import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findWorkspaceFolderById,
  folderKeyForUri,
  isWorkspaceFolderId,
} from "../../skillsDashboard/skills/skillIdentity";
import { isWebviewToHostMessage } from "../../skillsDashboard/shared/messages";

function folder(uri: string, name: string): { uri: { toString(): string }; name: string } {
  return { uri: { toString: () => uri }, name };
}

describe("import destination folder ids", () => {
  it("resolves opaque ids against live folders, deterministically", () => {
    const live = [folder("file:///proj-a/frontend", "frontend"), folder("file:///proj-b/frontend", "frontend")];
    const idA = folderKeyForUri("file:///proj-a/frontend");
    const idB = folderKeyForUri("file:///proj-b/frontend");
    assert.notEqual(idA, idB);
    assert.equal(findWorkspaceFolderById(live, idA), live[0]);
    assert.equal(findWorkspaceFolderById(live, idB), live[1]);
    assert.equal(findWorkspaceFolderById(live, idA), live[0]); // deterministic
    assert.ok(isWorkspaceFolderId(idA));
  });

  it("fails closed on unknown, stale, and malformed ids", () => {
    const live = [folder("file:///proj-b/frontend", "frontend")];
    const stale = folderKeyForUri("file:///proj-a/frontend"); // removed folder
    assert.equal(findWorkspaceFolderById(live, stale), undefined);
    assert.equal(findWorkspaceFolderById(live, "0123456789abcdef"), undefined); // well-formed but unknown
    assert.equal(findWorkspaceFolderById(live, undefined), undefined);
    assert.equal(findWorkspaceFolderById([], folderKeyForUri("file:///proj-b/frontend")), undefined);
    // Arbitrary paths are never ids.
    for (const bad of [
      "/abs/path",
      "file:///proj-b/frontend",
      "../evil",
      "frontend",
      "",
      "zzzzzzzzzzzzzzzz",
      "ABCDEF0123456789",
      "a".repeat(15),
      "a".repeat(17),
      42,
      null,
      {},
    ]) {
      assert.equal(isWorkspaceFolderId(bad), false, `should reject ${JSON.stringify(bad)}`);
      assert.equal(findWorkspaceFolderById(live, bad), undefined, `should not resolve ${JSON.stringify(bad)}`);
    }
  });

  it("validates previewImport destination ids in webview messages", () => {
    const url = "https://github.com/o/r/tree/main/skills/s";
    const id = folderKeyForUri("file:///w");
    assert.equal(isWebviewToHostMessage({ type: "previewImport", payload: { url } }), true);
    assert.equal(
      isWebviewToHostMessage({ type: "previewImport", payload: { url, workspaceFolderId: id } }),
      true
    );
    assert.equal(
      isWebviewToHostMessage({ type: "previewImport", payload: { url, workspaceFolderId: "/abs/path" } }),
      false
    );
    assert.equal(
      isWebviewToHostMessage({ type: "previewImport", payload: { url, workspaceFolderId: "file:///w" } }),
      false
    );
    assert.equal(
      isWebviewToHostMessage({ type: "previewImport", payload: { url, workspaceFolderId: "short" } }),
      false
    );
  });

  it("requires a valid destination id for confirmImport", () => {
    const base = {
      url: "https://github.com/o/r/tree/main/skills/s",
      targets: [".claude/skills"],
      overwrite: false,
    };
    const id = folderKeyForUri("file:///w");
    assert.equal(
      isWebviewToHostMessage({ type: "confirmImport", payload: { ...base, workspaceFolderId: id } }),
      true
    );
    // Missing id (legacy message) is rejected — the host must know the folder.
    assert.equal(isWebviewToHostMessage({ type: "confirmImport", payload: base }), false);
    // Arbitrary paths / malformed ids are rejected.
    for (const bad of ["/abs/path", "file:///w", "../evil", "frontend", "", "zzzzzzzzzzzzzzzz", 42]) {
      assert.equal(
        isWebviewToHostMessage({ type: "confirmImport", payload: { ...base, workspaceFolderId: bad } }),
        false,
        `should reject ${JSON.stringify(bad)}`
      );
    }
  });
});
