# Migrations Guard

Fifth, independent VS Code extension in this repository (own `package.json`,
tests and VSIX in this `migrations-guard/` folder).

Static safety checks for Django migrations. It's built for projects where coding agents
write the migrations and nobody reviews every line. It shows findings in the VS Code Problems
panel, and ships a CLI plus a skill for Claude Code, Codex and Copilot, and for CI.
It reads migrations as text and never runs project code.

## Rules

| Severity | Rule | Catches |
| --- | --- | --- |
| error | `remove-field`, `delete-model` | Dropping columns or tables: data loss, and old code breaks mid-deploy |
| error | `add-field-not-null` | NOT NULL `AddField` without a default (fails on tables that have rows) |
| error | `edited-migration`, `deleted-migration` | Changing or removing a migration that is already committed (git) |
| error | `conflicting-leaves` | Two latest migrations in one app (parallel branches); squashes are understood |
| error | `missing-dependency` | A dependency on a migration of the same app that does not exist |
| error | `direct-model-import` | `from app.models import …` inside a migration instead of `apps.get_model` |
| warning | `rename-field`, `rename-model` | Renames that break servers during rolling deploys |
| warning | `alter-field-not-null` | Nullable → NOT NULL with no default (existing NULLs fail); tracks field state across migrations |
| warning | `run-python-irreversible`, `run-sql-irreversible` | No reverse operation, so no rollback |
| info | `blocking-index` | Index/constraint changes that lock large PostgreSQL tables |

`node .migrations-guard/tool/cli.js rules` prints every rule with its fix.

## Scope

Old, already-applied migrations are not judged again:

- **default**: new or changed migrations in the working tree (vs `HEAD`), including untracked files
- **`--base origin/main`**: everything the branch adds; use this in CI and before PRs
- **`--all`**: every migration

Graph rules (`conflicting-leaves`, `missing-dependency`) always look at every migration.

**Exceptions** must be explicit and explained. Add this inside the migration:

```python
# migrations-guard: allow remove-field: column unused since v1.4, approved by Mohammad
```

An `allow` comment without a reason does not silence anything. Allowed findings are still listed in the report.

## Setup

1. Install the VSIX. Findings appear in the Problems panel for new or changed migrations as you save.
   To change the comparison, set `migrationsGuard.base` (default `HEAD`).
2. Run **Migrations Guard: Install CLI + Skill into Project**. It writes:
   - `.migrations-guard/tool/`: the CLI, Node only
   - the `django-migrations-guard` skill into `.claude/skills`, `.agents/skills` and `.github/skills`
3. Commit them, and add this to CI:
   ```sh
   node .migrations-guard/tool/cli.js check --base origin/main
   ```

The `django-new-app` skill from Django App Scaffolder runs the guard too, when it is installed.

## CLI

```sh
node .migrations-guard/tool/cli.js check                      # uncommitted work
node .migrations-guard/tool/cli.js check --base origin/main   # the whole branch
node .migrations-guard/tool/cli.js check --all --strict       # everything, warnings fail too
node .migrations-guard/tool/cli.js check --json               # machine-readable
```

Exit codes: 0 clean, 1 failing findings or an error, 2 usage error.

## Limits

- Heuristic parsing of `migrations.<Operation>(...)` calls inside `operations = [...]`.
  Operations built dynamically, or imported under other names, are not seen.
- `SeparateDatabaseAndState` inner operations are checked as if they ran on the database.
- It does not detect *missing* migrations. That needs Django itself:
  `python manage.py makemigrations --check --dry-run` (the skill runs it).

## Develop

```sh
cd migrations-guard
npm install
npm test          # compile + node --test (uses git in temp repos)
npm run lint
npm run package   # -> migrations-guard-0.1.0.vsix
```

---

## بالعربي باختصار

بيحميك من migrations خطيرة يكتبها وكيل:
- حذف عمود أو جدول
- حقل NOT NULL بدون قيمة افتراضية
- تعديل أو حذف migration قديمة
- تعارض migrations بين فرعين
- استيراد الـ models مباشرة جوّا migration

بيفحص بس الشغل الجديد، مش الـ migrations القديمة المطبّقة. أي حذف مقصود لازم يكون عليه تعليق فيه سبب وموافقة بشرية.
