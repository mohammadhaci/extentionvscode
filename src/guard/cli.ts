// CLI for agents, CI and scripts. Node standard library + git.
import * as fs from "fs";
import * as path from "path";
import { checkProject } from "./project";
import { formatText, summarize } from "./report";
import { RULES } from "./rules";
import { CLI, STUDIO_DIR, TOOL_DIR } from "../studio/paths";

export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
}

export { TOOL_DIR };

const USAGE = `Migrations Guard CLI

Static safety checks for Django migrations. Never runs project code.

Usage (run from anywhere inside the project):
  ${CLI} guard check [--base <git-ref>] [--all] [--strict] [--json]
  ${CLI} guard rules

check     By default only migrations that are new or changed in the working tree
          (vs HEAD) are checked, plus graph-wide conflicts.
          --base origin/main  check everything this branch adds (use in CI / before a PR)
          --all               check every migration's operations
          --strict            also fail on warnings
rules     List rule ids, severities and what to do about each.

Intentional, reviewed exceptions: add to the migration file
  # migrations-guard: allow <rule>[, <rule>]: <reason>

Exit codes: 0 clean, 1 findings that fail the check or an error, 2 usage error.`;

export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (["manage.py", ".git", STUDIO_DIR].some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) {
      return path.resolve(cwd);
    }
    dir = up;
  }
}

export function main(argv: readonly string[], io: Io): number {
  const positional: string[] = [];
  const flags = new Set<string>();
  let base: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") {
      base = argv[++i];
      if (!base || base.startsWith("--")) {
        io.err("error: --base needs a git ref, e.g. --base origin/main");
        return 2;
      }
    } else if (a.startsWith("--base=")) {
      base = a.slice(7);
    } else if (["--all", "--strict", "--json", "--help"].includes(a)) {
      flags.add(a.slice(2));
    } else if (a.startsWith("-")) {
      io.err(`error: unknown option ${a}`);
      return 2;
    } else {
      positional.push(a);
    }
  }
  const cmd = positional[0];
  if (flags.has("help") || cmd === "help") {
    io.out(USAGE);
    return 0;
  }
  if (!cmd || positional.length > 1) {
    io.err(USAGE);
    return 2;
  }
  if (cmd === "rules") {
    for (const [id, r] of Object.entries(RULES)) {
      io.out(`${r.severity.padEnd(7)} ${id}\n        ${r.hint}`);
    }
    return 0;
  }
  if (cmd !== "check") {
    io.err(`error: unknown command "${cmd}". Run with --help.`);
    return 2;
  }
  if (base && flags.has("all")) {
    io.err("error: use either --base or --all, not both.");
    return 2;
  }
  try {
    const root = findProjectRoot(io.cwd);
    const result = checkProject(root, { base, all: flags.has("all") });
    result.warnings.forEach((w) => io.err(`warning: ${w}`));
    const s = summarize(result.findings);
    const failed = s.errors > 0 || (flags.has("strict") && s.warnings > 0);
    if (flags.has("json")) {
      io.out(JSON.stringify({ ok: !failed, scope: result.scope, checked: result.checked, ...s, findings: result.findings }, null, 2));
    } else {
      io.out(formatText(result.findings, result.scope, result.checked));
    }
    return failed ? 1 : 0;
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
