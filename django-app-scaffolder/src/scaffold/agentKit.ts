/** Where the CLI is installed inside the user's project (committed with the repo). */
export const AGENT_TOOL_DIR = ".django-scaffold/tool";

/** Skill folder name installed for the agents. */
export const SKILL_NAME = "django-new-app";

/** Project skill roots read by Claude Code, Codex and GitHub Copilot respectively. */
export const DEFAULT_SKILL_ROOTS = [".claude/skills", ".agents/skills", ".github/skills"];
