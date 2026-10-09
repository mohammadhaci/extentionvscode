// Django Agent Studio CLI: one entry point for agents, CI and scripts.
// Installed into projects as .agent-studio/tool/cli.js (Node standard library + git only).
import * as fs from "fs";
import * as path from "path";
import { main as contextMain } from "./context/cli";
import { STUDIO_VERSION } from "./generated/version";
import { main as guardMain } from "./guard/cli";
import { main as reportMain } from "./report/cli";
import { main as scaffoldMain } from "./scaffold/cli";
import { CLI, RULES_FILE, SCAFFOLD_CONFIG } from "./studio/paths";
import { Io, runCaptured } from "./studio/run";

const USAGE = `🤖 Django Agent Studio ${STUDIO_VERSION}

Usage (run from anywhere inside the project):
  ${CLI} scaffold <new|check|apps|reference> ...   Create apps by cloning the approved reference app
  ${CLI} context  <sync|check|print|init|install-ci> Keep CLAUDE.md, AGENTS.md and Copilot instructions in sync
  ${CLI} guard    <check|rules> ...                 Static safety checks for Django migrations
  ${CLI} report   [--base <ref>] ...                One-page review of the current branch
  ${CLI} doctor   [--base <ref>]                    Run every check; exit 1 if any fails
  ${CLI} version

Run "${CLI} <command> --help" for the options of each command.`;

interface DoctorRow {
  name: string;
  state: "pass" | "fail" | "skip";
  detail: string;
}

/** Runs every check of the studio and prints one summary. */
function doctor(argv: readonly string[], io: Io): number {
  let base: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") {
      base = argv[++i];
    } else if (argv[i].startsWith("--base=")) {
      base = argv[i].slice(7);
    } else if (argv[i] === "--help") {
      io.out(`${CLI} doctor [--base <ref>]\n\nRuns guard check, scaffold check and context check. Exit 1 if any fails.`);
      return 0;
    } else {
      io.err(`error: unknown option ${argv[i]}`);
      return 2;
    }
  }
  const root = findRoot(io.cwd);
  const lastLine = (s: string): string => s.trim().split("\n").filter(Boolean).pop() ?? "";
  const rows: DoctorRow[] = [];

  const guard = runCaptured(guardMain, ["check", ...(base ? ["--base", base] : [])], io.cwd);
  rows.push({ name: "Migrations", state: guard.code === 0 ? "pass" : "fail", detail: lastLine(guard.out) || lastLine(guard.err) });

  if (fs.existsSync(path.join(root, ...SCAFFOLD_CONFIG.split("/")))) {
    const s = runCaptured(scaffoldMain, ["check", "--json"], io.cwd);
    let detail = lastLine(s.err);
    try {
      const j = JSON.parse(s.out) as { apps: { missing: string[]; registered: boolean }[] };
      const ok = j.apps.filter((a) => a.missing.length === 0 && a.registered).length;
      detail = `${ok} / ${j.apps.length} apps match the reference`;
    } catch {
      // keep the error text
    }
    rows.push({ name: "App structure", state: s.code === 0 ? "pass" : "fail", detail });
  } else {
    rows.push({ name: "App structure", state: "skip", detail: `no reference app (${CLI} scaffold reference <app_dir>)` });
  }

  if (fs.existsSync(path.join(root, ...RULES_FILE.split("/")))) {
    const c = runCaptured(contextMain, ["check"], io.cwd);
    rows.push({ name: "Agent instructions", state: c.code === 0 ? "pass" : "fail", detail: c.code === 0 ? "up to date" : `stale, run: ${CLI} context sync` });
  } else {
    rows.push({ name: "Agent instructions", state: "skip", detail: `no rules file (${CLI} context init)` });
  }

  const icon = { pass: "✅", fail: "❌", skip: "➖" } as const;
  const width = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) {
    io.out(`${icon[r.state]} ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const failed = rows.filter((r) => r.state === "fail").length;
  io.out(failed === 0 ? "\n🎉 All checks passed." : `\n${failed} check(s) need attention.`);
  return failed === 0 ? 0 : 1;
}

function findRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if ([".agent-studio", "manage.py", ".git"].some((m) => fs.existsSync(path.join(dir, m)))) {
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
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "scaffold":
      return scaffoldMain(rest, io);
    case "context":
      return contextMain(rest, io);
    case "guard":
      return guardMain(rest, io);
    case "report":
      return reportMain(argv, io);
    case "doctor":
      return doctor(rest, io);
    case "version":
    case "--version":
      io.out(STUDIO_VERSION);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      io.out(USAGE);
      return cmd === undefined ? 2 : 0;
    default:
      io.err(`error: unknown command "${cmd}".\n\n${USAGE}`);
      return 2;
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
