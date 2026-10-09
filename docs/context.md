# Agent Context Sync

Part of **Django Agent Studio** ([overview](../README.md)). In VS Code it lives in the
**Agent Studio** view; agents and CI run it as `node .agent-studio/tool/cli.js`.

Claude Code reads `CLAUDE.md`, Codex reads `AGENTS.md`, and GitHub Copilot reads
`.github/copilot-instructions.md`. This extension keeps all three in sync from
**one rules file** plus an **auto-generated Django project map**, so every agent
works from the same rules and always knows which apps exist.

## How it works

- You (or an agent) edit only `.agent-studio/rules.md`.
- `sync` renders one block and writes it into every target, between
  `<!-- agent-context:start -->` and `<!-- agent-context:end -->`.
  Text outside the markers is never touched. A file without markers gets the
  block after its `# Title` (or at the top), and missing files are created.
- The block contains:
  - the rules: HTML comments are dropped and headings are nested under "Project rules"
  - the project map:
    - settings modules and the root URLconf
    - every app with its models, its URL prefix, and the other apps it depends on (through relations or imports)
    - the reference app from Django App Scaffolder's `.agent-studio/scaffold.json`, when present
- The output is deterministic, so `check` can detect drift and fail CI or an agent's run.

The Django parsing reuses the pure parsers of the **Django Visual Map** extension
at the repo root (copied into `src/vendor/` by `npm run vendor` on every build). It
never executes project code.

## Setup

Run **Agent Studio: Set Up Project** once (or press *Set up* on the Home view). It writes
`.agent-studio/` (the CLI, rules and settings), the studio skills for Claude Code, Codex and
Copilot, and the CI guardrails workflow. Commit them so cloud agents and CI get them too.

## CLI (for agents, CI and scripts)

```sh
node .agent-studio/tool/cli.js context sync     # update every target
node .agent-studio/tool/cli.js context check    # exit 1 if any target is out of date
node .agent-studio/tool/cli.js context print    # show the generated block
node .agent-studio/tool/cli.js context init     # create rules.md from the template
```

The generated block itself tells agents to run `sync` after adding or removing apps, models or URL
includes. The `django-new-app` skill from Django App Scaffolder runs it after creating an app.
To enforce it, add `check` to CI.

## CI guardrails workflow

**Agent Studio: Set Up Project** (or `node .agent-studio/tool/cli.js context install-ci`)
writes `.github/workflows/agent-guardrails.yml`. It runs on every pull request, and on pushes to
`main`/`master`. Each check below runs only if its tool is installed in the project:

| Step | Runs | Fails when |
| --- | --- | --- |
| Migrations Guard | `check --base origin/<PR base>` (or `check` on push) | unsafe, edited or conflicting migrations |
| App structure | `django-scaffold check` | an app drifts from the reference app |
| Agent instructions | `agent-context check` | `CLAUDE.md` / `AGENTS.md` / copilot instructions are stale |

- All steps run even when an earlier one fails, so a single run shows every problem.
- Results also go to the job summary on the PR.
- The push trigger catches what no single PR can: two PRs that each add `0002` to the same app.
- An optional, commented-out step runs `makemigrations --check --dry-run`. It needs your
  project's requirements and settings, so it is left for you to adapt.
- A customised copy is never replaced without `--force` (or a confirmation in VS Code).

The template lives in `ci/agent-guardrails.yml`. The build embeds it in the CLI, and it is
checked with actionlint and shellcheck.

## `.agent-studio/context.json` (optional)

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

---

## بالعربي باختصار

- بتكتب قواعد الشركة مرة وحدة بـ `.agent-studio/rules.md`.
- الإضافة بتحطها بـ `CLAUDE.md` و`AGENTS.md` و`.github/copilot-instructions.md` مع خريطة محدّثة للمشروع: الأقسام، والـ models، والروابط، ومين بيعتمد على مين.
- كل وكيل بيشوف نفس القواعد ونفس صورة المشروع.
- أي قسم جديد بيظهر عندهم فوراً بعد `sync`. مهارة `django-new-app` بتشغّل `sync` لحالها، و`check` بيكشف إذا الملفات صارت قديمة.
- **Install CI Guardrails Workflow** بيضيف ملف GitHub Actions بيشغّل كل الفحوصات على كل PR. هيك ولا وكيل بيقدر يدمج شي بيكسر القواعد.
