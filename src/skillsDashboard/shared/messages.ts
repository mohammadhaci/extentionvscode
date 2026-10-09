/** Shared webview message types with runtime validation. */

export interface SkillSummary {
  id: string; // opaque `${folderKey}::${root}::${skillName}` (see skillIdentity)
  workspaceFolderName: string;
  root: string; // e.g. ".claude/skills"
  skillName: string;
  relativeDirPath: string; // e.g. ".claude/skills/my-skill"
  skillMdPath: string; // e.g. ".claude/skills/my-skill/SKILL.md"
  description: string;
  presentInRoots: string[]; // roots (same folder) containing same skill name
  fileCount?: number;
  preview?: string; // truncated SKILL.md text (bounded by host)
  oversized?: boolean; // SKILL.md exceeded the preview byte limit and was not loaded
}

export interface ImportPreviewFile {
  path: string; // relative to skill folder, posix
  size: number;
}

/** Compact destination-folder option: opaque id + display name (never a path). */
export interface WorkspaceFolderRef {
  id: string; // opaque folderKeyForUri (16 lowercase hex chars)
  name: string;
}

export interface ImportPreview {
  url: string;
  owner: string;
  repo: string;
  ref: string;
  skillPath: string;
  skillName: string;
  files: ImportPreviewFile[];
  totalBytes: number;
  targets: string[]; // resolved roots for the destination workspace folder
  conflicts: string[]; // target roots where skill already exists
  skippedSymlinks: string[]; // Git tree entries skipped as symlinks (never fetched)
  workspaceFolderId: string; // opaque id of the destination folder this preview was computed for
  workspaceFolders: WorkspaceFolderRef[]; // live destination options, workspace order
}

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "selectSkill"; payload: { id: string } }
  | { type: "copySkill"; payload: { skillId: string; targets: string[]; overwrite: boolean } }
  | { type: "removeSkill"; payload: { skillId: string; target: string } }
  | { type: "previewImport"; payload: { url: string; workspaceFolderId?: string } }
  | { type: "confirmImport"; payload: { url: string; targets: string[]; overwrite: boolean; workspaceFolderId: string } }
  | { type: "openSkillFile"; payload: { id: string } };

export type HostToWebviewMessage =
  | { type: "skillsData"; payload: { skills: SkillSummary[]; roots: string[]; workspaceFolderName: string; workspaceFolders: WorkspaceFolderRef[]; detail?: SkillSummary & { fullPreview: string } } }
  | { type: "importPreview"; payload: ImportPreview }
  | { type: "progress"; payload: { message: string } }
  | { type: "error"; payload: { message: string; detail?: string } }
  | { type: "operationResult"; payload: { ok: boolean; message: string } };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Opaque destination folder id: 16 lowercase hex chars — never a path. */
function isWorkspaceFolderId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{16}$/.test(v);
}

export function isWebviewToHostMessage(raw: unknown): raw is WebviewToHostMessage {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return false;
  }
  switch (raw.type) {
    case "ready":
    case "refresh":
      return true;
    case "selectSkill":
    case "openSkillFile":
      return isRecord(raw.payload) && typeof raw.payload.id === "string" && raw.payload.id.length <= 1024;
    case "copySkill":
      return (
        isRecord(raw.payload) &&
        typeof raw.payload.skillId === "string" &&
        raw.payload.skillId.length <= 1024 &&
        isStringArray(raw.payload.targets) &&
        raw.payload.targets.length <= 16 &&
        typeof raw.payload.overwrite === "boolean"
      );
    case "removeSkill":
      return (
        isRecord(raw.payload) &&
        typeof raw.payload.skillId === "string" &&
        raw.payload.skillId.length <= 1024 &&
        typeof raw.payload.target === "string" &&
        raw.payload.target.length <= 256
      );
    case "previewImport":
      return (
        isRecord(raw.payload) &&
        typeof raw.payload.url === "string" &&
        raw.payload.url.length <= 2048 &&
        (raw.payload.workspaceFolderId === undefined || isWorkspaceFolderId(raw.payload.workspaceFolderId))
      );
    case "confirmImport":
      return (
        isRecord(raw.payload) &&
        typeof raw.payload.url === "string" &&
        raw.payload.url.length <= 2048 &&
        isStringArray(raw.payload.targets) &&
        raw.payload.targets.length <= 16 &&
        typeof raw.payload.overwrite === "boolean" &&
        isWorkspaceFolderId(raw.payload.workspaceFolderId)
      );
    default:
      return false;
  }
}
