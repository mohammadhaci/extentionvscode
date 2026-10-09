import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findProjectRoot, main } from "../../scaffold/cli";

let root: string;

function write(rel: string, text: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function run(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: root, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-cli-"));
  write("manage.py", "");
  write("config/settings.py", 'INSTALLED_APPS = [\n    "django.contrib.admin",\n    "apps.orders",\n]\n');
  write("config/urls.py", 'urlpatterns = [\n    path("orders/", include("apps.orders.urls")),\n]\n');
  write("apps/__init__.py", "");
  write("apps/orders/__init__.py", "");
  write("apps/orders/apps.py", 'class OrdersConfig(AppConfig):\n    name = "apps.orders"\n');
  write("apps/orders/models.py", "class Order(models.Model):\n    border = 1\n");
  write("apps/orders/services.py", "def create_order():\n    pass\n");
  write("apps/orders/migrations/__init__.py", "");
  write("apps/orders/migrations/0001_initial.py", "# generated\n");
  write("apps/orders/node_modules/x.js", "ignored");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("cli", () => {
  it("prints usage", () => {
    assert.equal(run("--help").code, 0);
    assert.equal(run().code, 2);
    assert.equal(run("bogus").code, 2);
  });

  it("requires a reference app", () => {
    const r = run("new", "invoices");
    assert.equal(r.code, 1);
    assert.match(r.err, /No reference app/);
  });

  it("sets the reference app and lists apps", () => {
    assert.equal(run("reference", "apps/orders").code, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".agent-studio/scaffold.json"), "utf8")).referenceApp, "apps/orders");
    assert.equal(run("reference", "apps/missing").code, 1);
    const apps = JSON.parse(run("apps", "--json").out);
    assert.deepEqual(apps, { reference: "apps/orders", apps: ["apps/orders"] });
  });

  it("dry-run writes nothing", () => {
    run("reference", "apps/orders");
    const r = run("new", "invoices", "--entity", "Invoice", "--dry-run", "--json");
    assert.equal(r.code, 0);
    const s = JSON.parse(r.out);
    assert.equal(s.target, "apps/invoices");
    assert.deepEqual(s.entity, { from: "order", to: "Invoice" });
    assert.ok(s.files.some((f: { path: string }) => f.path === "apps/invoices/models.py"));
    assert.ok(!fs.existsSync(path.join(root, "apps/invoices")));
  });

  it("creates and registers the app, then passes check", () => {
    run("reference", "apps/orders");
    const r = run("new", "invoices", "--entity=Invoice");
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(path.join(root, "apps/invoices/models.py"), "utf8"), "class Invoice(models.Model):\n    border = 1\n");
    assert.equal(fs.readFileSync(path.join(root, "apps/invoices/services.py"), "utf8"), "def create_invoice():\n    pass\n");
    assert.ok(fs.existsSync(path.join(root, "apps/invoices/migrations/__init__.py")));
    assert.ok(!fs.existsSync(path.join(root, "apps/invoices/migrations/0001_initial.py")));
    assert.ok(!fs.existsSync(path.join(root, "apps/invoices/node_modules")));
    assert.match(fs.readFileSync(path.join(root, "config/settings.py"), "utf8"), /"apps\.orders",\n {4}"apps\.invoices",/);
    assert.match(fs.readFileSync(path.join(root, "config/urls.py"), "utf8"), /path\("invoices\/", include\("apps\.invoices\.urls"\)\),/);
    assert.equal(run("check").code, 0);
    assert.equal(run("new", "invoices").code, 1);
  });

  it("defaults the entity to the singular app name", () => {
    run("reference", "apps/orders");
    assert.equal(run("new", "categories").code, 0);
    assert.match(fs.readFileSync(path.join(root, "apps/categories/models.py"), "utf8"), /class Category\(/);
  });

  it("skips apps that existed before the studio unless checkAllApps is set", () => {
    run("reference", "apps/orders");
    write("apps/legacy/apps.py", "");
    const r = run("check", "--json");
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.out).skipped, ["apps/legacy"]);
    assert.match(run("check").out, /not checked: `apps\/legacy`/);

    const cfg = path.join(root, ".agent-studio/scaffold.json");
    fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, "utf8")), checkAllApps: true }));
    const all = run("check", "--json");
    assert.equal(all.code, 1);
    const report = JSON.parse(all.out);
    assert.equal(report.apps[0].dir, "apps/legacy");
    assert.equal(report.apps[0].registered, false);
    assert.ok(report.apps[0].missing.includes("models.py"));
  });

  it("records created apps and holds them to the skeleton, not the reference's features", () => {
    run("reference", "apps/orders");
    write("apps/orders/collaboration_views.py", "def board(request):\n    pass\n");
    assert.equal(run("new", "invoices", "--entity", "Invoice").code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, ".agent-studio/scaffold.json"), "utf8")).apps, ["apps/invoices"]);
    // Feature files of the reference may be removed from the new app...
    fs.rmSync(path.join(root, "apps/invoices/collaboration_views.py"));
    assert.equal(run("check").code, 0);
    // ...but skeleton modules may not.
    fs.rmSync(path.join(root, "apps/invoices/models.py"));
    const r = run("check", "--json");
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.out).apps[0].missing, ["models.py"]);
  });

  it("rejects invalid names", () => {
    run("reference", "apps/orders");
    assert.match(run("new", "Invoices").err, /snake_case/);
    assert.match(run("new", "orders").err, /already exists/);
    assert.match(run("new", "x", "--entity", "1bad").err, /--entity/);
  });

  it("finds the project root from a subfolder", () => {
    assert.equal(findProjectRoot(path.join(root, "apps/orders")), root);
  });
});
