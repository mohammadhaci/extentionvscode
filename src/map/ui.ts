import * as vscode from "vscode";
import { analyzeWorkspace } from "../analyzer/analyzeWorkspace";
import type { ProjectMap } from "../shared/graphTypes";
import { nonce } from "../shared/nonce";
import { isWebviewToHostMessage } from "../shared/messages";
import type { HostToWebviewMessage } from "../shared/messages";
import { isSafeWorkspaceRelativePath } from "../shared/workspacePath";

export const MAP_VIEW_ID = "agentStudio.map";

export function activateMap(context: vscode.ExtensionContext): void {
  const sidebar = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MAP_VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand("agentStudio.openMap", () =>
      openMapPanel(context)
    ),
    vscode.commands.registerCommand("agentStudio.refreshMap", async () => {
      await sidebar.refresh();
      await MapPanel.refreshAll();
    })
  );
}

export function deactivateMap(): void {
  MapPanel.disposeAll();
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

function activeFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

async function openFileAt(file: unknown, line?: unknown): Promise<void> {
  if (!isSafeWorkspaceRelativePath(file)) {
    void vscode.window.showWarningMessage("Invalid file reference from project map.");
    return;
  }
  const lineNo = typeof line === "number" && Number.isFinite(line) ? line : undefined;
  const folder = activeFolder();
  if (!folder) {
    void vscode.window.showWarningMessage("No workspace folder is open.");
    return;
  }
  const uri = vscode.Uri.joinPath(folder.uri, ...file.split("/"));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    if (lineNo && lineNo >= 1) {
      const pos = new vscode.Position(Math.min(lineNo - 1, doc.lineCount - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(
        new vscode.Range(pos, pos),
        vscode.TextEditorRevealType.InCenter
      );
    }
  } catch {
    void vscode.window.showWarningMessage(`Could not open ${file}.`);
  }
}

async function analyzeOrError(
  post: (msg: HostToWebviewMessage) => void,
  progress?: (message: string) => void
): Promise<void> {
  const folder = activeFolder();
  if (!folder) {
    post({
      type: "error",
      payload: {
        message: "No folder is open.",
        detail:
          "Open a folder containing a Django project (File → Open Folder), then run “Agent Studio: Open Project Map” again."
      }
    });
    return;
  }
  try {
    progress?.("Analyzing Django project…");
    const map: ProjectMap = await analyzeWorkspace(folder, progress);
    post({ type: "mapData", payload: map });
  } catch (err) {
    post({
      type: "error",
      payload: {
        message: "Analysis failed.",
        detail: err instanceof Error ? err.message : String(err)
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Full map panel
// ---------------------------------------------------------------------------

class MapPanel {
  private static panels = new Set<MapPanel>();
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel
  ) {
    this.panel = panel;
    MapPanel.panels.add(this);
    this.panel.webview.html = getPanelHtml(this.context, this.panel.webview);
    this.panel.webview.onDidReceiveMessage(
      async (raw: unknown) => {
        if (!isWebviewToHostMessage(raw)) {
          return;
        }
        const msg = raw;
        if (msg.type === "ready" || msg.type === "refresh") {
          await analyzeOrError(
            (m) => void this.panel.webview.postMessage(m),
            (message) =>
              void this.panel.webview.postMessage({
                type: "progress",
                payload: { message }
              } satisfies HostToWebviewMessage)
          );
        } else if (msg.type === "openFile") {
          await openFileAt(msg.payload.file, msg.payload.line);
        }
      },
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static async refreshAll(): Promise<void> {
    for (const p of [...MapPanel.panels]) {
      await p.refresh();
    }
  }

  static disposeAll(): void {
    for (const p of [...MapPanel.panels]) {
      p.dispose();
    }
  }

  async refresh(): Promise<void> {
    await analyzeOrError((m) => void this.panel.webview.postMessage(m));
  }

  dispose(): void {
    MapPanel.panels.delete(this);
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}

function openMapPanel(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    "djangoVisualMap",
    "Django Project Map",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
    }
  );
  new MapPanel(context, panel);
}

// ---------------------------------------------------------------------------
// Sidebar (Activity Bar view)
// ---------------------------------------------------------------------------

class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };
    view.webview.html = getSidebarHtml(this.extensionUri, view.webview);
    view.webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!isWebviewToHostMessage(raw)) {
        return;
      }
      if (raw.type === "openPanel") {
        await vscode.commands.executeCommand("django-visual-map.openMap");
      } else if (raw.type === "openFile") {
        await openFileAt(raw.payload.file, raw.payload.line);
      } else if (raw.type === "ready" || raw.type === "refresh") {
        await this.refresh();
      }
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const folder = activeFolder();
    if (!folder) {
      void this.view.webview.postMessage({
        type: "error",
        payload: {
          message: "No folder is open.",
          detail: "Open a Django project folder to see its map summary."
        }
      } satisfies HostToWebviewMessage);
      return;
    }
    try {
      const map = await analyzeWorkspace(folder);
      void this.view.webview.postMessage({ type: "mapData", payload: map } satisfies HostToWebviewMessage);
    } catch (err) {
      void this.view.webview.postMessage({
        type: "error",
        payload: {
          message: "Analysis failed.",
          detail: err instanceof Error ? err.message : String(err)
        }
      } satisfies HostToWebviewMessage);
    }
  }
}

// ---------------------------------------------------------------------------
// HTML (secure CSP + local resources + nonce)
// ---------------------------------------------------------------------------

function getPanelHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): string {
  const n = nonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "map.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "style.css")
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>Django Project Map</title>
</head>
<body>
<div id="app" data-view="panel"></div>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getSidebarHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview
): string {
  const n = nonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "sidebar.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "style.css")
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>Project Map</title>
</head>
<body>
<div id="app" data-view="sidebar"></div>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}
