// Pure: places the generated block inside an instructions file without touching
// anything outside the markers.
import { BLOCK_END, BLOCK_START } from "./render";

/**
 * Returns `existing` with the managed block inserted or replaced.
 * - no file: the block alone
 * - markers present: only the text between them (inclusive) is replaced
 * - no markers: the block goes right after a leading `# Title`, else at the top
 * Throws when the markers are unbalanced, rather than guessing.
 */
export function upsertBlock(existing: string | undefined, block: string): string {
  if (existing === undefined || existing.trim() === "") {
    return block + "\n";
  }
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const native = block.split("\n").join(eol);
  const start = existing.indexOf(BLOCK_START);
  const end = existing.indexOf(BLOCK_END);
  const starts = existing.split(BLOCK_START).length - 1;
  const ends = existing.split(BLOCK_END).length - 1;
  if (starts > 1 || ends > 1 || (start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error("agent-context markers are missing, duplicated or out of order; fix them by hand.");
  }
  if (start !== -1) {
    return existing.slice(0, start) + native + existing.slice(end + BLOCK_END.length);
  }
  const title = /^# [^\r\n]*\r?\n/.exec(existing);
  if (title) {
    const rest = existing.slice(title[0].length).replace(/^(\r?\n)+/, "");
    return title[0] + eol + native + eol + eol + rest;
  }
  return native + eol + eol + existing;
}
