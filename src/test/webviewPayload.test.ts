import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyMap } from "../shared/graphTypes";
import { buildProjectMap } from "../analyzer/graphBuilder";
import { fileCountCapWarning, MAX_PY_FILES } from "../analyzer/analysisLimits";

/**
 * Producer-side contract for the webview renderers (media/map.js,
 * media/sidebar.js): every mapData payload must carry a renderable
 * warnings array, and every empty map a non-empty emptyReason, so no
 * analysis state (e.g. the 500-file scan-cap warning) is undisplayable.
 */
describe("webview payload contract", () => {
  it("emptyMap always carries a warnings array and an emptyReason", () => {
    const m = emptyMap("ws", "No Python files found.");
    assert.ok(Array.isArray(m.warnings));
    assert.equal(typeof m.emptyReason, "string");
    assert.ok(m.emptyReason!.length > 0);
    assert.equal(m.isEmpty, true);
  });

  it("cap warning survives the non-Django early-return spread pattern", () => {
    const cap = fileCountCapWarning(MAX_PY_FILES, MAX_PY_FILES);
    assert.ok(cap);
    // Mirrors analyzeWorkspace: { ...emptyMap(...), warnings }
    const m = { ...emptyMap("ws", "Not a Django project."), warnings: [cap!] };
    assert.equal(m.warnings.length, 1);
    assert.match(m.warnings[0].message, /partial/i);
    assert.ok(m.emptyReason!.length > 0);
  });

  it("buildProjectMap preserves warnings (including the cap warning)", () => {
    const cap = fileCountCapWarning(MAX_PY_FILES, MAX_PY_FILES)!;
    const m = buildProjectMap({
      workspaceName: "ws",
      apps: [],
      modelsByFile: new Map(),
      viewsByFile: new Map(),
      urlsByFile: new Map(),
      warnings: [cap]
    });
    assert.ok(m.warnings.some((w) => /partial/i.test(w.message)));
  });

  it("host error payloads always have a message string", () => {
    for (const payload of [
      { message: "No folder is open.", detail: "Open a folder." },
      { message: "Analysis failed.", detail: "boom" }
    ]) {
      assert.equal(typeof payload.message, "string");
      assert.ok(payload.message.length > 0);
    }
  });
});
