import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { main } from "../../cli";
import { STUDIO_VERSION } from "../../generated/version";

let root: string;

const write = (rel: string, text: string): void => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const run = (...argv: string[]): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: path.join(root, "apps"), out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-cli-"));
  write("manage.py", "");
  write("config/settings.py", 'INSTALLED_APPS = [\n    "apps.orders",\n]\n');
  write("config/urls.py", 'urlpatterns = [\n    path("orders/", include("apps.orders.urls")),\n]\n');
  write("apps/orders/__init__.py", "");
  write("apps/orders/apps.py", 'class OrdersConfig(AppConfig):\n    name = "apps.orders"\n');
  write("apps/orders/models.py", "class Order(models.Model):\n    total = models.IntegerField(null=True)\n");
  write("apps/orders/tests.py", "");
  write("apps/orders/migrations/__init__.py", "");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], { cwd: root });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("studio cli", () => {
  it("prints help, version and rejects unknown commands", () => {
    assert.equal(run().code, 2);
    assert.match(run("--help").out, /scaffold <new\|check\|apps\|reference>/);
    assert.equal(run("version").out, STUDIO_VERSION);
    const bad = run("nope");
    assert.equal(bad.code, 2);
    assert.match(bad.err, /unknown command "nope"/);
  });

  it("routes to every module", () => {
    assert.equal(run("scaffold", "reference", "apps/orders").code, 0);
    assert.ok(fs.existsSync(path.join(root, ".agent-studio/scaffold.json")));
    assert.equal(run("context", "init").code, 0);
    assert.ok(fs.existsSync(path.join(root, ".agent-studio/rules.md")));
    assert.match(run("guard", "rules").out, /remove-field/);
    assert.match(run("report").out, /# Agent change report/);
    assert.match(run("scaffold", "--help").out, /node \.agent-studio\/tool\/cli\.js scaffold new/);
  });

  it("doctor skips unconfigured checks and fails on stale instructions", () => {
    const first = run("doctor");
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /✅ Migrations/);
    assert.match(first.out, /➖ App structure +no reference app/);
    assert.match(first.out, /🎉 All checks passed\./);

    run("scaffold", "reference", "apps/orders");
    run("context", "init");
    const stale = run("doctor");
    assert.equal(stale.code, 1);
    assert.match(stale.out, /✅ App structure +0 \/ 0 apps match the reference/);
    assert.match(stale.out, /❌ Agent instructions +stale, run: node \.agent-studio\/tool\/cli\.js context sync/);

    run("context", "sync");
    assert.equal(run("doctor").code, 0);
  });
});
