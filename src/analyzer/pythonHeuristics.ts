/** Shared heuristic parsing helpers. Line numbers are 1-based. */

export interface SourceLine {
  no: number;
  text: string;
}

export function toLines(text: string): SourceLine[] {
  return text.split(/\r?\n/).map((t, i) => ({ no: i + 1, text: t }));
}

/** Top-level (indentation 0) class/def statement, e.g. `class Post(models.Model):` */
export const TOP_CLASS_RE = /^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/;
export const TOP_DEF_RE = /^def\s+(\w+)\s*\(([^)]*)\)\s*:/;

/**
 * Extract the first positional argument target of a model field call, e.g.
 *   author = models.ForeignKey("blog.Author", on_delete=...)
 *   author = models.ForeignKey(Author, on_delete=...)
 *   parent = models.ForeignKey("self", on_delete=...)
 * Returns the raw target string without quotes, or undefined.
 */
export function extractRelationTarget(afterParen: string): string | undefined {
  const m = afterParen.match(/^\s*(?:r?["']([^"']+)["']|(\w+))?/);
  if (!m) {
    return undefined;
  }
  return m[1] ?? m[2];
}

/**
 * Normalize a relation target like "blog.Post" or "app_label.Post" to a
 * probable model class name ("Post"). Returns undefined for SET_NULL-style
 * constants (they never match this position in practice).
 */
export function targetToModelName(target: string | undefined): string | undefined {
  if (!target || target === "self") {
    return undefined; // handled by caller as self-reference
  }
  const parts = target.split(".");
  const last = parts[parts.length - 1];
  if (!/^[A-Za-z_]\w*$/.test(last)) {
    return undefined;
  }
  // Lowercase app-label-only strings ("author") are ambiguous; keep them —
  // graphBuilder matches case-insensitively as a fallback.
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Strip quotes from a Python string literal, else return as-is. */
export function unquote(s: string): string {
  const m = s.match(/^r?["'](.*)["']$/);
  return m ? m[1] : s;
}
