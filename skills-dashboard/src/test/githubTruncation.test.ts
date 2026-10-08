import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchSkillFromGitHub } from "../skills/githubFetch";
import { DEMO_URL as URL, mockTransport } from "./mockGitHub";

describe("github truncated tree listing", () => {
  it("refuses the import before any raw file request when truncated", async () => {
    const tree = [
      { path: "skills/demo/SKILL.md", mode: "100644", type: "blob", size: 8 },
      { path: "skills/demo/notes.md", mode: "100644", type: "blob", size: 5 },
    ];
    const { fn, rawCalls } = mockTransport(tree, { "SKILL.md": "# Demo" }, { truncated: true });
    await assert.rejects(fetchSkillFromGitHub(URL, fn), /truncated/i);
    assert.equal(rawCalls.length, 0);
  });

  it("still imports a complete (non-truncated) listing", async () => {
    const tree = [{ path: "skills/demo/SKILL.md", mode: "100644", type: "blob", size: 8 }];
    const { fn, rawCalls } = mockTransport(tree, { "SKILL.md": "# Demo" }, { truncated: false });
    const fetched = await fetchSkillFromGitHub(URL, fn);
    assert.deepEqual(fetched.files.map((f) => f.path), ["SKILL.md"]);
    assert.equal(rawCalls.length, 1);
  });
});
