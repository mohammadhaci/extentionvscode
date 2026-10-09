import * as vscode from "vscode";
import { parseSkillMetadata, resolveSkillPreviewText, MAX_SKILL_MD_BYTES } from "./skillMetadata";
import { isSafePosixRelativePath, isSafeSkillName } from "./pathSafety";
import { hasSymlinkBit, isRealDirectory, ancestorRelPaths } from "./symlinkGuard";
import {
  assertAncestorsHaveNoSymlinks,
  assertRealDirectory,
  assertRealFile,
  statSizeOrNull,
  writeSkillStaged,
} from "./fsGuard";
import { TargetFailure } from "./stagedPromote";

export interface DiscoveredSkill {
  workspaceFolder: vscode.WorkspaceFolder;
  root: string;
  skillName: string;
  relativeDirPath: string;
  dirUri: vscode.Uri;
  skillMdUri: vscode.Uri;
  description: string;
  preview: string; // truncated SKILL.md (plain text)
  oversized: boolean; // SKILL.md exceeded the preview byte limit and was not loaded
  fileCount: number;
}

const PREVIEW_CHARS = 4000;

async function countFiles(dir: vscode.Uri, depth: number): Promise<number> {
  if (depth > 4) {
    return 0;
  }
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const [name, type] of entries) {
    const t = type as number;
    if (hasSymlinkBit(t)) {
      continue; // never follow links while counting
    }
    if ((t & vscode.FileType.Directory) !== 0) {
      n += await countFiles(vscode.Uri.joinPath(dir, name), depth + 1);
    } else if ((t & vscode.FileType.File) !== 0) {
      n += 1;
    }
    if (n > 500) {
      break;
    }
  }
  return n;
}

/** Scan configured roots for immediate child folders containing SKILL.md. */
export async function discoverSkills(
  folder: vscode.WorkspaceFolder,
  roots: string[]
): Promise<DiscoveredSkill[]> {
  const found: DiscoveredSkill[] = [];
  for (const root of roots) {
    if (!isSafePosixRelativePath(root)) {
      continue;
    }
    const rootUri = vscode.Uri.joinPath(folder.uri, ...root.split("/"));
    let entries: [string, vscode.FileType][];
    try {
      // Reject symlink roots (or symlinked ancestors such as a linked `.claude`).
      await assertAncestorsHaveNoSymlinks(folder, ancestorRelPaths(root));
      await assertRealDirectory(rootUri, `Skill root "${root}"`);
      entries = await vscode.workspace.fs.readDirectory(rootUri);
    } catch {
      continue; // missing root is normal; symlinked roots are skipped, never followed
    }
    for (const [name, type] of entries) {
      const t = type as number;
      if (hasSymlinkBit(t)) {
        continue; // never list a symlinked skill folder
      }
      if (!isRealDirectory(t)) {
        continue;
      }
      if (!isSafeSkillName(name)) {
        continue;
      }
      const dirUri = vscode.Uri.joinPath(rootUri, name);
      const skillMdUri = vscode.Uri.joinPath(dirUri, "SKILL.md");
      try {
        // Re-stat after listing: refuse symlinked skill folders / SKILL.md files.
        await assertRealDirectory(dirUri, `Skill folder "${root}/${name}"`);
        await assertRealFile(skillMdUri, `SKILL.md in "${root}/${name}"`);
      } catch {
        continue; // missing or symlinked SKILL.md
      }
      // Stat before read: never load an oversized SKILL.md into memory.
      // A stat/read race (growth in between) is still caught by the
      // post-read length recheck, so behavior stays correct either way.
      let statSize: number | null = null;
      try {
        statSize = await statSizeOrNull(skillMdUri);
      } catch {
        statSize = null;
      }
      let bytes: Uint8Array | null = null;
      if (statSize !== null && !resolveSkillPreviewText(statSize, null).oversized) {
        try {
          bytes = await vscode.workspace.fs.readFile(skillMdUri);
        } catch {
          bytes = null;
        }
      }
      const preview = resolveSkillPreviewText(statSize, bytes);
      const meta = parseSkillMetadata(name, preview.text);
      const fileCount = await countFiles(dirUri, 0);
      found.push({
        workspaceFolder: folder,
        root,
        skillName: name,
        relativeDirPath: `${root}/${name}`,
        dirUri,
        skillMdUri,
        description: meta.description,
        preview: preview.text.slice(0, PREVIEW_CHARS),
        oversized: preview.oversized,
        fileCount,
      });
    }
  }
  found.sort((a, b) => a.skillName.localeCompare(b.skillName) || a.root.localeCompare(b.root));
  return found;
}

/** Recursively list files under a skill dir (bounded). */
export async function listSkillFiles(dir: vscode.Uri, relBase = "", depth = 0): Promise<string[]> {
  if (depth > 4) {
    return [];
  }
  const out: string[] = [];
  const entries = await vscode.workspace.fs.readDirectory(dir);
  for (const [name, type] of entries) {
    if (name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      continue;
    }
    const t = type as number;
    if (hasSymlinkBit(t)) {
      continue; // never follow links while enumerating source files
    }
    const rel = relBase === "" ? name : `${relBase}/${name}`;
    if (!isSafePosixRelativePath(rel)) {
      continue;
    }
    if ((t & vscode.FileType.Directory) !== 0) {
      out.push(...(await listSkillFiles(vscode.Uri.joinPath(dir, name), rel, depth + 1)));
    } else if ((t & vscode.FileType.File) !== 0) {
      out.push(rel);
    }
    if (out.length > 200) {
      break;
    }
  }
  return out;
}

/**
 * Copy one detected skill folder into target roots of the same workspace folder.
 * Never overwrites silently: throws a conflict error unless overwrite=true.
 */
export async function copySkillToRoots(
  source: DiscoveredSkill,
  targetRoots: string[],
  overwrite: boolean
): Promise<{ copied: string[]; skipped: string[]; failed: TargetFailure[]; notes: string[] }> {
  const copied: string[] = [];
  const skipped: string[] = [];
  const failed: TargetFailure[] = [];
  const notes: string[] = [];
  if (!isSafeSkillName(source.skillName) || !isSafePosixRelativePath(source.relativeDirPath)) {
    throw new Error("Invalid source skill path.");
  }
  // Recheck the source at copy time: ordinary dir, ordinary SKILL.md, no symlinked ancestors.
  await assertAncestorsHaveNoSymlinks(source.workspaceFolder, ancestorRelPaths(source.root, source.skillName));
  await assertRealDirectory(source.dirUri, `Source skill "${source.skillName}"`);
  await assertRealFile(source.skillMdUri, `SKILL.md in "${source.skillName}"`);
  const files = await listSkillFiles(source.dirUri);
  if (!files.includes("SKILL.md")) {
    throw new Error(`Source skill "${source.skillName}" has no SKILL.md.`);
  }
  if (files.length > 200) {
    throw new Error("Skill has too many files (limit 200).");
  }
  const payloads = new Map<string, Uint8Array>();
  let total = 0;
  for (const rel of files) {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(source.dirUri, ...rel.split("/")));
    if (bytes.length > MAX_SKILL_MD_BYTES) {
      throw new Error(`File ${rel} exceeds the 256 KB per-file limit.`);
    }
    total += bytes.length;
    if (total > 2 * 1024 * 1024) {
      throw new Error("Skill exceeds the 2 MB total size limit.");
    }
    payloads.set(rel, bytes);
  }
  const distinct = [...new Set(targetRoots)].filter((r) => r !== source.root && isSafePosixRelativePath(r));
  const payloadList = [...payloads].map(([rel, bytes]) => ({ rel, bytes }));
  for (const root of distinct) {
    try {
      // Staged per target: a failure here never affects other targets and
      // never leaves a half-written skill behind.
      const outcome = await writeSkillStaged(source.workspaceFolder, root, source.skillName, payloadList, overwrite);
      if (outcome.status === "installed") {
        copied.push(root);
        if (outcome.detail) {
          notes.push(`${root}: ${outcome.detail}`);
        }
      } else {
        skipped.push(root);
      }
    } catch (e) {
      failed.push({ root, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { copied, skipped, failed, notes };
}

/**
 * Delete exactly one skill folder, only when it contains SKILL.md and sits as
 * an immediate child of one of the configured roots. Caller must confirm first.
 */
export async function removeSkillFolder(
  folder: vscode.WorkspaceFolder,
  roots: string[],
  root: string,
  skillName: string
): Promise<void> {
  if (!roots.includes(root) || !isSafePosixRelativePath(root)) {
    throw new Error("Target is not a configured skill root.");
  }
  if (!isSafeSkillName(skillName)) {
    throw new Error("Invalid skill name.");
  }
  // Walk every existing ancestor from the workspace root through the skill
  // folder; refuse symlinks anywhere. Only an ordinary skill dir holding an
  // ordinary SKILL.md may be deleted — symlink targets are never removed.
  await assertAncestorsHaveNoSymlinks(folder, ancestorRelPaths(root, skillName));
  const dirUri = vscode.Uri.joinPath(folder.uri, ...root.split("/"), skillName);
  await assertRealDirectory(dirUri, `Skill folder "${root}/${skillName}"`);
  try {
    await assertRealFile(vscode.Uri.joinPath(dirUri, "SKILL.md"), `SKILL.md in "${root}/${skillName}"`);
  } catch {
    throw new Error("Refusing to delete: SKILL.md not found in the selected skill folder.");
  }
  await vscode.workspace.fs.delete(dirUri, { recursive: true, useTrash: false });
}
