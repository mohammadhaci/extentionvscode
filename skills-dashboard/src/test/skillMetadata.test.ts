import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSkillFrontmatter, parseSkillMetadata, firstMarkdownParagraph } from "../skills/skillMetadata";

describe("skillMetadata", () => {
  it("parses frontmatter fields", () => {
    const fm = parseSkillFrontmatter('---\nname: pdf-skill\ndescription: "Extract text"\nversion: 1.2.0\n---\n# Hello\n');
    assert.equal(fm.name, "pdf-skill");
    assert.equal(fm.description, "Extract text");
    assert.equal(fm.version, "1.2.0");
  });

  it("returns empty frontmatter without delimiter", () => {
    const fm = parseSkillFrontmatter("# Just markdown\nSome text\n");
    assert.equal(fm.name, undefined);
    assert.equal(fm.description, undefined);
  });

  it("ignores comments and keeps unknown keys in extra", () => {
    const fm = parseSkillFrontmatter("---\n# comment\ncustom-key: value\nname: x\n---\n");
    assert.equal(fm.name, "x");
    assert.equal(fm.extra["custom-key"], "value");
  });

  it("falls back to directory name and first paragraph", () => {
    const meta = parseSkillMetadata("my-skill", "# My Skill\n\nDoes useful things here.\n");
    assert.equal(meta.name, "my-skill");
    assert.ok(meta.description.includes("Does useful things"));
  });

  it("prefers frontmatter description over body", () => {
    const meta = parseSkillMetadata("dir", "---\ndescription: Front wins\n---\n\nBody text.\n");
    assert.equal(meta.description, "Front wins");
  });

  it("skips headings and code fences for paragraph fallback", () => {
    const text = "# Title\n```\ncode\n```\n\nReal description here.\n";
    assert.equal(firstMarkdownParagraph(text), "Real description here.");
  });

  it("handles non-string input safely", () => {
    const meta = parseSkillMetadata("dir", undefined);
    assert.equal(meta.name, "dir");
    assert.equal(meta.description, "");
  });
});
