import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nonce } from "../shared/nonce";

describe("nonce (webview CSP)", () => {
  it("returns a 32-char hex string", () => {
    const n = nonce();
    assert.equal(n.length, 32);
    assert.match(n, /^[0-9a-f]{32}$/);
  });

  it("generates unique values", () => {
    const values = new Set(Array.from({ length: 100 }, () => nonce()));
    assert.ok(values.size > 90, `expected mostly unique nonces, got ${values.size}/100`);
  });

  it("does not depend on Math.random", () => {
    const original = Math.random;
    (Math as { random: () => number }).random = () => 0.5;
    try {
      const a = nonce();
      const b = nonce();
      assert.notEqual(a, b, "nonces must differ even when Math.random is fixed");
    } finally {
      (Math as { random: () => number }).random = original;
    }
  });
});
