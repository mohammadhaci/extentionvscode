/**
 * GitHub URL parsing for skill imports.
 *
 * Accepted forms:
 *  - https://github.com/OWNER/REPO/tree/BRANCH/path/to/skill
 *  - https://github.com/OWNER/REPO/blob/BRANCH/path/to/SKILL.md
 *  - https://github.com/OWNER/REPO/raw/BRANCH/path/to/SKILL.md
 *  - https://raw.githubusercontent.com/OWNER/REPO/BRANCH/path/to/SKILL.md
 */

export interface ParsedSkillUrl {
  owner: string;
  repo: string;
  ref: string;
  /** Skill directory path inside repo, posix, no leading/trailing slash. */
  skillPath: string;
  /** SKILL.md path inside repo, posix. */
  skillFile: string;
  /** Final directory segment = skill name. */
  skillName: string;
  kind: "tree" | "blob" | "raw";
}

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9_.\-/]{1,200}$/;

function cleanSegments(parts: string[]): string[] | null {
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === "." || p === "..") {
      return null;
    }
    try {
      const decoded = decodeURIComponent(p);
      if (decoded === "" || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) {
        return null;
      }
      if (decoded.length > 100) {
        return null;
      }
      out.push(decoded);
    } catch {
      return null;
    }
  }
  return out;
}

export function parseGitHubSkillUrl(input: unknown): ParsedSkillUrl {
  if (typeof input !== "string") {
    throw new Error("URL must be a string.");
  }
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > 2048) {
    throw new Error("URL is empty or too long.");
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error("Not a valid URL.");
  }
  if (u.protocol !== "https:") {
    throw new Error("Only https: URLs are supported.");
  }

  if (u.hostname === "github.com") {
    const segs = u.pathname.split("/").filter((s) => s.length > 0);
    // OWNER / REPO / (tree|blob|raw) / REF / ...path
    if (segs.length < 4) {
      throw new Error("Expected https://github.com/OWNER/REPO/tree/BRANCH/path/to/skill (or blob/raw SKILL.md).");
    }
    const [owner, repo, kind, ...rest] = segs;
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
      throw new Error("Invalid repository owner or name.");
    }
    if (kind !== "tree" && kind !== "blob" && kind !== "raw") {
      throw new Error("GitHub URL must contain /tree/, /blob/, or /raw/.");
    }
    if (rest.length < 1) {
      throw new Error("Missing branch in GitHub URL.");
    }
    const ref = rest[0];
    if (!REF_RE.test(ref) || ref === "." || ref === "..") {
      throw new Error("Invalid branch in GitHub URL.");
    }
    const pathSegs = cleanSegments(rest.slice(1));
    if (!pathSegs || pathSegs.length === 0 || pathSegs.length > 20) {
      throw new Error("Invalid skill path in GitHub URL.");
    }
    let skillSegs = pathSegs;
    if (kind === "blob" || kind === "raw") {
      const last = pathSegs[pathSegs.length - 1].toLowerCase();
      if (last !== "skill.md") {
        throw new Error("Blob/raw URLs must point to a SKILL.md file.");
      }
      skillSegs = pathSegs.slice(0, -1);
      if (skillSegs.length === 0) {
        throw new Error("SKILL.md must be inside a skill folder.");
      }
    }
    const skillPath = skillSegs.join("/");
    const skillName = skillSegs[skillSegs.length - 1];
    return { owner, repo, ref, skillPath, skillFile: `${skillPath}/SKILL.md`, skillName, kind: kind as ParsedSkillUrl["kind"] };
  }

  if (u.hostname === "raw.githubusercontent.com") {
    const segs = u.pathname.split("/").filter((s) => s.length > 0);
    // OWNER / REPO / REF / ...path-to/SKILL.md
    if (segs.length < 4) {
      throw new Error("Expected https://raw.githubusercontent.com/OWNER/REPO/BRANCH/path/to/SKILL.md.");
    }
    const [owner, repo, ref, ...rest] = segs;
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
      throw new Error("Invalid repository owner or name.");
    }
    if (!REF_RE.test(ref)) {
      throw new Error("Invalid branch in raw URL.");
    }
    const pathSegs = cleanSegments(rest);
    if (!pathSegs || pathSegs.length < 2 || pathSegs.length > 21) {
      throw new Error("Invalid skill file path in raw URL.");
    }
    if (pathSegs[pathSegs.length - 1].toLowerCase() !== "skill.md") {
      throw new Error("Raw URLs must point to a SKILL.md file.");
    }
    const skillSegs = pathSegs.slice(0, -1);
    const skillPath = skillSegs.join("/");
    return { owner, repo, ref, skillPath, skillFile: `${skillPath}/SKILL.md`, skillName: skillSegs[skillSegs.length - 1], kind: "raw" };
  }

  throw new Error("Only github.com and raw.githubusercontent.com URLs are supported.");
}

export function toRawUrl(p: ParsedSkillUrl, repoPath: string): string {
  return `https://raw.githubusercontent.com/${p.owner}/${p.repo}/${p.ref}/${repoPath}`;
}

export function toApiTreeUrl(p: ParsedSkillUrl): string {
  return `https://api.github.com/repos/${p.owner}/${p.repo}/git/trees/${encodeURIComponent(p.ref)}?recursive=1`;
}
