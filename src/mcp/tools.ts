// The tools the MCP server gives agents. Each is a thin wrapper over the studio's own
// modules, so agents get the same answers as the CLI and VS Code. Node standard library only.
import * as fs from "fs";
import * as path from "path";
import { parseModels } from "../analyzer/parseModels";
import { parseUrls } from "../analyzer/parseUrls";
import { main as contextMain } from "../context/cli";
import { AppSummary, ProjectSummary } from "../context/projectMap";
import { main as guardMain } from "../guard/cli";
import { addMemory, findMemory, isMemoryType, listMemories, markOutdated, MEMORY_TYPES, MemoryEntry, searchMemories, TYPE_ICON } from "../memory/memory";
import { syncProject } from "../context/sync";
import { main as reportMain } from "../report/cli";
import { main as scaffoldMain } from "../scaffold/cli";
import { RULES_FILE } from "../studio/paths";
import { runCaptured } from "../studio/run";
import { buildPrompt, findTask, listTasks, memoriesFor, projectSummary } from "../tasks/library";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (root: string, args: Record<string, unknown>) => string;
}

/** A tool failure the agent should see as a message, not a protocol error. */
export class ToolError extends Error {}

const str = (args: Record<string, unknown>, key: string, required = false): string | undefined => {
  const v = args[key];
  if (v === undefined || v === null || v === "") {
    if (required) {
      throw new ToolError(`"${key}" is required`);
    }
    return undefined;
  }
  if (typeof v !== "string") {
    throw new ToolError(`"${key}" must be a string`);
  }
  return v;
};
const list = (args: Record<string, unknown>, key: string): string[] => {
  const v = args[key];
  if (v === undefined || v === null) {
    return [];
  }
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
    return v as string[];
  }
  if (typeof v === "string") {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  throw new ToolError(`"${key}" must be a list of strings`);
};

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const appArg = { type: "string", description: 'Project-relative app folder, e.g. "apps/rfq"' };
const baseArg = { type: "string", description: "Git ref to compare with (default: the closest of origin/main, main, …)" };

function findApp(summary: ProjectSummary, dir: string): AppSummary {
  const clean = dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const app = summary.apps.find((a) => a.dir === clean) ?? summary.apps.find((a) => a.name === clean);
  if (!app) {
    throw new ToolError(`"${dir}" is not a Django app. Apps: ${summary.apps.map((a) => a.dir).join(", ") || "none"}`);
  }
  return app;
}

const memoryLine = (e: MemoryEntry): string =>
  `- ${TYPE_ICON[e.type]} ${e.type}: ${e.title}${e.tags.length ? ` [${e.tags.join(", ")}]` : ""} (id ${e.id})${e.status === "outdated" ? " (outdated)" : ""}`;

/** Re-syncs agent instructions after memory changed; returns a note for the agent. */
function refresh(root: string): string {
  if (!fs.existsSync(path.join(root, ...RULES_FILE.split("/")))) {
    return "";
  }
  const n = syncProject(root).results.filter((r) => r.status === "created" || r.status === "updated").length;
  return n > 0 ? `\nAgent instructions updated (${n} file(s)).` : "";
}

const output = (r: { code: number; out: string; err: string }): string => {
  const text = [r.out.trim(), r.err.trim()].filter(Boolean).join("\n\n");
  if (r.code === 2) {
    throw new ToolError(text || "invalid arguments");
  }
  return text || "(no output)";
};

/** Mermaid graph of app dependencies (relations and imports). */
export function relationsDiagram(summary: ProjectSummary): string {
  const id = (dir: string): string => dir.replace(/[^A-Za-z0-9_]/g, "_");
  const lines = ["graph LR"];
  for (const a of summary.apps) {
    lines.push(`  ${id(a.dir)}["${a.dir}${a.dir === summary.referenceApp ? " ⭐" : ""}"]`);
  }
  for (const a of summary.apps) {
    for (const d of a.dependsOn) {
      lines.push(`  ${id(a.dir)} --> ${id(d)}`);
    }
  }
  return lines.join("\n");
}

export const TOOLS: readonly ToolDef[] = [
  {
    name: "project_overview",
    title: "Project overview",
    description:
      "Start here. The Django project's apps (models, URL prefix, dependencies), the reference app every new app is cloned from, the project rules and the size of the project memory.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
    run: (root) => {
      const s = projectSummary(root);
      if (!s.isDjango) {
        return "No Django project detected (no manage.py and no INSTALLED_APPS).";
      }
      const out = [`Django project with ${s.apps.length} app(s).`];
      if (s.referenceApp) {
        out.push(`Reference app (approved template): ${s.referenceApp}`);
      }
      if (s.rootUrls) {
        out.push(`Root URLconf: ${s.rootUrls}`);
      }
      out.push("", "Apps:");
      for (const a of s.apps) {
        out.push(
          `- ${a.dir}${a.urlPrefix ? ` (${a.urlPrefix})` : ""}: ${a.models.length ? a.models.join(", ") : "no models"}${a.dependsOn.length ? `; depends on ${a.dependsOn.join(", ")}` : ""}`
        );
      }
      const memories = listMemories(root).filter((m) => m.status === "active");
      out.push("", `Project memory: ${memories.length} active entr${memories.length === 1 ? "y" : "ies"} (use memory_search before you start).`);
      const rules = path.join(root, ...RULES_FILE.split("/"));
      out.push("", fs.existsSync(rules) ? `Rules (${RULES_FILE}):\n\n${fs.readFileSync(rules, "utf8").trim()}` : "No project rules file yet.");
      return out.join("\n");
    },
  },
  {
    name: "app_details",
    title: "App details",
    description: "Everything about one app: models with fields and relations, URL patterns, files, the apps it depends on, the apps that use it, and what the project memory knows about it.",
    inputSchema: { type: "object", properties: { app: appArg }, required: ["app"], additionalProperties: false },
    annotations: READ,
    run: (root, args) => {
      const s = projectSummary(root);
      const app = findApp(s, str(args, "app", true)!);
      const dir = path.join(root, ...app.dir.split("/"));
      const files: string[] = [];
      const walk = (d: string, rel: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
          if (e.name.startsWith(".") || e.name === "__pycache__" || e.name === "node_modules") {
            continue;
          }
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            walk(path.join(d, e.name), r);
          } else if (files.length < 200) {
            files.push(r);
          }
        }
      };
      walk(dir, "");
      const read = (rel: string): string => fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8");
      const out = [`# ${app.dir}${app.dir === s.referenceApp ? " (reference app)" : ""}`, ""];
      if (app.urlPrefix) {
        out.push(`URL prefix: ${app.urlPrefix}`);
      }
      out.push(`Depends on: ${app.dependsOn.join(", ") || "no other app"}`);
      out.push(`Used by: ${s.apps.filter((a) => a.dependsOn.includes(app.dir)).map((a) => a.dir).join(", ") || "no other app"}`);

      out.push("", "## Models");
      const modelFiles = files.filter((f) => f === "models.py" || (f.startsWith("models/") && f.endsWith(".py")));
      const models = modelFiles.flatMap((f) => parseModels(read(f)).filter((m) => m.isModel).map((m) => ({ ...m, file: f })));
      if (models.length === 0) {
        out.push("No models.");
      }
      for (const m of models) {
        out.push(`- ${m.name}(${m.base}) at ${app.dir}/${m.file}:${m.line}`);
        for (const f of m.fields) {
          out.push(`  - ${f.name}: ${f.fieldType}${f.relationTarget ? ` → ${f.relationTarget}` : ""}`);
        }
      }

      out.push("", "## URLs");
      const urls = files.includes("urls.py") ? parseUrls(read("urls.py")) : [];
      out.push(...(urls.length ? urls.map((u) => `- ${u.route || "(empty)"} → ${u.viewRef}${u.name ? ` (name: ${u.name})` : ""}`) : ["No urls.py patterns."]));

      out.push("", "## Project memory");
      const mem = memoriesFor(listMemories(root), app);
      out.push(...(mem.length ? mem.map(memoryLine) : ["Nothing saved about this app yet."]));

      out.push("", "## Files", ...files.map((f) => `- ${f}`));
      return out.join("\n");
    },
  },
  {
    name: "app_relations",
    title: "App relations",
    description: "How the apps depend on each other (model relations and imports), as a list and a Mermaid diagram. Use it to see what a change can break.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
    run: (root) => {
      const s = projectSummary(root);
      const out = ["Dependencies (A → B means A uses B):"];
      const edges = s.apps.flatMap((a) => a.dependsOn.map((d) => `- ${a.dir} → ${d}`));
      out.push(...(edges.length ? edges : ["- none"]));
      const isolated = s.apps.filter((a) => a.dependsOn.length === 0 && !s.apps.some((b) => b.dependsOn.includes(a.dir)));
      if (isolated.length) {
        out.push("", `Independent apps: ${isolated.map((a) => a.dir).join(", ")}`);
      }
      out.push("", "```mermaid", relationsDiagram(s), "```");
      return out.join("\n");
    },
  },
  {
    name: "memory_search",
    title: "Search project memory",
    description: "Search the shared project memory (decisions, gotchas, conventions, knowledge, lessons) before you start a task. All words must match.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to search for, e.g. \"rfq export\"" }, include_outdated: { type: "boolean" } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: READ,
    run: (root, args) => {
      const all = listMemories(root).filter((e) => args.include_outdated === true || e.status === "active");
      const hits = searchMemories(all, str(args, "query", true)!).slice(0, 20);
      if (hits.length === 0) {
        return "No matching memories.";
      }
      return hits.map((e) => `${memoryLine(e)}\n  ${e.body.replace(/\s+/g, " ").slice(0, 400) || "(no details)"}`).join("\n");
    },
  },
  {
    name: "memory_get",
    title: "Read a memory",
    description: "The full text of one memory entry, by id (or a unique part of it).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: READ,
    run: (root, args) => {
      let e: MemoryEntry;
      try {
        e = findMemory(listMemories(root), str(args, "id", true)!);
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err));
      }
      return `${TYPE_ICON[e.type]} ${e.type}: ${e.title}\nid: ${e.id} · ${e.date} · ${e.author} · ${e.status}\ntags: ${e.tags.join(", ") || "-"} · related: ${e.related.join(", ") || "-"}\nfile: ${e.path}\n\n${e.body || "(no details)"}`;
    },
  },
  {
    name: "memory_add",
    title: "Save to project memory",
    description:
      "Save one fact every future agent and session should know: a decision and why, a gotcha, a convention, how the business works, or a lesson from a tricky bug. Search first to avoid duplicates. Never save secrets.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...MEMORY_TYPES] },
        title: { type: "string", description: "One line someone can scan" },
        body: { type: "string", description: "What, why, and where in the code" },
        tags: { type: "array", items: { type: "string" } },
        related: { type: "array", items: { type: "string" }, description: 'Paths, e.g. ["apps/rfq"]' },
        author: { type: "string", description: "Who is saving it, e.g. claude, codex, copilot" },
      },
      required: ["type", "title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (root, args) => {
      const type = str(args, "type", true);
      if (!isMemoryType(type)) {
        throw new ToolError(`type must be one of ${MEMORY_TYPES.join(", ")}`);
      }
      const e = addMemory(root, {
        type,
        title: str(args, "title", true)!,
        body: str(args, "body"),
        tags: list(args, "tags"),
        related: list(args, "related"),
        author: str(args, "author") ?? "agent",
      });
      return `Saved ${TYPE_ICON[e.type]} ${e.title} to ${e.path}. Commit it with your change.${refresh(root)}`;
    },
  },
  {
    name: "memory_mark_outdated",
    title: "Retire a memory",
    description: "Mark a memory entry as no longer true. It stays in history but leaves the agents' index.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (root, args) => {
      let e: MemoryEntry;
      try {
        e = findMemory(listMemories(root), str(args, "id", true)!);
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err));
      }
      markOutdated(root, e);
      return `Marked "${e.title}" as outdated.${refresh(root)}`;
    },
  },
  {
    name: "run_checks",
    title: "Run every check",
    description: "Migrations safety, app structure against the reference app, and whether agent instructions are in sync. Run it before you finish.",
    inputSchema: { type: "object", properties: { base: baseArg }, additionalProperties: false },
    annotations: READ,
    run: (root, args) => {
      const base = str(args, "base");
      const parts = [
        ["Migrations", runCaptured(guardMain, ["check", ...(base ? ["--base", base] : [])], root)],
        ["App structure", runCaptured(scaffoldMain, ["check"], root)],
        ["Agent instructions", runCaptured(contextMain, ["check"], root)],
      ] as const;
      return parts
        .map(([name, r]) => `## ${r.code === 0 ? "✅" : "❌"} ${name}\n\n${[r.out.trim(), r.err.trim()].filter(Boolean).join("\n") || "(no output)"}`)
        .join("\n\n");
    },
  },
  {
    name: "migrations_check",
    title: "Check migrations",
    description: "Static safety checks for Django migrations: data loss, NOT NULL traps, edited or conflicting migrations.",
    inputSchema: { type: "object", properties: { base: baseArg }, additionalProperties: false },
    annotations: READ,
    run: (root, args) => {
      const base = str(args, "base");
      return output(runCaptured(guardMain, ["check", ...(base ? ["--base", base] : [])], root));
    },
  },
  {
    name: "change_report",
    title: "Change report",
    description: "One-page review of the current branch in Django terms (apps, models, URLs, dependencies, risks) with a red/yellow/green verdict.",
    inputSchema: { type: "object", properties: { base: baseArg }, additionalProperties: false },
    annotations: READ,
    run: (root, args) => {
      const base = str(args, "base");
      return output(runCaptured(reportMain, ["report", ...(base ? ["--base", base] : [])], root));
    },
  },
  {
    name: "sync_instructions",
    title: "Sync agent instructions",
    description: "Refresh CLAUDE.md, AGENTS.md and Copilot instructions from the rules, the project map and the memory. Run it after adding apps or models.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (root) => output(runCaptured(contextMain, ["sync"], root)),
  },
  {
    name: "list_tasks",
    title: "List ready-made tasks",
    description: "The project's ready-made agent tasks (security audit, tests, bug hunt, performance, review, …), including custom ones.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
    run: (root) =>
      listTasks(root)
        .map((t) => `- ${t.icon} ${t.id}: ${t.title}. ${t.description}${t.scope === "app" ? " (needs app)" : t.scope === "any" ? " (app optional)" : ""}${t.input ? " (needs input)" : ""}`)
        .join("\n"),
  },
  {
    name: "get_task",
    title: "Get a task",
    description: "The full instructions for a ready-made task, with the project's context. Then carry it out.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Task id from list_tasks" }, app: appArg, input: { type: "string", description: "Free text the task asks for" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: READ,
    run: (root, args) => {
      const id = str(args, "id", true)!;
      const task = findTask(listTasks(root), id);
      if (!task) {
        throw new ToolError(`No task "${id}". Use list_tasks.`);
      }
      const appDir = str(args, "app");
      const summary = projectSummary(root);
      try {
        return buildPrompt(root, task, { app: appDir ? findApp(summary, appDir).dir : undefined, input: str(args, "input") }, summary);
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err));
      }
    },
  },
];
