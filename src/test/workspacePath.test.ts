import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeWorkspaceRelativePath } from "../shared/workspacePath";

describe("isSafeWorkspaceRelativePath", () => {
  it("accepts analyzer-generated relative paths", () => {
    for (const f of [
      "manage.py",
      "blog/models.py",
      "mysite/urls.py",
      "my-app/my_views.py",
      "shop/v2/models.py"
    ]) {
      assert.equal(isSafeWorkspaceRelativePath(f), true, f);
    }
  });

  it("rejects absolute, drive-letter, and separator escapes", () => {
    for (const f of [
      "/etc/passwd",
      "/blog/views.py",
      "C:/Windows/win.ini",
      "C:\\Windows\\win.ini",
      "blog\\views.py",
      "..\\secret.py",
      "a\0b.py"
    ]) {
      assert.equal(isSafeWorkspaceRelativePath(f), false, JSON.stringify(f));
    }
  });

  it("rejects dot-segment and empty-segment traversals", () => {
    for (const f of [
      "..",
      "../secret.py",
      "blog/../secret.py",
      "blog/./views.py",
      "blog//views.py",
      "blog/",
      "/",
      "",
      ".",
      "./views.py"
    ]) {
      assert.equal(isSafeWorkspaceRelativePath(f), false, JSON.stringify(f));
    }
  });

  it("rejects non-strings", () => {
    for (const f of [null, undefined, 42, {}, []]) {
      assert.equal(isSafeWorkspaceRelativePath(f), false, String(f));
    }
  });
});
