/**
 * Pure symlink-confinement logic (no `vscode` import so it stays unit-testable
 * under plain node).
 *
 * Bit values mirror the VS Code `FileType` enum (vscode.d.ts):
 *   Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64
 * Providers may OR the SymbolicLink bit with File/Directory (e.g. 65, 66), so
 * every check here uses a bitmask, never equality.
 */

export const FILE_BIT = 1;
export const DIRECTORY_BIT = 2;
export const SYMLINK_BIT = 64;

/** True when the stat type carries the symlink bit (including combinations). */
export function hasSymlinkBit(type: number): boolean {
  if (!Number.isInteger(type) || type < 0) {
    return false;
  }
  return (type & SYMLINK_BIT) !== 0;
}

/** True for an ordinary directory (directory bit set, no symlink bit). */
export function isRealDirectory(type: number): boolean {
  if (!Number.isInteger(type) || type < 0) {
    return false;
  }
  return (type & DIRECTORY_BIT) !== 0 && !hasSymlinkBit(type);
}

/** True for an ordinary file (file bit set, no symlink bit). */
export function isRealFile(type: number): boolean {
  if (!Number.isInteger(type) || type < 0) {
    return false;
  }
  return (type & FILE_BIT) !== 0 && !hasSymlinkBit(type);
}

/**
 * Ordered workspace-relative ancestor paths to inspect, from the top-level
 * root segment down through the skill folder and any nested parents.
 * Example: (".claude/skills", "a", "x/y.md") ->
 *   [".claude", ".claude/skills", ".claude/skills/a", ".claude/skills/a/x"]
 * Callers stat each path that exists and reject symlink bits; missing paths
 * are fine (they will be created as real directories).
 */
export function ancestorRelPaths(rootRel: string, skillName?: string, nestedRel?: string): string[] {
  const out: string[] = [];
  const push = (p: string): void => {
    if (p !== "" && !out.includes(p)) {
      out.push(p);
    }
  };
  const rootSegs = rootRel.split("/");
  let acc = "";
  for (const seg of rootSegs) {
    acc = acc === "" ? seg : `${acc}/${seg}`;
    push(acc);
  }
  if (skillName !== undefined && skillName !== "") {
    push(`${rootRel}/${skillName}`);
  }
  if (nestedRel !== undefined && nestedRel !== "") {
    const parts = nestedRel.split("/").slice(0, -1); // parent dirs only
    let base = skillName !== undefined && skillName !== "" ? `${rootRel}/${skillName}` : rootRel;
    for (const part of parts) {
      base = `${base}/${part}`;
      push(base);
    }
  }
  return out;
}

export interface AncestorStat {
  rel: string;
  /** Numeric stat type, or null when the path does not exist. */
  type: number | null;
}

/**
 * Pure decision step over already-gathered stats: returns the first ancestor
 * carrying the symlink bit, or null when every existing ancestor is link-free.
 * Missing paths (type null) are skipped. This seam lets tests drive the logic
 * with a mock stat map instead of the VS Code filesystem.
 */
export function firstSymlinkOffender(entries: AncestorStat[]): string | null {
  for (const e of entries) {
    if (e.type === null || e.type === undefined) {
      continue;
    }
    if (hasSymlinkBit(e.type)) {
      return e.rel;
    }
  }
  return null;
}
