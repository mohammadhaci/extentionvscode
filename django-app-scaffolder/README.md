# Django App Scaffolder

Third, independent VS Code extension in this repository (own `package.json`,
tests and VSIX in this `django-app-scaffolder/` folder).

Your team approves one app built on the company template. Mark it as the
**reference app**, and every new app is created by cloning it, so the template
and its conventions carry over without being re-described anywhere.

## Commands

| Command | What it does |
| --- | --- |
| **Django Scaffolder: Set as Reference App** | Right-click the approved app folder (or pick from a list). Saves `referenceApp` in `.django-scaffold.json`; commit it so the team shares the same reference. |
| **Django Scaffolder: New App from Reference** | Asks for the new app name (e.g. `invoices`) and the singular entity name (e.g. `invoice`), shows a full preview, then creates the app on confirmation. |
| **Django Scaffolder: Check Apps Against Reference** | Report of every app's missing files compared to the reference (or `requiredFiles`), plus apps missing from `INSTALLED_APPS`. |

## What "New App" does

1. Copies every file of the reference app into a sibling folder, skipping
   `__pycache__`, `*.pyc` and all migrations except `migrations/__init__.py`.
2. Renames the app and entity in **paths and file contents**, in every casing:
   `orders/Orders/ORDERS/orders-…` and `order/Order/ORDER/orderId/order item…`.
   Matches are identifier-bounded, so `border`, `ordering` or `reorder` are never touched.
   Binary files (images, fonts) are copied unchanged.
3. Adds the app next to the reference entry in `INSTALLED_APPS` / `LOCAL_APPS`
   style lists and duplicates the reference `path(..., include("….urls"))`
   entry (multi-line and namespaced includes supported). These edits are left
   **unsaved** so you can review or undo them.
4. Opens a Markdown preview of every rename, file and edit **before** anything is
   written; layouts it cannot edit safely are listed under *Needs attention*.

Then run `python manage.py makemigrations <app>`.

## `.django-scaffold.json` (optional, workspace root)

```json
{
  "referenceApp": "apps/orders",
  "referenceEntity": "Order",
  "exclude": ["fixtures/**", "tests/snapshots/**"],
  "requiredFiles": ["apps.py", "models.py", "services.py", "selectors.py", "tests/__init__.py"],
  "registerInSettings": true,
  "registerInUrls": true
}
```

All keys are optional; VS Code validates the file with the bundled JSON schema.
`referenceEntity` is guessed from the app name (`orders` → `order`) when omitted.

## Limits

- Static text processing only: project code is never executed.
- Apps are discovered by `apps.py`; the reference app needs one.
- Only one-entry-per-line app lists are edited; other layouts are reported for manual edits.
- Reference apps are limited to 2,000 files, 2 MB per file and 30 MB total; symlinks are skipped.
- Names that are not plain singular/plural forms of the app name (e.g. `LineItem`
  inside `orders`) are not renamed — check the preview.

## Develop

```sh
cd django-app-scaffolder
npm install
npm test          # compile + node --test
npm run lint
npm run package   # -> django-app-scaffolder-0.1.0.vsix
```

Press F5 with **Run Django App Scaffolder** (`.vscode/launch.json` in this folder).

---

## بالعربي باختصار

1. كليك يمين على القسم الأول المعتمد ← **Set as Reference App**.
2. لكل قسم جديد: **New App from Reference**، ثم اكتب اسم القسم (مثلاً `invoices`) والاسم المفرد (`invoice`).
3. راجع المعاينة واضغط **Create**. بيتنسخ القالب كامل مع إعادة التسمية، وبيتسجّل القسم بـ `INSTALLED_APPS` و`urls.py`.
4. **Check Apps Against Reference** بيعطيك تقرير بالأقسام اللي ناقصها ملفات أو مش مسجّلة.
