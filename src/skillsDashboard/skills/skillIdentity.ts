/**
 * Stable workspace-folder identity for skill IDs (no runtime `vscode`
 * import — `vscode` is used as a type only, so this stays unit-testable).
 *
 * Skill IDs were `${workspaceFolder.name}::${root}::${skillName}`. Folder
 * *names* are not unique: two workspace folders can share a basename (e.g.
 * `/proj-a/frontend` and `/proj-b/frontend`), producing identical IDs so
 * selection, open, copy, and remove could hit the wrong folder's skill.
 *
 * IDs are now `${folderKey}::${root}::${skillName}` where `folderKey` is a
 * truncated SHA-256 of the folder URI string: deterministic, stable across
 * sessions, unique per folder, and opaque (no absolute paths or credentials
 * leak into webview traffic; the human-readable folder name stays a
 * display-only field).
 */
import type * as vscode from "vscode";
import { createHash } from "node:crypto";
import { isSafePosixRelativePath, isSafeSkillName } from "./pathSafety";

export const FOLDER_KEY_CHARS = 16;

/** Opaque, deterministic key for one workspace folder URI string. */
export function folderKeyForUri(uriString: string): string {
  return createHash("sha256").update(uriString, "utf8").digest("hex").slice(0, FOLDER_KEY_CHARS);
}

export interface SkillRef {
  workspaceFolder: vscode.WorkspaceFolder;
  root: string;
  skillName: string;
}

/** Producer: the canonical ID for one discovered skill. */
export function skillIdFor(skill: SkillRef): string {
  return `${folderKeyForUri(skill.workspaceFolder.uri.toString())}::${skill.root}::${skill.skillName}`;
}

export interface ParsedSkillId {
  folderKey: string;
  root: string;
  skillName: string;
}

/** Parse and validate an ID from the webview; null when malformed/unsafe. */
export function parseSkillId(id: unknown): ParsedSkillId | null {
  if (typeof id !== "string" || id === "" || id.length > 1024) {
    return null;
  }
  const head = id.slice(0, FOLDER_KEY_CHARS + 2);
  if (!/^[0-9a-f]{16}::$/.test(head)) {
    return null;
  }
  const rest = id.slice(FOLDER_KEY_CHARS + 2);
  const sep = rest.lastIndexOf("::");
  if (sep <= 0) {
    return null;
  }
  const root = rest.slice(0, sep);
  const skillName = rest.slice(sep + 2);
  if (!isSafePosixRelativePath(root) || !isSafeSkillName(skillName)) {
    return null;
  }
  return { folderKey: id.slice(0, FOLDER_KEY_CHARS), root, skillName };
}

/** Lookup: resolve a webview-supplied ID against live skills (fails closed). */
export function findBySkillId<T extends SkillRef>(skills: T[], id: string): T | undefined {
  const parsed = parseSkillId(id);
  if (!parsed) {
    return undefined;
  }
  return skills.find(
    (s) =>
      s.root === parsed.root &&
      s.skillName === parsed.skillName &&
      folderKeyForUri(s.workspaceFolder.uri.toString()) === parsed.folderKey
  );
}

/**
 * Destination workspace-folder selection for GitHub import.
 *
 * The webview never sends paths — only the opaque `folderKeyForUri` id
 * (16 lowercase hex chars). The host resolves that id against the *current
 * live* workspace folders on every request, so stale/removed folders and
 * forged ids fail closed to `undefined` instead of touching a wrong folder.
 */

export interface WorkspaceFolderLike {
  uri: { toString(): string };
  name: string;
}

/** Validate an opaque workspace-folder id from the webview (never a path). */
export function isWorkspaceFolderId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{16}$/.test(id);
}

/**
 * Resolve an opaque folder id against live workspace folders.
 * Returns `undefined` for malformed, unknown, or stale ids (fails closed).
 */
export function findWorkspaceFolderById<T extends WorkspaceFolderLike>(
  folders: readonly T[],
  id: unknown
): T | undefined {
  if (!isWorkspaceFolderId(id)) {
    return undefined;
  }
  return folders.find((f) => folderKeyForUri(f.uri.toString()) === id);
}
