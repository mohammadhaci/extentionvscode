import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWebviewToHostMessage } from "../../shared/messages";

describe("isWebviewToHostMessage", () => {
  it("accepts ready/refresh/openPanel", () => {
    assert.equal(isWebviewToHostMessage({ type: "ready" }), true);
    assert.equal(isWebviewToHostMessage({ type: "refresh" }), true);
    assert.equal(isWebviewToHostMessage({ type: "openPanel" }), true);
  });

  it("accepts a well-formed openFile payload", () => {
    assert.equal(
      isWebviewToHostMessage({ type: "openFile", payload: { file: "blog/views.py", line: 12 } }),
      true
    );
    assert.equal(
      isWebviewToHostMessage({ type: "openFile", payload: { file: "manage.py" } }),
      true
    );
  });

  it("rejects malformed openFile payloads without throwing", () => {
    const malformed: unknown[] = [
      { type: "openFile" },
      { type: "openFile", payload: null },
      { type: "openFile", payload: undefined },
      { type: "openFile", payload: "blog/views.py" },
      { type: "openFile", payload: 42 },
      { type: "openFile", payload: {} },
      { type: "openFile", payload: { file: 42 } },
      { type: "openFile", payload: { file: null } },
      { type: "openFile", payload: { file: "a.py", line: "12" } },
      { type: "openFile", payload: { file: "a.py", line: null } },
    ];
    for (const m of malformed) {
      assert.equal(isWebviewToHostMessage(m), false, `should reject ${JSON.stringify(m)}`);
    }
  });

  it("never throws on hostile input and guards property access", () => {
    const hostile: unknown[] = [null, undefined, 42, "openFile", [], { type: "openFile", payload: null }];
    for (const h of hostile) {
      let ok = false;
      try {
        ok = isWebviewToHostMessage(h);
      } catch {
        assert.fail(`guard threw for ${String(h)}`);
      }
      if (ok) {
        // Narrowed type guarantees payload access cannot throw.
        const msg = h as { payload: { file: unknown } };
        assert.doesNotThrow(() => String(msg.payload.file));
      } else {
        assert.equal(ok, false);
      }
    }
    // The previously crashing shape no longer passes the guard,
    // so `msg.payload.file` is unreachable for it.
    assert.equal(isWebviewToHostMessage({ type: "openFile" }), false);
    assert.equal(isWebviewToHostMessage({ type: "openFile", payload: null }), false);
  });

  it("rejects unknown types and non-objects", () => {
    assert.equal(isWebviewToHostMessage(null), false);
    assert.equal(isWebviewToHostMessage(undefined), false);
    assert.equal(isWebviewToHostMessage({ type: "nope" }), false);
    assert.equal(isWebviewToHostMessage({}), false);
  });
});
