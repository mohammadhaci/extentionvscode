/**
 * VS Code filesystem guards against symlink escape.
 *
 * Every existing ancestor from the workspace folder through the target is
 * inspected with `workspace.fs.stat`; any path carrying the symlink bit is
 * rejected. Missing paths are allowed (they are created as real directories).
 * Symlink targets are never followed for reads and never deleted: symlinked
 * skill folders, symlinked SKILL.md files, and symlinked ancestors all throw.
 */
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import {
  SYMLINK_BIT,
  FILE_BIT,
  DIRECTORY_BIT,
  ancestorRelPaths,
  firstSymlinkOffender,
  isRealDirectory,
  isRealFile,
} from "./symlinkGuard";
import { PromoteFile, PromoteFs, TargetOutcome, stagedPromote } from "./stagedPromote";

/** Fail closed if the host's FileType bits ever differ from our constants. */
function assertFileTypeBits(): void {
  const ft = vscode.FileType;
  if (ft.SymbolicLink !== SYMLINK_BIT || ft.Directory !== DIRECTORY_BIT || ft.File !== FILE_BIT) {
    throw new Error("Unsupported FileType bits from the VS Code host; refusing filesystem access.");
  }
}

/** Stat type number, or null when the path does not exist. Other errors throw. */
export async function statTypeOrNull(uri: vscode.Uri): Promise<number | null> {
  assertFileTypeBits();
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type as number;
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
      return null;
    }
    throw err;
  }
}

/**
 * Reject when any existing ancestor (workspace-relative rel paths) is a
 * symlink. Throws naming the offending path.
 */
export async function assertAncestorsHaveNoSymlinks(
  folder: vscode.WorkspaceFolder,
  rels: string[]
): Promise<void> {
  const entries: { rel: string; type: number | null }[] = [];
  for (const rel of rels) {
    const uri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    entries.push({ rel, type: await statTypeOrNull(uri) });
  }
  const offender = firstSymlinkOffender(entries);
  if (offender !== null) {
    throw new Error(`Refusing to proceed: "${offender}" is a symlink; targets outside the workspace are never followed.`);
  }
}

/** Stat size in bytes, or null when the path does not exist. Other errors throw. */
export async function statSizeOrNull(uri: vscode.Uri): Promise<number | null> {
  assertFileTypeBits();
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.size;
  } catch (err) {
    if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
      return null;
    }
    throw err;
  }
}

/** Require an existing ordinary directory (no symlink bit). */
export async function assertRealDirectory(uri: vscode.Uri, label: string): Promise<void> {
  const type = await statTypeOrNull(uri);
  if (type === null) {
    throw new Error(`${label} does not exist.`);
  }
  if (!isRealDirectory(type)) {
    throw new Error(`Refusing to proceed: ${label} is not an ordinary directory (symlinks are never followed).`);
  }
}

/** Require an existing ordinary file (no symlink bit). */
export async function assertRealFile(uri: vscode.Uri, label: string): Promise<void> {
  const type = await statTypeOrNull(uri);
  if (type === null) {
    throw new Error(`${label} does not exist.`);
  }
  if (!isRealFile(type)) {
    throw new Error(`Refusing to proceed: ${label} is not an ordinary file (symlinks are never followed).`);
  }
}

/**
 * VS Code adapter for staged writes: workspace-relative paths with the same
 * guards as every other write path.
 */
function vscodePromoteFs(folder: vscode.WorkspaceFolder): PromoteFs {
  const uriOf = (rel: string): vscode.Uri => vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
  return {
    statType: (rel) => statTypeOrNull(uriOf(rel)),
    listNames: async (rel) => {
      try {
        return (await vscode.workspace.fs.readDirectory(uriOf(rel))).map(([name]) => name);
      } catch (err) {
        if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
          return [];
        }
        throw err;
      }
    },
    mkdirp: async (rel) => {
      await vscode.workspace.fs.createDirectory(uriOf(rel));
    },
    writeFile: async (rel, bytes) => {
      await vscode.workspace.fs.writeFile(uriOf(rel), bytes);
    },
    renameRel: async (fromRel, toRel) => {
      await vscode.workspace.fs.rename(uriOf(fromRel), uriOf(toRel));
    },
    removeRel: async (rel) => {
      await vscode.workspace.fs.delete(uriOf(rel), { recursive: true, useTrash: false });
    },
  };
}

/**
 * Write one skill into one root via stage-then-promote (see stagedPromote).
 */
export async function writeSkillStaged(
  folder: vscode.WorkspaceFolder,
  root: string,
  skillName: string,
  files: PromoteFile[],
  overwrite: boolean
): Promise<TargetOutcome> {
  assertFileTypeBits();
  return stagedPromote(vscodePromoteFs(folder), root, skillName, files, overwrite, randomBytes(4).toString("hex"));
}

/**
 * Shared pre-write gate for copy/install targets: walks every existing
 * ancestor from the workspace root through the skill folder and each nested
 * file's parent directories, rejecting symlink bits anywhere along the way.
 */
export async function assertSkillTargetSafe(
  folder: vscode.WorkspaceFolder,
  root: string,
  skillName: string,
  nestedRels: string[]
): Promise<void> {
  const rels = new Set<string>(ancestorRelPaths(root, skillName));
  for (const nested of nestedRels) {
    for (const r of ancestorRelPaths(root, skillName, nested)) {
      rels.add(r);
    }
  }
  await assertAncestorsHaveNoSymlinks(folder, [...rels]);
}
