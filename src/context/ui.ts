import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { RULES_FILE } from "./config";
import { initRules, syncProject } from "./sync";

let output: vscode.OutputChannel | undefined;
const log = (line: string): void => {
  output ??= vscode.window.createOutputChannel("Agent Studio: Context");
  output.appendLine(line);
};

export function activateContext(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentStudio.syncContext", () => run(() => syncCommand())),
    vscode.commands.registerCommand("agentStudio.openRules", () => run(() => openRules()))
  );
  setUpAutoSync(context);
}

export function deactivate(): void {
  output?.dispose();
}

async function run(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    void vscode.window.showErrorMessage(`Agent Context Sync: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Local folders only: the sync engine reads the disk directly with Node's fs. */
function localFolders(): vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = localFolders();
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Open a local project folder first.");
    return undefined;
  }
  return folders.length === 1 ? folders[0] : vscode.window.showWorkspaceFolderPick({ placeHolder: "Which project?" });
}

function syncFolder(folder: vscode.WorkspaceFolder): { changed: string[]; problems: string[] } {
  const r = syncProject(folder.uri.fsPath);
  r.warnings.forEach((w) => log(`[${folder.name}] warning: ${w}`));
  const changed = r.results.filter((x) => x.status === "created" || x.status === "updated").map((x) => x.path);
  const problems = r.results.filter((x) => x.status === "error").map((x) => `${x.path}: ${x.error}`);
  r.results.forEach((x) => log(`[${folder.name}] ${x.status} ${x.path}${x.error ? ` (${x.error})` : ""}`));
  return { changed, problems };
}

async function syncCommand(): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const { changed, problems } = syncFolder(folder);
  if (problems.length > 0) {
    void vscode.window.showErrorMessage(`Agent context not fully synced: ${problems.join("; ")}`);
  } else {
    void vscode.window.showInformationMessage(changed.length > 0 ? `Agent context synced: ${changed.join(", ")}.` : "Agent context already up to date.");
  }
}

async function openRules(): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const created = initRules(folder.uri.fsPath);
  await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, ...RULES_FILE.split("/")));
  if (created) {
    void vscode.window.showInformationMessage("Created the rules file. Fill in the TODOs; saving it syncs CLAUDE.md, AGENTS.md and copilot-instructions.md.");
  }
}




/**
 * Re-syncs a folder a few seconds after Python files or the rules change, but
 * only in projects that opted in by having a rules file.
 */
function setUpAutoSync(context: vscode.ExtensionContext): void {
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (uri: vscode.Uri): void => {
    if (!vscode.workspace.getConfiguration("agentStudio").get<boolean>("autoSyncContext", true)) {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || folder.uri.scheme !== "file" || !fs.existsSync(path.join(folder.uri.fsPath, ...RULES_FILE.split("/")))) {
      return;
    }
    const key = folder.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        try {
          const { changed } = syncFolder(folder);
          if (changed.length > 0) {
            vscode.window.setStatusBarMessage(`$(sync) Agent context updated: ${changed.join(", ")}`, 5000);
          }
        } catch (err) {
          log(`[${folder.name}] auto-sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, 3000)
    );
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/{*.py,.agent-context/rules.md,.agent-context/config.json,.django-scaffold.json}");
  watcher.onDidChange(schedule);
  watcher.onDidCreate(schedule);
  watcher.onDidDelete(schedule);
  context.subscriptions.push(watcher, { dispose: () => timers.forEach((t) => clearTimeout(t)) });
}
