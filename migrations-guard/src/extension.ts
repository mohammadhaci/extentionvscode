import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { TOOL_DIR } from "./cli";
import { checkProject, isMigrationPath } from "./guard/project";
import { formatText, summarize } from "./guard/report";
import { Finding } from "./guard/rules";

const SKILL_NAME = "django-migrations-guard";
const SKILL_ROOTS = [".claude/skills", ".agents/skills", ".github/skills"];

let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("migrations-guard");
  output = vscode.window.createOutputChannel("Migrations Guard");
  context.subscriptions.push(
    diagnostics,
    output,
    vscode.commands.registerCommand("migrations-guard.check", () => run(() => checkCommand())),
    vscode.commands.registerCommand("migrations-guard.installTool", () => run(() => installTool(context)))
  );

  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (uri: vscode.Uri): void => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || folder.uri.scheme !== "file") {
      return;
    }
    const key = folder.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      refresh(folder);
    }, 1500));
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/migrations/*.py");
  watcher.onDidChange(schedule);
  watcher.onDidCreate(schedule);
  watcher.onDidDelete(schedule);
  context.subscriptions.push(watcher, { dispose: () => timers.forEach((t) => clearTimeout(t)) });
  localFolders().forEach((f) => refresh(f));
}

export function deactivate(): void {
  // Disposables are owned by the extension context.
}

async function run(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    void vscode.window.showErrorMessage(`Migrations Guard: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function localFolders(): vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
}

const base = (): string => vscode.workspace.getConfiguration("migrationsGuard").get<string>("base", "HEAD") || "HEAD";

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
} as const;

/** Re-checks a folder and replaces its diagnostics. Returns the findings, or undefined on failure. */
function refresh(folder: vscode.WorkspaceFolder): { findings: Finding[]; scope: string; checked: number } | undefined {
  const prefix = folder.uri.fsPath + path.sep;
  diagnostics.forEach((uri) => {
    if (uri.fsPath.startsWith(prefix)) {
      diagnostics.delete(uri);
    }
  });
  let result;
  try {
    result = checkProject(folder.uri.fsPath, { base: base() });
  } catch (err) {
    output.appendLine(`[${folder.name}] ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  result.warnings.forEach((w) => output.appendLine(`[${folder.name}] ${w}`));
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const f of result.findings.filter((x) => !x.allowedReason)) {
    const line = Math.max(0, f.line - 1);
    const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 200), `${f.message} ${f.hint}`, SEVERITY[f.severity]);
    d.source = "migrations-guard";
    d.code = f.rule;
    byFile.set(f.file, [...(byFile.get(f.file) ?? []), d]);
  }
  for (const [file, list] of byFile) {
    if (isMigrationPath(file)) {
      diagnostics.set(vscode.Uri.joinPath(folder.uri, ...file.split("/")), list);
    }
  }
  return result;
}

async function checkCommand(): Promise<void> {
  const folders = localFolders();
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Open a local Django project folder first.");
    return;
  }
  let errors = 0;
  let warnings = 0;
  for (const folder of folders) {
    const result = refresh(folder);
    if (!result) {
      continue;
    }
    output.appendLine(`\n[${folder.name}]\n${formatText(result.findings, result.scope, result.checked)}`);
    const s = summarize(result.findings);
    errors += s.errors;
    warnings += s.warnings;
  }
  output.show(true);
  const msg = `Migrations Guard: ${errors} error(s), ${warnings} warning(s). Details in the Problems panel.`;
  void (errors > 0 ? vscode.window.showErrorMessage(msg) : vscode.window.showInformationMessage(msg));
}

function copyTree(fromDir: string, toDir: string, skip: (rel: string) => boolean, rel = ""): void {
  for (const e of fs.readdirSync(path.join(fromDir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (skip(child)) {
      continue;
    }
    if (e.isDirectory()) {
      copyTree(fromDir, toDir, skip, child);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      fs.mkdirSync(path.join(toDir, rel), { recursive: true });
      fs.copyFileSync(path.join(fromDir, child), path.join(toDir, child));
    }
  }
}

/** Copies the CLI and the agent skill into the project. */
async function installTool(context: vscode.ExtensionContext): Promise<void> {
  const folders = localFolders();
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: "Which project?" });
  if (!folder) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Install Migrations Guard for agents?",
    { modal: true, detail: `Writes ${TOOL_DIR}/ and the "${SKILL_NAME}" skill into ${SKILL_ROOTS.join(", ")} (replacing earlier installs).` },
    "Install"
  );
  if (choice !== "Install") {
    return;
  }
  const root = folder.uri.fsPath;
  const dest = path.join(root, ...TOOL_DIR.split("/"));
  fs.rmSync(dest, { recursive: true, force: true });
  copyTree(path.join(context.extensionPath, "out"), dest, (rel) => rel === "test" || rel === "extension.js");
  // Keeps the CLI CommonJS even if the project's own package.json says "type": "module".
  fs.writeFileSync(path.join(dest, "package.json"), '{\n  "private": true,\n  "type": "commonjs"\n}\n');
  const skill = fs.readFileSync(path.join(context.extensionPath, "agent-kit", "SKILL.md"));
  for (const r of SKILL_ROOTS) {
    const dir = path.join(root, ...r.split("/"), SKILL_NAME);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skill);
  }
  void vscode.window.showInformationMessage(
    `Installed ${TOOL_DIR}/ and the ${SKILL_NAME} skill. Commit them; add \`node ${TOOL_DIR}/cli.js check --base origin/main\` to CI.`
  );
}
