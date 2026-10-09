/** Workspace path safety: keep all reads/writes/deletes inside workspace skill roots. */

export const DEFAULT_SKILL_ROOTS = [
  ".claude/skills",
  ".agents/skills",
  ".github/skills",
  ".cursor/skills",
  ".codex/skills",
  ".opencode/skills",
  ".gemini/skills",
];

export const MAX_ROOT_LENGTH = 256;
export const MAX_SKILL_NAME_LENGTH = 64;

const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isSafeSkillName(name: unknown): name is string {
  return typeof name === "string" && SKILL_NAME_RE.test(name);
}

/** Validate a posix-style workspace-relative path (no escapes). */
export function isSafePosixRelativePath(p: unknown): p is string {
  if (typeof p !== "string") {
    return false;
  }
  if (p === "" || p.length > 1024) {
    return false;
  }
  if (p.includes("\0") || p.includes("\\")) {
    return false;
  }
  if (p.startsWith("/")) {
    return false;
  }
  if (/^[A-Za-z]:/.test(p)) {
    return false;
  }
  const segs = p.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === "..") {
      return false;
    }
    if (s.length > 100) {
      return false;
    }
  }
  return true;
}

/**
 * Normalize a configured skill root to a safe workspace-relative posix path,
 * or return null when it must be rejected (outside workspace / unsafe).
 */
export function normalizeSkillRoot(root: unknown): string | null {
  if (typeof root !== "string") {
    return null;
  }
  let r = root.trim().replace(/\\/g, "/");
  if (r === "" || r.length > MAX_ROOT_LENGTH) {
    return null;
  }
  if (r.startsWith("/")) {
    return null; // absolute paths are never workspace-relative
  }
  // Strip leading ./ and slashes.
  while (r.startsWith("./")) {
    r = r.slice(2);
  }
  r = r.replace(/^\/+/, "").replace(/\/+$/, "");
  if (r === "" || r === "." || r === "..") {
    return null;
  }
  if (!isSafePosixRelativePath(r)) {
    return null;
  }
  if (r.split("/").length > 5) {
    return null;
  }
  return r;
}

export interface ResolvedRoots {
  roots: string[];
  rejected: string[];
}

export function resolveSkillRoots(configured: unknown): ResolvedRoots {
  const list: unknown[] = Array.isArray(configured) ? configured : DEFAULT_SKILL_ROOTS;
  const roots: string[] = [];
  const rejected: string[] = [];
  const source = list.length === 0 ? DEFAULT_SKILL_ROOTS : list;
  for (const entry of source) {
    const n = normalizeSkillRoot(entry);
    if (n && !roots.includes(n)) {
      roots.push(n);
    } else if (!n) {
      rejected.push(String(entry).slice(0, 120));
    }
  }
  if (roots.length === 0) {
    return { roots: [...DEFAULT_SKILL_ROOTS], rejected };
  }
  return { roots, rejected };
}

/** True when `target` (posix rel path) is exactly the skill dir or inside it. */
export function isWithinSkillDir(targetRel: string, skillDirRel: string): boolean {
  if (!isSafePosixRelativePath(targetRel) || !isSafePosixRelativePath(skillDirRel)) {
    return false;
  }
  return targetRel === skillDirRel || targetRel.startsWith(skillDirRel + "/");
}

/** True when `dirRel` is an immediate child of `rootRel`. */
export function isImmediateChildOfRoot(dirRel: string, rootRel: string): boolean {
  if (!isSafePosixRelativePath(dirRel) || !isSafePosixRelativePath(rootRel)) {
    return false;
  }
  if (!dirRel.startsWith(rootRel + "/")) {
    return false;
  }
  return !dirRel.slice(rootRel.length + 1).includes("/");
}
