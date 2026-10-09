# Django App Scaffolder

Part of **Django Agent Studio** ([overview](../README.md)). In VS Code it lives in the
**Agent Studio** view; agents and CI run it as `node .agent-studio/tool/cli.js`.

Your team approves one app built on the company template. Mark it as the
**reference app**, and every new app is created by cloning it, so the template
and its conventions carry over without being re-described anywhere.

Built for projects where **coding agents do the work**: the same engine ships as a
dependency-free Node CLI plus a `django-new-app` skill, so Claude Code, Codex and
GitHub Copilot create apps the same deterministic way you would from VS Code.

## Setup

Run **Agent Studio: Set Up Project** once (or press *Set up* on the Home view). It writes
`.agent-studio/` (the CLI, rules and settings), the studio skills for Claude Code, Codex and
Copilot, and the CI guardrails workflow. Commit them so cloud agents and CI get them too.

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

## `.agent-studio/scaffold.json` (optional, workspace root)

```json
{
  "referenceApp": "apps/orders",
  "referenceEntity": "Order",
  "exclude": ["fixtures/**", "tests/snapshots/**"],
  "requiredFiles": ["apps.py", "models.py", "services.py", "selectors.py", "tests/__init__.py"],
  "registerInSettings": true,
  "registerInUrls": true,
  "apps": ["apps/invoices"],
  "checkAllApps": false
}
```

All keys are optional; VS Code validates the file with the bundled JSON schema.
`referenceEntity` is guessed from the app name (`orders` → `order`) when omitted.

## The structure check

**Check Apps Against Reference** (and `scaffold check`, the CI step, and the Home card)
works like this:

- It covers the apps **created from the reference**. `new` adds each one to `apps`
  automatically. Apps that existed before the studio are listed as not checked, unless
  you set `"checkAllApps": true`.
- An app must have the reference's **skeleton**, not its features:
  - the standard Django modules the reference has (`models.py`, `views.py`, `urls.py`,
    `forms.py`, `serializers.py`, `services.py`, `admin.py`, …)
  - the `__init__.py` of each top-level package (`services/`, `tests/`, `migrations/`, …)
  Feature files such as `services/change_reviews.py` are not required.
- `requiredFiles` replaces the skeleton with your own list.

## Limits

- Static text processing only: project code is never executed.
- Apps are discovered by `apps.py`; the reference app needs one.
- Only one-entry-per-line app lists are edited; other layouts are reported for manual edits.
- Reference apps are limited to 2,000 files, 2 MB per file and 30 MB total; symlinks are skipped.
- When a one-word reference becomes a multi-word app (`order` → `purchase_order`), prose in
  comments and strings gets the snake form too ("a customer purchase_order"); fix wording in review.
- Names that are not plain singular/plural forms of the app name (e.g. `LineItem`
  inside `orders`) are not renamed — check the preview.

---

## بالعربي باختصار

**مع الوكلاء (الاستخدام الأساسي):** حدّد القسم المرجعي، شغّل **Agent Studio: Set Up Project** مرة وحدة، وارفع الملفات على git.
بعدها اطلب من Claude أو Codex أو Copilot "اعمل قسم جديد للفواتير"، والمهارة بتخلّيه يستعمل الأداة ويلتزم بالقالب ويتحقق من النتيجة.

**يدوياً من VS Code:**

1. كليك يمين على القسم الأول المعتمد ← **Set as Reference App**.
2. لكل قسم جديد: **New App from Reference**، ثم اكتب اسم القسم (مثلاً `invoices`) والاسم المفرد (`invoice`).
3. راجع المعاينة واضغط **Create**. بيتنسخ القالب كامل مع إعادة التسمية، وبيتسجّل القسم بـ `INSTALLED_APPS` و`urls.py`.
4. **Check Apps Against Reference** بيعطيك تقرير بالأقسام اللي ناقصها ملفات أو مش مسجّلة.
