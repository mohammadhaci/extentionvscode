import { splitWords, variant, VARIANT_STYLES } from "./names";

export interface RenamePair {
  from: string;
  to: string;
}

export interface Renamer {
  pairs: readonly RenamePair[];
  /** Replaces every identifier-bounded occurrence; returns the new text and replacement count. */
  apply(text: string): { text: string; count: number };
}

function pairsFor(fromName: string, toName: string): RenamePair[] {
  const fromWords = splitWords(fromName);
  const toWords = splitWords(toName);
  if (fromWords.length === 0 || toWords.length === 0) {
    return [];
  }
  return VARIANT_STYLES.map((s) => ({ from: variant(fromWords, s), to: variant(toWords, s) }));
}

/**
 * Builds the rename table: every case variant of the app name, then of the
 * singular entity name. The first mapping for a given source string wins and
 * identical source/target pairs are dropped.
 */
export function buildRenamePairs(
  refApp: string,
  newApp: string,
  refEntity?: string,
  newEntity?: string
): RenamePair[] {
  const all = [...pairsFor(refApp, newApp)];
  if (refEntity && newEntity) {
    all.push(...pairsFor(refEntity, newEntity));
  }
  const seen = new Map<string, RenamePair>();
  for (const p of all) {
    if (p.from && p.from !== p.to && !seen.has(p.from)) {
      seen.set(p.from, p);
    }
  }
  return [...seen.values()].sort((a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from));
}

const isLower = (c: string): boolean => c >= "a" && c <= "z";
const isUpper = (c: string): boolean => c >= "A" && c <= "Z";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isAlnum = (c: string): boolean => isLower(c) || isUpper(c) || isDigit(c);

/**
 * A match counts only on identifier boundaries, so "order" never rewrites
 * "border" or "ordering", while camel/Pascal joins ("OrderItem",
 * "createOrder") and separators ("order_id", "orders/") still match.
 */
function onBoundary(text: string, start: number, token: string): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = start + token.length < text.length ? text[start + token.length] : "";
  const leftOk = !before || !isAlnum(before) || (isUpper(token[0]) && (isLower(before) || isDigit(before)));
  const tokenIsUpperWord = token === token.toUpperCase();
  const rightOk = !after || !isAlnum(after) || (isUpper(after) && !tokenIsUpperWord);
  return leftOk && rightOk;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createRenamer(pairs: readonly RenamePair[]): Renamer {
  const map = new Map(pairs.map((p) => [p.from, p.to]));
  // Longest first so "orders" wins over "order" at the same position.
  const sources = [...map.keys()].sort((a, b) => b.length - a.length);
  const re = sources.length > 0 ? new RegExp(sources.map(escapeRe).join("|"), "g") : undefined;
  return {
    pairs,
    apply(text: string) {
      if (!re) {
        return { text, count: 0 };
      }
      let count = 0;
      const out = text.replace(re, (match: string, offset: number) => {
        if (!onBoundary(text, offset, match)) {
          return match;
        }
        count++;
        return map.get(match) ?? match;
      });
      return { text: out, count };
    },
  };
}
