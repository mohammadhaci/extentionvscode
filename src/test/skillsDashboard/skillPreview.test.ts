import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_SKILL_MD_BYTES, resolveSkillPreviewText } from "../../skillsDashboard/skills/skillMetadata";

function bytes(n: number): Uint8Array {
  return new Uint8Array(n).fill(65); // 'A'
}

describe("resolveSkillPreviewText size boundary", () => {
  it("loads files at exactly the limit", () => {
    const r = resolveSkillPreviewText(MAX_SKILL_MD_BYTES, bytes(MAX_SKILL_MD_BYTES));
    assert.equal(r.oversized, false);
    assert.equal(r.text.length, MAX_SKILL_MD_BYTES);
  });

  it("skips the read when the stat size is one byte over the limit", () => {
    const r = resolveSkillPreviewText(MAX_SKILL_MD_BYTES + 1, null);
    assert.equal(r.oversized, true);
    assert.equal(r.text, "");
  });

  it("marks oversized when the file grew between stat and read", () => {
    const r = resolveSkillPreviewText(10, bytes(MAX_SKILL_MD_BYTES + 1));
    assert.equal(r.oversized, true);
    assert.equal(r.text, "");
  });

  it("reports a failed read as empty but not oversized", () => {
    const r = resolveSkillPreviewText(10, null);
    assert.equal(r.oversized, false);
    assert.equal(r.text, "");
  });

  it("decodes small files normally", () => {
    const r = resolveSkillPreviewText(3, new TextEncoder().encode("abc"));
    assert.equal(r.oversized, false);
    assert.equal(r.text, "abc");
  });
});
