# Project Map

Part of **Django Agent Studio** ([overview](../README.md)): the **Project Map** view and the
**Agent Studio: Open Project Map** command.

A VS Code extension that analyzes a Django project and shows a clear, visual map of
**apps → URL sections → views → models → relationships** (plus template references).

It uses a **local, dependency-light static analyzer**: Python files are read as text and
parsed heuristically. **Project code is never executed and Django does not need to be
installed.** Anything inferred by heuristics (unresolved view references, name-based
view↔model links) is flagged with a `~ heuristic` badge in the UI.

## Features

- Command **Agent Studio: Open Project Map** (command palette) + an Activity Bar
  view (**Project Map** in the Agent Studio container) with a project summary, *Open Project Map* and *Refresh* actions.
- Discovers Django apps (`models.py` / `views.py` / `urls.py` / `apps.py`), the root
  URLconf (via `ROOT_URLCONF` or convention), URL patterns incl. `include()` and
  multi-line entries, function + class-based views, models with fields and
  `ForeignKey` / `OneToOneField` / `ManyToManyField` relations, and template references.
- Navigable map: search, per-kind toggles, per-app filter, heuristic on/off, click or
  keyboard selection, details panel with source file/line + **Open source** button,
  relationship list, zoom (buttons / wheel / `+` `-`), pan (drag / touch), fit-to-view (`0`),
  `/` focuses search, `Tab`/`Enter`/arrows move between nodes.
- Graceful empty state for non-Django folders and actionable errors (no open folder,
  unreadable files, skipped oversized files).

## Use

1. `File → Open Folder…` on your Django project (the folder with `manage.py`).
2. Run `Agent Studio: Open Project Map` from the command palette, or click the
   **Agent Studio** icon in the Activity Bar → **Open Project Map**.
3. Explore: filter with the kind chips / app dropdown, search, click any node for
   details, **Open source** jumps to the definition.

## How the analysis works (and its limits)

- **App discovery** (`src/analyzer/appDiscovery.ts`): groups `*.py` files by directory;
  a directory is an app candidate if it has Django marker files, backed by
  `INSTALLED_APPS` when available. Project config packages (`settings.py` without
  `models.py`/`views.py`) are excluded. Confidence (`high`/`medium`/`low`) + reason are
  shown in the app details.
- **Parsers** (`parseModels` / `parseViews` / `parseUrls` / `parseSettings`): line-based
  heuristics. Known limits: dynamically built `urlpatterns` (loops, `+ static(...)`),
  string-referenced views (`"myapp.views.x"`), viewsets/routers, abstract/proxy models,
  and multi-line model field calls split across lines may be missed or marked uncertain —
  these surface as warnings in the details panel instead of failing.
- **Graph** (`graphBuilder.ts`): pure function `buildProjectMap()` turning parsed data
  into `{ nodes, edges, warnings, stats }`; covered by unit tests in `src/test/`.
- **Messages** between host and webview are strictly typed
  (`src/shared/messages.ts`); the webview validates incoming payloads by `type`.
- The webview (`media/map.js`, vanilla JS, zero runtime dependencies) renders layered
  SVG columns and uses a strict CSP (`script-src` nonce-only, no inline styles/scripts).
