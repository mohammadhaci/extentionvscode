import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FILE_BYTES,
  MAX_PY_FILES,
  fileCountCapWarning,
  isOversizedFile,
  largeFileWarning
} from "../../analyzer/analysisLimits";

describe("analysisLimits", () => {
  it("stays silent below the file-count cap", () => {
    assert.equal(fileCountCapWarning(0, MAX_PY_FILES), undefined);
    assert.equal(fileCountCapWarning(MAX_PY_FILES - 1, MAX_PY_FILES), undefined);
  });

  it("warns when the findFiles cap is hit (results may be partial)", () => {
    const w = fileCountCapWarning(MAX_PY_FILES, MAX_PY_FILES);
    assert.ok(w, "expected a warning at exactly MAX_PY_FILES");
    assert.match(w!.message, /500/);
    assert.match(w!.message, /partial/i);
  });

  it("detects oversized files at the byte cap boundary", () => {
    assert.equal(isOversizedFile(MAX_FILE_BYTES), false);
    assert.equal(isOversizedFile(MAX_FILE_BYTES + 1), true);
  });

  it("warns for oversized files with the analyzer message format", () => {
    assert.equal(largeFileWarning("blog/models.py", MAX_FILE_BYTES), undefined);
    const w = largeFileWarning("blog/models.py", MAX_FILE_BYTES + 1024);
    assert.ok(w);
    assert.equal(w!.file, "blog/models.py");
    assert.match(w!.message, /Skipped large file blog\/models\.py/);
    assert.match(w!.message, /256 KB cap/);
  });
});
