---
name: project-memory
description: Shared long-term memory for this project, used by every agent and session. Read it before starting any task. Save to it whenever you learn something the next agent should not have to rediscover — especially anything the human explains about the project, a decision and its reason, a trap, or how a tricky bug was fixed.
---

# Project memory

This project keeps a shared memory in `.agent-studio/memory/`, one Markdown file per entry,
committed with the code. Claude Code, Codex and Copilot all read the same memory, so the
human never has to explain the same thing twice. The index of active entries is part of
`CLAUDE.md`, `AGENTS.md` and `.github/copilot-instructions.md`.

The CLI is `node .agent-studio/tool/cli.js memory`.

## Before you start a task

1. Look at the **Project memory** index in your instructions.
2. Search for the apps, models or topics the task touches:
   ```sh
   node .agent-studio/tool/cli.js memory search rfq loops
   node .agent-studio/tool/cli.js memory show <id>
   ```
3. Follow what you find. If an entry looks wrong or outdated, tell the human; do not silently ignore it.

## When to save

Save a memory when any of these happen:

| Type | Save when… | Example title |
| --- | --- | --- |
| `knowledge` | the human explains how the business or the project works | RFQ loops are versioned; a new loop copies the previous one |
| `decision` | a choice was made, and why | Exports run in Celery, not in the request (timeouts) |
| `gotcha` | something surprising that will bite the next person | `accounts.User.email` is not unique in legacy data |
| `convention` | a pattern the code follows that is not in the rules | Every service function takes `actor` as its first argument |
| `lesson` | a tricky bug was found and fixed | Duplicate notifications came from signals registered twice |

```sh
node .agent-studio/tool/cli.js memory add --type knowledge \
  --title "RFQ loops are versioned" \
  --tags rfq,loops --related apps/rfq --author claude \
  --body "Each loop belongs to an RFQ. Starting a new loop copies the previous one's files. Never edit a closed loop; create a new one."
```

For a longer body, use `--body-file notes.md` or `--body-file -` (stdin).

## Rules for good memories

- **One fact per entry.** A clear title someone can scan, and a body of a few sentences: what, why, and where in the code (`apps/rfq/services/loop_management.py`).
- **Search before adding**, so you don't create a duplicate. If an entry is no longer true, retire it with `memory outdated <id>` and add the corrected one.
- **Never store secrets**, credentials, personal data or customer data.
- **Rules stay in rules.** `.agent-studio/rules.md` belongs to the human. Memory is for what was learned, not for new rules.
- Saving a memory refreshes the agent instruction files. Commit the new memory file together with your change.
- Mention in your final summary which memories you added.
