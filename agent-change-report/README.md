# Agent Change Report

Sixth, independent VS Code extension in this repository (own `package.json`,
tests and VSIX in this `agent-change-report/` folder).

When coding agents write the code, a person's job becomes **reviewing** their branches.
This extension turns a branch into one page, written in Django terms rather than as a
list of files, with a single verdict at the top.

## What the report shows

- 🚦 **Verdict**: 🔴 needs changes, 🟡 review the flagged items, or 🟢 no problems.
- **Needs attention:**
  - Migrations Guard errors and warnings.
  - **Agent tooling, skills, CI or guardrail config changed.** An agent editing its own checks is always red.
  - Secrets or `.env` files, and deleted committed migrations (red).
  - Settings, dependencies, auth/permission/middleware code, and deployment files (yellow).
  - Deleted tests, and apps whose code changed while none of their tests did (yellow).
- **What changed in the project:**
  - apps added or removed
  - models and their fields: added, removed, or type/target changed
  - root URL includes and each app's URL patterns
  - new or removed dependencies between apps (relations + imports)
  - new migrations
- **Guardrails**: Migrations Guard, app structure (Django App Scaffolder) and agent
  instructions (Agent Context Sync). Each runs only when installed.
- The changed files with +/− counts, and the commits, collapsed at the bottom.

The base is the merge base with `origin/main`, `origin/master`, `main` or `master`. Without
`--base`, it uses whichever is **closest** to `HEAD`, so a stale `origin/main` does not pull
other people's work into the report. Uncommitted and untracked files are included.
The old structure is read straight from git, and project code is never executed.

## Use

- **VS Code:**
  - **Agent Change Report: Show Report for Current Branch** opens the report in the
    Markdown preview, with clickable file links.
  - **Copy Report (for PR Description)** copies the report to the clipboard.
  - The setting `agentChangeReport.base` overrides the base.
- **Agents:** **Install CLI + Skill into Project** writes:
  - `.agent-change-report/tool/`
  - the `agent-change-report` skill into `.claude/skills`, `.agents/skills` and `.github/skills`
  The skill makes agents fix 🔴 items, explain 🟡 items, and put the report in their PR description.
- **CI:** Agent Context Sync's guardrails workflow (re-install it to pick up the new step)
  posts the report at the top of each PR's job summary when this tool is installed.

```sh
node .agent-change-report/tool/cli.js report                    # Markdown to stdout
node .agent-change-report/tool/cli.js report --base origin/develop
node .agent-change-report/tool/cli.js report --json --out report.json
node .agent-change-report/tool/cli.js report --fail-on red      # exit 1 on a red verdict
```

## Limits

- Structure comes from the same static parsers as Django Visual Map:
  - models are classes whose bases mention `Model`, and their `models.X(...)` fields
  - URLs are `path`/`re_path`/`url` calls, and only the root URLconf's direct includes
- Risk rules match file paths. They point at what to review; they don't judge the code itself.
- "Code changed without test changes" is per app. It can't tell whether existing tests already cover the change.

## Develop

```sh
cd agent-change-report
npm install
npm test          # vendors the root parsers, compiles, runs node --test (uses git in temp repos)
npm run lint
npm run package   # -> agent-change-report-0.1.0.vsix
```

---

## بالعربي باختصار

بدل ما تقرأ مية ملف من شغل الوكيل، بتقرأ صفحة وحدة:
- حكم واحد: 🔴 أو 🟡 أو 🟢.
- شو لازم تنتبه عليه، وأخطرها إن الوكيل يعدّل على أدوات الحماية تبعه.
- شو تغيّر بالمشروع: الأقسام، والـ models والحقول، والروابط، والاعتماديات، والـ migrations.
- نتائج كل الفحوصات.

بيطلع بـ VS Code، وبوصف الـ PR من الوكيل نفسه، وعلى كل PR بالـ CI.
