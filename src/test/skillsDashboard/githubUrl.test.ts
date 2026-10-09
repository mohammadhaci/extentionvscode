import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGitHubSkillUrl } from "../../skillsDashboard/skills/githubUrl";

describe("parseGitHubSkillUrl", () => {
  it("parses tree folder URLs", () => {
    const p = parseGitHubSkillUrl("https://github.com/anthropics/skills/tree/main/skills/pdf");
    assert.equal(p.owner, "anthropics");
    assert.equal(p.repo, "skills");
    assert.equal(p.ref, "main");
    assert.equal(p.skillPath, "skills/pdf");
    assert.equal(p.skillFile, "skills/pdf/SKILL.md");
    assert.equal(p.skillName, "pdf");
    assert.equal(p.kind, "tree");
  });

  it("parses blob SKILL.md URLs to parent folder", () => {
    const p = parseGitHubSkillUrl("https://github.com/owner/repo/blob/main/path/to/my-skill/SKILL.md");
    assert.equal(p.skillPath, "path/to/my-skill");
    assert.equal(p.skillName, "my-skill");
    assert.equal(p.kind, "blob");
  });

  it("parses raw github URLs", () => {
    const p = parseGitHubSkillUrl("https://github.com/o/r/raw/v1/a/SKILL.md");
    assert.equal(p.skillPath, "a");
    assert.equal(p.skillName, "a");
  });

  it("parses raw.githubusercontent URLs", () => {
    const p = parseGitHubSkillUrl("https://raw.githubusercontent.com/o/r/main/a/b/SKILL.md");
    assert.equal(p.skillPath, "a/b");
    assert.equal(p.skillName, "b");
    assert.equal(p.kind, "raw");
  });

  it("neutralizes dot-dot segments via URL normalization (contained, never escapes)", () => {
    // WHATWG URL parsing resolves ".." (even percent-encoded) before we see it,
    // so traversal collapses inside the repo path instead of escaping it.
    const collapsed = parseGitHubSkillUrl("https://github.com/o/r/tree/main/a/../evil");
    assert.equal(collapsed.skillPath, "evil");
    const encoded = parseGitHubSkillUrl("https://github.com/o/r/tree/main/a/%2e%2e/evil");
    assert.equal(encoded.skillPath, "evil");
  });

  it("rejects encoded slashes inside a segment", () => {
    assert.throws(() => parseGitHubSkillUrl("https://github.com/o/r/tree/main/a%2Fb/c"), /Invalid/);
  });

  it("rejects non-github hosts and http", () => {
    assert.throws(() => parseGitHubSkillUrl("https://gitlab.com/o/r/tree/main/a"), /Only github/);
    assert.throws(() => parseGitHubSkillUrl("http://github.com/o/r/tree/main/a"), /Only https/);
  });

  it("rejects blob URLs not pointing at SKILL.md", () => {
    assert.throws(() => parseGitHubSkillUrl("https://github.com/o/r/blob/main/a/README.md"), /SKILL\.md/);
  });

  it("rejects malformed input", () => {
    assert.throws(() => parseGitHubSkillUrl(""), /empty/);
    assert.throws(() => parseGitHubSkillUrl(42 as unknown as string), /string/);
    assert.throws(() => parseGitHubSkillUrl("not a url"), /valid URL/);
  });
});
