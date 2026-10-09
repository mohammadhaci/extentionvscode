import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSafePosixRelativePath,
  isSafeSkillName,
  normalizeSkillRoot,
  resolveSkillRoots,
  isWithinSkillDir,
  isImmediateChildOfRoot,
  DEFAULT_SKILL_ROOTS,
} from "../../skillsDashboard/skills/pathSafety";

describe("pathSafety", () => {
  it("accepts default roots", () => {
    for (const r of DEFAULT_SKILL_ROOTS) {
      assert.equal(isSafePosixRelativePath(r), true, r);
    }
    assert.equal(DEFAULT_SKILL_ROOTS.length, 7);
  });

  it("rejects escapes and absolute paths", () => {
    assert.equal(isSafePosixRelativePath("../evil"), false);
    assert.equal(isSafePosixRelativePath("/abs"), false);
    assert.equal(isSafePosixRelativePath("C:/win"), false);
    assert.equal(isSafePosixRelativePath("a//b"), false);
    assert.equal(isSafePosixRelativePath("a/./b"), false);
    assert.equal(isSafePosixRelativePath("a\\b"), false);
    assert.equal(isSafePosixRelativePath(""), false);
  });

  it("validates skill names", () => {
    assert.equal(isSafeSkillName("my-skill_1.2"), true);
    assert.equal(isSafeSkillName("../evil"), false);
    assert.equal(isSafeSkillName("a/b"), false);
    assert.equal(isSafeSkillName(""), false);
    assert.equal(isSafeSkillName("-lead"), false);
  });

  it("normalizes custom roots and rejects escapes", () => {
    assert.equal(normalizeSkillRoot(".claude/skills"), ".claude/skills");
    assert.equal(normalizeSkillRoot("./.agents/skills/"), ".agents/skills");
    assert.equal(normalizeSkillRoot("../outside"), null);
    assert.equal(normalizeSkillRoot("/abs"), null);
    assert.equal(normalizeSkillRoot(""), null);
    assert.equal(normalizeSkillRoot("a/../../b"), null);
  });

  it("resolveSkillRoots falls back when empty and reports rejected", () => {
    const r = resolveSkillRoots([".claude/skills", "../evil", 42]);
    assert.deepEqual(r.roots, [".claude/skills"]);
    assert.equal(r.rejected.length, 2);
    const empty = resolveSkillRoots([]);
    assert.deepEqual(empty.roots, DEFAULT_SKILL_ROOTS);
  });

  it("checks skill-dir confinement", () => {
    assert.equal(isWithinSkillDir(".claude/skills/a/SKILL.md", ".claude/skills/a"), true);
    assert.equal(isWithinSkillDir(".claude/skills/a", ".claude/skills/a"), true);
    assert.equal(isWithinSkillDir(".claude/skills/b", ".claude/skills/a"), false);
    assert.equal(isWithinSkillDir(".claude/skills/a../x", ".claude/skills/a"), false);
    assert.equal(isImmediateChildOfRoot(".claude/skills/a", ".claude/skills"), true);
    assert.equal(isImmediateChildOfRoot(".claude/skills/a/b", ".claude/skills"), false);
  });
});
