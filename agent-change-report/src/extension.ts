import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { TOOL_DIR } from "./cli";
import { buildReport } from "./report/build";
import { LinkFn, renderReport } from "./report/render";

const SKILL_NAME = "agent-change-report";
const SKILL_ROOTS = [".claude/skills", ".agents/skills", ".github/skills"];

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("agent-change-report.show", () => run(() => show(context))),
    vscode.commands.registerCommand("agent-change-report.copy", () => run(() => copy())),
    vscode.commands.registerCommand("agent-change-report.installTool", () => run(() => installTool(context)))
  );
}

export function deactivate(): void {
  // Nothing to clean up.
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
  const base = vscode.workspace.getConfiguration("agentChangeReport").get<string>("base") || undefined;
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

async function installTool(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Install Agent Change Report for agents?",
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
    `Installed ${TOOL_DIR}/ and the ${SKILL_NAME} skill. Commit them; re-install the CI guardrails workflow to post the report on every PR.`
  );
}
