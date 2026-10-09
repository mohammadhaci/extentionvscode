// Collects everything the Home view shows, by running the studio's own CLIs
// in-process. Node standard library + git only (no `vscode`), so it is testable.
import * as fs from "fs";
import * as path from "path";
import { CI_WORKFLOW_PATH } from "../context/ci";
import { main as contextMain } from "../context/cli";
import { summarizeProject } from "../context/projectMap";
import { scanPython } from "../context/sync";
import { CI_WORKFLOW } from "../generated/ciTemplate";
import { STUDIO_VERSION } from "../generated/version";
import { main as guardMain } from "../guard/cli";
import { main as reportMain } from "../report/cli";
import { main as scaffoldMain } from "../scaffold/cli";
import { mcpInstalled } from "../mcp/config";
import { listMemories } from "../memory/memory";
import { listTasks } from "../tasks/library";
import { installedToolVersion, missingSkills } from "./install";
import { RULES_FILE, SCAFFOLD_CONFIG } from "./paths";
import { runJson } from "./run";

export type CheckState = "pass" | "fail" | "off" | "error";

export interface StudioStatus {
  folder: string;
  django: { detected: boolean; apps: number; models: number };
  git: boolean;
  tool: { installed: boolean; version?: string; outdated: boolean };
  skills: { missing: string[] };
  ci: "installed" | "outdated" | "missing";
  scaffold: { state: CheckState; reference?: string; ok: number; total: number; detail?: string };
  context: { state: CheckState; stale: string[]; detail?: string };
  guard: { state: CheckState; errors: number; warnings: number; scope?: string; detail?: string };
  report: { state: CheckState; verdict?: "red" | "yellow" | "green"; branch?: string; base?: string; files: number; commits: number; detail?: string };
  memory: { active: number; latest?: string };
  mcp: boolean;
  tasks: { id: string; icon: string; title: string; titleAr?: string; custom: boolean }[];
}

const exists = (root: string, rel: string): boolean => fs.existsSync(path.join(root, ...rel.split("/")));

export function collectStatus(root: string): StudioStatus {
  const summary = summarizeProject(scanPython(root));
  const git = fs.existsSync(path.join(root, ".git"));
  const version = installedToolVersion(root);
  const ciFile = path.join(root, ...CI_WORKFLOW_PATH.split("/"));
  const ci = !fs.existsSync(ciFile) ? "missing" : fs.readFileSync(ciFile, "utf8") === CI_WORKFLOW ? "installed" : "outdated";

  // App structure vs reference app
  let scaffold: StudioStatus["scaffold"] = { state: "off", ok: 0, total: 0 };
  if (exists(root, SCAFFOLD_CONFIG)) {
    const { json, error } = runJson<{ reference: string; ok: boolean; apps: { missing: string[]; registered: boolean }[] }>(scaffoldMain, ["check", "--json"], root);
    scaffold = json
      ? {
          state: json.ok ? "pass" : "fail",
          reference: json.reference,
          ok: json.apps.filter((a) => a.missing.length === 0 && a.registered).length,
          total: json.apps.length,
        }
      : { state: "error", ok: 0, total: 0, detail: error };
  }

  // Agent instructions
  let context: StudioStatus["context"] = { state: "off", stale: [] };
  if (exists(root, RULES_FILE)) {
    const { json, error } = runJson<{ ok: boolean; results: { path: string; status: string }[] }>(contextMain, ["check", "--json"], root);
    context = json
      ? { state: json.ok ? "pass" : "fail", stale: json.results.filter((r) => r.status !== "unchanged").map((r) => r.path) }
      : { state: "error", stale: [], detail: error };
  }

  // Migrations (uncommitted work)
  let guard: StudioStatus["guard"] = { state: "off", errors: 0, warnings: 0 };
  if (summary.isDjango) {
    const { json, error } = runJson<{ ok: boolean; errors: number; warnings: number; scope: string }>(guardMain, ["check", "--json"], root);
    guard = json
      ? { state: json.ok ? "pass" : "fail", errors: json.errors, warnings: json.warnings, scope: json.scope }
      : { state: "error", errors: 0, warnings: 0, detail: error };
  }

  // Current branch report (checks above already ran, so skip them here)
  let report: StudioStatus["report"] = { state: "off", files: 0, commits: 0 };
  if (git) {
    const { json, error } = runJson<{ verdict: "red" | "yellow" | "green"; branch: string; base: string; files: unknown[]; commits: unknown[] }>(
      reportMain,
      ["report", "--json", "--no-tools"],
      root
    );
    report = json
      ? {
          state: json.verdict === "red" ? "fail" : "pass",
          verdict: json.verdict,
          branch: json.branch,
          base: json.base,
          files: json.files.length,
          commits: json.commits.length,
        }
      : { state: "error", files: 0, commits: 0, detail: error };
  }

  const memories = listMemories(root).filter((m) => m.status === "active");

  return {
    folder: path.basename(root),
    django: {
      detected: summary.isDjango,
      apps: summary.apps.length,
      models: summary.apps.reduce((n, a) => n + a.models.length, 0),
    },
    git,
    tool: { installed: version !== undefined, version, outdated: version !== undefined && version !== STUDIO_VERSION },
    skills: { missing: missingSkills(root) },
    ci,
    scaffold,
    context,
    guard,
    report,
    memory: { active: memories.length, latest: memories[0]?.title },
    mcp: mcpInstalled(root),
    tasks: listTasks(root).map((t) => ({ id: t.id, icon: t.icon, title: t.title, titleAr: t.titleAr, custom: t.path !== undefined })),
  };
}
