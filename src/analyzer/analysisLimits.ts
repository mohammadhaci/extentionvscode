import type { AnalysisWarning } from "../shared/graphTypes";

/** Safety caps for the workspace scan. Values are the analyzer limits. */
export const MAX_PY_FILES = 500;
export const MAX_FILE_BYTES = 256 * 1024;

/**
 * `findFiles` truncates silently at `maxFiles`, so reaching the cap means
 * results may be partial. Returns a warning when `foundCount >= maxFiles`.
 */
export function fileCountCapWarning(
  foundCount: number,
  maxFiles: number = MAX_PY_FILES
): AnalysisWarning | undefined {
  if (foundCount < maxFiles) {
    return undefined;
  }
  return {
    message:
      `Scanned first ${maxFiles} Python files (workspace hits the ${maxFiles}-file scan cap); ` +
      `results may be partial. Narrow the folder excludes or split the workspace.`
  };
}

/** True when a file exceeds the per-file read cap. */
export function isOversizedFile(sizeBytes: number, maxBytes: number = MAX_FILE_BYTES): boolean {
  return sizeBytes > maxBytes;
}

/** Warning matching the analyzer's large-file skip message. */
export function largeFileWarning(
  file: string,
  sizeBytes: number,
  maxBytes: number = MAX_FILE_BYTES
): AnalysisWarning | undefined {
  if (!isOversizedFile(sizeBytes, maxBytes)) {
    return undefined;
  }
  return {
    message: `Skipped large file ${file} (${Math.round(sizeBytes / 1024)} KB > ${Math.round(maxBytes / 1024)} KB cap).`,
    file
  };
}
