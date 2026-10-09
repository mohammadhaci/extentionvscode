// CLI for agents, CI and scripts. Node standard library + git.
import * as fs from "fs";
import * as path from "path";
import { buildReport } from "./build";
import { renderReport, Verdict } from "./render";
import { CLI, TOOL_DIR } from "../studio/paths";

export interface Io {
  cwd: string;
  out(line: string): void;
  err(line: string): void;
}

export { TOOL_DIR };

const USAGE = `Agent Change Report CLI

Summarises what a branch changes in Django terms (apps, models, fields, URLs,
app dependencies, migrations), flags risky files, and runs the other installed
agent tools. Static: never runs project code.

Usage (run from anywhere inside the project):
  ${CLI} report [--base <git-ref>] [--json] [--out <file>] [--no-tools] [--fail-on red|yellow]

  --base      Compare with this ref (default: origin/main, origin/master, main or master)
  --json      Machine-readable output instead of Markdown
  --out       Write to a file instead of stdout
  --no-tools  Do not run Migrations Guard / app structure / agent-instructions checks
  --fail-on   Exit 1 when the verdict is red (or yellow and red)

Exit codes: 0 report written, 1 failure or --fail-on matched, 2 usage error.`;

export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (["manage.py", ".git"].some((m) => fs.existsSync(path.join(dir, m)))) {
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
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [key, inline] = a.startsWith("--") ? a.slice(2).split(/=(.*)/s, 2) : [undefined, undefined];
    if (key && ["base", "out", "fail-on"].includes(key)) {
      const v = inline ?? argv[++i];
      if (!v || v.startsWith("--")) {
        io.err(`error: --${key} needs a value`);
        return 2;
      }
      values.set(key, v);
    } else if (key && ["json", "no-tools", "help"].includes(key)) {
      flags.add(key);
    } else if (a.startsWith("-")) {
      io.err(`error: unknown option ${a}`);
      return 2;
    } else {
      positional.push(a);
    }
  }
  if (flags.has("help") || positional[0] === "help") {
    io.out(USAGE);
    return 0;
  }
  if (positional[0] !== "report" || positional.length > 1) {
    io.err(positional.length === 0 ? USAGE : `error: unknown command "${positional.join(" ")}". Run with --help.`);
    return 2;
  }
  const failOn = values.get("fail-on");
  if (failOn !== undefined && failOn !== "red" && failOn !== "yellow") {
    io.err("error: --fail-on must be red or yellow");
    return 2;
  }
  try {
    const root = findProjectRoot(io.cwd);
    const report = buildReport(root, { base: values.get("base"), noTools: flags.has("no-tools") });
    const text = flags.has("json") ? JSON.stringify(report, null, 2) + "\n" : renderReport(report);
    const out = values.get("out");
    if (out) {
      fs.writeFileSync(path.resolve(io.cwd, out), text);
      io.err(`Wrote ${out} (verdict: ${report.verdict}).`);
    } else {
      io.out(text.replace(/\n$/, ""));
    }
    const rank: Record<Verdict, number> = { green: 0, yellow: 1, red: 2 };
    return failOn && rank[report.verdict] >= rank[failOn as Verdict] ? 1 : 0;
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
