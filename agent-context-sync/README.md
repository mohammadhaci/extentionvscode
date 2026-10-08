# Agent Context Sync

Fourth, independent VS Code extension in this repository (own `package.json`,
tests and VSIX in this `agent-context-sync/` folder).

Claude Code reads `CLAUDE.md`, Codex reads `AGENTS.md`, and GitHub Copilot reads
`.github/copilot-instructions.md`. This extension keeps all three in sync from
**one rules file** plus an **auto-generated Django project map**, so every agent
works from the same rules and always knows which apps exist.

## How it works

- You (or an agent) edit only `.agent-context/rules.md`.
- `sync` renders one block and writes it into every target, between
  `<!-- agent-context:start -->` and `<!-- agent-context:end -->`.
  Text outside the markers is never touched. A file without markers gets the
  block after its `# Title` (or at the top), and missing files are created.
- The block contains:
  - the rules: HTML comments are dropped and headings are nested under "Project rules"
  - the project map:
    - settings modules and the root URLconf
    - every app with its models, its URL prefix, and the other apps it depends on (through relations or imports)
    - the reference app from Django App Scaffolder's `.django-scaffold.json`, when present
- The output is deterministic, so `check` can detect drift and fail CI or an agent's run.

The Django parsing reuses the pure parsers of the **Django Visual Map** extension
at the repo root (copied into `src/vendor/` by `npm run vendor` on every build). It
never executes project code.

## Setup (once per project)

1. Run **Agent Context: Install CLI into Project**. It does three things:
   - copies the CLI to `.agent-context/tool/`
   - creates `.agent-context/rules.md` from a starter template
   - runs the first sync
2. Replace the TODOs in `rules.md` with the company rules.
3. Commit `.agent-context/`, `CLAUDE.md`, `AGENTS.md` and `.github/copilot-instructions.md`.

While VS Code is open, saving `rules.md` or any `.py` file re-syncs a few seconds later.
To turn that off, set `agentContextSync.autoSync` to false. It only runs in projects
that have the rules file.

## CLI (for agents, CI and scripts)

```sh
node .agent-context/tool/cli.js sync     # update every target
node .agent-context/tool/cli.js check    # exit 1 if any target is out of date
node .agent-context/tool/cli.js print    # show the generated block
node .agent-context/tool/cli.js init     # create rules.md from the template
```

The generated block itself tells agents to run `sync` after adding or removing apps, models or URL
includes. The `django-new-app` skill from Django App Scaffolder runs it after creating an app.
To enforce it, add `check` to CI.

## `.agent-context/config.json` (optional)

```json
{
  "targets": ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"],
  "projectMap": true,
  "maxModelsPerApp": 8
}
```

## Limits

- The project map comes from static heuristics, the same as Django Visual Map:
  - apps are found by their marker files
  - URL prefixes come from the root URLconf's direct `include("…")` entries only
  - dependencies come from model relations and absolute imports
- Local folders only. The engine reads the disk with Node's `fs`; remote workspaces work
  because the extension runs on the remote host.
- Files with unbalanced markers are reported and left untouched.

## Develop

```sh
cd agent-context-sync
npm install
npm test          # vendors the parsers, compiles, runs node --test
npm run lint
npm run package   # -> agent-context-sync-0.1.0.vsix
```

Press F5 with **Run Agent Context Sync** (`.vscode/launch.json` in this folder).

---

## بالعربي باختصار

- بتكتب قواعد الشركة مرة وحدة بـ `.agent-context/rules.md`.
- الإضافة بتحطها بـ `CLAUDE.md` و`AGENTS.md` و`.github/copilot-instructions.md` مع خريطة محدّثة للمشروع: الأقسام، والـ models، والروابط، ومين بيعتمد على مين.
- كل وكيل بيشوف نفس القواعد ونفس صورة المشروع.
- أي قسم جديد بيظهر عندهم فوراً بعد `sync`. مهارة `django-new-app` بتشغّل `sync` لحالها، و`check` بيكشف إذا الملفات صارت قديمة.
