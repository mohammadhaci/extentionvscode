/** Shared mocked GitHub transport for importer tests (no network, no VS Code API). */
import type { FetchFn } from "../skills/githubFetch";

export const DEMO_URL = "https://github.com/o/r/tree/main/skills/demo";

function encode(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

/**
 * Serves one Trees API envelope and records every raw request.
 * Pass `envelope` for extra top-level fields (e.g. `{ truncated: true }`).
 */
export function mockTransport(
  tree: unknown,
  bodies: Record<string, string>,
  envelope?: Record<string, unknown>
): { fn: FetchFn; rawCalls: string[] } {
  const rawCalls: string[] = [];
  const fn: FetchFn = async (url: string) => {
    if (url.includes("api.github.com")) {
      return {
        ok: true,
        status: 200,
        headers: { get: (_n: string) => null },
        json: async () => ({ tree, ...envelope }),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "",
      };
    }
    rawCalls.push(url);
    const leaf = url.split("/").pop() ?? "";
    return {
      ok: true,
      status: 200,
      headers: { get: (_n: string) => null },
      json: async () => ({}),
      arrayBuffer: async () => encode(bodies[leaf] ?? ""),
      text: async () => bodies[leaf] ?? "",
    };
  };
  return { fn, rawCalls };
}
