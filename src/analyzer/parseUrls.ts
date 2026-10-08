import { toLines, unquote } from "./pythonHeuristics";

export interface UrlPattern {
  route: string;
  /** Raw second argument, e.g. `views.post_list`, `views.PostListView.as_view()`, `include("blog.urls")` */
  viewRef: string;
  name?: string;
  line: number;
  isInclude: boolean;
  includeModule?: string;
}

const URL_CALL_START_RE = /\b(path|re_path|url)\s*\(/;
const INCLUDE_RE = /\binclude\s*\(\s*(?:r?["']([^"']+)["']|([\w.]+))/;
const NAME_RE = /\bname\s*=\s*["']([^"']+)["']/;

/** Normalize a view reference: strip `.as_view(...)`, take dotted last part. */
export function normalizeViewRef(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\.as_view\s*\(.*\)\s*$/, "");
  s = s.split("(")[0].trim();
  const parts = s.split(".");
  return parts[parts.length - 1].replace(/[^A-Za-z0-9_]/g, "");
}

/** Split a call's inner text on top-level commas (string- and paren-aware). */
function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      current += ch;
      if (ch === quote && inner[i - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      current += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") {
    args.push(current.trim());
  }
  return args;
}

/**
 * Inner texts of every top-level path()/re_path()/url() call in a statement,
 * e.g. both calls of `urlpatterns = [path("a/", x), path("b/", y)]`. Calls
 * nested inside another call (such as `include([path(...)])`) are skipped.
 */
function callInners(stmt: string): string[] {
  const inners: string[] = [];
  let from = 0;
  for (;;) {
    const m = URL_CALL_START_RE.exec(stmt.slice(from));
    if (!m) {
      return inners;
    }
    let i = stmt.indexOf("(", from + m.index);
    let depth = 0;
    let quote: string | null = null;
    const start = i;
    let end = -1;
    for (; i < stmt.length; i++) {
      const ch = stmt[i];
      if (quote) {
        if (ch === quote && stmt[i - 1] !== "\\") {
          quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      return inners;
    }
    inners.push(stmt.slice(start + 1, end));
    from = end + 1;
  }
}

/**
 * Heuristically parse urls.py content. Handles the common
 * `path("route", views.X, name="...")` / `include("app.urls")` shapes,
 * including multi-line entries and nested calls like `.as_view()`.
 * Never executes code.
 */
export function parseUrls(text: string): UrlPattern[] {
  const lines = toLines(text);
  // Join continuation lines: accumulate until parens balance,
  // ignoring parens inside string literals (e.g. regex routes).
  const stripStrings = (s: string) =>
    s.replace(/r?"""[\s\S]*?"""|r?'''[\s\S]*?'''|r?"[^"\n]*"|r?'[^'\n]*'/g, '""');
  const logical: { text: string; line: number }[] = [];
  let buf = "";
  let start = 0;
  let depth = 0;
  lines.forEach(({ no, text: raw }) => {
    const stripped = raw.trim();
    if (!stripped || stripped.startsWith("#")) {
      return;
    }
    if (buf === "") {
      start = no;
    }
    buf += (buf ? " " : "") + stripped;
    const code = stripStrings(raw);
    depth += (code.match(/\(/g) || []).length - (code.match(/\)/g) || []).length;
    if (depth <= 0) {
      logical.push({ text: buf, line: start });
      buf = "";
      depth = 0;
    }
  });
  if (buf) {
    logical.push({ text: buf, line: start });
  }

  const out: UrlPattern[] = [];
  for (const { text: stmt, line } of logical) {
    for (const inner of callInners(stmt)) {
      const args = splitTopLevelArgs(inner);
      if (args.length < 2) {
        continue;
      }
      const route = unquote(args[0].trim().replace(/^r(?=["'])/, ""));
      const viewRaw = args[1].trim();
      // Read the name from this call only, so each pattern of a shared line keeps its own.
      const nameM = inner.match(NAME_RE);
      const name = nameM ? nameM[1] : undefined;
      const inc = viewRaw.match(INCLUDE_RE);
      if (inc) {
        out.push({
          route,
          viewRef: viewRaw,
          name,
          line,
          isInclude: true,
          includeModule: inc[1] ?? inc[2]
        });
      } else {
        out.push({ route, viewRef: viewRaw, name, line, isInclude: false });
      }
    }
  }
  return out;
}
