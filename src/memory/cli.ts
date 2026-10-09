// `cli.js memory ...`: read and write the shared project memory.
import * as fs from "fs";
import * as path from "path";
import { syncProject } from "../context/sync";
import { CLI, MEMORY_DIR, RULES_FILE } from "../studio/paths";
import { Io } from "../studio/run";
import { addMemory, findMemory, isMemoryType, listMemories, markOutdated, MEMORY_TYPES, MemoryEntry, searchMemories, TYPE_ICON } from "./memory";

const USAGE = `Project memory: decisions, gotchas, conventions, knowledge and lessons shared by
every agent and session. Entries live in ${MEMORY_DIR}/ (one Markdown file each).

  ${CLI} memory add --type <type> --title "<title>" [--body "<text>" | --body-file <file|->]
                    [--tags a,b] [--related apps/rfq,apps/accounts] [--author claude]
  ${CLI} memory list [--type <type>] [--tag <tag>] [--all] [--json]
  ${CLI} memory search <words...> [--json]
  ${CLI} memory show <id>
  ${CLI} memory outdated <id>       Keep the entry but drop it from the agent index

Types: ${MEMORY_TYPES.map((t) => `${TYPE_ICON[t]} ${t}`).join(", ")}
Adding or retiring an entry refreshes CLAUDE.md, AGENTS.md and Copilot instructions.`;

const VALUE_FLAGS = new Set(["type", "title", "body", "body-file", "tags", "related", "author", "tag", "date"]);
const BOOL_FLAGS = new Set(["json", "all", "help"]);

function parse(argv: readonly string[]): { positional: string[]; values: Map<string, string>; flags: Set<string> } | string {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (BOOL_FLAGS.has(key)) {
        flags.add(key);
      } else if (VALUE_FLAGS.has(key)) {
        const v = inline ?? argv[++i];
        if (v === undefined) {
          return `--${key} needs a value`;
        }
        values.set(key, v);
      } else {
        return `unknown option ${a}`;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, values, flags };
}

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

/** Keeps every agent's instructions current after the memory changed. */
function refreshInstructions(root: string, io: Io): void {
  if (fs.existsSync(path.join(root, ...RULES_FILE.split("/")))) {
    const changed = syncProject(root).results.filter((r) => r.status === "created" || r.status === "updated").length;
    if (changed > 0) {
      io.out(`Agent instructions updated (${changed} file(s)).`);
    }
  }
}

const line = (e: MemoryEntry): string =>
  `${TYPE_ICON[e.type]} ${e.id}  ${e.title}${e.tags.length ? `  [${e.tags.join(", ")}]` : ""}${e.status === "outdated" ? "  (outdated)" : ""}`;

export function main(argv: readonly string[], io: Io): number {
  const p = parse(argv);
  if (typeof p === "string") {
    io.err(`error: ${p}`);
    return 2;
  }
  const cmd = p.positional[0];
  if (!cmd || cmd === "help" || p.flags.has("help")) {
    io.out(USAGE);
    return cmd || p.flags.has("help") ? 0 : 2;
  }
  const root = findRoot(io.cwd);
  try {
    switch (cmd) {
      case "add": {
        const type = p.values.get("type");
        if (!isMemoryType(type)) {
          io.err(`error: --type must be one of: ${MEMORY_TYPES.join(", ")}`);
          return 2;
        }
        const bodyFile = p.values.get("body-file");
        const body = bodyFile === undefined ? p.values.get("body") : fs.readFileSync(bodyFile === "-" ? 0 : path.resolve(io.cwd, bodyFile), "utf8");
        const split = (k: string): string[] => (p.values.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const entry = addMemory(root, {
          type,
          title: p.values.get("title") ?? p.positional.slice(1).join(" "),
          body,
          tags: split("tags"),
          related: split("related"),
          author: p.values.get("author"),
          date: p.values.get("date"),
        });
        io.out(p.flags.has("json") ? JSON.stringify(entry, null, 2) : `Saved ${TYPE_ICON[entry.type]} ${entry.title}\n  ${entry.path}`);
        refreshInstructions(root, io);
        return 0;
      }
      case "list": {
        const type = p.values.get("type");
        const tag = p.values.get("tag")?.toLowerCase();
        const entries = listMemories(root).filter(
          (e) => (p.flags.has("all") || e.status === "active") && (!type || e.type === type) && (!tag || e.tags.includes(tag))
        );
        if (p.flags.has("json")) {
          io.out(JSON.stringify(entries, null, 2));
        } else if (entries.length === 0) {
          io.out(`No memories yet. Save one with: ${CLI} memory add --type knowledge --title "..." --body "..."`);
        } else {
          entries.forEach((e) => io.out(line(e)));
        }
        return 0;
      }
      case "search": {
        const hits = searchMemories(listMemories(root), p.positional.slice(1).join(" "));
        if (p.flags.has("json")) {
          io.out(JSON.stringify(hits, null, 2));
        } else if (hits.length === 0) {
          io.out("Nothing found.");
        } else {
          hits.slice(0, 20).forEach((e) => io.out(line(e)));
        }
        return 0;
      }
      case "show": {
        const e = findMemory(listMemories(root), p.positional.slice(1).join(" "));
        io.out(`${TYPE_ICON[e.type]} ${e.title}\n${e.type} · ${e.date} · ${e.author}${e.tags.length ? ` · ${e.tags.join(", ")}` : ""}${e.related.length ? `\nRelated: ${e.related.join(", ")}` : ""}${e.status === "outdated" ? "\n(outdated)" : ""}\n\n${e.body}`);
        return 0;
      }
      case "outdated": {
        const e = findMemory(listMemories(root), p.positional.slice(1).join(" "));
        markOutdated(root, e);
        io.out(`Marked outdated: ${e.title}`);
        refreshInstructions(root, io);
        return 0;
      }
      default:
        io.err(`error: unknown memory command "${cmd}".\n\n${USAGE}`);
        return 2;
    }
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
