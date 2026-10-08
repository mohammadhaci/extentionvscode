import * as vscode from "vscode";
import { AGENT_TOOL_DIR, DEFAULT_SKILL_ROOTS, SKILL_NAME } from "./scaffold/agentKit";
import { CONFIG_FILE, isSafeRelativePath, parseConfig, ScaffoldConfig, withReferenceApp } from "./scaffold/config";
import { formatConformanceReport } from "./scaffold/conformance";
import { guessSingular, validateAppName } from "./scaffold/names";
import { planFiles, SourceFile } from "./scaffold/plan";
import { formatPreview } from "./scaffold/preview";
import { baseOf, checkConformance, FileText, joinPath as join, newAppRenamer, parentOf, planRegistrations, referenceEntity } from "./scaffold/workflow";

const EXCLUDE_DIRS = "{**/node_modules/**,**/.venv/**,**/venv/**,**/env/**,**/site-packages/**,**/.git/**,**/.tox/**,**/__pycache__/**}";
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_DEPTH = 20;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("django-app-scaffolder.newApp", (uri?: vscode.Uri) => run(() => newApp(uri))),
    vscode.commands.registerCommand("django-app-scaffolder.setReference", (uri?: vscode.Uri) => run(() => setReference(uri))),
    vscode.commands.registerCommand("django-app-scaffolder.checkApps", () => run(() => checkApps())),
    vscode.commands.registerCommand("django-app-scaffolder.installAgentKit", () => run(() => installAgentKit(context)))
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

  const refEntity = referenceEntity(refDir, config);
  let newEntity: string | undefined;
  if (refEntity) {
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

  const renamer = newAppRenamer(refDir, appName, config, newEntity?.trim());
  const pairs = renamer.pairs;
  const targetDir = join(parent, appName);

  const tree = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Reading ${refDir}…` },
    () => readTree(folder, refDir, true)
  );
  const plan = planFiles(tree.files, renamer, config.exclude);
  plan.skipped.push(...tree.skipped);

  const readAll = (paths: string[]): Promise<FileText[]> =>
    Promise.all(paths.map(async (p) => ({ path: p, text: await readText(uriOf(folder, p)) })));
  const { byFile: editsByFile, notes, descriptions: registrations } = planRegistrations(
    await readAll(await findProjectFiles(folder, SETTINGS_GLOB)),
    await readAll(await findProjectFiles(folder, "**/urls.py")),
    refDir,
    targetDir,
    renamer,
    config
  );

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
  const listing = async (dir: string): Promise<string[]> => (await readTree(folder, dir, false)).files.map((f) => f.relPath);
  const refFiles = await listing(refDir);
  const settingsTexts = await Promise.all((await findProjectFiles(folder, SETTINGS_GLOB)).map((f) => readText(uriOf(folder, f))));
  const apps = await Promise.all((await discoverAppDirs(folder)).map(async (dir) => ({ dir, files: new Set(await listing(dir)) })));
  const results = checkConformance(refDir, refFiles, apps, settingsTexts, config);
  const source = config.requiredFiles ? `\`requiredFiles\` in ${CONFIG_FILE}` : "the reference app's Python files";
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: formatConformanceReport(refDir, source, results) });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/**
 * Copies the CLI and the agent skill into the project so Claude Code, Codex and
 * Copilot can create apps from the reference without VS Code.
 */
async function installAgentKit(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const config = await loadConfig(folder);
  if (!config.referenceApp) {
    const pick = await vscode.window.showWarningMessage(
      "Agents need a reference app. Set one now?",
      { modal: true, detail: `Without "referenceApp" in ${CONFIG_FILE}, the CLI stops and asks for --reference.` },
      "Set Reference App"
    );
    if (pick === "Set Reference App") {
      await setReference();
    }
  }

  const outUri = vscode.Uri.joinPath(context.extensionUri, "out");
  const sources: { from: vscode.Uri; to: string }[] = [{ from: vscode.Uri.joinPath(outUri, "cli.js"), to: join(AGENT_TOOL_DIR, "cli.js") }];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(outUri, "scaffold"))) {
    if (type === vscode.FileType.File && name.endsWith(".js")) {
      sources.push({ from: vscode.Uri.joinPath(outUri, "scaffold", name), to: join(AGENT_TOOL_DIR, `scaffold/${name}`) });
    }
  }
  const skill = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, "agent-kit", "SKILL.md"));
  const skillRoots = vscode.workspace.getConfiguration("djangoScaffolder").get<string[]>("agentSkillRoots") ?? DEFAULT_SKILL_ROOTS;
  const skillTargets = skillRoots.filter(isSafeRelativePath).map((r) => join(r, `${SKILL_NAME}/SKILL.md`));

  const targets = [...sources.map((s) => s.to), join(AGENT_TOOL_DIR, "package.json"), ...skillTargets];
  const existing: string[] = [];
  for (const t of targets) {
    if (await exists(uriOf(folder, t))) {
      existing.push(t);
    }
  }
  const choice = await vscode.window.showInformationMessage(
    "Install the agent kit into this project?",
    {
      modal: true,
      detail: `Writes the CLI to ${AGENT_TOOL_DIR}/ and the "${SKILL_NAME}" skill to: ${skillRoots.join(", ")}.` +
        (existing.length > 0 ? `\n\nOverwrites ${existing.length} existing file(s) from an earlier install.` : ""),
    },
    "Install"
  );
  if (choice !== "Install") {
    return;
  }
  for (const s of sources) {
    await vscode.workspace.fs.writeFile(uriOf(folder, s.to), await vscode.workspace.fs.readFile(s.from));
  }
  // Keeps the CLI CommonJS even if the project's own package.json says "type": "module".
  await vscode.workspace.fs.writeFile(uriOf(folder, join(AGENT_TOOL_DIR, "package.json")), new TextEncoder().encode('{\n  "private": true,\n  "type": "commonjs"\n}\n'));
  for (const t of skillTargets) {
    await vscode.workspace.fs.writeFile(uriOf(folder, t), skill);
  }
  void vscode.window.showInformationMessage(
    `Agent kit installed. Commit ${AGENT_TOOL_DIR}/, ${CONFIG_FILE} and the skill folders so every agent (local or cloud) can use them.`
  );
}
