// Where Django Agent Studio keeps its files inside a project. Everything lives
// in one folder so it is easy to commit, review and protect.

export const STUDIO_DIR = ".agent-studio";
/** The CLI copied into the project for agents and CI. */
export const TOOL_DIR = `${STUDIO_DIR}/tool`;
/** How agents, CI and docs invoke the CLI. */
export const CLI = `node ${TOOL_DIR}/cli.js`;
/** App Scaffolder settings (reference app, excludes, required files). */
export const SCAFFOLD_CONFIG = `${STUDIO_DIR}/scaffold.json`;
/** Agent Context settings (targets, project map options). */
export const CONTEXT_CONFIG = `${STUDIO_DIR}/context.json`;
/** Single source of the agent rules. */
export const RULES_FILE = `${STUDIO_DIR}/rules.md`;
/** Shared project memory: one Markdown file per entry. */
export const MEMORY_DIR = `${STUDIO_DIR}/memory`;
/** Project skill roots read by Claude Code, Codex and GitHub Copilot. */
export const SKILL_ROOTS = [".claude/skills", ".agents/skills", ".github/skills"];
/** Skills shipped with the studio (folders under agent-kit/skills/). */
export const STUDIO_SKILLS = ["django-new-app", "django-migrations-guard", "agent-change-report", "project-memory"];
