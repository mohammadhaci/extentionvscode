import * as path from "path";
import * as vscode from "vscode";
import { AppSummary } from "../context/projectMap";
import { BUILTIN_TASKS, buildPrompt, findTask, listTasks, projectSummary, TaskDef } from "./library";
import { createCustomTask, taskFileText, writeRun } from "./runs";

type Target = "claude" | "codex" | "copilot" | "clipboard" | "file";

const TARGETS: { id: Target; label: string; detail: string }[] = [
  { id: "claude", label: "$(terminal) Claude Code", detail: "Runs Claude Code in a terminal with the task" },
  { id: "codex", label: "$(terminal) Codex", detail: "Runs Codex CLI in a terminal with the task" },
  { id: "copilot", label: "$(copilot) Copilot Chat", detail: "Opens Copilot Chat (agent mode) with the task" },
  { id: "clipboard", label: "$(clippy) Copy to clipboard", detail: "Paste it into any agent" },
  { id: "file", label: "$(file) Open as a file", detail: "Read or edit the prompt first" },
];
const LAST_TARGET = "agentStudio.lastTaskTarget";

function folder(): vscode.WorkspaceFolder | undefined {
  const f = (vscode.workspace.workspaceFolders ?? []).find((w) => w.uri.scheme === "file");
  if (!f) {
    void vscode.window.showErrorMessage("Open your project folder first.");
  }
  return f;
}

async function pickTask(tasks: readonly TaskDef[], onlyApp: boolean): Promise<TaskDef | undefined> {
  const list = onlyApp ? tasks.filter((t) => t.scope !== "project") : tasks;
  const pick = await vscode.window.showQuickPick(
    list.map((t) => ({ label: `${t.icon} ${t.title}`, description: t.path ? "custom" : undefined, detail: t.description, task: t })),
    { title: "Give an agent a task", placeHolder: "What should the agent do?", matchOnDetail: true }
  );
  return pick?.task;
}

async function pickApp(task: TaskDef, apps: readonly AppSummary[], reference?: string): Promise<{ app?: string } | undefined> {
  if (apps.length === 0) {
    if (task.scope === "app") {
      void vscode.window.showWarningMessage("No Django apps found in this project.");
      return undefined;
    }
    return {};
  }
  type Item = vscode.QuickPickItem & { app?: string };
  const items: Item[] = [
    ...(task.scope === "any" ? [{ label: "$(globe) Whole project", app: undefined } as Item] : []),
    ...apps.map((a) => ({
      label: `$(package) ${a.dir}`,
      description: [a.dir === reference ? "reference app" : "", a.models.length ? `${a.models.length} models` : ""].filter(Boolean).join(" · "),
      app: a.dir,
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, { title: `${task.icon} ${task.title}`, placeHolder: task.scope === "app" ? "Which app?" : "Whole project or one app?" });
  return pick ? { app: pick.app } : undefined;
}

async function pickTarget(context: vscode.ExtensionContext): Promise<Target | undefined> {
  const setting = vscode.workspace.getConfiguration("agentStudio").get<string>("taskTarget", "ask");
  if (TARGETS.some((t) => t.id === setting)) {
    return setting as Target;
  }
  const last = context.globalState.get<Target>(LAST_TARGET);
  const ordered = [...TARGETS].sort((a, b) => Number(b.id === last) - Number(a.id === last));
  const pick = await vscode.window.showQuickPick(
    ordered.map((t) => ({ label: t.label, detail: t.detail, id: t.id })),
    { title: "Send the task to…", placeHolder: "Set agentStudio.taskTarget to skip this step" }
  );
  if (pick) {
    await context.globalState.update(LAST_TARGET, pick.id);
  }
  return pick?.id;
}

async function deliver(root: vscode.Uri, task: TaskDef, prompt: string, target: Target): Promise<void> {
  const rel = writeRun(root.fsPath, task.id, prompt);
  const config = vscode.workspace.getConfiguration("agentStudio");
  if (target === "claude" || target === "codex") {
    const cmd = config.get<string>(target === "claude" ? "claudeCommand" : "codexCommand", target);
    const terminal = vscode.window.createTerminal({ name: `${task.icon} ${task.title}`, cwd: root.fsPath });
    terminal.show();
    // The full prompt is in a file; the command line stays short and safe in every shell.
    terminal.sendText(`${cmd} "Read ${rel} and carry out the task it describes."`);
    return;
  }
  if (target === "copilot") {
    for (const args of [{ query: prompt, mode: "agent" }, { query: prompt }]) {
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", args);
        return;
      } catch {
        // older VS Code: try without the mode, then fall back to the clipboard
      }
    }
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showWarningMessage("Couldn't open Copilot Chat. The task is on the clipboard: paste it into the chat.");
    return;
  }
  if (target === "clipboard") {
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(`${task.icon} "${task.title}" copied. Paste it into any agent.`);
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.joinPath(root, ...rel.split("/")), { preview: false });
}

/** Explorer folder -> the app it is (or is inside of). */
function appOfUri(root: vscode.Uri, uri: vscode.Uri, apps: readonly AppSummary[]): string | undefined {
  const rel = path.relative(root.fsPath, uri.fsPath).split(path.sep).join("/");
  return apps
    .filter((a) => rel === a.dir || rel.startsWith(`${a.dir}/`))
    .sort((a, b) => b.dir.length - a.dir.length)[0]?.dir;
}

async function runTask(context: vscode.ExtensionContext, arg?: unknown): Promise<void> {
  const f = folder();
  if (!f) {
    return;
  }
  const root = f.uri.fsPath;
  const problems: string[] = [];
  const tasks = listTasks(root, problems);
  if (problems.length > 0) {
    void vscode.window.showWarningMessage(`Some custom tasks were skipped: ${problems.join("; ")}`);
  }
  const summary = projectSummary(root);
  const fromExplorer = arg instanceof vscode.Uri ? appOfUri(f.uri, arg, summary.apps) : undefined;
  if (arg instanceof vscode.Uri && !fromExplorer) {
    void vscode.window.showWarningMessage("That folder is not a Django app of this project.");
    return;
  }

  const task = typeof arg === "string" ? findTask(tasks, arg) : await pickTask(tasks, fromExplorer !== undefined);
  if (!task) {
    return;
  }
  let app = task.scope === "project" ? undefined : fromExplorer;
  if (task.scope !== "project" && !fromExplorer) {
    const picked = await pickApp(task, summary.apps, summary.referenceApp);
    if (!picked) {
      return;
    }
    app = picked.app;
  }
  let input: string | undefined;
  if (task.input) {
    input = await vscode.window.showInputBox({ title: `${task.icon} ${task.title}`, prompt: task.input, validateInput: (v) => (v.trim() ? undefined : "Required") });
    if (!input) {
      return;
    }
  }
  const prompt = buildPrompt(root, task, { app, input }, summary);
  const target = await pickTarget(context);
  if (target) {
    await deliver(f.uri, task, prompt, target);
  }
}

async function newTask(): Promise<void> {
  const f = folder();
  if (!f) {
    return;
  }
  const start = await vscode.window.showQuickPick(
    [
      { label: "$(new-file) Blank task", id: "" },
      ...BUILTIN_TASKS.map((t) => ({ label: `${t.icon} Start from "${t.title}"`, description: "copy and edit for this project", id: t.id })),
    ],
    { title: "New custom task (1/2)", placeHolder: "Start from scratch or adapt a built-in task" }
  );
  if (!start) {
    return;
  }
  const base = BUILTIN_TASKS.find((t) => t.id === start.id);
  const id = await vscode.window.showInputBox({
    title: "New custom task (2/2)",
    prompt: base ? "File name (keep the same id to replace the built-in task)" : "File name",
    value: base?.id ?? "",
    placeHolder: "e.g. check-translations",
    validateInput: (v) => (/^[a-z0-9][a-z0-9-]{0,63}$/.test(v) ? undefined : "Lowercase letters, digits and dashes"),
  });
  if (!id) {
    return;
  }
  const rel = createCustomTask(f.uri.fsPath, id, base ? taskFileText(base) : undefined);
  await vscode.window.showTextDocument(vscode.Uri.joinPath(f.uri, ...rel.split("/")), { preview: false });
  void vscode.window.showInformationMessage(`⭐ Edit the task, then commit ${rel} so the whole team gets the button.`);
}

export function activateTasks(context: vscode.ExtensionContext): void {
  const safe = (task: (arg?: unknown) => Promise<void>) => async (arg?: unknown): Promise<void> => {
    try {
      await task(arg);
    } catch (err) {
      void vscode.window.showErrorMessage(`Agent task: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("agentStudio.runTask", safe((arg) => runTask(context, arg))),
    vscode.commands.registerCommand("agentStudio.newTask", safe(newTask))
  );
}
