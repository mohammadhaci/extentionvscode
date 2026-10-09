import * as vscode from "vscode";
import { isSafePosixRelativePath, isSafeSkillName } from "./pathSafety";
import { writeSkillStaged } from "./fsGuard";
import type { FetchedSkill } from "./githubFetch";
import { TargetFailure } from "./stagedPromote";

// Fetching moved to ./githubFetch (vscode-free, unit-testable); re-exported
// here so existing import sites keep working.
export { fetchSkillFromGitHub, MAX_IMPORT_TOTAL_BYTES } from "./githubFetch";
export { MAX_IMPORT_FILES } from "./githubTree";
export type { FetchFn, FetchedSkill, FetchedSkillFile } from "./githubFetch";

/**
 * Write fetched skill files into selected workspace roots.
 * Never executes files; refuses silent overwrite unless overwrite=true.
 */
export async function installFetchedSkill(
  folder: vscode.WorkspaceFolder,
  roots: string[],
  targetRoots: string[],
  fetched: FetchedSkill,
  overwrite: boolean
): Promise<{ installed: string[]; conflicts: string[]; failed: TargetFailure[]; notes: string[] }> {
  if (!isSafeSkillName(fetched.parsed.skillName)) {
    throw new Error("Invalid skill name from GitHub.");
  }
  const installed: string[] = [];
  const conflicts: string[] = [];
  const failed: TargetFailure[] = [];
  const notes: string[] = [];
  const distinct = [...new Set(targetRoots)].filter((r) => roots.includes(r) && isSafePosixRelativePath(r));
  if (distinct.length === 0) {
    throw new Error("No valid target directories selected.");
  }
  const payloadList = fetched.files.map((f) => ({ rel: f.path, bytes: f.bytes }));
  for (const root of distinct) {
    try {
      // Staged per target: a failure here never affects other targets and
      // never leaves a half-written skill behind.
      const outcome = await writeSkillStaged(folder, root, fetched.parsed.skillName, payloadList, overwrite);
      if (outcome.status === "installed") {
        installed.push(root);
        if (outcome.detail) {
          notes.push(`${root}: ${outcome.detail}`);
        }
      } else {
        conflicts.push(root);
      }
    } catch (e) {
      failed.push({ root, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { installed, conflicts, failed, notes };
}

/** Check which target roots already contain this skill name. */
export async function findInstallConflicts(
  folder: vscode.WorkspaceFolder,
  targetRoots: string[],
  skillName: string
): Promise<string[]> {
  const conflicts: string[] = [];
  if (!isSafeSkillName(skillName)) {
    return conflicts;
  }
  for (const root of targetRoots) {
    if (!isSafePosixRelativePath(root)) {
      continue;
    }
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...root.split("/"), skillName, "SKILL.md"));
      conflicts.push(root);
    } catch {
      // no conflict
    }
  }
  return conflicts;
}
