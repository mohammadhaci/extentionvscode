import * as path from "path";
import * as vscode from "vscode";
import { checkProject, isMigrationPath } from "./project";
import { formatText, summarize } from "./report";
import { Finding } from "./rules";

let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;

export function activateGuard(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("migrations-guard");
  output = vscode.window.createOutputChannel("Agent Studio: Migrations");
  context.subscriptions.push(
    diagnostics,
    output,
    vscode.commands.registerCommand("agentStudio.checkMigrations", () => run(() => checkCommand()))
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

const base = (): string => vscode.workspace.getConfiguration("agentStudio").get<string>("guardBase", "HEAD") || "HEAD";

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


