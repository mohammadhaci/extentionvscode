/**
 * Pure GitHub Trees API selection logic (no `vscode` import: unit-testable).
 *
 * Confirmed against the GitHub REST docs ("REST API endpoints for Git trees"):
 * a symlink is reported as `type: "blob"` with `mode: "120000"` ("a blob that
 * specifies the path of a symlink"). The previous check looked at `type` only,
 * so symlinks passed the filter and their targets were fetched from
 * raw.githubusercontent.com. Selection now inspects `mode` first.
 */
import type { ParsedSkillUrl } from "./githubUrl";
import { isSafePosixRelativePath } from "./pathSafety";
import { MAX_SKILL_MD_BYTES } from "./skillMetadata";

export const MAX_IMPORT_FILES = 50;

/** Git Trees API mode for "a blob that specifies the path of a symlink". */
export const SYMLINK_GIT_MODE = "120000";

export function isSymlinkMode(mode: unknown): boolean {
  if (typeof mode === "number") {
    return mode === 120000;
  }
  if (typeof mode !== "string") {
    return false;
  }
  return mode.trim() === SYMLINK_GIT_MODE;
}

export interface RawTreeEntry {
  path?: unknown;
  type?: unknown;
  mode?: unknown;
  size?: unknown;
}

export interface SelectedImportFiles {
  wanted: string[];
  skippedSymlinks: string[];
}

/**
 * Filter one recursive Trees API listing down to the files under the chosen
 * skill folder (or the repository root when `parsed.skillPath` is empty).
 * Throws when SKILL.md itself is a symlink (whole import refused); symlink
 * assets are collected into `skippedSymlinks` and never fetched. Throws on
 * missing SKILL.md and on file-count/size violations.
 *
 * For repository-root imports with no root SKILL.md, throws an actionable
 * collection message instead of silently choosing among nested skills. The
 * caller must surface this before any raw asset request.
 */
export function selectImportFiles(tree: unknown, parsed: ParsedSkillUrl): SelectedImportFiles {
  if (!Array.isArray(tree)) {
    throw new Error("Unexpected GitHub API response.");
  }
  const isRoot = parsed.skillPath === "";
  const prefix = parsed.skillPath + "/";
  const wanted: string[] = [];
  const skippedSymlinks: string[] = [];
  for (const entry of tree as RawTreeEntry[]) {
    if (typeof entry.path !== "string" || typeof entry.type !== "string") {
      continue;
    }
    if (entry.type !== "blob") {
      continue; // tree (040000) / submodule commit (160000)
    }
    let rel: string;
    if (isRoot) {
      if (entry.path === "" || entry.path.startsWith("/")) {
        continue;
      }
      rel = entry.path;
    } else {
      if (entry.path !== parsed.skillFile && !entry.path.startsWith(prefix)) {
        continue;
      }
      rel = entry.path.slice(prefix.length);
    }
    if (rel === "" || rel.endsWith("/")) {
      continue;
    }
    if (!isSafePosixRelativePath(rel)) {
      continue; // reject traversal/unsafe paths
    }
    if (rel.split("/").length > 6) {
      continue;
    }
    if (isSymlinkMode(entry.mode)) {
      if (rel === "SKILL.md") {
        throw new Error("Refusing import: SKILL.md in the selected GitHub folder is a symlink.");
      }
      skippedSymlinks.push(rel);
      continue; // never fetch a symlink target
    }
    if (typeof entry.size === "number" && entry.size > MAX_SKILL_MD_BYTES) {
      throw new Error(`File ${rel} exceeds the 256 KB per-file limit.`);
    }
    wanted.push(rel);
    if (wanted.length > MAX_IMPORT_FILES) {
      throw new Error(`Skill exceeds the ${MAX_IMPORT_FILES}-file import limit.`);
    }
  }
  if (!wanted.includes("SKILL.md")) {
    if (isRoot) {
      throw new Error(
        "No SKILL.md at the repository root. This repository looks like a collection of skills: " +
          "paste the URL of the skill folder containing SKILL.md (…/tree/BRANCH/path/to/skill)."
      );
    }
    throw new Error("No SKILL.md found under the selected GitHub folder.");
  }
  wanted.sort();
  skippedSymlinks.sort();
  return { wanted, skippedSymlinks };
}
