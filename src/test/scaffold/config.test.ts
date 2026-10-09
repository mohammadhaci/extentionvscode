import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeRelativePath, parseConfig, withReferenceApp } from "../../scaffold/config";
import { expectedFiles, formatConformanceReport, missingFiles } from "../../scaffold/conformance";
import { buildRenamePairs, createRenamer } from "../../scaffold/rename";

describe("config", () => {
  it("parses a full config", () => {
    const { config, errors } = parseConfig(
      JSON.stringify({ referenceApp: "./apps/orders/", referenceEntity: "Order", exclude: ["fixtures/**"], requiredFiles: ["services.py"], registerInUrls: false })
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(config, { referenceApp: "apps/orders", referenceEntity: "Order", exclude: ["fixtures/**"], requiredFiles: ["services.py"], registerInUrls: false });
  });

  it("reports invalid values and keeps the valid ones", () => {
    const { config, errors } = parseConfig(JSON.stringify({ referenceApp: "../outside", exclude: "x", registerInSettings: "yes", referenceEntity: "Order" }));
    assert.equal(errors.length, 3);
    assert.deepEqual(config, { referenceEntity: "Order" });
  });

  it("rejects non-objects and bad JSON", () => {
    assert.equal(parseConfig("[]").errors.length, 1);
    assert.match(parseConfig("{").errors[0], /not valid JSON/);
  });

  it("checks relative paths", () => {
    assert.ok(isSafeRelativePath("apps/orders"));
    for (const p of ["", "/abs", "C:/x", "a/../b", "a\\b", "a//b"]) {
      assert.ok(!isSafeRelativePath(p), p);
    }
  });

  it("sets the reference app and keeps other keys", () => {
    assert.equal(withReferenceApp(undefined, "apps/orders"), '{\n  "referenceApp": "apps/orders"\n}\n');
    const out = JSON.parse(withReferenceApp('{"exclude": ["a"], "referenceApp": "old"}', "apps/orders"));
    assert.deepEqual(out, { exclude: ["a"], referenceApp: "apps/orders" });
    assert.throws(() => withReferenceApp("[]", "x"));
  });
});

describe("conformance", () => {
  const renamer = createRenamer(buildRenamePairs("orders", "invoices", "order", "invoice"));
  const ref = ["__init__.py", "apps.py", "models.py", "services/order_service.py", "migrations/__init__.py", "migrations/0001_initial.py", "templates/orders/a.html"];

  it("expects the reference Python files, renamed", () => {
    assert.deepEqual(expectedFiles(ref, renamer), ["__init__.py", "apps.py", "migrations/__init__.py", "models.py", "services/invoice_service.py"]);
  });

  it("uses requiredFiles when configured", () => {
    assert.deepEqual(expectedFiles(ref, renamer, ["selectors.py", "templates/orders/base.html"]), ["selectors.py", "templates/invoices/base.html"]);
  });

  it("lists missing files and formats a report", () => {
    const missing = missingFiles(["apps.py", "models.py"], new Set(["apps.py"]));
    assert.deepEqual(missing, ["models.py"]);
    const md = formatConformanceReport("apps/orders", "reference", [
      { dir: "apps/invoices", missing, registered: true },
      { dir: "apps/users", missing: [], registered: true },
      { dir: "apps/legacy", missing: [], registered: false },
    ]);
    assert.match(md, /\*\*1 \/ 3\*\*/);
    assert.match(md, /Missing `models.py`/);
    assert.match(md, /Not found in any settings app list/);
  });
});
