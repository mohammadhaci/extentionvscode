// Filesystem + git side, shared by the CLI and the VS Code extension.
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { analyze, ChangeStatus, Finding, MigrationFile } from "./rules";

const SKIP_DIRS = new Set(["node_modules", "venv", "env", "site-packages", "__pycache__", "dist", "build"]);
const MAX_MIGRATIONS = 20_000;

export const isMigrationPath = (p: string): boolean => /(^|\/)migrations\/(?!__init__\.py$)[^/]+\.py$/.test(p);

/** All `<app>/migrations/*.py` files, skipping hidden, dependency and virtualenv folders and symlinks. */
export function findMigrations(root: string): MigrationFile[] {
  const out: MigrationFile[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > 25 || out.length >= MAX_MIGRATIONS) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (!e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
          walk(child, depth + 1);
        }
      } else if (e.isFile() && isMigrationPath(child)) {
        const parts = child.split("/");
        out.push({
          path: child,
          app: parts.length >= 3 ? parts[parts.length - 3] : "",
          name: e.name.slice(0, -3),
          text: fs.readFileSync(path.join(root, child), "utf8"),
        });
      }
    }
  };
  walk("", 0);
  return out;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

export interface ChangeSet {
  changes: Map<string, ChangeStatus>;
  /** Human description of what was compared, e.g. "working tree vs HEAD". */
  description: string;
}

/**
 * Migration files added, modified or deleted relative to `base` (merge-base
 * with HEAD), including uncommitted and untracked files. Undefined when the
 * folder is not a git work tree.
 */
export function migrationChanges(root: string, base: string): ChangeSet | undefined {
  let top: string;
  try {
    top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return undefined;
  }
  const prefix = path.relative(fs.realpathSync(top), fs.realpathSync(root)).split(path.sep).join("/");
  const toRoot = (p: string): string | undefined =>
    !prefix ? p : p.startsWith(`${prefix}/`) ? p.slice(prefix.length + 1) : undefined;

  const changes = new Map<string, ChangeStatus>();
  let description: string;
  let hasHead = true;
  try {
    git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    hasHead = false;
  }
  if (hasHead) {
    let from = "HEAD";
    if (base !== "HEAD") {
      try {
        git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
      } catch {
        throw new Error(`Unknown git ref "${base}". Check the branch name, or fetch it first (e.g. git fetch origin main).`);
      }
      try {
        from = git(root, ["merge-base", base, "HEAD"]).trim();
      } catch {
        throw new Error(`Cannot compare with "${base}": no common history (fetch it first, e.g. git fetch origin main).`);
      }
    }
    description = base === "HEAD" ? "uncommitted changes" : `changes since ${base}`;
    const fields = git(top, ["diff", "--name-status", "--no-renames", "-z", from, "--"]).split("\0");
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const [status, file] = [fields[i], fields[i + 1]];
      const rel = file ? toRoot(file) : undefined;
      if (!rel || !isMigrationPath(rel)) {
        continue;
      }
      changes.set(rel, status === "A" ? "added" : status === "D" ? "deleted" : "modified");
    }
  } else {
    description = "all files (repository has no commits yet)";
  }
  const untracked = git(top, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const file of untracked.split("\0")) {
    const rel = file ? toRoot(file) : undefined;
    if (rel && isMigrationPath(rel)) {
      changes.set(rel, "added");
    }
  }
  return { changes, description };
}

export interface CheckResult {
  findings: Finding[];
  scope: string;
  checked: number;
  warnings: string[];
}

export function checkProject(root: string, options: { base?: string; all?: boolean } = {}): CheckResult {
  const migrations = findMigrations(root);
  const warnings: string[] = [];
  if (options.all) {
    return { findings: analyze({ migrations }), scope: "all migrations", checked: migrations.length, warnings };
  }
  const base = options.base ?? "HEAD";
  const set = migrationChanges(root, base);
  if (!set) {
    warnings.push("Not a git repository: checking every migration (use --all to silence this).");
    return { findings: analyze({ migrations }), scope: "all migrations", checked: migrations.length, warnings };
  }
  const checked = [...set.changes.values()].filter((s) => s !== "deleted").length;
  return { findings: analyze({ migrations, changes: set.changes }), scope: set.description, checked, warnings };
}
