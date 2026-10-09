import * as vscode from "vscode";
import { nonce } from "./shared/nonce";
import { isWebviewToHostMessage, SkillSummary, HostToWebviewMessage } from "./shared/messages";
import { DEFAULT_SKILL_ROOTS, resolveSkillRoots } from "./skills/pathSafety";
import { discoverSkills, copySkillToRoots, removeSkillFolder, DiscoveredSkill } from "./skills/skillScanner";
import { fetchSkillFromGitHub, installFetchedSkill, findInstallConflicts } from "./skills/githubImport";
import { formatTargetReport } from "./skills/stagedPromote";
import { findBySkillId, findWorkspaceFolderById, folderKeyForUri, skillIdFor } from "./skills/skillIdentity";

export const SKILLS_VIEW_ID = "agentStudio.skills";

export function activateSkills(context: vscode.ExtensionContext): void {
  const sidebar = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SKILLS_VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("agentStudio.openSkills", () => openDashboardPanel(context)),
    vscode.commands.registerCommand("agentStudio.refreshSkills", async () => {
      await sidebar.refresh();
      await DashboardPanel.refreshAll();
    })
  );
}

export function deactivateSkills(): void {
  DashboardPanel.disposeAll();
}

// ---------------------------------------------------------------------------
// Shared dashboard logic
// ---------------------------------------------------------------------------

function configuredRoots(): { roots: string[]; rejected: string[] } {
  const cfg = vscode.workspace.getConfiguration("agentStudio").get<unknown>("skillRoots");
  if (cfg === undefined) {
    return { roots: [...DEFAULT_SKILL_ROOTS], rejected: [] };
  }
  return resolveSkillRoots(cfg);
}

function toSummary(s: DiscoveredSkill, all: DiscoveredSkill[]): SkillSummary {
  const key = folderKeyForUri(s.workspaceFolder.uri.toString());
  const present = all
    .filter(
      (o) =>
        folderKeyForUri(o.workspaceFolder.uri.toString()) === key && o.skillName === s.skillName
    )
    .map((o) => o.root);
  return {
    id: skillIdFor(s),
    workspaceFolderName: s.workspaceFolder.name,
    root: s.root,
    skillName: s.skillName,
    relativeDirPath: s.relativeDirPath,
    skillMdPath: `${s.relativeDirPath}/SKILL.md`,
    description: s.description,
    presentInRoots: [...new Set(present)].sort(),
    fileCount: s.fileCount,
    preview: s.preview.slice(0, 1200),
    oversized: s.oversized,
  };
}

async function scanAll(): Promise<{ skills: DiscoveredSkill[]; roots: string[]; rejected: string[] }> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const { roots, rejected } = configuredRoots();
  const skills: DiscoveredSkill[] = [];
  for (const folder of folders) {
    skills.push(...(await discoverSkills(folder, roots)));
  }
  return { skills, roots, rejected };
}

/** Live destination options for the import UI (opaque ids, workspace order). */
function workspaceRefs(): { id: string; name: string }[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    id: folderKeyForUri(f.uri.toString()),
    name: f.name,
  }));
}

async function postSkills(post: (m: HostToWebviewMessage) => void, detailId?: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    post({
      type: "error",
      payload: {
        message: "No folder is open.",
        detail: "Open a folder (File → Open Folder), then Refresh. Skills live in project-local roots such as .claude/skills.",
      },
    });
    return;
  }
  try {
    const { skills, roots, rejected } = await scanAll();
    const summaries = skills.map((s) => toSummary(s, skills));
    let detail: (SkillSummary & { fullPreview: string }) | undefined;
    if (detailId) {
      const hit = findBySkillId(skills, detailId);
      if (hit) {
        detail = { ...toSummary(hit, skills), fullPreview: hit.preview };
      }
    } else if (summaries.length > 0) {
      const first = skills[0];
      detail = { ...summaries[0], fullPreview: first.preview };
    }
    if (rejected.length > 0) {
      post({ type: "progress", payload: { message: `Ignored ${rejected.length} unsafe custom root(s).` } });
    }
    post({
      type: "skillsData",
      payload: { skills: summaries, roots, workspaceFolderName: folders.map((f) => f.name).join(", "), workspaceFolders: workspaceRefs(), detail },
    });
  } catch (err) {
    post({ type: "error", payload: { message: "Scan failed.", detail: err instanceof Error ? err.message : String(err) } });
  }
}

async function handleMessage(
  post: (m: HostToWebviewMessage) => void,
  raw: unknown,
  refresh: (detailId?: string) => Promise<void>
): Promise<void> {
  if (!isWebviewToHostMessage(raw)) {
    return;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  switch (raw.type) {
    case "ready":
    case "refresh":
      await postSkills(post);
      return;
    case "selectSkill":
      await postSkills(post, raw.payload.id);
      return;
    case "openSkillFile": {
      const { skills } = await scanAll();
      const hit = findBySkillId(skills, raw.payload.id);
      if (!hit) {
        post({ type: "error", payload: { message: "Skill not found." } });
        return;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(hit.skillMdUri);
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch {
        post({ type: "error", payload: { message: "Could not open SKILL.md." } });
      }
      return;
    }
    case "copySkill": {
      const { skills, roots } = await scanAll();
      const hit = findBySkillId(skills, raw.payload.skillId);
      if (!hit) {
        post({ type: "operationResult", payload: { ok: false, message: "Skill not found." } });
        return;
      }
      const targets = [...new Set(raw.payload.targets)].filter((t) => roots.includes(t) && t !== hit.root);
      if (targets.length === 0) {
        post({ type: "operationResult", payload: { ok: false, message: "Select at least one different target directory." } });
        return;
      }
      try {
        const { copied, skipped, failed, notes } = await copySkillToRoots(hit, targets, raw.payload.overwrite);
        post({ type: "operationResult", payload: formatTargetReport("Copied", hit.skillName, copied, skipped, failed, notes) });
      } catch (err) {
        post({ type: "operationResult", payload: { ok: false, message: err instanceof Error ? err.message : String(err) } });
      }
      await refresh(raw.payload.skillId);
      return;
    }
    case "removeSkill": {
      const { skills, roots } = await scanAll();
      const hit = findBySkillId(skills, raw.payload.skillId);
      if (!hit) {
        post({ type: "operationResult", payload: { ok: false, message: "Skill not found." } });
        return;
      }
      const target = raw.payload.target;
      if (!roots.includes(target)) {
        post({ type: "operationResult", payload: { ok: false, message: "Invalid target directory." } });
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete skill "${hit.skillName}" from ${target}? This removes the folder ${target}/${hit.skillName} only.`,
        { modal: true },
        "Delete"
      );
      if (confirm !== "Delete") {
        post({ type: "operationResult", payload: { ok: false, message: "Delete cancelled." } });
        return;
      }
      try {
        await removeSkillFolder(hit.workspaceFolder, roots, target, hit.skillName);
        post({ type: "operationResult", payload: { ok: true, message: `Removed "${hit.skillName}" from ${target}.` } });
      } catch (err) {
        post({ type: "operationResult", payload: { ok: false, message: err instanceof Error ? err.message : String(err) } });
      }
      await refresh();
      return;
    }
    case "previewImport": {
      if (folders.length === 0) {
        post({ type: "error", payload: { message: "No folder is open." } });
        return;
      }
      // Resolve the requested destination against live folders; default to the
      // first folder only when the webview sent no selection. Unknown ids fail
      // closed (never fall back to a different folder).
      const requested = raw.payload.workspaceFolderId;
      const folder =
        requested === undefined ? folders[0] : findWorkspaceFolderById(folders, requested);
      if (!folder) {
        post({ type: "error", payload: { message: "Unknown destination folder.", detail: "Refresh and pick the destination again." } });
        return;
      }
      post({ type: "progress", payload: { message: "Fetching skill from GitHub…" } });
      try {
        const fetched = await fetchSkillFromGitHub(raw.payload.url);
        const { roots } = configuredRoots();
        const targets = roots;
        const conflicts = await findInstallConflicts(folder, targets, fetched.parsed.skillName);
        post({
          type: "importPreview",
          payload: {
            url: raw.payload.url,
            owner: fetched.parsed.owner,
            repo: fetched.parsed.repo,
            ref: fetched.parsed.ref,
            skillPath: fetched.parsed.skillPath,
            skillName: fetched.parsed.skillName,
            files: fetched.files.map((f) => ({ path: f.path, size: f.bytes.length })),
            totalBytes: fetched.totalBytes,
            targets,
            conflicts,
            skippedSymlinks: fetched.skippedSymlinks,
            workspaceFolderId: folderKeyForUri(folder.uri.toString()),
            workspaceFolders: workspaceRefs(),
          },
        });
      } catch (err) {
        post({ type: "error", payload: { message: "Import preview failed.", detail: err instanceof Error ? err.message : String(err) } });
      }
      return;
    }
    case "confirmImport": {
      if (folders.length === 0) {
        post({ type: "operationResult", payload: { ok: false, message: "No folder is open." } });
        return;
      }
      // Install strictly into the selected folder, resolved against live
      // folders. Stale/unknown ids fail closed — never folders[0].
      const folder = findWorkspaceFolderById(folders, raw.payload.workspaceFolderId);
      if (!folder) {
        post({ type: "operationResult", payload: { ok: false, message: "Unknown destination folder. Refresh and pick the destination again." } });
        return;
      }
      post({ type: "progress", payload: { message: "Installing skill…" } });
      try {
        const fetched = await fetchSkillFromGitHub(raw.payload.url);
        const { roots } = configuredRoots();
        const { installed, conflicts, failed, notes } = await installFetchedSkill(folder, roots, raw.payload.targets, fetched, raw.payload.overwrite);
        post({ type: "operationResult", payload: formatTargetReport("Installed", fetched.parsed.skillName, installed, conflicts, failed, notes) });
      } catch (err) {
        post({ type: "operationResult", payload: { ok: false, message: err instanceof Error ? err.message : String(err) } });
      }
      await refresh();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Panel + sidebar
// ---------------------------------------------------------------------------

class DashboardPanel {
  private static panels = new Set<DashboardPanel>();
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext, panel: vscode.WebviewPanel) {
    this.panel = panel;
    DashboardPanel.panels.add(this);
    this.panel.webview.html = getHtml(this.context, this.panel.webview);
    this.panel.webview.onDidReceiveMessage(
      async (raw: unknown) => {
        await handleMessage(
          (m) => void this.panel.webview.postMessage(m),
          raw,
          async (detailId?: string) => postSkills((m) => void this.panel.webview.postMessage(m), detailId)
        );
      },
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static async refreshAll(): Promise<void> {
    for (const p of [...DashboardPanel.panels]) {
      postSkills((m) => void p.panel.webview.postMessage(m)).catch(() => undefined);
    }
  }

  static disposeAll(): void {
    for (const p of [...DashboardPanel.panels]) {
      p.dispose();
    }
  }

  dispose(): void {
    DashboardPanel.panels.delete(this);
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}

function openDashboardPanel(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel("skillsDashboard", "Skills Dashboard", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
  });
  new DashboardPanel(context, panel);
}

class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = getHtml({ extensionUri: this.extensionUri } as vscode.ExtensionContext, view.webview);
    view.webview.onDidReceiveMessage(async (raw: unknown) => {
      if (!this.view) {
        return;
      }
      const v = this.view;
      await handleMessage(
        (m) => void v.webview.postMessage(m),
        raw,
        async (detailId?: string) => postSkills((m) => void v.webview.postMessage(m), detailId)
      );
    });
    void postSkills((m) => void this.view?.webview.postMessage(m));
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const v = this.view;
    await postSkills((m) => void v.webview.postMessage(m));
  }
}

function getHtml(context: vscode.ExtensionContext | { extensionUri: vscode.Uri }, webview: vscode.Webview): string {
  const n = nonce();
  const extUri = (context as vscode.ExtensionContext).extensionUri;
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extUri, "media", "skills", "dashboard.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extUri, "media", "skills", "dashboard.css"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${n}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>Skills Dashboard</title>
</head>
<body>
<div id="app"></div>
<script nonce="${n}" src="${scriptUri}"></script>
</body>
</html>`;
}
