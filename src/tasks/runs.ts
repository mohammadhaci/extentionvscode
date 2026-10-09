import * as fs from "fs";
import * as path from "path";
import { RUNS_DIR, TASKS_DIR } from "../studio/paths";
import { CUSTOM_TASK_TEMPLATE } from "./library";

const KEEP_RUNS = 20;

/**
 * Saves a prompt as `.agent-studio/runs/<time>-<id>.md` (git-ignored) so a terminal agent can
 * be pointed at it with a short, shell-safe command. Keeps the newest runs only.
 */
export function writeRun(root: string, taskId: string, prompt: string, now = new Date()): string {
  const dir = path.join(root, ...RUNS_DIR.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(ignore, "# Prompts sent to agents by Agent Studio; not part of the project.\n*\n");
  }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  let name = `${stamp}-${taskId}.md`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) {
    name = `${stamp}-${taskId}-${i}.md`;
  }
  fs.writeFileSync(path.join(dir, name), prompt);
  const runs = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
    fs.rmSync(path.join(dir, old), { force: true });
  }
  return `${RUNS_DIR}/${name}`;
}

/** Creates `.agent-studio/tasks/<id>.md` from the template (or from `text`); returns its relative path. */
export function createCustomTask(root: string, id: string, text = CUSTOM_TASK_TEMPLATE): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error("Use lowercase letters, digits and dashes, e.g. check-translations");
  }
  const rel = `${TASKS_DIR}/${id}.md`;
  const file = path.join(root, ...rel.split("/"));
  if (fs.existsSync(file)) {
    throw new Error(`${rel} already exists`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { flag: "wx" });
  return rel;
}

/** A built-in task as a custom task file, to edit it for this project. */
export function taskFileText(t: { title: string; titleAr?: string; icon: string; description: string; scope: string; input?: string; prompt: string }): string {
  const q = (v: string): string => JSON.stringify(v);
  return [
    "---",
    `title: ${q(t.title)}`,
    ...(t.titleAr ? [`titleAr: ${q(t.titleAr)}`] : []),
    `icon: ${t.icon}`,
    `description: ${q(t.description)}`,
    `scope: ${t.scope}`,
    ...(t.input ? [`input: ${q(t.input)}`] : []),
    "---",
    t.prompt,
    "",
  ].join("\n");
}
