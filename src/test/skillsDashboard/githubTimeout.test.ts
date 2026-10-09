import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchSkillFromGitHub, FetchFn } from "../../skillsDashboard/skills/githubFetch";
import { DEMO_URL as URL, mockTransport } from "./mockGitHub";

/** Hangs forever unless the abort signal fires, then rejects. */
function hangingFetch(): { fn: FetchFn; abortSeen: () => boolean } {
  let seen = false;
  const fn: FetchFn = (_url: string, init?: { signal?: AbortSignal }) => {
    const signal = init?.signal;
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        seen = true;
        reject(new Error("already aborted"));
        return;
      }
      signal?.addEventListener(
        "abort",
        () => {
          seen = true;
          reject(new Error("fetch aborted"));
        },
        { once: true }
      );
      // Never resolves on its own.
    });
  };
  return { fn, abortSeen: () => seen };
}

describe("github request timeout", () => {
  it("rejects a hanging Trees request in bounded time and fires abort", async () => {
    const { fn, abortSeen } = hangingFetch();
    const start = Date.now();
    await assert.rejects(fetchSkillFromGitHub(URL, fn, 25), /timed out/i);
    assert.ok(Date.now() - start < 5000, "must reject quickly, not hang");
    assert.equal(abortSeen(), true);
  });

  it("rejects a stalled response body in bounded time", async () => {
    const tree = [{ path: "skills/demo/SKILL.md", mode: "100644", type: "blob", size: 8 }];
    const { fn: base } = mockTransport(tree, { "SKILL.md": "# Demo" });
    const stalled: FetchFn = async (url: string, init?: { signal?: AbortSignal }) => {
      const res = await base(url, init);
      if (!url.includes("api.github.com")) {
        return { ...res, arrayBuffer: () => new Promise<ArrayBuffer>(() => undefined) };
      }
      return res;
    };
    const start = Date.now();
    await assert.rejects(fetchSkillFromGitHub(URL, stalled, 25), /timed out/i);
    assert.ok(Date.now() - start < 5000, "must reject quickly, not hang");
  });
});
