// `cli.js tasks ...`: the ready-made agent tasks, as prompts any agent can run.
import * as fs from "fs";
import * as path from "path";
import { CLI, TASKS_DIR } from "../studio/paths";
import { Io } from "../studio/run";
import { BUILTIN_TASKS, buildPrompt, findTask, listTasks } from "./library";
import { createCustomTask, taskFileText } from "./runs";

const USAGE = `Ready-made tasks for coding agents. Each prints a complete prompt with the project's
context, rules and memory. Custom tasks live in ${TASKS_DIR}/<id>.md.

  ${CLI} tasks list [--json]
  ${CLI} tasks show <id> [--app <app_dir>] [--input "<text>"]
  ${CLI} tasks new <id> [--from <built-in id>]     Create a custom task file to edit`;

function findRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if ([".agent-studio", "manage.py", ".git"].some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) {
      return path.resolve(cwd);
    }
    dir = up;
  }
}

export function main(argv: readonly string[], io: Io): number {
  const positional: string[] = [];
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      json = true;
    } else if (a === "--help" || a === "-h") {
      io.out(USAGE);
      return 0;
    } else if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (!["app", "input", "from"].includes(key)) {
        io.err(`error: unknown option ${a}`);
        return 2;
      }
      const v = inline ?? argv[++i];
      if (v === undefined) {
        io.err(`error: --${key} needs a value`);
        return 2;
      }
      values.set(key, v);
    } else {
      positional.push(a);
    }
  }
  const [sub, id] = positional;
  const root = findRoot(io.cwd);
  const problems: string[] = [];
  const tasks = listTasks(root, problems);
  problems.forEach((p) => io.err(`warning: ${p}`));

  try {
    switch (sub) {
      case "list":
        if (json) {
          io.out(JSON.stringify(tasks.map(({ prompt: _p, ...t }) => t), null, 2));
        } else {
          const width = Math.max(...tasks.map((t) => t.id.length));
          for (const t of tasks) {
            const scope = t.scope === "app" ? " [--app]" : t.scope === "any" ? " [--app optional]" : "";
            io.out(`${t.icon} ${t.id.padEnd(width)}  ${t.title}: ${t.description}${scope}${t.input ? " [--input]" : ""}${t.path ? "  (custom)" : ""}`);
          }
        }
        return 0;
      case "show": {
        const t = id ? findTask(tasks, id) : undefined;
        if (!t) {
          io.err(`error: no task "${id ?? ""}". Run: ${CLI} tasks list`);
          return 1;
        }
        const app = values.get("app")?.replace(/\\/g, "/").replace(/\/+$/, "");
        io.out(buildPrompt(root, t, { app, input: values.get("input") }).trimEnd());
        return 0;
      }
      case "new": {
        if (!id) {
          io.err("error: tasks new needs an id, e.g. check-translations");
          return 2;
        }
        const from = values.get("from");
        const base = from ? BUILTIN_TASKS.find((t) => t.id === from) : undefined;
        if (from && !base) {
          io.err(`error: no built-in task "${from}"`);
          return 1;
        }
        const rel = createCustomTask(root, id, base ? taskFileText(base) : undefined);
        io.out(`Created ${rel}. Edit it, then commit it so the whole team gets the task.`);
        return 0;
      }
      default:
        io.err(USAGE);
        return 2;
    }
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
