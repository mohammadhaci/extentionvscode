import { CONTEXT_CONFIG, RULES_FILE, SCAFFOLD_CONFIG, TOOL_DIR } from "../studio/paths";

export { RULES_FILE, SCAFFOLD_CONFIG, TOOL_DIR };
export const CONFIG_FILE = CONTEXT_CONFIG;

/** Instruction files read by Claude Code, Codex and GitHub Copilot. */
export const DEFAULT_TARGETS = ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"];

export interface ContextConfig {
  targets: string[];
  projectMap: boolean;
  maxModelsPerApp: number;
}

export const DEFAULT_CONFIG: ContextConfig = { targets: DEFAULT_TARGETS, projectMap: true, maxModelsPerApp: 8 };

export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.includes("\\")) {
    return false;
  }
  return p.split("/").every((seg) => seg !== ".." && seg !== "" && seg !== ".");
}

export function parseContextConfig(text: string): { config: ContextConfig; errors: string[] } {
  const errors: string[] = [];
  const config: ContextConfig = { ...DEFAULT_CONFIG };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { config, errors: [`${CONFIG_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config, errors: [`${CONFIG_FILE} must contain a JSON object.`] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.targets !== undefined) {
    const t = obj.targets;
    if (!Array.isArray(t) || t.length === 0 || !t.every((x) => typeof x === "string" && isSafeRelativePath(x) && x.toLowerCase().endsWith(".md"))) {
      errors.push(`"targets" must be a non-empty list of workspace-relative .md paths.`);
    } else {
      config.targets = [...new Set(t as string[])];
    }
  }
  if (obj.projectMap !== undefined) {
    if (typeof obj.projectMap === "boolean") {
      config.projectMap = obj.projectMap;
    } else {
      errors.push(`"projectMap" must be true or false.`);
    }
  }
  if (obj.maxModelsPerApp !== undefined) {
    const n = obj.maxModelsPerApp;
    if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100) {
      config.maxModelsPerApp = n;
    } else {
      errors.push(`"maxModelsPerApp" must be an integer from 0 to 100.`);
    }
  }
  return { config, errors };
}

/** Starter rules file; HTML comments are guidance and never reach the agents. */
export const RULES_TEMPLATE = `# Project rules

<!--
Single source of truth for Claude Code (CLAUDE.md), Codex (AGENTS.md) and
GitHub Copilot (.github/copilot-instructions.md). Edit only this file, then
run sync. Comments like this one are not copied. Replace the TODOs below.
-->

## Stack

- Django project. <!-- TODO: Python/Django versions, database, DRF or templates, task queue -->

## Conventions

- Follow the structure of the reference app for every new app.
- <!-- TODO: company rules, e.g. business logic lives in services.py, queries in selectors.py -->

## Commands

- Checks: \`python manage.py check\`
- Tests: \`python manage.py test\`
- New migrations: \`python manage.py makemigrations <app>\`

## Do not

- Do not edit existing migrations; create new ones.
- Do not commit secrets or change production settings without being asked.
`;
