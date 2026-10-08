// CLI for agents, CI and scripts. Node standard library only.
import * as fs from "fs";
import * as path from "path";
import { CONFIG_FILE, RULES_FILE, SCAFFOLD_CONFIG, TOOL_DIR } from "./context/config";
import { initRules, syncProject, TargetResult } from "./context/sync";

export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
}

const USAGE = `Agent Context Sync CLI

Keeps CLAUDE.md, AGENTS.md and .github/copilot-instructions.md in sync from
${RULES_FILE} plus an auto-generated Django project map.

Usage (run from anywhere inside the project):
  node ${TOOL_DIR}/cli.js sync [--json]    Update the generated block in every target file
  node ${TOOL_DIR}/cli.js check [--json]   Exit 1 when any target is out of date (for CI / agents)
  node ${TOOL_DIR}/cli.js print            Print the generated block
  node ${TOOL_DIR}/cli.js init             Create ${RULES_FILE} from a starter template

Only the text between <!-- agent-context:start --> and <!-- agent-context:end -->
is ever rewritten; everything else in the target files is preserved.
Targets and options: ${CONFIG_FILE} (optional).

Exit codes: 0 success, 1 out of date or failure, 2 usage error.`;

/** Nearest ancestor holding the context folder, manage.py or a .git folder; falls back to `cwd`. */
export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const marker of [path.dirname(RULES_FILE), "manage.py", SCAFFOLD_CONFIG, ".git"]) {
      if (fs.existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    const up = path.dirname(dir);
    if (up === dir) {
      return path.resolve(cwd);
    }
    dir = up;
  }
}

function report(results: readonly TargetResult[], io: Io): void {
  for (const r of results) {
    io.out(`${r.status.padEnd(9)} ${r.path}${r.error ? ` (${r.error})` : ""}`);
  }
}

export function main(argv: readonly string[], io: Io): number {
  const args = argv.filter((a) => !a.startsWith("--"));
  const json = argv.includes("--json");
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--json" && a !== "--help");
  const cmd = args[0];
  if (argv.includes("--help") || cmd === "help") {
    io.out(USAGE);
    return 0;
  }
  if (!cmd || args.length > 1 || unknown.length > 0) {
    io.err(unknown.length > 0 ? `error: unknown option ${unknown[0]}` : USAGE);
    return 2;
  }
  try {
    const root = findProjectRoot(io.cwd);
    switch (cmd) {
      case "init": {
        const created = initRules(root);
        io.out(created ? `Created ${RULES_FILE}. Fill in the TODOs, then run sync.` : `${RULES_FILE} already exists.`);
        return 0;
      }
      case "print": {
        const r = syncProject(root, { check: true });
        r.warnings.forEach((w) => io.err(`warning: ${w}`));
        io.out(r.block);
        return 0;
      }
      case "sync":
      case "check": {
        const check = cmd === "check";
        const r = syncProject(root, { check });
        r.warnings.forEach((w) => io.err(`warning: ${w}`));
        const failed = r.results.some((x) => x.status === "error" || x.status === "stale");
        if (json) {
          io.out(JSON.stringify({ ok: !failed, results: r.results, warnings: r.warnings }, null, 2));
        } else {
          report(r.results, io);
          if (check && failed) {
            io.err(`Agent instructions are out of date. Run: node ${TOOL_DIR}/cli.js sync`);
          }
        }
        return failed ? 1 : 0;
      }
      default:
        io.err(`error: unknown command "${cmd}". Run with --help.`);
        return 2;
    }
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (require.main === module) {
  // Output piped into `head` and similar closes early; that is not a failure.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") {
        process.exit(process.exitCode ?? 0);
      }
      throw err;
    });
  }
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (l) => process.stdout.write(l + "\n"),
    err: (l) => process.stderr.write(l + "\n"),
  });
}
