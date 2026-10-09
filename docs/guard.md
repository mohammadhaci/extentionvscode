# Migrations Guard

Part of **Django Agent Studio** ([overview](../README.md)). In VS Code it lives in the
**Agent Studio** view; agents and CI run it as `node .agent-studio/tool/cli.js`.

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

`node .agent-studio/tool/cli.js guard rules` prints every rule with its fix.

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

Run **Agent Studio: Set Up Project** once (or press *Set up* on the Home view). It writes
`.agent-studio/` (the CLI, rules and settings), the studio skills for Claude Code, Codex and
Copilot, and the CI guardrails workflow. Commit them so cloud agents and CI get them too.

## CLI

```sh
node .agent-studio/tool/cli.js guard check                      # uncommitted work
node .agent-studio/tool/cli.js guard check --base origin/main   # the whole branch
node .agent-studio/tool/cli.js guard check --all --strict       # everything, warnings fail too
node .agent-studio/tool/cli.js guard check --json               # machine-readable
```

Exit codes: 0 clean, 1 failing findings or an error, 2 usage error.

## Limits

- Heuristic parsing of `migrations.<Operation>(...)` calls inside `operations = [...]`.
  Operations built dynamically, or imported under other names, are not seen.
- `SeparateDatabaseAndState` inner operations are checked as if they ran on the database.
- It does not detect *missing* migrations. That needs Django itself:
  `python manage.py makemigrations --check --dry-run` (the skill runs it).

---

## بالعربي باختصار

بيحميك من migrations خطيرة يكتبها وكيل:
- حذف عمود أو جدول
- حقل NOT NULL بدون قيمة افتراضية
- تعديل أو حذف migration قديمة
- تعارض migrations بين فرعين
- استيراد الـ models مباشرة جوّا migration

بيفحص بس الشغل الجديد، مش الـ migrations القديمة المطبّقة. أي حذف مقصود لازم يكون عليه تعليق فيه سبب وموافقة بشرية.
