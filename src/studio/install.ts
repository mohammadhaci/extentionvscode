// Installs Django Agent Studio into a project: the CLI, the agent skills, the
// rules file and the CI workflow. Node standard library only (testable).
import * as fs from "fs";
import * as path from "path";
import { installMcpConfig, McpInstallResult } from "../mcp/config";
import { CiInstallStatus, installCiWorkflow } from "../context/ci";
import { initRules } from "../context/sync";
import { STUDIO_VERSION } from "../generated/version";
import { SKILL_ROOTS, STUDIO_SKILLS, TOOL_DIR } from "./paths";

/** Compiled files the CLI needs; editor-only modules (they import `vscode`) stay out. */
export function isToolFile(rel: string): boolean {
  if (!rel.endsWith(".js")) {
    return false;
  }
  const top = rel.split("/")[0];
  if (["test", "map", "skillsDashboard"].includes(top) || rel === "extension.js") {
    return false;
  }
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  return base !== "ui.js" && !/^studio\/(home|setup)\b/.test(rel) && rel !== "analyzer/analyzeWorkspace.js";
}

/** Copies the CLI from the extension's `out/` folder into `<project>/.agent-studio/tool/`. */
export function installTool(outDir: string, projectRoot: string): number {
  const dest = path.join(projectRoot, ...TOOL_DIR.split("/"));
  fs.rmSync(dest, { recursive: true, force: true });
  let count = 0;
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(outDir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(child);
      } else if (e.isFile() && isToolFile(child)) {
        fs.mkdirSync(path.dirname(path.join(dest, child)), { recursive: true });
        fs.copyFileSync(path.join(outDir, child), path.join(dest, child));
        count++;
      }
    }
  };
  walk("");
  // Keeps the CLI CommonJS even if the project's own package.json says "type": "module".
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ private: true, type: "commonjs", version: STUDIO_VERSION }, null, 2) + "\n");
  return count;
}

/** Version of the CLI installed in the project, if any. */
export function installedToolVersion(projectRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, ...TOOL_DIR.split("/"), "package.json"), "utf8")) as { version?: unknown };
    return fs.existsSync(path.join(projectRoot, ...TOOL_DIR.split("/"), "cli.js")) && typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/** Writes every studio skill into every skill root. Returns the written SKILL.md paths. */
export function installSkills(agentKitDir: string, projectRoot: string, roots: readonly string[] = SKILL_ROOTS): string[] {
  const written: string[] = [];
  for (const skill of STUDIO_SKILLS) {
    const text = fs.readFileSync(path.join(agentKitDir, "skills", skill, "SKILL.md"));
    for (const root of roots) {
      const rel = `${root}/${skill}/SKILL.md`;
      const file = path.join(projectRoot, ...rel.split("/"));
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
        continue;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      written.push(rel);
    }
  }
  return written;
}

/** Skills shipped with the studio that are missing from at least one root. */
export function missingSkills(projectRoot: string, roots: readonly string[] = SKILL_ROOTS): string[] {
  return STUDIO_SKILLS.filter((s) => roots.some((r) => !fs.existsSync(path.join(projectRoot, ...r.split("/"), s, "SKILL.md"))));
}

export interface SetupResult {
  toolFiles: number;
  skills: string[];
  rulesCreated: boolean;
  ci: CiInstallStatus | "skipped";
  mcp: McpInstallResult[];
}

/** Full project setup. `ci`: "write" keeps a customised workflow, "force" replaces it, "skip" leaves it. */
export function setUpProject(
  extensionRoot: string,
  projectRoot: string,
  options: { ci?: "write" | "force" | "skip"; skillRoots?: readonly string[] } = {}
): SetupResult {
  const toolFiles = installTool(path.join(extensionRoot, "out"), projectRoot);
  const skills = installSkills(path.join(extensionRoot, "agent-kit"), projectRoot, options.skillRoots);
  const rulesCreated = initRules(projectRoot);
  const ci = options.ci === "skip" ? "skipped" : installCiWorkflow(projectRoot, options.ci === "force");
  const mcp = installMcpConfig(projectRoot);
  return { toolFiles, skills, rulesCreated, ci, mcp };
}
