/** SKILL.md frontmatter + metadata parsing (pure, unit-tested). */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  license?: string;
  tools?: string;
  extra: Record<string, string>;
}

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  frontmatter: SkillFrontmatter;
}

export const MAX_SKILL_MD_BYTES = 256 * 1024;
const MAX_FRONTMATTER_BYTES = 8 * 1024;
const MAX_DESC_CHARS = 240;

export function parseSkillFrontmatter(markdown: unknown): SkillFrontmatter {
  const extra: Record<string, string> = {};
  const out: SkillFrontmatter = { extra };
  if (typeof markdown !== "string" || markdown.length === 0) {
    return out;
  }
  if (markdown.length > MAX_SKILL_MD_BYTES) {
    return out;
  }
  if (!markdown.startsWith("---")) {
    return out;
  }
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) {
    return out;
  }
  const block = markdown.slice(3, end);
  if (block.length > MAX_FRONTMATTER_BYTES) {
    return out;
  }
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    let value = line.slice(colon + 1).trim();
    if (value.length > 500) {
      value = value.slice(0, 500);
    }
    // Strip single pair of matching quotes.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (!/^[a-z0-9_-]{1,40}$/.test(key)) {
      continue;
    }
    if (key === "name" || key === "description" || key === "version" || key === "license" || key === "tools") {
      (out as unknown as Record<string, string>)[key] = value;
    } else {
      extra[key] = value;
    }
  }
  return out;
}

/** First meaningful markdown text: skip headings, code fences, blanks. */
export function firstMarkdownParagraph(markdown: string, maxChars = MAX_DESC_CHARS): string {
  let inFence = false;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (line === "" || line.startsWith("#") || line.startsWith("---") || line.startsWith(">")) {
      continue;
    }
    const cleaned = line.replace(/[*_`[\]()!<>]/g, "").trim();
    if (cleaned === "") {
      continue;
    }
    return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
  }
  return "";
}

export function parseSkillMetadata(skillDirName: string, markdown: unknown): SkillMetadata {
  const fallback = typeof skillDirName === "string" && skillDirName !== "" ? skillDirName : "skill";
  const frontmatter = parseSkillFrontmatter(markdown);
  const text = typeof markdown === "string" ? markdown : "";
  // Strip frontmatter block for paragraph fallback.
  let body = text;
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---");
    if (end !== -1) {
      body = text.slice(end + 4);
    }
  }
  const name = (frontmatter.name ?? "").trim() !== "" ? (frontmatter.name as string).trim().slice(0, 64) : fallback;
  let description = (frontmatter.description ?? "").trim();
  if (description === "") {
    description = firstMarkdownParagraph(body);
  }
  if (description.length > MAX_DESC_CHARS) {
    description = description.slice(0, MAX_DESC_CHARS);
  }
  const version = (frontmatter.version ?? "").trim() !== "" ? (frontmatter.version as string).trim().slice(0, 32) : undefined;
  return { name, description, version, frontmatter };
}

export interface ResolvedSkillPreview {
  text: string;
  oversized: boolean;
}

/**
 * Pure size gate for SKILL.md previews (stat-before-read decision).
 *
 * - `statSize` is the pre-read stat size, or null when the stat failed.
 * - `bytes` are the post-read contents, or null when the read failed.
 * - Oversized files are never decoded: returns empty text with
 *   `oversized: true` so callers show an honest status instead of a preview.
 * - A post-read length recheck covers the stat/read race (file grew between
 *   stat and read): behavior stays correct even though the bytes were loaded.
 */
export function resolveSkillPreviewText(statSize: number | null, bytes: Uint8Array | null): ResolvedSkillPreview {
  if (typeof statSize === "number" && Number.isFinite(statSize) && statSize > MAX_SKILL_MD_BYTES) {
    return { text: "", oversized: true };
  }
  if (bytes === null) {
    return { text: "", oversized: false };
  }
  if (bytes.length > MAX_SKILL_MD_BYTES) {
    return { text: "", oversized: true };
  }
  return { text: Buffer.from(bytes).toString("utf8"), oversized: false };
}
