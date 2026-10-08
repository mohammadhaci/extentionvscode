import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchSkillFromGitHub } from "../skills/githubFetch";
import { isSymlinkMode } from "../skills/githubTree";
import { DEMO_URL as URL, mockTransport } from "./mockGitHub";

describe("github symlink import guard", () => {
  it("recognizes the Trees API symlink mode (string and numeric)", () => {
    assert.equal(isSymlinkMode("120000"), true);
    assert.equal(isSymlinkMode(120000), true);
    assert.equal(isSymlinkMode("100644"), false);
    assert.equal(isSymlinkMode("100755"), false);
    assert.equal(isSymlinkMode("040000"), false);
    assert.equal(isSymlinkMode(undefined), false);
  });

  it("rejects a symlink SKILL.md before any raw file request", async () => {
    const tree = [
      { path: "skills/demo/SKILL.md", mode: "120000", type: "blob", size: 24 },
      { path: "skills/demo/notes.md", mode: "100644", type: "blob", size: 5 },
    ];
    const { fn, rawCalls } = mockTransport(tree, { "SKILL.md": "# x", "notes.md": "hi" });
    await assert.rejects(fetchSkillFromGitHub(URL, fn), /symlink/i);
    assert.equal(rawCalls.length, 0);
  });

  it("does not follow symlink assets, imports the rest", async () => {
    const tree = [
      { path: "skills/demo/SKILL.md", mode: "100644", type: "blob", size: 8 },
      { path: "skills/demo/evil-link", mode: "120000", type: "blob", size: 11 },
      { path: "skills/demo/ok.md", mode: "100644", type: "blob", size: 4 },
    ];
    const { fn, rawCalls } = mockTransport(tree, { "SKILL.md": "# Demo", "ok.md": "ok" });
    const fetched = await fetchSkillFromGitHub(URL, fn);
    assert.deepEqual(fetched.files.map((f) => f.path), ["SKILL.md", "ok.md"]);
    assert.deepEqual(fetched.skippedSymlinks, ["evil-link"]);
    assert.equal(rawCalls.length, 2);
    assert.ok(rawCalls.every((u) => !u.endsWith("/evil-link")));
  });
});
