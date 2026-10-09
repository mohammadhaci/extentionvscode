import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  stepZoom,
  zoomAt,
  transformString,
  fitZoom,
  BUTTON_ZOOM_FACTOR
} from "../../shared/zoom";

describe("zoom bounds", () => {
  it("clamps to the usable range", () => {
    assert.equal(clampZoom(0.01), MIN_ZOOM);
    assert.equal(clampZoom(100), MAX_ZOOM);
    assert.equal(clampZoom(1), 1);
    assert.equal(clampZoom(Number.NaN), 1);
  });

  it("max zoom is materially above the old cap of 3", () => {
    assert.ok(MAX_ZOOM >= 8, `MAX_ZOOM=${MAX_ZOOM} should allow deep zoom`);
  });

  it("repeated zoom-in steps saturate at MAX_ZOOM (reliable increments)", () => {
    let k = 1;
    for (let i = 0; i < 50; i++) {
      const next = stepZoom(k, BUTTON_ZOOM_FACTOR);
      assert.ok(next >= k, `zoom must not slip backwards (${k} -> ${next})`);
      k = next;
    }
    assert.equal(k, MAX_ZOOM);
  });

  it("repeated zoom-out steps saturate at MIN_ZOOM", () => {
    let k = 1;
    for (let i = 0; i < 50; i++) {
      k = stepZoom(k, 1 / BUTTON_ZOOM_FACTOR);
    }
    assert.equal(k, MIN_ZOOM);
  });

  it("rejects non-positive factors", () => {
    assert.equal(stepZoom(2, 0), 2);
    assert.equal(stepZoom(2, -1), 2);
  });
});

describe("pointer-anchored zoom", () => {
  it("keeps the anchor point stationary", () => {
    const start = { x: 20, y: 50, k: 1 };
    const next = zoomAt(start, 2, 100, 100);
    assert.equal(next.k, 2);
    // anchor invariant: cx - (cx - x') / k' == cx - (cx - x) / k
    const before = (100 - start.x) / start.k;
    const after = (100 - next.x) / next.k;
    assert.ok(Math.abs(before - after) < 1e-9);
  });

  it("clamps the anchored result at MAX_ZOOM", () => {
    const next = zoomAt({ x: 0, y: 0, k: MAX_ZOOM }, 2, 10, 10);
    assert.equal(next.k, MAX_ZOOM);
  });

  it("transform string round-trips through the clamp", () => {
    assert.equal(transformString({ x: 20, y: 50, k: 500 }), `translate(20,50) scale(${MAX_ZOOM})`);
  });
});

describe("fitToView zoom", () => {
  it("fits content and never exceeds the fit cap", () => {
    assert.equal(fitZoom(1000, 800, 100, 100, 40), 1.5);
    const k = fitZoom(200, 200, 1000, 1000, 40);
    assert.ok(k >= MIN_ZOOM && k <= 1.5);
  });

  it("falls back on degenerate input", () => {
    assert.equal(fitZoom(0, 0, 0, 0), 0.5);
  });
});
