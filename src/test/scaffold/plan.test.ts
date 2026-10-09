import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeText, globToRegExp, isExcluded, planFiles } from "../../scaffold/plan";
import { buildRenamePairs, createRenamer } from "../../scaffold/rename";
import { formatPreview } from "../../scaffold/preview";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("globs and excludes", () => {
  it("matches globs", () => {
    assert.ok(globToRegExp("**/*.pyc").test("a/b/c.pyc"));
    assert.ok(globToRegExp("**/*.pyc").test("c.pyc"));
    assert.ok(!globToRegExp("*.pyc").test("a/c.pyc"));
    assert.ok(globToRegExp("fixtures/**").test("fixtures/x/y.json"));
    assert.ok(globToRegExp("file?.txt").test("file1.txt"));
  });

  it("skips migrations except the package marker", () => {
    assert.ok(isExcluded("migrations/0001_initial.py"));
    assert.ok(!isExcluded("migrations/__init__.py"));
    assert.ok(isExcluded("__pycache__/models.cpython-312.pyc"));
    assert.ok(isExcluded("fixtures/demo.json", ["fixtures/**"]));
    assert.ok(!isExcluded("models.py"));
  });

  it("detects binary content", () => {
    assert.equal(decodeText(enc("hello")), "hello");
    assert.equal(decodeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1])), undefined);
    assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0xfd])), undefined);
  });
});

describe("planFiles", () => {
  const renamer = createRenamer(buildRenamePairs("orders", "invoices", "order", "invoice"));
  const sources = [
    { relPath: "__init__.py", bytes: enc("") },
    { relPath: "apps.py", bytes: enc("class OrdersConfig(AppConfig):\n    name = \"apps.orders\"\n") },
    { relPath: "models.py", bytes: enc("class Order(models.Model):\n    border = 1\n") },
    { relPath: "migrations/__init__.py", bytes: enc("") },
    { relPath: "migrations/0001_initial.py", bytes: enc("# generated") },
    { relPath: "templates/orders/order_detail.html", bytes: enc("{{ order.id }}") },
    { relPath: "static/orders/logo.png", bytes: new Uint8Array([0x89, 0, 1, 2]) },
    { relPath: "__pycache__/models.cpython-312.pyc", bytes: new Uint8Array([0]) },
  ];

  it("renames paths and content and skips generated files", () => {
    const plan = planFiles(sources, renamer);
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.files.map((f) => f.targetRel), [
      "__init__.py",
      "apps.py",
      "migrations/__init__.py",
      "models.py",
      "static/invoices/logo.png",
      "templates/invoices/invoice_detail.html",
    ]);
    assert.deepEqual(plan.skipped.sort(), ["__pycache__/models.cpython-312.pyc", "migrations/0001_initial.py"]);
    const byPath = new Map(plan.files.map((f) => [f.targetRel, f]));
    assert.equal(dec(byPath.get("apps.py")!.bytes), "class InvoicesConfig(AppConfig):\n    name = \"apps.invoices\"\n");
    assert.equal(dec(byPath.get("models.py")!.bytes), "class Invoice(models.Model):\n    border = 1\n");
    assert.equal(dec(byPath.get("templates/invoices/invoice_detail.html")!.bytes), "{{ invoice.id }}");
    const png = byPath.get("static/invoices/logo.png")!;
    assert.equal(png.binary, true);
    assert.deepEqual([...png.bytes], [0x89, 0, 1, 2]);
  });

  it("reports target path collisions", () => {
    const plan = planFiles([{ relPath: "orders.py", bytes: enc("") }, { relPath: "invoices.py", bytes: enc("") }], renamer);
    assert.equal(plan.errors.length, 1);
  });

  it("keeps a UTF-8 BOM and CRLF line endings", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("order\r\n")]);
    const out = planFiles([{ relPath: "a.py", bytes: bom }], renamer).files[0].bytes;
    assert.deepEqual([...out.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(dec(out.slice(3)), "invoice\r\n");
  });

  it("formats a preview", () => {
    const plan = planFiles(sources, renamer);
    const md = formatPreview({ referenceDir: "apps/orders", targetDir: "apps/invoices", pairs: renamer.pairs, plan, registrations: ["config/settings.py:12 add apps.invoices"], notes: [] });
    assert.match(md, /# New Django app: `apps\/invoices`/);
    assert.match(md, /`static\/invoices\/logo.png` — binary/);
    assert.match(md, /makemigrations/);
  });
});
