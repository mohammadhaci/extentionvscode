import * as vscode from "vscode";
import { STUDIO_VERSION } from "../generated/version";
import { nonce } from "../shared/nonce";
import { scoreOf } from "./score";
import { localFolder } from "./setup";
import { collectStatus } from "./status";

export const HOME_VIEW_ID = "agentStudio.home";

/** Commands the Home view may run (anything else from the webview is ignored). */
const ALLOWED_COMMANDS = new Set([
  "agentStudio.setup",
  "agentStudio.setReference",
  "agentStudio.newApp",
  "agentStudio.checkApps",
  "agentStudio.openRules",
  "agentStudio.syncContext",
  "agentStudio.checkMigrations",
  "agentStudio.showReport",
  "agentStudio.copyReport",
  "agentStudio.openMap",
  "agentStudio.openSkills",
  "agentStudio.addMemory",
  "agentStudio.browseMemory",
  "agentStudio.runTask",
  "agentStudio.newTask",
]);

type Lang = "en" | "ar";
type FromWebview =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "run"; command: string }
  | { type: "task"; id: string }
  | { type: "lang"; lang: Lang };

function isFromWebview(m: unknown): m is FromWebview {
  if (typeof m !== "object" || m === null) {
    return false;
  }
  const t = (m as { type?: unknown }).type;
  if (t === "ready" || t === "refresh") {
    return true;
  }
  if (t === "run") {
    return typeof (m as { command?: unknown }).command === "string";
  }
  if (t === "task") {
    const id = (m as { id?: unknown }).id;
    return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
  }
  return t === "lang" && ((m as { lang?: unknown }).lang === "en" || (m as { lang?: unknown }).lang === "ar");
}

export class HomeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private timer?: NodeJS.Timeout;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get lang(): Lang {
    const saved = this.context.globalState.get<Lang>("agentStudio.lang");
    return saved ?? (vscode.env.language.toLowerCase().startsWith("ar") ? "ar" : "en");
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media", "studio");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const n = nonce();
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "home.js"));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "home.css"));
    view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${n}'; img-src ${view.webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Agent Studio</title>
</head>
<body>
<div id="app"></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
    view.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.refreshSoon(0);
      }
    });
  }

  private async onMessage(m: unknown): Promise<void> {
    if (!isFromWebview(m)) {
      return;
    }
    if (m.type === "ready" || m.type === "refresh") {
      this.refreshSoon(0);
    } else if (m.type === "lang") {
      await this.context.globalState.update("agentStudio.lang", m.lang);
      this.refreshSoon(0);
    } else if (m.type === "task") {
      await vscode.commands.executeCommand("agentStudio.runTask", m.id);
    } else if (m.type === "run" && ALLOWED_COMMANDS.has(m.command)) {
      try {
        await vscode.commands.executeCommand(m.command);
      } finally {
        this.refreshSoon(300);
      }
    }
  }

  /** Debounced refresh; only works while the view is visible. */
  refreshSoon(delay = 2000): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    const view = this.view;
    if (!view || !view.visible) {
      return;
    }
    const folder = localFolder();
    if (!folder) {
      void view.webview.postMessage({ type: "state", payload: { noFolder: true, lang: this.lang, version: STUDIO_VERSION } });
      return;
    }
    void view.webview.postMessage({ type: "busy" });
    try {
      const status = collectStatus(folder.uri.fsPath);
      const score = scoreOf(status);
      // Celebrate when a new quest step was reached, or the first time health hits 100.
      const key = `agentStudio.progress:${folder.uri.toString()}`;
      const prev = this.context.workspaceState.get<{ level: number; perfect: boolean }>(key);
      const perfect = score.health >= 100;
      const celebrate = prev !== undefined && (score.level > prev.level || (perfect && !prev.perfect));
      await this.context.workspaceState.update(key, { level: score.level, perfect });
      void view.webview.postMessage({ type: "state", payload: { status, score, lang: this.lang, version: STUDIO_VERSION, celebrate } });
    } catch (err) {
      void view.webview.postMessage({ type: "error", payload: { message: err instanceof Error ? err.message : String(err), lang: this.lang } });
    }
  }
}
