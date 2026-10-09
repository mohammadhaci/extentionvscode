# 🤖 Django Agent Studio

One VS Code extension for building a Django project **with coding agents** (Claude Code,
Codex, GitHub Copilot), safely. You set the rules and review; the agents do the work, and
the studio keeps them on track.

Everything lives behind one **Agent Studio** icon in the Activity Bar:

| View / tool | What it does | Docs |
| --- | --- | --- |
| 🏠 **Home** | Health score, setup quest, every tool at a glance, badges | below |
| 🗺️ **Project Map** | Apps, URLs, views, models and relations as an interactive map | [map](docs/map.md) |
| 🧠 **Skills** | Browse, copy, remove and import agent skills (`SKILL.md`) | [skills](docs/skills.md) |
| 🧬 **New apps** | Clone the approved reference app into new apps, renamed and registered | [scaffold](docs/scaffold.md) |
| 📜 **Agent rules** | One `rules.md` plus a live project map, synced to `CLAUDE.md`, `AGENTS.md` and Copilot | [context](docs/context.md) |
| 🛡️ **Migrations** | Static safety checks: data loss, NOT NULL traps, edited or conflicting migrations | [guard](docs/guard.md) |
| 📋 **Change report** | One-page review of a branch in Django terms, with a red/yellow/green verdict | [report](docs/report.md) |

Static analysis only: project code is never executed.

## Quick start

1. Install `django-agent-studio-0.2.0.vsix` (Extensions → ⋯ → *Install from VSIX…*) and open your Django project.
2. Click the **Agent Studio** icon. **Home** shows a setup quest:
   1. **Install the studio**: one click writes `.agent-studio/` (CLI, rules, settings), the
      studio skills for every agent, and the CI guardrails workflow.
   2. **Pick your reference app**: the approved app every new app is cloned from.
   3. **Write the agent rules** in `.agent-studio/rules.md`.
   4. **Teach your agents** (skills) and **guard every pull request** (CI).
   5. **Go all green.**
3. Commit `.agent-studio/`, the skill folders, `CLAUDE.md`, `AGENTS.md`,
   `.github/copilot-instructions.md` and `.github/workflows/agent-guardrails.yml`.

From then on, ask any agent for *"a new invoices section"*. Its skills make it clone the
reference app, build the feature the same way, check the migrations and structure, refresh
every agent's instructions, and hand over a change report.

## Home

- **Health ring** (0–100) with a mood: 😴 nothing set up yet, 🙂 good progress, 😬 something
  is failing, 😎 nearly there, 🥳 all green (with confetti).
- **Setup quest** with levels, from *Newcomer* to *Legend*. The next step is highlighted, and each
  step has a *Do it* button.
- **Tool cards**: live state and one-click actions for every tool.
- **Badges**: 🧹 clean migrations, 🧬 template keeper, 🔗 in sync, 🧠 skilled, 🛡️ guarded,
  🌿 green branch, 🏆 all-star.
- **English / عربي**, with right-to-left layout. Follows your theme; animations respect
  *reduce motion*.

## For agents and CI: one CLI

`Set Up Project` installs a dependency-free CLI (Node + git only) into the project:

```sh
node .agent-studio/tool/cli.js scaffold new invoices --entity Invoice   # clone the reference app
node .agent-studio/tool/cli.js context sync                             # refresh CLAUDE.md / AGENTS.md / Copilot
node .agent-studio/tool/cli.js guard check --base origin/main           # migration safety
node .agent-studio/tool/cli.js report                                   # one-page branch review
node .agent-studio/tool/cli.js doctor                                   # every check, one summary
```

The CI workflow runs the change report and every check on each pull request, and on pushes
to `main`/`master`.

Project layout:

```
.agent-studio/
  tool/            the CLI (re-installed by Set Up Project when the extension updates)
  rules.md         agent rules: the single source for every agent
  scaffold.json    reference app and scaffolding options (JSON schema in the editor)
  context.json     optional: instruction targets and project map options
```

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `agentStudio.skillRoots` | 7 common skill folders | Where the Skills view looks |
| `agentStudio.installSkillsTo` | `.claude/skills`, `.agents/skills`, `.github/skills` | Where setup installs the studio skills |
| `agentStudio.autoSyncContext` | `true` | Re-sync agent instructions when Python files or rules change |
| `agentStudio.guardBase` | `HEAD` | What the editor's migration check compares with |
| `agentStudio.reportBase` | closest of `origin/main`, `main`, … | What the change report compares with |

## Develop

```sh
npm install
npm test          # generate + compile + 272 node:test tests
npm run lint
npm run package   # -> django-agent-studio-0.2.0.vsix
```

Press <kbd>F5</kbd> (**Run Extension**) to try it in an Extension Development Host.

```
src/
  extension.ts      activates every module
  cli.ts            the project CLI (scaffold | context | guard | report | doctor)
  studio/           Home view, setup, status and score, shared paths
  map/ analyzer/ shared/   Project Map and the Django static analyzer
  skillsDashboard/  Skills view
  scaffold/ context/ guard/ report/   the agent tools (pure core + cli.ts + ui.ts)
media/              webview assets (map, skills, studio Home)
agent-kit/skills/   skills installed into projects
ci/                 the guardrails workflow template (embedded at build time)
```

---

## بالعربي باختصار

إضافة وحدة فيها كل شي لبناء مشروع Django مع الوكلاء (Claude وCodex وCopilot):
- 🏠 صفحة رئيسية فيها نسبة صحة المشروع، ومهمة تجهيز بمستويات، وأوسمة، واحتفال لما يصير كل شي أخضر.
- 🗺️ خريطة المشروع.
- 🧠 المهارات.
- 🧬 أقسام جديدة من القالب المعتمد.
- 📜 قواعد موحّدة لكل الوكلاء.
- 🛡️ حماية الـ migrations.
- 📋 تقرير صفحة وحدة لكل فرع.

اضغط **Set Up Project** مرة وحدة، وارفع `.agent-studio/` على git، وخلّي الوكلاء يشتغلوا.

## License

MIT — see [LICENSE](LICENSE).
