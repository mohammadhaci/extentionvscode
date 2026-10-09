import { Renamer } from "./rename";

export interface SourceFile {
  /** Path relative to the reference app folder, "/"-separated. */
  relPath: string;
  bytes: Uint8Array;
}

export interface PlannedFile {
  sourceRel: string;
  /** Path relative to the new app folder. */
  targetRel: string;
  bytes: Uint8Array;
  replacements: number;
  binary: boolean;
}

export interface FilePlan {
  files: PlannedFile[];
  skipped: string[];
  errors: string[];
}

/** Always skipped: caches, compiled files, and every migration except the package marker. */
const BUILTIN_EXCLUDES = ["**/__pycache__/**", "**/*.pyc", "**/*.pyo", "**/.DS_Store", "migrations/**", "**/migrations/**"];
const ALWAYS_KEEP = new Set(["migrations/__init__.py"]);

/** Minimal glob: `**` spans folders, `*` and `?` stay inside one segment. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function isExcluded(relPath: string, extraExcludes: readonly string[] = []): boolean {
  if (ALWAYS_KEEP.has(relPath)) {
    return false;
  }
  return [...BUILTIN_EXCLUDES, ...extraExcludes].some((g) => globToRegExp(g).test(relPath));
}

/** UTF-8 text without NUL bytes is renamed; anything else is copied byte for byte. */
export function decodeText(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

export function planFiles(sources: readonly SourceFile[], renamer: Renamer, extraExcludes: readonly string[] = []): FilePlan {
  const files: PlannedFile[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const byTarget = new Map<string, string>();
  for (const src of sources) {
    if (isExcluded(src.relPath, extraExcludes)) {
      skipped.push(src.relPath);
      continue;
    }
    const target = renamer.apply(src.relPath);
    const clash = byTarget.get(target.text);
    if (clash !== undefined) {
      errors.push(`"${src.relPath}" and "${clash}" would both be written to "${target.text}".`);
      continue;
    }
    byTarget.set(target.text, src.relPath);
    const text = decodeText(src.bytes);
    if (text === undefined) {
      files.push({ sourceRel: src.relPath, targetRel: target.text, bytes: src.bytes, replacements: target.count, binary: true });
      continue;
    }
    const renamed = renamer.apply(text);
    files.push({
      sourceRel: src.relPath,
      targetRel: target.text,
      bytes: new TextEncoder().encode(renamed.text),
      replacements: renamed.count + target.count,
      binary: false,
    });
  }
  files.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
  return { files, skipped, errors };
}
