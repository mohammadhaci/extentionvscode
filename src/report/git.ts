// git + filesystem access. Uses only the git CLI and Node's standard library.
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { decodePythonSource } from "../analyzer/decodePythonSource";
import { ChangedFile } from "./risks";
import { SourceText } from "./snapshot";

const SKIP_DIRS = new Set(["node_modules", "venv", "env", "site-packages", "__pycache__", "migrations", "dist", "build", "staticfiles", "media"]);
const MAX_PY_FILES = 20_000;
const MAX_PY_BYTES = 1024 * 1024;

export function git(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 512 * 1024 * 1024,
  });
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args).trim();
  } catch {
    return undefined;
  }
}

/** Python files that matter for structure: skips hidden, dependency, build and migration folders. */
export function isStructurePath(p: string): boolean {
  return p.endsWith(".py") && !p.split("/").some((seg, i, all) => i < all.length - 1 && (seg.startsWith(".") || SKIP_DIRS.has(seg)));
}

export interface Range {
  /** Repository root (where git runs). */
  top: string;
  /** Project root relative to `top` ("" when equal). */
  prefix: string;
  base: string;
  mergeBase: string;
  head: string;
  branch: string;
}

/** Resolves the comparison: `base` if given, else origin/main, origin/master, main, master. */
export function resolveRange(root: string, base?: string): Range {
  const top = tryGit(root, ["rev-parse", "--show-toplevel"]);
  if (!top) {
    throw new Error("Not a git repository.");
  }
  if (!tryGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"])) {
    throw new Error("The repository has no commits yet.");
  }
  const candidates = (base ? [base] : ["origin/main", "origin/master", "main", "master"]).filter((c) =>
    tryGit(root, ["rev-parse", "--verify", "--quiet", `${c}^{commit}`])
  );
  if (candidates.length === 0) {
    throw new Error(base ? `Unknown git ref "${base}". Fetch it first (e.g. git fetch origin main).` : "No main/master branch found; pass --base <ref>.");
  }
  // Without an explicit base, use the candidate closest to HEAD (fewest commits to
  // review), so a stale origin/main or an outdated local main does not inflate the report.
  let best: { ref: string; mergeBase: string; distance: number } | undefined;
  for (const ref of candidates) {
    const mb = tryGit(root, ["merge-base", ref, "HEAD"]);
    const distance = mb ? Number(tryGit(root, ["rev-list", "--count", `${mb}..HEAD`]) ?? Infinity) : Infinity;
    if (mb && (!best || distance < best.distance)) {
      best = { ref, mergeBase: mb, distance };
    }
  }
  if (!best) {
    throw new Error(`"${candidates[0]}" has no common history with HEAD.`);
  }
  const found = best.ref;
  const mergeBase = best.mergeBase;
  const prefix = path.relative(fs.realpathSync(top), fs.realpathSync(root)).split(path.sep).join("/");
  return {
    top,
    prefix,
    base: found,
    mergeBase,
    head: tryGit(root, ["rev-parse", "HEAD"]) ?? "HEAD",
    branch: tryGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD",
  };
}

const toRoot = (range: Range, p: string): string | undefined =>
  !range.prefix ? p : p.startsWith(`${range.prefix}/`) ? p.slice(range.prefix.length + 1) : undefined;

/** Files changed between the merge base and the working tree (committed, staged, unstaged and untracked). */
export function changedFiles(root: string, range: Range): ChangedFile[] {
  const files = new Map<string, ChangedFile>();
  const status = git(range.top, ["diff", "--name-status", "--no-renames", "-z", range.mergeBase, "--"]).split("\0");
  for (let i = 0; i + 1 < status.length; i += 2) {
    const rel = toRoot(range, status[i + 1]);
    if (rel) {
      files.set(rel, { path: rel, status: status[i] === "A" ? "added" : status[i] === "D" ? "deleted" : "modified" });
    }
  }
  const numstat = git(range.top, ["diff", "--numstat", "--no-renames", "-z", range.mergeBase, "--"]).split("\0");
  for (const entry of numstat) {
    const [a, d, file] = entry.split("\t");
    const rel = file ? toRoot(range, file) : undefined;
    const f = rel ? files.get(rel) : undefined;
    if (f && a !== "-") {
      f.added = Number(a);
      f.removed = Number(d);
    }
  }
  for (const file of git(range.top, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")) {
    const rel = file ? toRoot(range, file) : undefined;
    if (!rel) {
      continue;
    }
    let added: number | undefined;
    try {
      const buf = fs.readFileSync(path.join(root, rel));
      added = buf.includes(0) ? undefined : buf.toString("utf8").split("\n").filter((l, i, all) => i < all.length - 1 || l !== "").length;
    } catch {
      added = undefined;
    }
    files.set(rel, { path: rel, status: "added", added, removed: added === undefined ? undefined : 0 });
  }
  return [...files.values()].sort((x, y) => x.path.localeCompare(y.path));
}

export function commits(range: Range, limit = 30): { sha: string; subject: string }[] {
  const out = git(range.top, ["log", "--format=%h%x09%s", `-${limit}`, `${range.mergeBase}..HEAD`]);
  return out.split("\n").filter(Boolean).map((l) => ({ sha: l.split("\t")[0], subject: l.slice(l.indexOf("\t") + 1) }));
}

/** Python sources of the project as of the merge base, read in one `git cat-file --batch`. */
export function baseSources(range: Range): SourceText[] {
  const listing = git(range.top, ["ls-tree", "-r", "-z", "--name-only", range.mergeBase]).split("\0");
  const wanted = listing
    .map((p) => ({ repo: p, rel: toRoot(range, p) }))
    .filter((x): x is { repo: string; rel: string } => !!x.rel && isStructurePath(x.rel))
    .slice(0, MAX_PY_FILES);
  if (wanted.length === 0) {
    return [];
  }
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    cwd: range.top,
    input: wanted.map((w) => `${range.mergeBase}:${w.repo}\n`).join(""),
    maxBuffer: 1024 * 1024 * 1024,
  });
  const out: SourceText[] = [];
  let pos = 0;
  for (const w of wanted) {
    const nl = raw.indexOf(0x0a, pos);
    const header = raw.subarray(pos, nl).toString("utf8");
    pos = nl + 1;
    const m = /^\S+ blob (\d+)$/.exec(header);
    if (!m) {
      continue; // "missing" or non-blob: no body follows
    }
    const size = Number(m[1]);
    const body = raw.subarray(pos, pos + size);
    pos += size + 1;
    if (size <= MAX_PY_BYTES) {
      try {
        out.push({ path: w.rel, text: decodePythonSource(body).text });
      } catch {
        // undecodable file: ignored for structure
      }
    }
  }
  return out;
}

/** Python sources in the working tree. */
export function headSources(root: string): SourceText[] {
  const out: SourceText[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > 25 || out.length >= MAX_PY_FILES) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
          walk(child, depth + 1);
        }
      } else if (e.isFile() && e.name.endsWith(".py")) {
        const full = path.join(root, child);
        if (fs.statSync(full).size <= MAX_PY_BYTES) {
          try {
            out.push({ path: child, text: decodePythonSource(fs.readFileSync(full)).text });
          } catch {
            // undecodable file: ignored for structure
          }
        }
      }
    }
  };
  walk("", 0);
  return out;
}
