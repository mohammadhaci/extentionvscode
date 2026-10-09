---
name: agent-change-report
description: Summarise a branch's changes for the human reviewer before handing work back or opening/updating a pull request. Use at the end of any task that changed code in this repository.
---

# Change report for the reviewer

The human who owns this project reviews agent work through a structured report, not
by reading every line. Generate it at the end of every task:

```sh
node .agent-studio/tool/cli.js report
```

The report is Markdown. It contains:
- the verdict
- the items that need attention
- what changed in Django terms: apps, models and fields, URLs, app dependencies, migrations
- the guardrail checks
- the file list

It compares against `origin/main` (or `main`/`master`). Use `--base <ref>` for another base.

## What to do with it

1. **Fix every 🔴 item before you finish.** The usual causes are:
   - a Migrations Guard error
   - changes to the agent tooling, skills or CI
   - secret or env files
   - deleted migrations
   If a 🔴 item is something the human explicitly asked for, say so clearly in your summary.
2. **For each 🟡 item, fix it or explain it.** For example:
   - add the missing tests
   - justify a new dependency
   - run `node .agent-studio/tool/cli.js context sync` for stale instructions
3. Check that "What changed in the project" matches the task. If something appears that the
   task did not ask for (a removed field, an unexpected new dependency between apps), undo it
   or explain it.
4. Put the final report in the pull request description, or in your final message when there
   is no PR. Above it, add a short paragraph in your own words describing the change.

## Do not

- Do not edit the report by hand to hide items. Fix the cause and regenerate the report.
- Do not edit `.agent-studio/` or this skill unless the human asks.
