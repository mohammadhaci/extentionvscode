import { Renamer } from "./rename";

/** A block of whole lines inserted before `insertAtLine` (0-based). */
export interface RegistrationEdit {
  insertAtLine: number;
  text: string;
  description: string;
}

export interface RegistrationResult {
  edits: RegistrationEdit[];
  notes: string[];
}

/**
 * Dotted module names the reference app may be referred to by:
 * "src/apps/orders" -> ["src.apps.orders", "apps.orders", "orders"].
 */
export function moduleCandidates(refDir: string): string[] {
  const parts = refDir.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(i).join("."));
}

const eolOf = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");
const splitLines = (text: string): string[] => text.split(/\r?\n/);

const APP_ENTRY_RE = /^(\s*)(["'])([^"'\\]+)\2(\s*,)?(\s*#.*)?$/;

function refersToApp(value: string, candidates: readonly string[]): boolean {
  return candidates.some((c) => value === c || value.startsWith(`${c}.apps.`));
}

/**
 * Adds the new app next to the reference app inside settings app lists
 * (INSTALLED_APPS, LOCAL_APPS, ...). Only one-entry-per-line lists are edited;
 * anything else is left for the user and reported as a note.
 */
export function planSettingsRegistration(
  text: string,
  refDir: string,
  renamer: Renamer,
  fileLabel: string
): RegistrationResult {
  const result: RegistrationResult = { edits: [], notes: [] };
  if (!/_APPS\b/.test(text)) {
    return result;
  }
  const candidates = moduleCandidates(refDir);
  const lines = splitLines(text);
  lines.forEach((line, i) => {
    const m = APP_ENTRY_RE.exec(line);
    if (!m || !refersToApp(m[3], candidates)) {
      return;
    }
    const renamed = renamer.apply(line).text;
    const newValue = APP_ENTRY_RE.exec(renamed)?.[3];
    if (renamed === line || !newValue) {
      result.notes.push(`${fileLabel}:${i + 1}: could not derive the new app entry from "${line.trim()}".`);
      return;
    }
    if (text.includes(`"${newValue}"`) || text.includes(`'${newValue}'`)) {
      result.notes.push(`${fileLabel}: "${newValue}" is already registered.`);
      return;
    }
    if (m[4]) {
      result.edits.push({ insertAtLine: i + 1, text: renamed, description: `${fileLabel}:${i + 2} add ${newValue}` });
    } else {
      // Reference entry is last and has no comma: insert before it so the
      // list never gains an implicit string concatenation.
      const withComma = renamed.replace(APP_ENTRY_RE, (_s, ind, q, v, _c, cm) => `${ind}${q}${v}${q},${cm ?? ""}`);
      result.edits.push({ insertAtLine: i, text: withComma, description: `${fileLabel}:${i + 1} add ${newValue}` });
    }
  });
  return result;
}

/** True when any settings text lists the app at `appDir` as a one-per-line app entry. */
export function isRegistered(settingsTexts: readonly string[], appDir: string): boolean {
  const candidates = moduleCandidates(appDir);
  return settingsTexts.some(
    (text) => /_APPS\b/.test(text) && splitLines(text).some((line) => {
      const m = APP_ENTRY_RE.exec(line);
      return !!m && refersToApp(m[3], candidates);
    })
  );
}

const INCLUDE_STR_RE = /include\s*\(\s*\(?\s*["']([^"']+)["']/;
const ROUTE_CALL_RE = /\b(?:re_path|path|url)\s*\(/;

/** Line/column where the call opened on `startLine` closes; ignores parens in strings and comments. */
function findCallEnd(lines: readonly string[], startLine: number, startCol: number): { line: number; col: number } | undefined {
  let depth = 0;
  for (let li = startLine; li < lines.length && li < startLine + 40; li++) {
    const line = lines[li];
    let quote = "";
    for (let ci = li === startLine ? startCol : 0; ci < line.length; ci++) {
      const c = line[ci];
      if (quote) {
        if (c === "\\") {
          ci++;
        } else if (c === quote) {
          quote = "";
        }
        continue;
      }
      if (c === "#") {
        break;
      }
      if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "(" || c === "[") {
        depth++;
      } else if (c === ")" || c === "]") {
        depth--;
        if (depth === 0) {
          return { line: li, col: ci };
        }
      }
    }
  }
  return undefined;
}

/**
 * Duplicates the `path(..., include("<ref>.urls"))` entry of a URLconf for the
 * new app, including multi-line entries. Entries sharing a line with other
 * code are reported instead of edited.
 */
export function planUrlsRegistration(text: string, refDir: string, renamer: Renamer, fileLabel: string): RegistrationResult {
  const result: RegistrationResult = { edits: [], notes: [] };
  const candidates = moduleCandidates(refDir);
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const inc = INCLUDE_STR_RE.exec(lines[i].split("#")[0]);
    if (!inc || !candidates.some((c) => inc[1].startsWith(`${c}.`) && inc[1].endsWith("urls"))) {
      continue;
    }
    let start = -1;
    for (let back = i; back >= 0 && back >= i - 5; back--) {
      if (ROUTE_CALL_RE.test(lines[back])) {
        start = back;
        break;
      }
    }
    const callMatch = start >= 0 ? ROUTE_CALL_RE.exec(lines[start]) : null;
    const end = callMatch ? findCallEnd(lines, start, callMatch.index) : undefined;
    const prefix = start >= 0 ? lines[start].slice(0, callMatch!.index) : "";
    const tail = end ? lines[end.line].slice(end.col + 1) : "";
    if (!callMatch || !end || end.line < i || prefix.trim() !== "" || !/^\s*,?\s*(#.*)?$/.test(tail)) {
      result.notes.push(`${fileLabel}:${i + 1}: add the URL include for the new app manually (entry layout not recognised).`);
      continue;
    }
    const block = lines.slice(start, end.line + 1);
    const renamed = block.map((l) => renamer.apply(l).text);
    const newModule = INCLUDE_STR_RE.exec(renamed.join("\n"))?.[1];
    if (!newModule || newModule === inc[1]) {
      result.notes.push(`${fileLabel}:${i + 1}: could not derive the new URL include.`);
    } else if (text.includes(`"${newModule}"`) || text.includes(`'${newModule}'`)) {
      result.notes.push(`${fileLabel}: "${newModule}" is already included.`);
    } else if (/^\s*,/.test(tail)) {
      result.edits.push({ insertAtLine: end.line + 1, text: renamed.join(eolOf(text)), description: `${fileLabel}:${end.line + 2} include ${newModule}` });
    } else {
      // Renaming can shift columns, so locate the closing paren in the renamed block.
      const close = findCallEnd(renamed, 0, ROUTE_CALL_RE.exec(renamed[0])?.index ?? 0) ?? { line: renamed.length - 1, col: renamed[renamed.length - 1].length - 1 };
      const l = renamed[close.line];
      renamed[close.line] = l.slice(0, close.col + 1) + "," + l.slice(close.col + 1);
      result.edits.push({ insertAtLine: start, text: renamed.join(eolOf(text)), description: `${fileLabel}:${start + 1} include ${newModule}` });
    }
    i = end.line;
  }
  return result;
}

/** Applies insertions to text (used by tests and for previews). */
export function applyEdits(text: string, edits: readonly RegistrationEdit[]): string {
  const eol = eolOf(text);
  const lines = splitLines(text);
  const sorted = [...edits].sort((a, b) => b.insertAtLine - a.insertAtLine);
  for (const e of sorted) {
    lines.splice(e.insertAtLine, 0, ...e.text.split(/\r?\n/));
  }
  return lines.join(eol);
}
