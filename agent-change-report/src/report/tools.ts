// Runs the other agent tools' CLIs when they are installed in the project.
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export type ToolState = "pass" | "fail" | "missing" | "broken";

export interface ToolResult {
  name: string;
  state: ToolState;
  summary: string;
  /** Blocking items to surface under "Needs attention". */
  problems: { level: "red" | "yellow"; text: string; file?: string; line?: number }[];
}

function runJson(root: string, cli: string, args: string[]): { json?: unknown; error?: string } {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    return { error: r.error.message };
  }
  try {
    return { json: JSON.parse(r.stdout) };
  } catch {
    return { error: (r.stderr || r.stdout || `exit ${r.status}`).trim().split("\n")[0] };
  }
}

interface GuardJson {
  ok: boolean;
  errors: number;
  warnings: number;
  findings: { rule: string; severity: string; file: string; line: number; message: string; allowedReason?: string }[];
}

export function migrationsGuard(root: string, base: string): ToolResult {
  const cli = path.join(root, ".migrations-guard", "tool", "cli.js");
  const name = "Migrations Guard";
  if (!fs.existsSync(cli)) {
    return { name, state: "missing", summary: "not installed", problems: [] };
  }
  const { json, error } = runJson(root, cli, ["check", "--base", base, "--json"]);
  const g = json as GuardJson | undefined;
  if (!g || !Array.isArray(g.findings)) {
    return { name, state: "broken", summary: `could not run: ${error ?? "unexpected output"}`, problems: [] };
  }
  const active = g.findings.filter((f) => !f.allowedReason && f.severity !== "info");
  const allowed = g.findings.filter((f) => f.allowedReason).length;
  return {
    name,
    state: g.ok ? "pass" : "fail",
    summary: `${g.errors} error(s), ${g.warnings} warning(s)${allowed ? `, ${allowed} allowed by comment` : ""}`,
    problems: active.map((f) => ({
      level: f.severity === "error" ? ("red" as const) : ("yellow" as const),
      text: `Migrations Guard \`${f.rule}\`: ${f.message}`,
      file: f.file,
      line: f.line,
    })),
  };
}

interface ScaffoldJson {
  ok: boolean;
  apps: { dir: string; missing: string[]; registered: boolean }[];
}

export function appStructure(root: string): ToolResult {
  const cli = path.join(root, ".django-scaffold", "tool", "cli.js");
  const name = "App structure";
  if (!fs.existsSync(cli) || !fs.existsSync(path.join(root, ".django-scaffold.json"))) {
    return { name, state: "missing", summary: "not installed", problems: [] };
  }
  const { json, error } = runJson(root, cli, ["check", "--json"]);
  const s = json as ScaffoldJson | undefined;
  if (!s || !Array.isArray(s.apps)) {
    return { name, state: "broken", summary: `could not run: ${error ?? "unexpected output"}`, problems: [] };
  }
  const bad = s.apps.filter((a) => a.missing.length > 0 || !a.registered);
  return {
    name,
    state: s.ok ? "pass" : "fail",
    summary: `${s.apps.length - bad.length} / ${s.apps.length} apps match the reference`,
    problems: bad.map((a) => ({
      level: "yellow" as const,
      text: `\`${a.dir}\` differs from the reference app: ${[
        ...(a.missing.length ? [`missing ${a.missing.join(", ")}`] : []),
        ...(a.registered ? [] : ["not in INSTALLED_APPS"]),
      ].join("; ")}`,
    })),
  };
}

interface ContextJson {
  ok: boolean;
  results: { path: string; status: string }[];
}

export function agentInstructions(root: string): ToolResult {
  const cli = path.join(root, ".agent-context", "tool", "cli.js");
  const name = "Agent instructions";
  if (!fs.existsSync(cli)) {
    return { name, state: "missing", summary: "not installed", problems: [] };
  }
  const { json, error } = runJson(root, cli, ["check", "--json"]);
  const c = json as ContextJson | undefined;
  if (!c || !Array.isArray(c.results)) {
    return { name, state: "broken", summary: `could not run: ${error ?? "unexpected output"}`, problems: [] };
  }
  const stale = c.results.filter((r) => r.status !== "unchanged").map((r) => r.path);
  return {
    name,
    state: c.ok ? "pass" : "fail",
    summary: c.ok ? "up to date" : `stale: ${stale.join(", ")}`,
    problems: c.ok
      ? []
      : [{ level: "yellow" as const, text: `Agent instructions are stale (${stale.join(", ")}). Run \`node .agent-context/tool/cli.js sync\`.` }],
  };
}
