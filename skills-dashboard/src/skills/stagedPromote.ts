/**
 * Pure staged skill writes (no `vscode` import: unit-testable against a fake
 * filesystem). Each target is written to a temporary sibling folder and
 * promoted with renames only after every file is staged and verified, so a
 * failure midway never leaves a half-written skill behind and never corrupts
 * an existing one being overwritten.
 *
 * Staging/backup siblings are immediate children of the skill root whose
 * names start with "." so they fail `isSafeSkillName` and are invisible to
 * discovery. Every guard that applies to the final path (ancestor symlink
 * walk, ordinary-directory/file checks) also applies to the staging and
 * backup paths, which share the same ancestor chain.
 */
import { isSafePosixRelativePath, isSafeSkillName } from "./pathSafety";
import {
  ancestorRelPaths,
  firstSymlinkOffender,
  hasSymlinkBit,
  isRealDirectory,
  isRealFile,
} from "./symlinkGuard";

export interface PromoteFile {
  rel: string; // relative to the skill folder, posix
  bytes: Uint8Array;
}

/** Minimal filesystem surface; the VS Code adapter lives in fsGuard. */
export interface PromoteFs {
  /** Numeric stat type, or null when the path does not exist. */
  statType(rel: string): Promise<number | null>;
  /** Immediate child names of a directory ([] when missing is acceptable). */
  listNames(rel: string): Promise<string[]>;
  mkdirp(rel: string): Promise<void>;
  writeFile(rel: string, bytes: Uint8Array): Promise<void>;
  renameRel(fromRel: string, toRel: string): Promise<void>;
  removeRel(rel: string): Promise<void>;
}

export type TargetStatus = "installed" | "skipped" | "failed";

export interface TargetOutcome {
  status: TargetStatus;
  /** Failure reason, or a non-fatal note on success. */
  detail?: string;
}

export interface TargetFailure {
  root: string;
  message: string;
}

const TAG_RE = /^[0-9a-f]{1,16}$/;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parentRel(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i <= 0 ? "" : rel.slice(0, i);
}

/**
 * Temporary sibling names for one install. Returns null for anything unsafe.
 * Names start with "." so they are never valid skill names (invisible to
 * discovery) while remaining safe workspace-relative paths.
 */
export function stagingNames(skillName: string, tag: string): { staging: string; backup: string } | null {
  if (!isSafeSkillName(skillName) || !TAG_RE.test(tag)) {
    return null;
  }
  const staging = `.staging-${skillName}-${tag}`;
  const backup = `.backup-${skillName}-${tag}`;
  if (!isSafePosixRelativePath(staging) || !isSafePosixRelativePath(backup)) {
    return null;
  }
  return { staging, backup };
}

function isOwnSibling(name: string, kind: "staging" | "backup", skillName: string): boolean {
  const prefix = `.${kind}-${skillName}-`;
  if (!name.startsWith(prefix)) {
    return false;
  }
  return TAG_RE.test(name.slice(prefix.length));
}

async function removeIfRealDir(fs: PromoteFs, rel: string): Promise<void> {
  const t = await fs.statType(rel);
  if (t === null) {
    return;
  }
  if (hasSymlinkBit(t)) {
    throw new Error(`Refusing to remove "${rel}": it is a symlink.`);
  }
  await fs.removeRel(rel);
}

/** Remove leftover staging/backup siblings from crashed runs (never links). */
async function removeStaleSiblings(fs: PromoteFs, root: string, skillName: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.listNames(root);
  } catch {
    return; // root missing: no stale siblings possible
  }
  for (const name of names) {
    if (!isOwnSibling(name, "staging", skillName) && !isOwnSibling(name, "backup", skillName)) {
      continue;
    }
    await removeIfRealDir(fs, `${root}/${name}`);
  }
}

/**
 * Write one skill into one root via stage-then-promote. Returns "skipped"
 * for an existing skill without overwrite; throws with a precise message on
 * any failure (the previous destination is left intact or restored).
 */
export async function stagedPromote(
  fs: PromoteFs,
  root: string,
  skillName: string,
  files: PromoteFile[],
  overwrite: boolean,
  tag: string
): Promise<TargetOutcome> {
  if (!isSafePosixRelativePath(root)) {
    throw new Error("Invalid target root.");
  }
  const names = stagingNames(skillName, tag);
  if (!names) {
    throw new Error("Invalid skill name.");
  }
  if (!files.some((f) => f.rel === "SKILL.md")) {
    throw new Error(`Skill "${skillName}" has no SKILL.md.`);
  }
  for (const f of files) {
    if (!isSafePosixRelativePath(f.rel)) {
      throw new Error(`Unsafe file path in skill: ${f.rel}.`);
    }
  }

  // Guard the final, staging, and backup paths: same ancestor chain, explicit.
  const rels = new Set<string>();
  for (const r of ancestorRelPaths(root, skillName)) {
    rels.add(r);
  }
  for (const f of files) {
    for (const r of ancestorRelPaths(root, skillName, f.rel)) {
      rels.add(r);
    }
    for (const r of ancestorRelPaths(root, names.staging, f.rel)) {
      rels.add(r);
    }
  }
  for (const r of ancestorRelPaths(root, names.backup)) {
    rels.add(r);
  }
  const stats: { rel: string; type: number | null }[] = [];
  for (const rel of rels) {
    stats.push({ rel, type: await fs.statType(rel) });
  }
  const offender = firstSymlinkOffender(stats);
  if (offender !== null) {
    throw new Error(`Refusing to write: "${offender}" is a symlink; targets outside the workspace are never followed.`);
  }

  const destRel = `${root}/${skillName}`;
  const stagingRel = `${root}/${names.staging}`;
  const backupRel = `${root}/${names.backup}`;

  await removeStaleSiblings(fs, root, skillName);

  const destType = await fs.statType(destRel);
  if (destType !== null && !isRealDirectory(destType)) {
    throw new Error(`Refusing to write: existing "${destRel}" is not an ordinary directory.`);
  }
  const mdType = await fs.statType(`${destRel}/SKILL.md`);
  if (mdType !== null) {
    if (hasSymlinkBit(mdType)) {
      throw new Error(`Refusing to write: existing SKILL.md in "${destRel}" is a symlink.`);
    }
    if (!overwrite) {
      return { status: "skipped" };
    }
  }

  // Stage everything before touching the destination.
  await removeIfRealDir(fs, stagingRel);
  await fs.mkdirp(stagingRel);
  try {
    for (const f of files) {
      const stagedPath = `${stagingRel}/${f.rel}`;
      const parent = parentRel(stagedPath);
      if (parent !== "") {
        await fs.mkdirp(parent);
      }
      await fs.writeFile(stagedPath, f.bytes);
    }
  } catch (e) {
    await fs.removeRel(stagingRel).catch(() => undefined);
    throw new Error(`Failed staging "${destRel}" (destination left untouched): ${msg(e)}`);
  }
  const stagedMd = await fs.statType(`${stagingRel}/SKILL.md`);
  if (stagedMd === null || !isRealFile(stagedMd)) {
    await fs.removeRel(stagingRel).catch(() => undefined);
    throw new Error(`Failed staging "${destRel}" (destination left untouched): staged SKILL.md failed verification.`);
  }

  if (destType !== null) {
    await fs.renameRel(destRel, backupRel);
    try {
      await fs.renameRel(stagingRel, destRel);
    } catch (e) {
      try {
        await fs.renameRel(backupRel, destRel);
      } catch (restoreErr) {
        throw new Error(
          `Failed promoting "${destRel}" and could not restore the original (it is preserved at "${backupRel}"): ${msg(e)} / restore: ${msg(restoreErr)}`
        );
      }
      await fs.removeRel(stagingRel).catch(() => undefined);
      throw new Error(`Failed promoting "${destRel}" (original restored): ${msg(e)}`);
    }
    try {
      await removeIfRealDir(fs, backupRel);
    } catch (e) {
      return { status: "installed", detail: `Installed; leftover backup "${backupRel}" could not be removed: ${msg(e)}` };
    }
    return { status: "installed" };
  }

  try {
    await fs.renameRel(stagingRel, destRel);
  } catch (e) {
    await fs.removeRel(stagingRel).catch(() => undefined);
    throw new Error(`Failed promoting "${destRel}" (nothing was written there): ${msg(e)}`);
  }
  return { status: "installed" };
}

/**
 * Compose exact per-target status: a failed target is always named with its
 * reason and the outcome is not ok; successes are never claimed for failures.
 */
export function formatTargetReport(
  verb: "Copied" | "Installed",
  skillName: string,
  done: string[],
  skipped: string[],
  failed: TargetFailure[],
  notes: string[] = []
): { ok: boolean; message: string } {
  const parts: string[] = [];
  if (failed.length > 0) {
    if (done.length > 0) {
      parts.push(`${verb} "${skillName}" to ${done.join(", ")}.`);
    }
    if (skipped.length > 0) {
      parts.push(`Exists in ${skipped.join(", ")} (not overwritten).`);
    }
    for (const f of failed) {
      parts.push(`Failed in ${f.root}: ${f.message}`);
    }
    for (const n of notes) {
      parts.push(n);
    }
    return { ok: false, message: parts.join(" ") };
  }
  if (skipped.length > 0 && done.length === 0) {
    return { ok: false, message: `Already exists in ${skipped.join(", ")}. Tick overwrite to replace.` };
  }
  if (skipped.length > 0) {
    parts.push(`${verb} to ${done.join(", ")}. Exists in ${skipped.join(", ")} (not overwritten).`);
  } else {
    parts.push(`${verb} "${skillName}" to ${done.join(", ")}.`);
  }
  for (const n of notes) {
    parts.push(n);
  }
  return { ok: true, message: parts.join(" ") };
}
