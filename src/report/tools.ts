// Runs the studio's other checks in-process for the change report.
import * as fs from "fs";
import * as path from "path";
import { main as contextMain } from "../context/cli";
import { main as guardMain } from "../guard/cli";
import { main as scaffoldMain } from "../scaffold/cli";
import { CLI, RULES_FILE, SCAFFOLD_CONFIG } from "../studio/paths";
import { runJson } from "../studio/run";

export type ToolState = "pass" | "fail" | "missing" | "broken";

export interface ToolResult {
  name: string;
  state: ToolState;
  summary: string;
  /** Blocking items to surface under "Needs attention". */
  problems: { level: "red" | "yellow"; text: string; file?: string; line?: number }[];
}

interface GuardJson {
  ok: boolean;
  errors: number;
  warnings: number;
  findings: { rule: string; severity: string; file: string; line: number; message: string; allowedReason?: string }[];
}

export function migrationsGuard(root: string, base: string): ToolResult {
  const name = "Migrations Guard";
  const { json: g, error } = runJson<GuardJson>(guardMain, ["check", "--base", base, "--json"], root);
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
  const name = "App structure";
  if (!fs.existsSync(path.join(root, ...SCAFFOLD_CONFIG.split("/")))) {
    return { name, state: "missing", summary: "no reference app set", problems: [] };
  }
  const { json: s, error } = runJson<ScaffoldJson>(scaffoldMain, ["check", "--json"], root);
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
  const name = "Agent instructions";
  if (!fs.existsSync(path.join(root, ...RULES_FILE.split("/")))) {
    return { name, state: "missing", summary: "no rules file", problems: [] };
  }
  const { json: c, error } = runJson<ContextJson>(contextMain, ["check", "--json"], root);
  if (!c || !Array.isArray(c.results)) {
    return { name, state: "broken", summary: `could not run: ${error ?? "unexpected output"}`, problems: [] };
  }
  const stale = c.results.filter((r) => r.status !== "unchanged").map((r) => r.path);
  return {
    name,
    state: c.ok ? "pass" : "fail",
    summary: c.ok ? "up to date" : `stale: ${stale.join(", ")}`,
    problems: c.ok ? [] : [{ level: "yellow" as const, text: `Agent instructions are stale (${stale.join(", ")}). Run \`${CLI} context sync\`.` }],
  };
}
