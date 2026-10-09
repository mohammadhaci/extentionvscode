import * as path from "path";
import * as vscode from "vscode";
import { buildReport } from "./build";
import { LinkFn, renderReport } from "./render";

export function activateReport(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentStudio.showReport", () => run(() => show(context))),
    vscode.commands.registerCommand("agentStudio.copyReport", () => run(() => copy()))
  );
}


async function run(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    void vscode.window.showErrorMessage(`Agent Change Report: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file");
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Open a local git project folder first.");
    return undefined;
  }
  return folders.length === 1 ? folders[0] : vscode.window.showWorkspaceFolderPick({ placeHolder: "Which project?" });
}

function generate(folder: vscode.WorkspaceFolder, link?: LinkFn): Thenable<{ markdown: string; verdict: string }> {
  const base = vscode.workspace.getConfiguration("agentStudio").get<string>("reportBase") || undefined;
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Building change report…" },
    async () => {
      const report = buildReport(folder.uri.fsPath, { base });
      return { markdown: renderReport(report, link), verdict: report.verdict };
    }
  );
}

/** Renders the report in the Markdown preview with clickable file links. */
async function show(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const link: LinkFn = (p, line) => {
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, ...p.split("/"))).toString();
    return `[${line ? `${p}:${line}` : p}](${uri}${line ? `#L${line}` : ""})`;
  };
  const { markdown } = await generate(folder, link);
  const file = vscode.Uri.joinPath(context.globalStorageUri, `change-report-${folder.name.replace(/[^\w.-]/g, "_")}.md`);
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(markdown));
  await vscode.commands.executeCommand("markdown.showPreview", file);
}

/** Copies the plain (repository-relative) report, ready to paste into a PR description. */
async function copy(): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const { markdown, verdict } = await generate(folder);
  await vscode.env.clipboard.writeText(markdown);
  void vscode.window.showInformationMessage(`Change report copied (verdict: ${verdict}). Paste it into the PR description.`);
}


