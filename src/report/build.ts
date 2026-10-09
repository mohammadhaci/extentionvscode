import * as fs from "fs";
import * as path from "path";
import { parseMemory } from "../memory/memory";
import { MEMORY_DIR } from "../studio/paths";
import { diffSnapshots } from "./diff";
import { baseSources, changedFiles, commits, fileAtBase, headSources, Range, resolveRange } from "./git";
import { Report, verdictOf } from "./render";
import { findRisks } from "./risks";
import { snapshot } from "./snapshot";
import { agentInstructions, appStructure, migrationsGuard, ToolResult } from "./tools";

export interface BuildOptions {
  base?: string;
  /** Skip running the other tools (CI already runs them as separate steps). */
  noTools?: boolean;
}

export function buildReport(root: string, options: BuildOptions = {}): Report {
  const range = resolveRange(root, options.base);
  const files = changedFiles(root, range);
  const before = snapshot(baseSources(range));
  const after = snapshot(headSources(root));
  const diff = diffSnapshots(before, after);
  const appDirs = [...new Set([...Object.keys(before.apps), ...Object.keys(after.apps)])];
  const risks = findRisks(files, appDirs, { studioUpdate: studioUpdate(root, range) });
  const memories = files
    .filter((f) => f.status !== "deleted" && f.path.startsWith(`${MEMORY_DIR}/`) && f.path.endsWith(".md"))
    .map((f) => {
      const full = path.join(root, ...f.path.split("/"));
      const m = fs.existsSync(full) ? parseMemory(fs.readFileSync(full, "utf8"), f.path) : undefined;
      return m ? { title: m.title, type: m.type, path: f.path, status: m.status, change: f.status === "added" ? ("added" as const) : ("modified" as const) } : undefined;
    })
    .filter((m): m is NonNullable<typeof m> => m !== undefined);
  const tools: ToolResult[] = options.noTools
    ? []
    : [migrationsGuard(root, range.base), appStructure(root), agentInstructions(root)];
  return {
    branch: range.branch,
    base: range.base,
    mergeBase: range.mergeBase,
    commits: commits(range),
    files,
    diff,
    risks,
    tools,
    verdict: verdictOf(risks, tools),
    memories,
  };
}

/** The installed tool's version change on the branch, if any. */
function studioUpdate(root: string, range: Range): { from?: string; to: string } | undefined {
  const version = (text: string | undefined): string | undefined => {
    try {
      const v = text ? (JSON.parse(text) as { version?: unknown }).version : undefined;
      return typeof v === "string" ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const rel = ".agent-studio/tool/package.json";
  const file = path.join(root, ...rel.split("/"));
  const to = version(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined);
  const from = version(fileAtBase(range, rel));
  return to && to !== from ? { from, to } : undefined;
}
