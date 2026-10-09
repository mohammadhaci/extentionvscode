# Agent Tasks

Part of **Django Agent Studio** ([overview](../README.md)).

Stop hunting for the right prompt. One click gives an agent a ready-made, expert task,
already filled in with your project's context:

- the apps, and the reference app every app follows;
- for an app: its models, URL prefix, the apps it depends on and the apps that use it;
- what the project memory already knows about that app;
- the project rules, and how to finish (run `doctor`, save new facts to memory, summarize).

## Built-in tasks

| Task | Scope | What the agent does |
| --- | --- | --- |
| 🔒 Security audit | project or app | Settings, access control and company scoping (IDOR), injection, XSS, CSRF, mass assignment, uploads, redirects, secrets, dependencies; a findings table, then fixes Critical/High with tests |
| 🧪 Write tests | app | Permissions per view, business rules, validation, routing, side effects, in the project's test style |
| 🐞 Hunt for bugs | project or app | Logic, Decimal vs float, timezones, transactions and races, status transitions, error handling |
| ⚡ Performance | project or app | N+1 queries, missing indexes, heavy requests, caching; fixes the high-impact ones with `assertNumQueries` |
| 👀 Review my branch | project | A strict senior review using the change report and the migrations guard; Blocking / Should fix / Nit |
| 🎓 Learn an app | app | Studies the app and saves 3–10 facts to project memory, so no agent has to rediscover them |
| 🧹 Clean up code | app | Duplication, fat views, dead code, drift from the reference app, without changing behaviour |
| 🧬 New section | project (asks for a description) | Builds a new app from the approved template, end to end |

## Running a task

- **Home → 🎯 Agent tasks**: click a task.
- **Command palette**: *Agent Studio: Give an Agent a Task…*
- **Explorer**: right-click an app folder → *Give an Agent a Task…* (the app is already chosen).

Then choose where it goes:

| Target | What happens |
| --- | --- |
| Claude Code | A terminal runs `claude "Read .agent-studio/runs/<file>.md and carry out the task it describes."` |
| Codex | The same with `codex` |
| Copilot Chat | Opens Copilot Chat in agent mode with the full prompt |
| Clipboard | Paste it into any agent |
| File | Opens the prompt so you can read or edit it first |

Prompts are saved in `.agent-studio/runs/` (git-ignored, newest 20 kept). Settings:
`agentStudio.taskTarget` (skip the question), `agentStudio.claudeCommand`,
`agentStudio.codexCommand`.

## Your own tasks

*Agent Studio: New Custom Agent Task* (or **＋ Custom task** on Home) creates
`.agent-studio/tasks/<id>.md`, blank or copied from a built-in task. Commit it, and the whole
team gets the button. A file with a built-in task's id replaces that task.

```markdown
---
title: "Check translations"
titleAr: "افحص الترجمة"
icon: 🌐
description: "Find strings that are not translated"
scope: app            # project | app | any
# input: "What should the agent focus on?"   (asks for text, used as {{input}})
---
Find every user-facing string in {{target}} that is not wrapped in gettext ...
```

Placeholders: `{{target}}` (*the whole project* or *the `apps/x` app*), `{{app}}`, `{{input}}`,
`{{cli}}`. The project context is added automatically.

## CLI (for agents and scripts)

```sh
node .agent-studio/tool/cli.js tasks list [--json]
node .agent-studio/tool/cli.js tasks show security-audit --app apps/rfq
node .agent-studio/tool/cli.js tasks show new-section --input "invoices: bill each accepted quote"
node .agent-studio/tool/cli.js tasks new check-translations [--from security-audit]
```
