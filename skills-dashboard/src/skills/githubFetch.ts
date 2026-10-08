/**
 * GitHub skill fetching with injectable transport (no `vscode` import, so
 * `fetchSkillFromGitHub` is unit-testable with a mocked FetchFn).
 */
import { parseGitHubSkillUrl, toApiTreeUrl, toRawUrl, ParsedSkillUrl } from "./githubUrl";
import { selectImportFiles } from "./githubTree";
import { MAX_SKILL_MD_BYTES } from "./skillMetadata";

export const MAX_IMPORT_TOTAL_BYTES = 2 * 1024 * 1024;

/** Per-request network bound: no single Trees API or raw fetch may pend longer. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface FetchedSkillFile {
  path: string; // relative to skill folder
  bytes: Uint8Array;
}

export interface FetchedSkill {
  parsed: ParsedSkillUrl;
  files: FetchedSkillFile[];
  totalBytes: number;
  /** Tree entries skipped because they are symlinks (mode 120000). Never fetched. */
  skippedSymlinks: string[];
}

export type FetchFn = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

function defaultFetch(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): ReturnType<FetchFn> {
  return fetch(url, { headers: init?.headers, signal: init?.signal }) as unknown as ReturnType<FetchFn>;
}

function githubError(status: number, headers: { get(n: string): string | null }, body: string): Error {
  const remaining = headers.get("x-ratelimit-remaining");
  if (status === 404) {
    return new Error("Not found on GitHub. Check the repository, branch, and skill path.");
  }
  if (status === 403 && remaining === "0") {
    const reset = headers.get("x-ratelimit-reset");
    const when = reset ? ` (resets ${new Date(Number(reset) * 1000).toISOString()})` : "";
    return new Error(`GitHub rate limit exceeded${when}. Try again later.`);
  }
  if (status === 403) {
    return new Error("GitHub refused the request (403). The repository may be private or rate-limited.");
  }
  if (status >= 500) {
    return new Error(`GitHub server error (${status}). Try again later.`);
  }
  return new Error(`GitHub request failed (${status}): ${body.slice(0, 200)}`);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function resolveTimeout(timeoutMs: number | undefined): number {
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

/** Rejects unless the wrapped promise settles first; the timer is always cleared. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * One bounded request: the transport gets an AbortSignal fired at the
 * deadline (real sockets are actually aborted); transports that ignore the
 * signal are still cut off by mapping an abort-coincident failure to a
 * timeout error. The timer is always cleared.
 */
async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: { headers?: Record<string, string> },
  timeoutMs: number
): Promise<Awaited<ReturnType<FetchFn>>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`GitHub request timed out after ${timeoutMs} ms.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch all files under the skill folder (bounded, traversal-safe, SKILL.md required). */
export async function fetchSkillFromGitHub(
  url: string,
  fetchFn: FetchFn = defaultFetch,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<FetchedSkill> {
  const parsed = parseGitHubSkillUrl(url);
  const timeout = resolveTimeout(timeoutMs);
  const timedOut = `GitHub request timed out after ${timeout} ms.`;

  // 1) Single bounded Trees API request, then mode-aware selection.
  let treeJson: unknown;
  try {
    const res = await fetchWithTimeout(fetchFn, toApiTreeUrl(parsed), { headers: { Accept: "application/vnd.github+json", "User-Agent": "skills-dashboard-vscode" } }, timeout);
    if (!res.ok) {
      throw githubError(res.status, res.headers, await withTimeout(res.text(), timeout, timedOut).catch(() => ""));
    }
    treeJson = await withTimeout(res.json(), timeout, timedOut);
  } catch (e) {
    const msg = errorMessage(e);
    if (msg.startsWith("GitHub") || msg.startsWith("Not found") || msg.startsWith("Refusing import")) {
      throw e;
    }
    throw new Error(`Network error contacting GitHub: ${msg}`);
  }
  const envelope = treeJson as { tree?: unknown; truncated?: unknown };
  if (envelope.truncated === true) {
    throw new Error("GitHub truncated the file listing for this repository; import refused because the skill may be incomplete.");
  }
  const tree = envelope.tree;
  // Throws on symlink SKILL.md, before any raw request below.
  const { wanted, skippedSymlinks } = selectImportFiles(tree, parsed);

  // 2) Bounded raw fetches (sequential to bound load).
  const files: FetchedSkillFile[] = [];
  let total = 0;
  for (const rel of wanted) {
    const rawUrl = toRawUrl(parsed, `${parsed.skillPath}/${rel}`);
    let res;
    try {
      res = await fetchWithTimeout(fetchFn, rawUrl, { headers: { "User-Agent": "skills-dashboard-vscode" } }, timeout);
    } catch (e) {
      throw new Error(`Network error fetching ${rel}: ${errorMessage(e)}`);
    }
    if (!res.ok) {
      throw githubError(res.status, res.headers, await withTimeout(res.text(), timeout, timedOut).catch(() => ""));
    }
    const buf = new Uint8Array(await withTimeout(res.arrayBuffer(), timeout, timedOut));
    if (buf.length > MAX_SKILL_MD_BYTES) {
      throw new Error(`File ${rel} exceeds the 256 KB per-file limit.`);
    }
    total += buf.length;
    if (total > MAX_IMPORT_TOTAL_BYTES) {
      throw new Error("Skill exceeds the 2 MB total import size limit.");
    }
    files.push({ path: rel, bytes: buf });
  }
  // Validate SKILL.md is non-empty text.
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (!skillMd || skillMd.bytes.length === 0) {
    throw new Error("SKILL.md is empty.");
  }
  return { parsed, files, totalBytes: total, skippedSymlinks };
}
