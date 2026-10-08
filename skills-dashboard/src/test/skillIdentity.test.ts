import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import {
  findBySkillId,
  folderKeyForUri,
  parseSkillId,
  skillIdFor,
} from "../skills/skillIdentity";

function folder(uri: string, name: string): vscode.WorkspaceFolder {
  return {
    uri: { toString: () => uri } as unknown as vscode.Uri,
    name,
    index: 0,
  };
}

describe("skillIdentity", () => {
  it("gives same-basename folders distinct, deterministic IDs", () => {
    const a = { workspaceFolder: folder("file:///proj-a/frontend", "frontend"), root: ".claude/skills", skillName: "demo" };
    const b = { workspaceFolder: folder("file:///proj-b/frontend", "frontend"), root: ".claude/skills", skillName: "demo" };
    const idA = skillIdFor(a);
    const idB = skillIdFor(b);
    assert.notEqual(idA, idB);
    assert.equal(idA, skillIdFor(a)); // deterministic
    assert.match(idA, /^[0-9a-f]{16}::\.claude\/skills::demo$/);
    // Each ID resolves to its own folder's skill, never the other's.
    assert.equal(findBySkillId([a, b], idA), a);
    assert.equal(findBySkillId([a, b], idB), b);
  });

  it("derives opaque keys that hide the absolute path", () => {
    const key = folderKeyForUri("file:///home/user/secret/proj");
    assert.equal(key.length, 16);
    assert.match(key, /^[0-9a-f]{16}$/);
    assert.ok(!skillIdFor({ workspaceFolder: folder("file:///home/user/secret/proj", "proj"), root: "r", skillName: "s" }).includes("secret"));
  });

  it("round-trips valid IDs and rejects malformed or unsafe ones", () => {
    const ref = { workspaceFolder: folder("file:///w", "w"), root: ".agents/skills", skillName: "demo" };
    const parsed = parseSkillId(skillIdFor(ref));
    assert.deepEqual(parsed, {
      folderKey: folderKeyForUri("file:///w"),
      root: ".agents/skills",
      skillName: "demo",
    });
    assert.equal(parseSkillId("frontend::.claude/skills::demo"), null); // legacy basename form
    assert.equal(parseSkillId("zzzzzzzzzzzzzzzz::r::s"), null); // non-hex key
    assert.equal(parseSkillId("a".repeat(1025)), null);
    assert.equal(parseSkillId(`${"a".repeat(16)}::../x::s`), null);
    assert.equal(parseSkillId(`${"a".repeat(16)}::r::../evil`), null);
    assert.equal(parseSkillId("not-an-id"), null);
    assert.equal(parseSkillId(42), null);
  });

  it("fails closed on unknown folders instead of hitting a same-named one", () => {
    const live = [{ workspaceFolder: folder("file:///proj-b/frontend", "frontend"), root: "r", skillName: "s" }];
    const staleId = skillIdFor({ workspaceFolder: folder("file:///proj-a/frontend", "frontend"), root: "r", skillName: "s" });
    assert.equal(findBySkillId(live, staleId), undefined);
  });
});
