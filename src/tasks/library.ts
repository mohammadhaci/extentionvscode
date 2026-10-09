// Ready-made tasks for coding agents. Each turns into a complete prompt with the
// project's context (apps, reference app, rules, memory). Node standard library only.
import * as fs from "fs";
import * as path from "path";
import { summarizeProject, AppSummary, ProjectSummary } from "../context/projectMap";
import { scanPython } from "../context/sync";
import { listMemories, MemoryEntry, TYPE_ICON } from "../memory/memory";
import { parseConfig } from "../scaffold/config";
import { CLI, RULES_FILE, SCAFFOLD_CONFIG, TASKS_DIR, TOOL_DIR } from "../studio/paths";

/** project: no target; app: one app required; any: the whole project or one app. */
export type TaskScope = "project" | "app" | "any";

export interface TaskDef {
  id: string;
  icon: string;
  title: string;
  titleAr?: string;
  description: string;
  scope: TaskScope;
  /** Asks the user for free text, substituted for {{input}}. */
  input?: string;
  /** Template: {{target}}, {{app}}, {{input}}, {{cli}}. */
  prompt: string;
  /** Project-relative path of a custom task file. */
  path?: string;
}

export const BUILTIN_TASKS: readonly TaskDef[] = [
  {
    id: "security-audit",
    icon: "🔒",
    title: "Security audit",
    titleAr: "فحص أمان",
    description: "Settings, access control, injection, XSS, CSRF, secrets, dependencies",
    scope: "any",
    prompt: `Run a security audit of {{target}} in this Django project.

Check at least:
1. Settings: DEBUG, where SECRET_KEY comes from, ALLOWED_HOSTS, SECURE_* and HSTS, SESSION_COOKIE_SECURE, CSRF_COOKIE_SECURE, X_FRAME_OPTIONS, password validators.
2. Access control: every view and API endpoint requires login and the right permission. Querysets are scoped to the current user or company, so nobody can read or change someone else's objects by changing an id in the URL or the request (IDOR).
3. Injection: raw(), extra(), RawSQL and cursor.execute built with string formatting; subprocess, eval or pickle on user input.
4. XSS: mark_safe, |safe, format_html misuse, {% autoescape off %}, user content placed inside JavaScript.
5. CSRF: csrf_exempt views, GET requests that change data.
6. Forms and serializers: fields = "__all__", exclude, writable fields that must be read-only (mass assignment).
7. Files: upload validation (type and size), paths built from user input, how uploads are served.
8. Redirects: next or return URLs not checked with url_has_allowed_host_and_scheme.
9. Secrets: keys, passwords or tokens in code or settings; sensitive data in logs or error messages.
10. Dependencies: run pip-audit (or safety) if it is available and list vulnerable packages.
11. Authentication: rate limiting on login and password reset, user enumeration.

Output a findings table: severity (Critical / High / Medium / Low), file:line, the problem, how it could be exploited, the fix.
Then fix the Critical and High findings that are local and safe to change, each with a test that proves the fix. Leave the rest as recommendations. Never weaken an existing check.`,
  },
  {
    id: "write-tests",
    icon: "🧪",
    title: "Write tests",
    titleAr: "اكتب اختبارات",
    description: "Permissions, business rules, validation and flows of one app",
    scope: "app",
    prompt: `Write automated tests for {{target}}.

1. Read the app first: models, views, forms, serializers, services, urls, permissions, signals, and its existing tests. Follow their style, test framework (TestCase or pytest), factories and fixtures.
2. Cover, in this order:
   - access to every view: anonymous user, a user of another company or without permission, an allowed user;
   - business rules in models and services, including status transitions;
   - form and serializer validation, with edge cases;
   - URL routing and response codes;
   - signals and other side effects.
3. Keep tests small, fast and independent. No network calls: mock external services.
4. Run the tests and make them pass. If a test exposes a real bug, do not bend the test: report the bug, and fix it if the fix is small and clear.

Finish with what is now covered and any bugs you found.`,
  },
  {
    id: "find-bugs",
    icon: "🐞",
    title: "Hunt for bugs",
    titleAr: "دوّر على أخطاء",
    description: "Logic, money, dates, transactions, race conditions, error handling",
    scope: "any",
    prompt: `Hunt for bugs in {{target}}. Read the code like a reviewer who is trying to break it:
- logic errors and wrong conditions; unhandled None or empty values; off-by-one errors
- money and quantities: float instead of Decimal, rounding
- dates: naive datetimes, date.today() instead of timezone-aware dates, ranges without an end bound
- data integrity: multi-step writes without transaction.atomic, race conditions (select_for_update, F() expressions), missing unique constraints
- status fields: transitions allowed from the wrong state
- error handling: bare except, swallowed errors, wrong HTTP status codes
- templates and translations: variables that do not exist

List each bug with file:line, a concrete scenario that triggers it, and the fix. Fix the clear ones, each with a regression test.`,
  },
  {
    id: "performance-review",
    icon: "⚡",
    title: "Performance",
    titleAr: "مراجعة الأداء",
    description: "N+1 queries, missing indexes, heavy requests, caching",
    scope: "any",
    prompt: `Review {{target}} for database and performance problems.

Look for:
- N+1 queries: loops, templates and serializers that touch related objects (fix with select_related / prefetch_related)
- queries inside loops; bulk_create / bulk_update opportunities
- len(queryset) or list() where count() or exists() would do
- lists without pagination
- filter / order_by on fields without an index (suggest Meta.indexes)
- loading whole objects where only() or values() would do
- heavy work inside a request that belongs in a background task
- identical queries repeated in one request that could be cached
- signals doing expensive work

For each finding: file:line, impact (High / Medium / Low), the fix. Apply the High-impact fixes that are safe, with behaviour unchanged, and add tests (assertNumQueries where it helps). A new index needs a migration: check it with \`{{cli}} guard check\`.`,
  },
  {
    id: "review-branch",
    icon: "👀",
    title: "Review my branch",
    titleAr: "راجع الفرع",
    description: "A strict senior review of the current branch, with a verdict",
    scope: "project",
    prompt: `Review the changes on the current branch as a strict senior Django reviewer.

1. Run \`{{cli}} report\` and read it. Use its base for the next steps.
2. Run \`{{cli}} guard check --base <base>\`.
3. Read the whole diff: \`git diff <base>...HEAD\`.
4. Check correctness, the agent rules, consistency with the reference app, security (permissions and company scoping), migrations, tests for every change, naming, dead code and leftover debug code.

Output a verdict (approve / request changes), then the findings grouped as Blocking, Should fix and Nit, each with file:line and a suggested fix. Do not change code.`,
  },
  {
    id: "learn-app",
    icon: "🎓",
    title: "Learn an app",
    titleAr: "افهم واحفظ",
    description: "Learn an app and save what every agent should know to project memory",
    scope: "app",
    prompt: `Study {{target}} until you could explain it to a new developer, then save what you learned to the project memory so no agent has to rediscover it.

1. Read the models (fields, relations, constraints, status fields and their transitions), urls and views (the user flows), forms and serializers, services, signals, tasks, templates, admin and tests.
2. Search the memory first (\`{{cli}} memory search <app name>\`) and do not duplicate entries.
3. Save 3 to 10 entries with \`{{cli}} memory add\`:
   - knowledge: how the domain works (entities, flows, statuses);
   - convention: patterns this app follows;
   - gotcha: traps you noticed.
   Use \`--related {{app}}\` and tag them with the app name. One specific fact per entry, with file paths.
4. Finish with a short explanation of the app: its purpose, the main models and how they relate, the main flows, and open questions.

Do not change code.`,
  },
  {
    id: "clean-up",
    icon: "🧹",
    title: "Clean up code",
    titleAr: "رتّب الكود",
    description: "Duplication, fat views, dead code, drift from the reference app",
    scope: "app",
    prompt: `Clean up {{target}} without changing its behaviour.

Look for duplicated code, long views that should call a service, dead code (unused imports, templates, urls, functions), inconsistent names, magic strings and numbers that should be constants or TextChoices, and differences from the reference app's structure and patterns.

First list what you plan to change and why. Then change it in small steps, running the tests after each step. Do not change public URLs, model fields or migrations unless the rules allow it.`,
  },
  {
    id: "new-section",
    icon: "🧬",
    title: "New section",
    titleAr: "قسم جديد",
    description: "Build a new app from the approved template, end to end",
    scope: "project",
    input: "Describe the new section: its name and what it should do",
    prompt: `Build a new section for this project: {{input}}

1. Follow the django-new-app skill. Choose a short app name and its main entity, then clone the reference app: \`{{cli}} scaffold new <name> --entity <Entity>\`.
2. Adapt the models, forms, views, templates and urls to the description. Keep the reference app's structure and patterns.
3. Create the migrations and check them with \`{{cli}} guard check\`.
4. Write tests for permissions, business rules and validation, and make them pass.
5. Run \`{{cli}} context sync\`, then \`{{cli}} report\`, and include the verdict in your summary.
6. If anything about the domain was unclear, list your assumptions.`,
  },
];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function unquote(v: string): string {
  const t = v.trim();
  if (t.startsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

/** A custom task file: `---` frontmatter (title, icon, description, scope, input) then the prompt. */
export function parseTaskFile(text: string, relPath: string): TaskDef | string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) {
    return "missing the --- frontmatter";
  }
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0 && !line.trimStart().startsWith("#")) {
      meta[line.slice(0, i).trim()] = unquote(line.slice(i + 1));
    }
  }
  const id = path.basename(relPath, ".md").toLowerCase();
  if (!ID_RE.test(id)) {
    return "the file name must be lowercase letters, digits and dashes";
  }
  const scope = (meta.scope || "project") as TaskScope;
  if (!["project", "app", "any"].includes(scope)) {
    return `scope must be project, app or any (got "${meta.scope}")`;
  }
  const prompt = m[2].trim();
  if (!meta.title || !prompt) {
    return "needs a title and a prompt";
  }
  return {
    id,
    icon: meta.icon || "⭐",
    title: meta.title,
    titleAr: meta.titleAr || undefined,
    description: meta.description || "Custom task",
    scope,
    input: meta.input || undefined,
    prompt,
    path: relPath,
  };
}

/** Built-in tasks plus `.agent-studio/tasks/*.md`; a custom task with a built-in's id replaces it. */
export function listTasks(root: string, problems: string[] = []): TaskDef[] {
  const tasks = new Map(BUILTIN_TASKS.map((t) => [t.id, t]));
  const dir = path.join(root, ...TASKS_DIR.split("/"));
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n.toLowerCase() !== "readme.md").sort()) {
      const rel = `${TASKS_DIR}/${f}`;
      const t = parseTaskFile(fs.readFileSync(path.join(dir, f), "utf8"), rel);
      if (typeof t === "string") {
        problems.push(`${rel}: ${t}`);
      } else {
        tasks.set(t.id, t);
      }
    }
  }
  return [...tasks.values()];
}

export function findTask(tasks: readonly TaskDef[], id: string): TaskDef | undefined {
  return tasks.find((t) => t.id === id);
}

export const CUSTOM_TASK_TEMPLATE = `---
title: "My task"
icon: ⭐
description: "What this task does, in one line"
# project: the whole project · app: pick one app · any: either
scope: any
# Optional: ask for text when the task runs, used as {{input}}
# input: "What should the agent focus on?"
---
Describe the task for the agent here, as you would to a senior developer.

Placeholders: {{target}} (the whole project, or "the \`apps/x\` app"), {{app}} (the app folder),
{{input}}, and {{cli}} (the Agent Studio CLI). Project context, the rules and the
project memory are added automatically.
`;

export interface PromptOptions {
  /** Project-relative app folder, for app / any tasks. */
  app?: string;
  input?: string;
}

function readReference(root: string): string | undefined {
  const file = path.join(root, ...SCAFFOLD_CONFIG.split("/"));
  return fs.existsSync(file) ? parseConfig(fs.readFileSync(file, "utf8")).config.referenceApp : undefined;
}

export function projectSummary(root: string): ProjectSummary {
  return summarizeProject(scanPython(root), readReference(root));
}

/** Memories about an app: related to its folder, or tagged with its name. */
export function memoriesFor(entries: readonly MemoryEntry[], app: AppSummary): MemoryEntry[] {
  const name = app.name.toLowerCase();
  return entries.filter(
    (e) => e.status === "active" && (e.related.some((r) => r === app.dir || r.startsWith(`${app.dir}/`)) || e.tags.includes(name))
  );
}

/** The full prompt for a task: the task itself, then the project context and how to finish. */
export function buildPrompt(root: string, task: TaskDef, opts: PromptOptions = {}, summary: ProjectSummary = projectSummary(root)): string {
  if (task.scope === "app" && !opts.app) {
    throw new Error(`"${task.title}" needs an app`);
  }
  if (task.input && !opts.input?.trim()) {
    throw new Error(`"${task.title}" needs input: ${task.input}`);
  }
  const app = opts.app ? summary.apps.find((a) => a.dir === opts.app) : undefined;
  if (opts.app && !app) {
    throw new Error(`"${opts.app}" is not a Django app of this project`);
  }
  const hasTool = fs.existsSync(path.join(root, ...TOOL_DIR.split("/"), "cli.js"));
  const hasRules = fs.existsSync(path.join(root, ...RULES_FILE.split("/")));
  const fill = (s: string): string =>
    s
      .replace(/\{\{target\}\}/g, app ? `the \`${app.dir}\` app` : "the whole project")
      .replace(/\{\{app\}\}/g, app?.dir ?? "")
      .replace(/\{\{input\}\}/g, opts.input?.trim() ?? "")
      .replace(/\{\{cli\}\}/g, CLI);

  const out: string[] = [`# ${task.icon} ${task.title}${app ? `: ${app.dir}` : ""}`, "", fill(task.prompt), "", "## Project context", ""];
  if (summary.isDjango) {
    const list = summary.apps.slice(0, 40).map((a) => `\`${a.dir}\``).join(", ");
    out.push(`- Django project with ${summary.apps.length} app(s): ${list}${summary.apps.length > 40 ? ", …" : ""}.`);
  }
  if (summary.referenceApp) {
    out.push(`- Reference app (the approved template every app follows): \`${summary.referenceApp}\`.`);
  }
  if (app) {
    const usedBy = summary.apps.filter((a) => a.dependsOn.includes(app.dir)).map((a) => `\`${a.dir}\``);
    out.push(`- Target app \`${app.dir}\`:`);
    out.push(`  - models: ${app.models.length ? app.models.join(", ") : "none"}`);
    if (app.urlPrefix) {
      out.push(`  - URL prefix: \`${app.urlPrefix}\``);
    }
    out.push(`  - depends on: ${app.dependsOn.length ? app.dependsOn.map((d) => `\`${d}\``).join(", ") : "no other app"}`);
    out.push(`  - used by: ${usedBy.length ? usedBy.join(", ") : "no other app"}`);
  }
  out.push(
    hasRules
      ? `- Follow the project rules in \`${RULES_FILE}\` (also in CLAUDE.md and AGENTS.md).`
      : "- Follow the project rules in CLAUDE.md / AGENTS.md if they exist."
  );

  const memories = listMemories(root).filter((e) => e.status === "active");
  if (hasTool) {
    out.push(`- Project memory: before you start, run \`${CLI} memory search <words>\` for the area you touch.`);
  }
  const relevant = app ? memoriesFor(memories, app) : [];
  if (relevant.length > 0) {
    out.push("- What the project memory already knows about this app:");
    for (const e of relevant.slice(0, 15)) {
      out.push(`  - ${TYPE_ICON[e.type]} ${e.type}: ${e.title} (\`${e.path}\`)`);
    }
  }

  out.push("", "## When you finish", "");
  if (hasTool) {
    out.push(`- If you changed code, run \`${CLI} doctor\` and fix what fails.`);
    out.push(`- Save anything the next agent should know with \`${CLI} memory add\` (see the project-memory skill).`);
  }
  out.push("- End with a short summary: what you found, what you changed, and what is left.");
  return out.join("\n") + "\n";
}
