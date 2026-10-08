import { diffSnapshots } from "./diff";
import { baseSources, changedFiles, commits, headSources, resolveRange } from "./git";
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
  const risks = findRisks(files, appDirs);
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
  };
}
