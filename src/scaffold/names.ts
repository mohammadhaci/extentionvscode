// Pure naming helpers: validation, word splitting and case variants.

const PY_KEYWORDS = new Set([
  "false", "none", "true", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
  "try", "while", "with", "yield", "match", "case", "type",
]);

// Names that shadow common modules or collide with django.contrib app labels.
const RESERVED = new Set([
  "django", "rest_framework", "test", "tests", "site", "types", "json", "logging", "email",
  "string", "random", "time", "os", "sys", "re", "io", "collections", "typing", "abc",
  "admin", "auth", "contenttypes", "sessions", "messages", "staticfiles", "sites",
]);

/** Returns an error message, or undefined when `name` is a valid new app name. */
export function validateAppName(name: string, existing: ReadonlySet<string> = new Set()): string | undefined {
  if (!name) {
    return "Enter an app name.";
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return "Use lowercase snake_case: letters, digits and underscores, starting with a letter.";
  }
  if (name.length > 60) {
    return "Name is too long (max 60 characters).";
  }
  if (name.endsWith("_") || name.includes("__")) {
    return "Avoid leading/trailing or double underscores.";
  }
  if (PY_KEYWORDS.has(name)) {
    return `"${name}" is a Python keyword.`;
  }
  if (RESERVED.has(name)) {
    return `"${name}" clashes with a Python/Django module or built-in app label.`;
  }
  if (existing.has(name)) {
    return `A folder named "${name}" already exists next to the reference app.`;
  }
  return undefined;
}

/** Splits snake_case, kebab-case, camelCase, PascalCase or spaced text into lowercase words. */
export function splitWords(input: string): string[] {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const cap = (w: string): string => (w ? w[0].toUpperCase() + w.slice(1) : w);

export type VariantStyle = "snake" | "kebab" | "pascal" | "camel" | "upper" | "spaced" | "title";

export const VARIANT_STYLES: readonly VariantStyle[] = ["snake", "kebab", "pascal", "camel", "upper", "spaced", "title"];

export function variant(words: readonly string[], style: VariantStyle): string {
  switch (style) {
    case "snake":
      return words.join("_");
    case "kebab":
      return words.join("-");
    case "pascal":
      return words.map(cap).join("");
    case "camel":
      return words.map((w, i) => (i === 0 ? w : cap(w))).join("");
    case "upper":
      return words.join("_").toUpperCase();
    case "spaced":
      return words.join(" ");
    case "title":
      return words.map(cap).join(" ");
  }
}

/** Best-effort English singular of the last word ("order_items" -> "order_item"). */
export function guessSingular(name: string): string {
  const words = splitWords(name);
  if (words.length === 0) {
    return name;
  }
  const last = words[words.length - 1];
  let s = last;
  if (/[^aeiou]ies$/.test(last)) {
    s = last.slice(0, -3) + "y";
  } else if (/(ss|x|ch|sh)es$/.test(last)) {
    s = last.slice(0, -2);
  } else if (/ss$/.test(last) || /us$/.test(last) || /is$/.test(last)) {
    s = last;
  } else if (/s$/.test(last) && last.length > 1) {
    s = last.slice(0, -1);
  }
  return [...words.slice(0, -1), s].join("_");
}
