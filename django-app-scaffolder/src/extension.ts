import * as vscode from "vscode";
import { CONFIG_FILE, parseConfig, ScaffoldConfig, withReferenceApp } from "./scaffold/config";
import { expectedFiles, formatConformanceReport, missingFiles, AppConformance } from "./scaffold/conformance";
import { guessSingular, splitWords, validateAppName } from "./scaffold/names";
import { planFiles, SourceFile } from "./scaffold/plan";
import { formatPreview } from "./scaffold/preview";
import { isRegistered, planSettingsRegistration, planUrlsRegistration, RegistrationEdit } from "./scaffold/registration";
import { buildRenamePairs, createRenamer } from "./scaffold/rename";

const EXCLUDE_DIRS = "{**/node_modules/**,**/.venv/**,**/venv/**,**/env/**,**/site-packages/**,**/.git/**,**/.tox/**,**/__pycache__/**}";
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_DEPTH = 20;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("django-app-scaffolder.newApp", (uri?: vscode.Uri) => run(() => newApp(uri))),
    vscode.commands.registerCommand("django-app-scaffolder.setReference", (uri?: vscode.Uri) => run(() => setReference(uri))),
    vscode.commands.registerCommand("django-app-scaffolder.checkApps", () => run(() => checkApps()))
  );
}

export function deactivate(): void {
  // Nothing to clean up.
}

async function run(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    void vscode.window.showErrorMessage(`Django App Scaffolder: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

function rel(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  const root = folder.uri.path.replace(/\/+$/, "");
  return uri.path === root ? "" : uri.path.startsWith(`${root}/`) ? uri.path.slice(root.length + 1) : uri.path;
}
const parentOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
const uriOf = (folder: vscode.WorkspaceFolder, relPath: string): vscode.Uri =>
  relPath ? vscode.Uri.joinPath(folder.uri, ...relPath.split("/")) : folder.uri;

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri));
}

async function pickFolder(hint?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Open your Django project folder first (File → Open Folder).");
    return undefined;
  }
  if (hint) {
    const f = vscode.workspace.getWorkspaceFolder(hint);
    if (f) {
      return f;
    }
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({ placeHolder: "Which project?" });
}

async function loadConfig(folder: vscode.WorkspaceFolder): Promise<ScaffoldConfig> {
  const uri = uriOf(folder, CONFIG_FILE);
  if (!(await exists(uri))) {
    return {};
  }
  const { config, errors } = parseConfig(await readText(uri));
  if (errors.length > 0) {
    void vscode.window.showWarningMessage(`${CONFIG_FILE}: ${errors.join(" ")} Invalid keys are ignored.`);
  }
  return config;
}

/** Folders containing apps.py, workspace-relative and sorted. */
async function discoverAppDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
  const hits = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/apps.py"), EXCLUDE_DIRS, 1000);
  return [...new Set(hits.map((u) => parentOf(rel(folder, u))))].filter(Boolean).sort();
}

async function isAppDir(folder: vscode.WorkspaceFolder, dir: string): Promise<boolean> {
  return dir !== "" && (await exists(uriOf(folder, join(dir, "apps.py"))));
}

/** Recursively lists a folder (optionally reading bytes). Symlinks are skipped, sizes are bounded. */
async function readTree(folder: vscode.WorkspaceFolder, dir: string, withBytes: boolean): Promise<{ files: SourceFile[]; skipped: string[] }> {
  const files: SourceFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  const walk = async (sub: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      skipped.push(`${sub || "."} (too deep)`);
      return;
    }
    const entries = await vscode.workspace.fs.readDirectory(uriOf(folder, join(dir, sub)));
    entries.sort(([a], [b]) => a.localeCompare(b));
    for (const [name, type] of entries) {
      const relPath = join(sub, name);
      if (type & vscode.FileType.SymbolicLink) {
        skipped.push(`${relPath} (symlink)`);
      } else if (type & vscode.FileType.Directory) {
        if (name !== "__pycache__" && name !== "node_modules" && name !== ".git") {
          await walk(relPath, depth + 1);
        }
      } else if (type & vscode.FileType.File) {
        if (files.length >= MAX_FILES) {
          throw new Error(`Reference app has more than ${MAX_FILES} files.`);
        }
        if (!withBytes) {
          files.push({ relPath, bytes: new Uint8Array() });
          continue;
        }
        const bytes = await vscode.workspace.fs.readFile(uriOf(folder, join(dir, relPath)));
        if (bytes.length > MAX_FILE_BYTES) {
          skipped.push(`${relPath} (larger than 2 MB)`);
          continue;
        }
        total += bytes.length;
        if (total > MAX_TOTAL_BYTES) {
          throw new Error("Reference app is larger than 30 MB.");
        }
        files.push({ relPath, bytes });
      }
    }
  };
  await walk("", 0);
  return { files, skipped };
}

async function findProjectFiles(folder: vscode.WorkspaceFolder, glob: string): Promise<string[]> {
  const hits = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, glob), EXCLUDE_DIRS, 300);
  return hits.map((u) => rel(folder, u)).sort();
}

const SETTINGS_GLOB = "{**/*settings*.py,**/settings/*.py}";

async function resolveReference(folder: vscode.WorkspaceFolder, config: ScaffoldConfig, hint?: vscode.Uri): Promise<string | undefined> {
  if (hint) {
    const dir = rel(folder, hint);
    if (await isAppDir(folder, dir)) {
      return dir;
    }
  }
  if (config.referenceApp) {
    if (await isAppDir(folder, config.referenceApp)) {
      return config.referenceApp;
    }
    void vscode.window.showWarningMessage(`Reference app "${config.referenceApp}" from ${CONFIG_FILE} has no apps.py; pick one instead.`);
  }
  const dirs = await discoverAppDirs(folder);
  if (dirs.length === 0) {
    void vscode.window.showErrorMessage("No Django apps (folders with apps.py) found in this project.");
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    dirs.map((d) => ({ label: baseOf(d), description: d, dir: d })),
    { placeHolder: "Reference app to clone (tip: right-click it → Set as Reference App to skip this step)" }
  );
  return pick?.dir;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function newApp(hint?: vscode.Uri): Promise<void> {
  const folder = await pickFolder(hint);
  if (!folder) {
    return;
  }
  const config = await loadConfig(folder);
  const refDir = await resolveReference(folder, config, hint);
  if (!refDir) {
    return;
  }
  const refName = baseOf(refDir);
  const parent = parentOf(refDir);
  const siblings = new Set((await vscode.workspace.fs.readDirectory(uriOf(folder, parent))).map(([n]) => n));

  const newName = await vscode.window.showInputBox({
    title: `New app from "${refDir}"`,
    prompt: `Folder name, created next to ${refName} in ${parent || "the project root"}`,
    placeHolder: "e.g. invoices",
    validateInput: (v) => validateAppName(v.trim(), siblings),
  });
  if (!newName) {
    return;
  }
  const appName = newName.trim();

  const refEntity = config.referenceEntity ?? guessSingular(refName);
  let newEntity: string | undefined;
  if (splitWords(refEntity).join("_") !== refName) {
    newEntity = await vscode.window.showInputBox({
      title: "Singular name",
      prompt: `Inside ${refName}, "${refEntity}" (Order, order_id, OrderSerializer…) will be renamed to:`,
      value: guessSingular(appName),
      validateInput: (v) => (/^[A-Za-z][A-Za-z0-9_ -]*$/.test(v.trim()) ? undefined : "Letters, digits, spaces, _ or - only."),
    });
    if (newEntity === undefined) {
      return;
    }
  }

  const pairs = buildRenamePairs(refName, appName, newEntity ? refEntity : undefined, newEntity?.trim());
  const renamer = createRenamer(pairs);
  const targetDir = join(parent, appName);

  const tree = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Reading ${refDir}…` },
    () => readTree(folder, refDir, true)
  );
  const plan = planFiles(tree.files, renamer, config.exclude);
  plan.skipped.push(...tree.skipped);

  const notes: string[] = [];
  const editsByFile = new Map<string, { text: string; edits: RegistrationEdit[] }>();
  const collect = async (files: string[], planner: typeof planSettingsRegistration): Promise<void> => {
    for (const f of files) {
      if (f.startsWith(`${refDir}/`)) {
        continue;
      }
      const text = await readText(uriOf(folder, f));
      const r = planner(text, refDir, renamer, f);
      notes.push(...r.notes);
      if (r.edits.length > 0) {
        const entry = editsByFile.get(f) ?? { text, edits: [] };
        entry.edits.push(...r.edits);
        editsByFile.set(f, entry);
      }
    }
  };
  if (config.registerInSettings !== false) {
    const notesBefore = notes.length;
    await collect(await findProjectFiles(folder, SETTINGS_GLOB), planSettingsRegistration);
    if (editsByFile.size === 0 && notes.length === notesBefore) {
      notes.push(`Add "${targetDir.replace(/\//g, ".")}" to INSTALLED_APPS manually (reference entry not found).`);
    }
  }
  if (config.registerInUrls !== false) {
    await collect(await findProjectFiles(folder, "**/urls.py"), planUrlsRegistration);
  }
  const registrations = [...editsByFile.values()].flatMap((e) => e.edits.map((x) => x.description));

  const preview = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: formatPreview({ referenceDir: refDir, targetDir, pairs, plan, registrations, notes }),
  });
  await vscode.window.showTextDocument(preview, { preview: true, viewColumn: vscode.ViewColumn.Beside });

  if (plan.errors.length > 0) {
    void vscode.window.showErrorMessage("Cannot create the app; see “Needs attention” in the preview.");
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Create "${targetDir}"?`,
    { modal: true, detail: `${plan.files.length} files, ${registrations.length} registration edit(s). Review the preview beside this dialog.` },
    "Create"
  );
  if (choice !== "Create") {
    return;
  }

  const targetUri = uriOf(folder, targetDir);
  if (await exists(targetUri)) {
    throw new Error(`"${targetDir}" already exists; nothing was written.`);
  }
  let written = 0;
  try {
    for (const f of plan.files) {
      await vscode.workspace.fs.writeFile(uriOf(folder, join(targetDir, f.targetRel)), f.bytes);
      written++;
    }
  } catch (err) {
    throw new Error(`Stopped after writing ${written} of ${plan.files.length} files into "${targetDir}": ${err instanceof Error ? err.message : String(err)}`);
  }

  // Registration edits stay unsaved so they can be reviewed or undone.
  const edit = new vscode.WorkspaceEdit();
  const stale: string[] = [];
  for (const [file, { text, edits }] of editsByFile) {
    const doc = await vscode.workspace.openTextDocument(uriOf(folder, file));
    if (doc.getText() !== text) {
      stale.push(file);
      continue;
    }
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    for (const e of edits) {
      const body = e.text.split(/\r?\n/).join(eol);
      if (e.insertAtLine < doc.lineCount) {
        edit.insert(doc.uri, new vscode.Position(e.insertAtLine, 0), body + eol);
      } else {
        edit.insert(doc.uri, doc.lineAt(doc.lineCount - 1).range.end, eol + body);
      }
    }
  }
  await vscode.workspace.applyEdit(edit);

  const appsPy = plan.files.find((f) => f.targetRel === "apps.py") ?? plan.files[0];
  if (appsPy) {
    await vscode.window.showTextDocument(uriOf(folder, join(targetDir, appsPy.targetRel)), { preview: false });
  }
  const staleNote = stale.length > 0 ? ` Skipped edits in changed file(s): ${stale.join(", ")}.` : "";
  void vscode.window.showInformationMessage(
    `Created "${targetDir}" (${written} files). Registration edits are unsaved: review and save, then run makemigrations.${staleNote}`
  );
}

async function setReference(hint?: vscode.Uri): Promise<void> {
  const folder = await pickFolder(hint);
  if (!folder) {
    return;
  }
  let dir = hint ? rel(folder, hint) : undefined;
  if (!dir || !(await isAppDir(folder, dir))) {
    const dirs = await discoverAppDirs(folder);
    const pick = await vscode.window.showQuickPick(dirs, { placeHolder: "Which app is the approved reference template?" });
    if (!pick) {
      return;
    }
    dir = pick;
  }
  const uri = uriOf(folder, CONFIG_FILE);
  const existing = (await exists(uri)) ? await readText(uri) : undefined;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(withReferenceApp(existing, dir)));
  void vscode.window.showInformationMessage(`"${dir}" is now the reference app (saved in ${CONFIG_FILE}; commit it to share with the team).`);
}

async function checkApps(): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const config = await loadConfig(folder);
  const refDir = await resolveReference(folder, config);
  if (!refDir) {
    return;
  }
  const refName = baseOf(refDir);
  const refEntity = config.referenceEntity ?? guessSingular(refName);
  const refFiles = (await readTree(folder, refDir, false)).files.map((f) => f.relPath);
  const settingsTexts = await Promise.all((await findProjectFiles(folder, SETTINGS_GLOB)).map((f) => readText(uriOf(folder, f))));

  const results: AppConformance[] = [];
  for (const dir of await discoverAppDirs(folder)) {
    if (dir === refDir || dir.startsWith(`${refDir}/`)) {
      continue;
    }
    const name = baseOf(dir);
    const renamer = createRenamer(buildRenamePairs(refName, name, refEntity, guessSingular(name)));
    const expected = expectedFiles(refFiles, renamer, config.requiredFiles, config.exclude);
    const actual = new Set((await readTree(folder, dir, false)).files.map((f) => f.relPath));
    results.push({ dir, missing: missingFiles(expected, actual), registered: isRegistered(settingsTexts, dir) });
  }
  const source = config.requiredFiles ? `\`requiredFiles\` in ${CONFIG_FILE}` : "the reference app's Python files";
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: formatConformanceReport(refDir, source, results) });
  await vscode.window.showTextDocument(doc, { preview: true });
}
