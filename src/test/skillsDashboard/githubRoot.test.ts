import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGitHubSkillUrl } from "../../skillsDashboard/skills/githubUrl";
import { fetchSkillFromGitHub, FetchFn } from "../../skillsDashboard/skills/githubFetch";

function encode(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

interface RootMockOptions {
  defaultBranch?: string;
  repoStatus?: number;
  tree: unknown;
  bodies: Record<string, string>;
  truncated?: boolean;
}

/** Serves the Repos API (default branch), the Trees API, and raw files. */
function mockRootTransport(opts: RootMockOptions): { fn: FetchFn; requested: string[]; rawCalls: string[] } {
  const requested: string[] = [];
  const rawCalls: string[] = [];
  const fn: FetchFn = async (url: string) => {
    requested.push(url);
    if (url.includes("/git/trees/")) {
      return {
        ok: true,
        status: 200,
        headers: { get: (_n: string) => null },
        json: async () => ({ tree: opts.tree, ...(opts.truncated === undefined ? {} : { truncated: opts.truncated }) }),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "",
      };
    }
    if (url.startsWith("https://api.github.com/repos/")) {
      const status = opts.repoStatus ?? 200;
      if (status !== 200) {
        return {
          ok: false,
          status,
          headers: { get: (_n: string) => null },
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0),
          text: async () => "not found",
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (_n: string) => null },
        json: async () => ({ default_branch: opts.defaultBranch ?? "main" }),
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
      arrayBuffer: async () => encode(opts.bodies[leaf] ?? ""),
      text: async () => opts.bodies[leaf] ?? "",
    };
  };
  return { fn, requested, rawCalls };
}

describe("repository-root skill URLs", () => {
  it("parses a bare repository URL as a root import with omitted branch", () => {
    const p = parseGitHubSkillUrl("https://github.com/awesome-skills/code-review");
    assert.equal(p.owner, "awesome-skills");
    assert.equal(p.repo, "code-review");
    assert.equal(p.ref, "");
    assert.equal(p.skillPath, "");
    assert.equal(p.skillFile, "SKILL.md");
    assert.equal(p.skillName, "code-review");
  });

  it("parses a bare repository URL with a trailing slash", () => {
    const p = parseGitHubSkillUrl("https://github.com/o/r/");
    assert.equal(p.skillPath, "");
    assert.equal(p.ref, "");
    assert.equal(p.skillName, "r");
  });

  it("parses /tree/BRANCH with no folder path as a pinned root import", () => {
    const p = parseGitHubSkillUrl("https://github.com/o/r/tree/develop");
    assert.equal(p.ref, "develop");
    assert.equal(p.skillPath, "");
    assert.equal(p.skillFile, "SKILL.md");
    assert.equal(p.skillName, "r");
  });

  it("parses blob/raw SKILL.md URLs at the repository root", () => {
    const blob = parseGitHubSkillUrl("https://github.com/o/r/blob/main/SKILL.md");
    assert.equal(blob.skillPath, "");
    assert.equal(blob.skillFile, "SKILL.md");
    assert.equal(blob.skillName, "r");
    assert.equal(blob.kind, "blob");
    const raw = parseGitHubSkillUrl("https://github.com/o/r/raw/main/SKILL.md");
    assert.equal(raw.skillPath, "");
    assert.equal(raw.skillFile, "SKILL.md");
    const cdn = parseGitHubSkillUrl("https://raw.githubusercontent.com/o/r/main/SKILL.md");
    assert.equal(cdn.skillPath, "");
    assert.equal(cdn.skillFile, "SKILL.md");
    assert.equal(cdn.skillName, "r");
  });

  it("resolves the default branch for bare URLs and imports root SKILL.md", async () => {
    const tree = [
      { path: "SKILL.md", mode: "100644", type: "blob", size: 8 },
      { path: "README.md", mode: "100644", type: "blob", size: 6 },
      { path: "scripts/run.sh", mode: "100755", type: "blob", size: 4 },
    ];
    const { fn, requested, rawCalls } = mockRootTransport({
      defaultBranch: "main",
      tree,
      bodies: { "SKILL.md": "# Root", "README.md": "docs", "run.sh": "echo hi" },
    });
    const fetched = await fetchSkillFromGitHub("https://github.com/o/r", fn);
    assert.equal(fetched.parsed.ref, "main");
    assert.equal(fetched.parsed.skillPath, "");
    assert.deepEqual(
      fetched.files.map((f) => f.path),
      ["README.md", "SKILL.md", "scripts/run.sh"]
    );
    assert.ok(requested.includes("https://api.github.com/repos/o/r"), "must resolve default branch via Repos API");
    assert.ok(rawCalls.every((u) => u.startsWith("https://raw.githubusercontent.com/o/r/main/")));
    assert.ok(rawCalls.every((u) => !u.includes("//SKILL.md") && !u.includes("/main//")));
  });

  it("uses the pinned branch for /tree/BRANCH root URLs without a Repos API call", async () => {
    const tree = [{ path: "SKILL.md", mode: "100644", type: "blob", size: 8 }];
    const { fn, requested } = mockRootTransport({ tree, bodies: { "SKILL.md": "# Root" } });
    const fetched = await fetchSkillFromGitHub("https://github.com/o/r/tree/develop", fn);
    assert.equal(fetched.parsed.ref, "develop");
    assert.deepEqual(fetched.files.map((f) => f.path), ["SKILL.md"]);
    assert.ok(requested.every((u) => !/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(u)));
  });

  it("reports a collection (not a silent choice) when root SKILL.md is missing, before raw fetches", async () => {
    const tree = [
      { path: "skills/alpha/SKILL.md", mode: "100644", type: "blob", size: 8 },
      { path: "skills/beta/SKILL.md", mode: "100644", type: "blob", size: 8 },
    ];
    const { fn, rawCalls } = mockRootTransport({
      tree,
      bodies: { "SKILL.md": "# Alpha" },
    });
    await assert.rejects(fetchSkillFromGitHub("https://github.com/o/r", fn), /collection of skills/);
    await assert.rejects(
      fetchSkillFromGitHub("https://github.com/o/r/tree/main", fn),
      /paste the URL of the skill folder/
    );
    assert.equal(rawCalls.length, 0);
  });

  it("refuses a symlinked root SKILL.md before any raw request, and skips symlink assets", async () => {
    const linked = [{ path: "SKILL.md", mode: "120000", type: "blob", size: 10 }];
    const t1 = mockRootTransport({ tree: linked, bodies: { "SKILL.md": "# x" } });
    await assert.rejects(fetchSkillFromGitHub("https://github.com/o/r", t1.fn), /symlink/i);
    assert.equal(t1.rawCalls.length, 0);

    const mixed = [
      { path: "SKILL.md", mode: "100644", type: "blob", size: 8 },
      { path: "evil-link", mode: "120000", type: "blob", size: 11 },
      { path: "ok.md", mode: "100644", type: "blob", size: 4 },
    ];
    const t2 = mockRootTransport({ tree: mixed, bodies: { "SKILL.md": "# Root", "ok.md": "ok" } });
    const fetched = await fetchSkillFromGitHub("https://github.com/o/r", t2.fn);
    assert.deepEqual(fetched.files.map((f) => f.path), ["SKILL.md", "ok.md"]);
    assert.deepEqual(fetched.skippedSymlinks, ["evil-link"]);
  });

  it("surfaces repository lookup failures for bare URLs", async () => {
    const { fn } = mockRootTransport({ repoStatus: 404, tree: [], bodies: {} });
    await assert.rejects(fetchSkillFromGitHub("https://github.com/o/missing", fn), /Not found/);
  });
});
