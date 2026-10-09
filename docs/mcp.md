# MCP Server

Part of **Django Agent Studio** ([overview](../README.md)).

The studio ships a [Model Context Protocol](https://modelcontextprotocol.io) server inside
the project CLI, so agents use its tools **directly** instead of guessing: they read the
project map, search and write the shared memory, run the checks and fetch ready-made tasks.
No dependencies (Node only), static analysis only, and it runs on your machine over stdio.

## Setup

**Set Up Project** registers it automatically, keeping any other servers you have:

| Agent | Config file | Entry |
| --- | --- | --- |
| Claude Code | `.mcp.json` | `node .agent-studio/tool/cli.js mcp` |
| VS Code / Copilot (agent mode) | `.vscode/mcp.json` | `node ${workspaceFolder}/.agent-studio/tool/cli.js mcp` |
| Codex CLI | its own config | run once: `codex mcp add agent-studio -- node "<project>/.agent-studio/tool/cli.js" mcp` |

Commit `.mcp.json` and `.vscode/mcp.json` so the whole team gets it. Claude Code asks once
before it trusts a project's servers. From a terminal: `node .agent-studio/tool/cli.js mcp install`
(or `mcp check`, which exits 1 when the registration is missing). A config file with
comments is left alone; add the entry by hand.

## Tools

| Tool | What the agent gets |
| --- | --- |
| `project_overview` | Apps with models, URL prefixes and dependencies; the reference app; the rules; memory size |
| `app_details` | One app: models with fields and relations (file:line), URL patterns, files, depends on / used by, its memory |
| `app_relations` | Which apps use which (relations and imports), as a list and a Mermaid diagram |
| `memory_search` / `memory_get` | Search and read the shared project memory |
| `memory_add` / `memory_mark_outdated` | Save a fact for every future agent, or retire one (agent instructions refresh automatically) |
| `run_checks` | Migrations, app structure and agent instructions in one call |
| `migrations_check` | Migration safety checks |
| `change_report` | The one-page branch review with its verdict |
| `sync_instructions` | Refresh CLAUDE.md, AGENTS.md and Copilot instructions |
| `list_tasks` / `get_task` | The ready-made tasks (built-in and custom), with project context |

Read-only tools are marked as such, so clients can run them without asking.

## Prompts

Every agent task is also an MCP **prompt** (with an `app` or `input` argument when it needs
one). In Claude Code type `/` and pick, for example, `/mcp__agent-studio__security-audit`;
in Copilot Chat they appear as `/mcp.agent-studio.security-audit`.

## Protocol

JSON-RPC 2.0 over stdio, one message per line; protocol versions 2025-06-18, 2025-03-26
and 2024-11-05. Tool failures (an unknown app, a missing argument) come back as results with
`isError: true` so the agent can correct itself.
