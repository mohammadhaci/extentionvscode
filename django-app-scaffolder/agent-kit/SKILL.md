---
name: django-new-app
description: Create a new Django app (section, module, قسم) in this project by cloning the team-approved reference app, then build the requested feature inside it and verify it. Use whenever a task asks for a new Django app/section, or to check that existing apps still follow the company template.
---

# Creating a new Django app in this project

Every app in this project must follow the company template, and the approved
**reference app** in `.django-scaffold.json` is that template. Always clone it
with the bundled CLI. Never use `django-admin startapp`, and never hand-build an app skeleton.

The CLI is `node .django-scaffold/tool/cli.js`. It needs only Node, and it never runs project code.

## Workflow

1. **Pick the names.**
   - App folder name: lowercase snake_case plural, e.g. `invoices` or `purchase_orders`.
   - Singular entity: e.g. `Invoice` or `PurchaseOrder`.
   - If the task does not make them clear, ask the human before creating anything.
2. **Preview.** Run:
   ```sh
   node .django-scaffold/tool/cli.js new <app_name> --entity <Singular> --dry-run
   ```
   Read the renames, files and "Needs attention" sections.
   - If no reference app is configured, stop and ask the human which approved app to use.
   - Do not pick a reference app yourself.
3. **Create.** Run the same command without `--dry-run`. It writes the new app next to the
   reference app and registers it in the settings app list and the URLconf.
4. **Review the generated diff** (`git status`, `git diff`).
   - Do every item listed under "Needs attention" by hand.
   - The renamer only changes the app name and the singular entity name. Rename any other
     reference-specific names that are still left, such as other models or fields copied from the
     reference that the new feature does not need.
5. **Implement the requested feature inside the new app.** Follow the conventions the
   reference app uses: the same file layout, layering (for example services/selectors),
   naming, serializers, permissions, tests and translations.
   - Do not add new top-level files or patterns that the reference app does not have,
     unless the task asks for them.
   - Never modify the reference app, or other apps, to make the new one work, unless the task says so.
6. **Migrations and checks:**
   ```sh
   python manage.py makemigrations <app_name>
   python manage.py check
   python manage.py test <app_name>        # or the project's test runner
   node .django-scaffold/tool/cli.js check
   ```
   - `check` exits with 1 and names the app when files from the template are missing or the app is not registered.
   - Fix every issue it names for the new app before you finish.
7. **Refresh the agent instructions** if the project uses Agent Context Sync
   (`.agent-context/tool/cli.js` exists):
   ```sh
   node .agent-context/tool/cli.js sync
   ```
   This adds the new app to the project map in `CLAUDE.md`, `AGENTS.md` and
   `.github/copilot-instructions.md`. Commit those files with the app.

## Other commands

- `node .django-scaffold/tool/cli.js apps`: lists the apps and the reference app.
- `node .django-scaffold/tool/cli.js check --json`: the structure report in machine-readable form.
- Add `--json` to `new` for a machine-readable summary of what was created.

## Do not

- Do not edit `.django-scaffold.json`, `.django-scaffold/tool/`, or this skill unless the human asks.
- Do not copy migrations from the reference app. The CLI already skips them; generate new ones with `makemigrations`.
- Do not report the task as done while `python manage.py check` or the CLI `check` fails for the new app.
