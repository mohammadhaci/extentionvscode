---
name: django-migrations-guard
description: Safety check for Django migrations. Use whenever a task adds or changes models, creates or edits migrations, or before finishing any change that touches a migrations/ folder.
---

# Django migrations: safety check

Production databases depend on migrations being append-only and safe to run
while the old code is still serving traffic. This project checks that with
`node .agent-studio/tool/cli.js guard`. The tool is static and never runs project code.

## Workflow

1. Change the models, then generate migrations. Never write them by hand when `makemigrations` can:
   ```sh
   python manage.py makemigrations <app>
   ```
2. Run the guard on what you changed:
   ```sh
   node .agent-studio/tool/cli.js guard check
   ```
   Before opening a PR, check everything the branch adds:
   ```sh
   node .agent-studio/tool/cli.js guard check --base origin/main
   ```
3. Fix every **error** before you finish. Each finding says what to do. The common ones:
   - `edited-migration` / `deleted-migration`: revert the change to the existing migration,
     and create a new migration instead.
   - `conflicting-leaves`: run `python manage.py makemigrations --merge`.
   - `add-field-not-null`: add `null=True` or a default, or split the change into steps.
   - `direct-model-import`: inside `RunPython`, use `apps.get_model("app", "Model")`.
   - `remove-field` / `delete-model`: data loss. Do not remove anything the task did not
     explicitly ask to remove. If it did ask, **stop and ask the human to confirm**. Only after
     they confirm, add this comment at the top of that migration, with their reason:
     `# migrations-guard: allow remove-field: <reason, who approved>`
4. Treat **warnings** (renames, irreversible `RunPython`/`RunSQL`, nullable → NOT NULL) as
   things to fix, or to explain in your final summary.
5. Also run `python manage.py makemigrations --check --dry-run`. It must report no
   changes, which proves the migrations match the models.

## Do not

- Do not add `allow` comments to silence findings on your own.
- Do not edit, renumber or delete migrations that are already committed.
- Do not edit `.agent-studio/` or this skill unless the human asks.
