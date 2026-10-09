# Skills Dashboard

Part of **Django Agent Studio** ([overview](../README.md)). In VS Code it lives in the
**Agent Studio** view; agents and CI run it as `node .agent-studio/tool/cli.js`.

## What it does (MVP)

- Scans configured project-local skill roots for immediate child folders with `SKILL.md`.
- Lists / searches skills, shows metadata, path, which tool roots contain each skill, and a plain-text preview.
- Copies one skill into selected roots (multi-target, explicit overwrite, conflict report).
- Removes one skill copy from a selected directory only after modal confirmation,
  and only when the folder contains `SKILL.md` inside a configured root.
- Imports a skill from a GitHub folder URL (`.../tree/BRANCH/path/to/skill`) or a
  `SKILL.md` URL (`blob` / `raw`, incl. `raw.githubusercontent.com`), shows a
  name/files/target preview with conflicts, then installs on explicit action.
  Bounded requests, size/file-count limits, traversal rejection, never executes files.

Default roots: `.claude/skills`, `.agents/skills`, `.github/skills`,
`.cursor/skills`, `.codex/skills`, `.opencode/skills`, `.gemini/skills`.
Override with setting `agentStudio.skillRoots` (workspace-relative; unsafe or
outside-workspace entries are rejected).

## Security notes

- Webview uses strict CSP (`default-src 'none'`, nonce `script-src`,
  `asWebviewUri` + `localResourceRoots`), typed/validated messages, and only
  `textContent` / plain-text preview (no HTML rendering of skill content).
- All project reads/writes/deletes use `vscode.workspace.fs`, confined to the
  workspace folder and configured roots; deletes require `SKILL.md` + modal confirm.
- Symlink confinement: discovery skips symlinked roots, skill folders, and
  `SKILL.md` files; copy/install/delete walk every existing ancestor from the
  workspace root through the target (bitmask check, so `Directory|Symlink`
  combos are caught) and refuse on any link. Symlink targets are never followed
  or deleted. Limitation: if a filesystem provider transparently resolves a
  link without surfacing the `SymbolicLink` bit (no `realpath` API exists),
  the link is undetectable — lexical confinement plus the immediate-child and
  `SKILL.md` requirements still bound the blast radius to one skill folder.
