# Project Memory

Part of **Django Agent Studio** ([overview](../README.md)).

Every new agent session starts from zero. Project memory is how the project remembers:
decisions, traps, conventions and business knowledge, written once and read by **every**
agent (Claude Code, Codex, Copilot) in **every** session. You stop re-explaining the project.

## How it works

- Each fact is one Markdown file in `.agent-studio/memory/`, committed with the code, so it
  is shared with the team, reviewed in pull requests and versioned like everything else.
- An index of active entries is written into `CLAUDE.md`, `AGENTS.md` and
  `.github/copilot-instructions.md` (the *Project memory* section of the managed block), so
  every agent sees it without being asked.
- The `project-memory` skill tells agents **when** to search memory (before a task) and
  **when** to save to it (after learning something the next agent would need).

| Type | Use it for | Example |
| --- | --- | --- |
| 📚 knowledge | How the business or project works | *An RFQ has loops; a new loop copies the previous one* |
| 🧭 decision | A choice that was made, and why | *Exports run in Celery: requests time out after 30 s* |
| ⚠️ gotcha | A trap that will bite the next person | *User email is not unique in legacy data* |
| 📏 convention | A pattern the code follows | *Every list view uses the shared `PaginatedTable`* |
| 🩹 lesson | A tricky bug and how it was fixed | *Signals fired twice because apps.py imported them twice* |

Rules stay in `rules.md`; memory is for facts. Never store secrets.

## An entry

```markdown
---
type: gotcha
title: "User email is not unique"
tags: [accounts, legacy]
related: [apps/accounts]
author: codex
date: 2026-10-09
status: active
---
Legacy imports created duplicate emails. Look users up by id, never by email.
```

## CLI (for agents)

```sh
node .agent-studio/tool/cli.js memory search loops export        # all words must match
node .agent-studio/tool/cli.js memory list [--type gotcha] [--tag rfq] [--all] [--json]
node .agent-studio/tool/cli.js memory show <id>
node .agent-studio/tool/cli.js memory add --type decision --title "…" --body "…" \
  --tags exports,celery --related apps/exports --author claude   # or --body-file <file|->
node .agent-studio/tool/cli.js memory outdated <id>              # retire a fact that is no longer true
```

`add` and `outdated` refresh every agent's instructions right away.

## In VS Code

- **Home → 🐘 Project memory**: *Remember* (type → title → details) and *Browse* (searchable).
- Commands: **Agent Studio: Add to Project Memory**, **Agent Studio: Browse Project Memory**.
- The 🐘 badge appears at five active memories.

## In the change report

New or edited memory entries are listed under **Project memory**. They are not flagged as
tooling changes: agents are supposed to write them.
