import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { syncProject } from "../context/sync";
import { RULES_FILE } from "../studio/paths";
import { addMemory, listMemories, MEMORY_TYPES, MemoryType, TYPE_ICON } from "./memory";

const TYPE_HELP: Record<MemoryType, string> = {
  knowledge: "How the business or the project works",
  decision: "A choice that was made, and why",
  gotcha: "A trap that will bite the next person",
  convention: "A pattern the code follows",
  lesson: "A tricky bug and how it was fixed",
};

function folder(): vscode.WorkspaceFolder | undefined {
  const f = (vscode.workspace.workspaceFolders ?? []).find((w) => w.uri.scheme === "file");
  if (!f) {
    void vscode.window.showErrorMessage("Open your project folder first.");
  }
  return f;
}

function refresh(root: string): void {
  if (fs.existsSync(path.join(root, ...RULES_FILE.split("/")))) {
    syncProject(root);
  }
}

async function addCommand(): Promise<void> {
  const f = folder();
  if (!f) {
    return;
  }
  const type = await vscode.window.showQuickPick(
    MEMORY_TYPES.map((t) => ({ label: `${TYPE_ICON[t]} ${t}`, description: TYPE_HELP[t], type: t })),
    { title: "Add to project memory (1/3)", placeHolder: "What kind of memory?" }
  );
  if (!type) {
    return;
  }
  const title = await vscode.window.showInputBox({
    title: "Add to project memory (2/3)",
    prompt: "A short title someone can scan",
    placeHolder: "e.g. RFQ loops are versioned; a new loop copies the previous one",
    validateInput: (v) => (v.trim() ? undefined : "Enter a title"),
  });
  if (!title) {
    return;
  }
  const body = await vscode.window.showInputBox({
    title: "Add to project memory (3/3)",
    prompt: "Details: what, why, and where in the code (optional; you can edit the file afterwards)",
  });
  if (body === undefined) {
    return;
  }
  const entry = addMemory(f.uri.fsPath, { type: type.type, title, body, author: "human" });
  refresh(f.uri.fsPath);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(f.uri, ...entry.path.split("/")));
  await vscode.window.showTextDocument(doc, { preview: false });
  void vscode.window.showInformationMessage(`🐘 Saved to project memory. Every agent will see it. Commit ${entry.path}.`);
}

async function browseCommand(): Promise<void> {
  const f = folder();
  if (!f) {
    return;
  }
  const entries = listMemories(f.uri.fsPath);
  if (entries.length === 0) {
    const pick = await vscode.window.showInformationMessage("The project memory is empty.", "Add Memory");
    if (pick) {
      await addCommand();
    }
    return;
  }
  const pick = await vscode.window.showQuickPick(
    entries.map((e) => ({
      label: `${TYPE_ICON[e.type]} ${e.title}`,
      description: [e.tags.join(", "), e.status === "outdated" ? "outdated" : ""].filter(Boolean).join(" · "),
      detail: `${e.type} · ${e.date} · ${e.author}${e.body ? ` · ${e.body.replace(/\s+/g, " ").slice(0, 120)}` : ""}`,
      entry: e,
    })),
    { title: `Project memory (${entries.length})`, placeHolder: "Search titles, tags and text", matchOnDescription: true, matchOnDetail: true }
  );
  if (pick) {
    await vscode.window.showTextDocument(vscode.Uri.joinPath(f.uri, ...pick.entry.path.split("/")), { preview: true });
  }
}

export function activateMemory(context: vscode.ExtensionContext): void {
  const run = (task: () => Promise<void>) => async (): Promise<void> => {
    try {
      await task();
    } catch (err) {
      void vscode.window.showErrorMessage(`Project memory: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("agentStudio.addMemory", run(addCommand)),
    vscode.commands.registerCommand("agentStudio.browseMemory", run(browseCommand))
  );
}
