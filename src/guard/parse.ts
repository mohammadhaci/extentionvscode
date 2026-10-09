// Pure, heuristic parsing of Django migration files. Never executes code.

export interface Dependency {
  app: string;
  name: string;
}

export interface Operation {
  /** e.g. "AddField", "RunPython" */
  kind: string;
  /** 1-based line of `migrations.<kind>(` */
  line: number;
  /** Positional argument source texts. */
  args: string[];
  /** Keyword argument source texts. */
  kwargs: Map<string, string>;
}

export interface ParsedMigration {
  dependencies: Dependency[];
  replaces: Dependency[];
  operations: Operation[];
  /** Absolute imports of `*.models` outside django.* (line numbers). */
  modelImports: { line: number; module: string }[];
  /** rule id -> reason ("" when no reason was given). */
  allows: Map<string, string>;
}

/**
 * Index just past the bracket that closes the one at `open`, skipping strings
 * (incl. triple-quoted and prefixed) and comments. -1 when unbalanced.
 */
export function matchBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "#") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text.startsWith(q, j)) {
          break;
        }
        if (!triple && text[j] === "\n") {
          break;
        }
        j++;
      }
      i = j + q.length - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return -1;
}

/** Splits call arguments on top-level commas. */
export function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "[" || c === "{" || c === '"' || c === "'" || c === "#") {
      if (c === "#") {
        const nl = inner.indexOf("\n", i);
        i = nl === -1 ? inner.length : nl;
        continue;
      }
      // matchBracket also skips a lone string when started on its quote.
      const end = c === '"' || c === "'" ? skipString(inner, i) : matchBracket(inner, i);
      i = (end === -1 ? inner.length : end) - 1;
    } else if (c === ",") {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) {
    out.push(last);
  }
  return out.filter(Boolean);
}

function skipString(text: string, i: number): number {
  const c = text[i];
  const triple = text.startsWith(c.repeat(3), i);
  const q = triple ? c.repeat(3) : c;
  let j = i + q.length;
  while (j < text.length && !text.startsWith(q, j)) {
    j += text[j] === "\\" ? 2 : 1;
  }
  return Math.min(text.length, j + q.length);
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;

/** Text of the `name = [ ... ]` list assignment at top or class level, with its offset. */
function listAssignment(text: string, name: string): { body: string; offset: number } | undefined {
  const m = new RegExp(`^\\s*${name}\\s*=\\s*\\[`, "m").exec(text);
  if (!m) {
    return undefined;
  }
  const open = m.index + m[0].length - 1;
  const close = matchBracket(text, open);
  return close === -1 ? undefined : { body: text.slice(open + 1, close - 1), offset: open + 1 };
}

const DEP_RE = /\(\s*["']([\w.]+)["']\s*,\s*["']([^"']+)["']\s*\)/g;

function dependencyList(text: string, name: string): Dependency[] {
  const list = listAssignment(text, name);
  if (!list) {
    return [];
  }
  return [...list.body.matchAll(DEP_RE)].map((m) => ({ app: m[1], name: m[2] }));
}

const OP_RE = /\bmigrations\.(\w+)\s*\(/g;

export function parseOperations(text: string): Operation[] {
  const list = listAssignment(text, "operations");
  if (!list) {
    return [];
  }
  const ops: Operation[] = [];
  for (const m of list.body.matchAll(OP_RE)) {
    const at = list.offset + m.index!;
    if (text.slice(text.lastIndexOf("\n", at) + 1, at).includes("#")) {
      continue; // commented out
    }
    const open = at + m[0].length - 1;
    const close = matchBracket(text, open);
    if (close === -1) {
      continue;
    }
    const args: string[] = [];
    const kwargs = new Map<string, string>();
    for (const a of splitArgs(text.slice(open + 1, close - 1))) {
      const kw = /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
      if (kw) {
        kwargs.set(kw[1], kw[2].trim());
      } else {
        args.push(a);
      }
    }
    ops.push({ kind: m[1], line: lineAt(text, list.offset + m.index!), args, kwargs });
  }
  return ops;
}

// [ \t] rather than \s: a reason never continues onto the next line.
const ALLOW_RE = /#[ \t]*migrations-guard:[ \t]*allow[ \t]+([\w-]+(?:[ \t]*,[ \t]*[\w-]+)*)[ \t]*(?::|—|--)?[ \t]*(.*)$/gm;
const MODEL_IMPORT_RES = [/^\s*from\s+([\w.]+\.models)(?:\.\w+)*\s+import\b/, /^\s*import\s+([\w.]+\.models)\b/];

export function parseMigration(text: string): ParsedMigration {
  const allows = new Map<string, string>();
  for (const m of text.matchAll(ALLOW_RE)) {
    for (const rule of m[1].split(",")) {
      allows.set(rule.trim(), m[2].trim());
    }
  }
  const modelImports: { line: number; module: string }[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const re of MODEL_IMPORT_RES) {
      const m = re.exec(line);
      if (m && !m[1].startsWith("django.")) {
        modelImports.push({ line: i + 1, module: m[1] });
      }
    }
  });
  return {
    dependencies: dependencyList(text, "dependencies"),
    replaces: dependencyList(text, "replaces"),
    operations: parseOperations(text),
    modelImports,
    allows,
  };
}

/** String value of a keyword or positional argument: `"name"` -> name. */
export function stringArg(op: Operation, key: string, position?: number): string | undefined {
  const raw = op.kwargs.get(key) ?? (position !== undefined ? op.args[position] : undefined);
  const m = raw ? /^[rbuRBU]?["']([^"']*)["']$/.exec(raw.trim()) : null;
  return m ? m[1] : undefined;
}

export interface FieldInfo {
  type: string;
  nullable: boolean;
  hasDefault: boolean;
}

/** Reads `models.X(...)` flags relevant to nullability. */
export function fieldInfo(src: string | undefined): FieldInfo | undefined {
  const m = src ? /^(?:[\w.]*\.)?(\w+)\s*\(/.exec(src.trim()) : null;
  if (!m || !src) {
    return undefined;
  }
  const inner = src.slice(src.indexOf("(") + 1, src.lastIndexOf(")"));
  const kw = new Map<string, string>();
  for (const a of splitArgs(inner)) {
    const k = /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    if (k) {
      kw.set(k[1], k[2].trim());
    }
  }
  return {
    type: m[1],
    nullable: kw.get("null") === "True",
    hasDefault: kw.has("default") || kw.has("db_default"),
  };
}

/** `fields=[("id", models.AutoField(...)), ...]` of a CreateModel. */
export function createModelFields(op: Operation): { name: string; field: string }[] {
  const raw = op.kwargs.get("fields") ?? op.args[1];
  if (!raw || !raw.trim().startsWith("[")) {
    return [];
  }
  const inner = raw.trim().slice(1, -1);
  return splitArgs(inner)
    .map((tuple) => {
      const parts = splitArgs(tuple.trim().replace(/^\(/, "").replace(/\)$/, ""));
      const name = /^["'](\w+)["']$/.exec(parts[0] ?? "")?.[1];
      return name && parts[1] ? { name, field: parts[1] } : undefined;
    })
    .filter((x): x is { name: string; field: string } => !!x);
}
