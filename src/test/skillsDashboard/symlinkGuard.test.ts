import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SYMLINK_BIT,
  hasSymlinkBit,
  isRealDirectory,
  isRealFile,
  ancestorRelPaths,
  firstSymlinkOffender,
} from "../../skillsDashboard/skills/symlinkGuard";

describe("symlinkGuard bit detection", () => {
  it("matches the VS Code FileType.SymbolicLink value", () => {
    assert.equal(SYMLINK_BIT, 64);
  });

  it("detects the symlink bit with equality-defeating combinations", () => {
    assert.equal(hasSymlinkBit(0), false);
    assert.equal(hasSymlinkBit(1), false); // File
    assert.equal(hasSymlinkBit(2), false); // Directory
    assert.equal(hasSymlinkBit(63), false);
    assert.equal(hasSymlinkBit(128), false);
    assert.equal(hasSymlinkBit(64), true);
    assert.equal(hasSymlinkBit(65), true); // File | SymbolicLink
    assert.equal(hasSymlinkBit(66), true); // Directory | SymbolicLink
    assert.equal(hasSymlinkBit(67), true);
  });

  it("rejects non-integer or negative types", () => {
    assert.equal(hasSymlinkBit(-1), false);
    assert.equal(hasSymlinkBit(1.5), false);
    assert.equal(hasSymlinkBit(NaN), false);
  });

  it("accepts only ordinary directories and files", () => {
    assert.equal(isRealDirectory(2), true);
    assert.equal(isRealDirectory(0), false);
    assert.equal(isRealDirectory(1), false);
    assert.equal(isRealDirectory(64), false);
    assert.equal(isRealDirectory(66), false); // symlink-to-dir combo
    assert.equal(isRealFile(1), true);
    assert.equal(isRealFile(0), false);
    assert.equal(isRealFile(2), false);
    assert.equal(isRealFile(64), false);
    assert.equal(isRealFile(65), false); // symlink-to-file combo
  });
});

describe("ancestorRelPaths", () => {
  it("lists root segments top-down for root-only checks", () => {
    assert.deepEqual(ancestorRelPaths(".claude/skills"), [".claude", ".claude/skills"]);
  });

  it("extends through the skill folder and nested parents in order", () => {
    assert.deepEqual(ancestorRelPaths(".claude/skills", "a", "x/y.md"), [
      ".claude",
      ".claude/skills",
      ".claude/skills/a",
      ".claude/skills/a/x",
    ]);
  });

  it("adds nothing extra for top-level files", () => {
    assert.deepEqual(ancestorRelPaths(".agents/skills", "b", "SKILL.md"), [
      ".agents",
      ".agents/skills",
      ".agents/skills/b",
    ]);
  });
});

describe("firstSymlinkOffender (mock stat map, no VS Code API)", () => {
  it("ignores missing paths and clean stats", () => {
    assert.equal(
      firstSymlinkOffender([
        { rel: ".claude", type: 2 },
        { rel: ".claude/skills", type: null },
        { rel: ".claude/skills/a", type: 2 },
      ]),
      null
    );
  });

  it("reports the first symlinked ancestor, including bitflag combos", () => {
    assert.equal(
      firstSymlinkOffender([
        { rel: ".claude", type: 66 }, // Directory | SymbolicLink
        { rel: ".claude/skills", type: 2 },
      ]),
      ".claude"
    );
    assert.equal(
      firstSymlinkOffender([
        { rel: ".agents", type: 2 },
        { rel: ".agents/skills", type: 2 },
        { rel: ".agents/skills/b", type: 65 }, // File | SymbolicLink
      ]),
      ".agents/skills/b"
    );
  });
});
