// Shared project memory: small Markdown files in .agent-studio/memory/, one per
// entry, so parallel branches never conflict. Node standard library only.
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { MEMORY_DIR } from "../studio/paths";

export const MEMORY_TYPES = ["decision", "gotcha", "convention", "knowledge", "lesson"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const TYPE_ICON: Record<MemoryType, string> = {
  decision: "🧭",
  gotcha: "⚠️",
  convention: "📏",
  knowledge: "📚",
  lesson: "🩹",
};

export interface MemoryEntry {
  /** File name without .md, e.g. "2026-10-09-rfq-loops-are-versioned-3f2a". */
  id: string;
  /** Project-relative path of the file. */
  path: string;
  type: MemoryType;
  title: string;
  tags: string[];
  /** Related apps or paths, e.g. "apps/rfq". */
  related: string[];
  author: string;
  date: string;
  status: "active" | "outdated";
  body: string;
}

export interface NewMemory {
  type: MemoryType;
  title: string;
  body?: string;
  tags?: string[];
  related?: string[];
  author?: string;
  /** YYYY-MM-DD; defaults to today. */
  date?: string;
}

export const isMemoryType = (v: unknown): v is MemoryType => typeof v === "string" && (MEMORY_TYPES as readonly string[]).includes(v);

const today = (): string => new Date().toISOString().slice(0, 10);

/** ASCII slug of the title; empty for titles without Latin letters (e.g. Arabic). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

const list = (v: string): string[] =>
  v
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

/** Parses one entry file; undefined when it has no usable frontmatter. */
export function parseMemory(text: string, relPath: string): MemoryEntry | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) {
    return undefined;
  }
  const fields = new Map<string, string>();
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      fields.set(kv[1], kv[2].trim());
    }
  }
  const type = fields.get("type");
  const rawTitle = fields.get("title") ?? "";
  let title = rawTitle.replace(/^'|'$/g, "");
  if (rawTitle.startsWith('"')) {
    try {
      title = JSON.parse(rawTitle) as string;
    } catch {
      title = rawTitle.replace(/^"|"$/g, "");
    }
  }
  if (!isMemoryType(type) || !title) {
    return undefined;
  }
  return {
    id: path.basename(relPath, ".md"),
    path: relPath,
    type,
    title,
    tags: list(fields.get("tags") ?? ""),
    related: list(fields.get("related") ?? ""),
    author: fields.get("author") || "unknown",
    date: /^\d{4}-\d{2}-\d{2}$/.test(fields.get("date") ?? "") ? fields.get("date")! : "",
    status: fields.get("status") === "outdated" ? "outdated" : "active",
    body: m[2].trim(),
  };
}

const quote = (s: string): string => JSON.stringify(s);

export function serializeMemory(e: Omit<MemoryEntry, "id" | "path">): string {
  return [
    "---",
    `type: ${e.type}`,
    `title: ${quote(e.title.replace(/\r?\n/g, " "))}`,
    `tags: [${e.tags.join(", ")}]`,
    `related: [${e.related.join(", ")}]`,
    `author: ${e.author}`,
    `date: ${e.date}`,
    `status: ${e.status}`,
    "---",
    "",
    e.body.trim(),
    "",
  ].join("\n");
}

/** All entries, newest first (then by id for a stable order). */
export function listMemories(root: string): MemoryEntry[] {
  const dir = path.join(root, ...MEMORY_DIR.split("/"));
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: MemoryEntry[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!name.endsWith(".md") || name.toLowerCase() === "readme.md" || !fs.lstatSync(full).isFile()) {
      continue;
    }
    const entry = parseMemory(fs.readFileSync(full, "utf8"), `${MEMORY_DIR}/${name}`);
    if (entry) {
      out.push(entry);
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

const cleanList = (xs: readonly string[] | undefined): string[] =>
  [...new Set((xs ?? []).map((x) => x.trim().replace(/[[\],]/g, "")).filter(Boolean))];

/** Writes a new entry and returns it. */
export function addMemory(root: string, input: NewMemory): MemoryEntry {
  const title = input.title.trim();
  if (!title) {
    throw new Error("A memory needs a title.");
  }
  if (!isMemoryType(input.type)) {
    throw new Error(`Type must be one of: ${MEMORY_TYPES.join(", ")}.`);
  }
  const date = input.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date must look like 2026-10-09.");
  }
  const entry = {
    type: input.type,
    title,
    tags: cleanList(input.tags).map((t) => t.toLowerCase()),
    related: cleanList(input.related),
    author: (input.author ?? "human").trim() || "human",
    date,
    status: "active" as const,
    body: (input.body ?? "").trim(),
  };
  const hash = createHash("sha1").update(`${title}\n${entry.body}\n${Date.now()}\n${Math.random()}`).digest("hex").slice(0, 4);
  const id = [date, slugify(title) || entry.type, hash].join("-");
  const dir = path.join(root, ...MEMORY_DIR.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.md`), serializeMemory(entry), { flag: "wx" });
  return { ...entry, id, path: `${MEMORY_DIR}/${id}.md` };
}

/** Finds an entry by full id, unique id prefix, or unique title match. */
export function findMemory(entries: readonly MemoryEntry[], key: string): MemoryEntry {
  const k = key.trim().toLowerCase().replace(/\.md$/, "").replace(/^.*\//, "");
  const exact = entries.filter((e) => e.id.toLowerCase() === k);
  const hits = exact.length > 0 ? exact : entries.filter((e) => e.id.toLowerCase().startsWith(k) || e.id.toLowerCase().endsWith(k) || e.title.toLowerCase() === k);
  if (hits.length !== 1) {
    throw new Error(hits.length === 0 ? `No memory matches "${key}".` : `"${key}" matches ${hits.length} memories; use the full id.`);
  }
  return hits[0];
}

/** Marks an entry outdated (kept for history, dropped from the agent index). */
export function markOutdated(root: string, entry: MemoryEntry): void {
  const file = path.join(root, ...entry.path.split("/"));
  fs.writeFileSync(file, serializeMemory({ ...entry, status: "outdated" }));
}

/** Simple ranked search over title (x3), tags (x2), related paths (x2) and body. */
export function searchMemories(entries: readonly MemoryEntry[], query: string): MemoryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [...entries];
  }
  const scored = entries.map((e) => {
    const title = e.title.toLowerCase();
    const tags = e.tags.join(" ");
    const related = e.related.join(" ").toLowerCase();
    const body = e.body.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const s = (title.includes(t) ? 3 : 0) + (tags.includes(t) ? 2 : 0) + (related.includes(t) ? 2 : 0) + (body.includes(t) ? 1 : 0) + (e.type === t ? 2 : 0);
      if (s === 0) {
        return { e, score: 0 };
      }
      score += s;
    }
    return { e, score: e.status === "outdated" ? score / 4 : score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.e);
}
