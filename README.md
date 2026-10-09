# 🤖 Django Agent Studio

One VS Code extension for building a Django project **with coding agents** (Claude Code,
Codex, GitHub Copilot), safely. You set the rules and review; the agents do the work, and
the studio keeps them on track.

Everything lives behind one **Agent Studio** icon in the Activity Bar:

| View / tool | What it does | Docs |
| --- | --- | --- |
| 🏠 **Home** | Health score, setup quest, every tool at a glance, badges | below |
| 🎯 **Agent tasks** | One click gives Claude Code, Codex or Copilot an expert task (security audit, tests, bugs, performance, review…) with your project's context | [tasks](docs/tasks.md) |
| 🗺️ **Project Map** | Apps, URLs, views, models and relations as an interactive map | [map](docs/map.md) |
| 🧠 **Skills** | Browse, copy, remove and import agent skills (`SKILL.md`) | [skills](docs/skills.md) |
| 🧬 **New apps** | Clone the approved reference app into new apps, renamed and registered | [scaffold](docs/scaffold.md) |
| 📜 **Agent rules** | One `rules.md` plus a live project map, synced to `CLAUDE.md`, `AGENTS.md` and Copilot | [context](docs/context.md) |
| 🛡️ **Migrations** | Static safety checks: data loss, NOT NULL traps, edited or conflicting migrations | [guard](docs/guard.md) |
| 📋 **Change report** | One-page review of a branch in Django terms, with a red/yellow/green verdict | [report](docs/report.md) |
| 🔌 **MCP server** | Claude Code, Copilot and Codex call the studio's tools directly: map, app details and relations, memory, checks, tasks | [mcp](docs/mcp.md) |
| 🐘 **Project memory** | Long-term memory shared by every agent and session: decisions, gotchas, conventions | [memory](docs/memory.md) |

Static analysis only: project code is never executed.

## Quick start

1. Install `django-agent-studio-0.2.1.vsix` (Extensions → ⋯ → *Install from VSIX…*) and open your Django project.
2. Click the **Agent Studio** icon. **Home** shows a setup quest:
   1. **Install the studio**: one click writes `.agent-studio/` (CLI, rules, settings), the
      studio skills and MCP server for every agent, and the CI guardrails workflow.
   2. **Pick your reference app**: the approved app every new app is cloned from.
   3. **Write the agent rules** in `.agent-studio/rules.md`.
   4. **Teach your agents** (skills) and **guard every pull request** (CI).
   5. **Go all green.**
3. Commit `.agent-studio/`, the skill folders, `CLAUDE.md`, `AGENTS.md`,
   `.github/copilot-instructions.md`, `.github/workflows/agent-guardrails.yml`, `.mcp.json`
   and `.vscode/mcp.json`.

From then on, ask any agent for *"a new invoices section"*. Its skills make it clone the
reference app, build the feature the same way, check the migrations and structure, refresh
every agent's instructions, and hand over a change report. What they learn on the way goes
into the project memory, so the next agent (or the next session) starts from it.

## Home

- **Health ring** (0–100) with a mood: 😴 nothing set up yet, 🙂 good progress, 😬 something
  is failing, 😎 nearly there, 🥳 all green (with confetti).
- **Setup quest** with levels, from *Newcomer* to *Legend*. The next step is highlighted, and each
  step has a *Do it* button.
- **Agent tasks**: one button per task, plus your own custom tasks.
- **Tool cards**: live state and one-click actions for every tool.
- **Badges**: 🧹 clean migrations, 🧬 template keeper, 🔗 in sync, 🧠 skilled, 🛡️ guarded,
  🌿 green branch, 🐘 elephant memory, 🏆 all-star.
- **English / عربي**, with right-to-left layout. Follows your theme; animations respect
  *reduce motion*.

## For agents and CI: one CLI

`Set Up Project` installs a dependency-free CLI (Node + git only) into the project:

```sh
node .agent-studio/tool/cli.js scaffold new invoices --entity Invoice   # clone the reference app
node .agent-studio/tool/cli.js context sync                             # refresh CLAUDE.md / AGENTS.md / Copilot
node .agent-studio/tool/cli.js guard check --base origin/main           # migration safety
node .agent-studio/tool/cli.js report                                   # one-page branch review
node .agent-studio/tool/cli.js tasks show security-audit --app apps/rfq # a ready-made prompt
node .agent-studio/tool/cli.js memory search celery                     # what the project already knows
node .agent-studio/tool/cli.js memory add --type gotcha --title "…"     # remember something for every agent
node .agent-studio/tool/cli.js doctor                                   # every check, one summary
node .agent-studio/tool/cli.js mcp                                      # MCP server (agents start it themselves)
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
  memory/          project memory: one Markdown file per fact, written by agents and humans
  tasks/           optional: your own agent tasks (one Markdown prompt each)
  runs/            prompts sent to agents (git-ignored)
```

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `agentStudio.skillRoots` | 7 common skill folders | Where the Skills view looks |
| `agentStudio.installSkillsTo` | `.claude/skills`, `.agents/skills`, `.github/skills` | Where setup installs the studio skills |
| `agentStudio.autoSyncContext` | `true` | Re-sync agent instructions when Python files or rules change |
| `agentStudio.guardBase` | `HEAD` | What the editor's migration check compares with |
| `agentStudio.reportBase` | closest of `origin/main`, `main`, … | What the change report compares with |
| `agentStudio.taskTarget` | `ask` | Where agent tasks go: Claude Code, Codex, Copilot Chat, clipboard or a file |
| `agentStudio.claudeCommand` / `codexCommand` | `claude` / `codex` | Terminal commands used for agent tasks |

## Develop

```sh
npm install
npm test          # generate + compile + 298 node:test tests
npm run lint
npm run package   # -> django-agent-studio-0.2.1.vsix
```

Press <kbd>F5</kbd> (**Run Extension**) to try it in an Extension Development Host.

```
src/
  extension.ts      activates every module
  cli.ts            the project CLI (scaffold | context | guard | memory | tasks | report | mcp | doctor)
  studio/           Home view, setup, status and score, shared paths
  map/ analyzer/ shared/   Project Map and the Django static analyzer
  skillsDashboard/  Skills view
  scaffold/ context/ guard/ report/ memory/ tasks/   the agent tools
  mcp/              the MCP server (tools and prompts over stdio) (pure core + cli.ts + ui.ts)
media/              webview assets (map, skills, studio Home)
agent-kit/skills/   skills installed into projects
ci/                 the guardrails workflow template (embedded at build time)
```

---

## بالعربي باختصار

إضافة وحدة فيها كل شي لبناء مشروع Django مع الوكلاء (Claude وCodex وCopilot):
- 🏠 صفحة رئيسية فيها نسبة صحة المشروع، ومهمة تجهيز بمستويات، وأوسمة، واحتفال لما يصير كل شي أخضر.
- 🎯 أزرار مهام: كبسة وحدة بتعطي Claude أو Codex أو Copilot مهمة جاهزة (فحص أمان، اختبارات، أخطاء، أداء، مراجعة…) مع معلومات مشروعك.
- 🗺️ خريطة المشروع.
- 🧠 المهارات.
- 🧬 أقسام جديدة من القالب المعتمد.
- 📜 قواعد موحّدة لكل الوكلاء.
- 🛡️ حماية الـ migrations.
- 📋 تقرير صفحة وحدة لكل فرع.
- 🔌 سيرفر MCP: Claude وCopilot وCodex بيستعملوا أدوات الإضافة مباشرة (الخريطة، علاقات الأقسام، الذاكرة، الفحوصات، المهام).
- 🐘 ذاكرة مشتركة للمشروع: أي وكيل أو جلسة جديدة بتعرف القرارات والمطبات والاتفاقيات بدون ما تشرحها من جديد.

اضغط **Set Up Project** مرة وحدة، وارفع `.agent-studio/` على git، وخلّي الوكلاء يشتغلوا.

## License

MIT — see [LICENSE](LICENSE).
