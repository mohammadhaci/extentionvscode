import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { main } from "../cli";

let root: string;

const write = (rel: string, text: string): void => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const git = (...args: string[]): string =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root, encoding: "utf8" });
const run = (...argv: string[]): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: path.join(root, "apps"), out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "change-report-"));
  write("manage.py", "");
  write("config/settings.py", 'INSTALLED_APPS = [\n    "apps.orders",\n]\n');
  write("config/urls.py", 'urlpatterns = [path("orders/", include("apps.orders.urls"))]\n');
  write("apps/orders/__init__.py", "");
  write("apps/orders/apps.py", "");
  write("apps/orders/models.py", "class Order(models.Model):\n    total = models.IntegerField()\n");
  write("apps/orders/tests.py", "");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "agent/work");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("cli", () => {
  it("usage", () => {
    assert.equal(run("--help").code, 0);
    assert.equal(run().code, 2);
    assert.equal(run("report", "--fail-on", "blue").code, 2);
    assert.equal(run("report", "--nope").code, 2);
  });

  it("reports committed and uncommitted work against main", () => {
    write("apps/orders/models.py", "class Order(models.Model):\n    total = models.IntegerField()\n    note = models.TextField(null=True)\n");
    git("commit", "-qam", "add note");
    write("config/settings.py", 'INSTALLED_APPS = [\n    "apps.orders",\n]\nDEBUG = True\n');
    write("apps/orders/extra.py", "x = 1\n");
    const r = run("report");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /`agent\/work` vs `main`/);
    assert.match(r.out, /1 commit\(s\) · 3 file\(s\)/);
    assert.match(r.out, /\| orders \| Order \| ➕ note \(TextField\) \|/);
    assert.match(r.out, /🟡 \*\*Settings changed\*\*/);
    assert.match(r.out, /🟡 \*\*Code changed without test changes\*\*: `apps\/orders`/);
    assert.match(r.out, /\| `apps\/orders\/extra.py` \| added \| \+1 −0 \|/);
    assert.match(r.out, /\| Migrations Guard \| ➖ not installed \|/);
  });

  it("supports --json, --out, --no-tools and --fail-on", () => {
    write(".env", "SECRET=1\n");
    const json = JSON.parse(run("report", "--json", "--no-tools").out);
    assert.equal(json.verdict, "red");
    assert.deepEqual(json.tools, []);
    assert.equal(run("report", "--fail-on", "red").code, 1);
    assert.equal(run("report", "--fail-on=yellow", "--out", "../r.md").code, 1);
    assert.match(fs.readFileSync(path.join(root, "r.md"), "utf8"), /Secrets or environment files changed/);
  });

  it("picks the closest base when origin/main is stale", () => {
    git("checkout", "-q", "main");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    write("apps/orders/old.py", "x = 1\n");
    git("add", "-A");
    git("commit", "-qm", "main moved on locally");
    git("checkout", "-qb", "agent/next");
    write("apps/orders/new.py", "y = 2\n");
    write("apps/orders/tests.py", "# t\n");
    git("add", "-A");
    git("commit", "-qm", "agent work");
    const r = run("report");
    assert.match(r.out, /`agent\/next` vs `main`/);
    assert.match(r.out, /1 commit\(s\) · 2 file\(s\)/);
    assert.ok(!r.out.includes("old.py"));
    assert.match(run("report", "--base", "origin/main").out, /2 commit\(s\) · 3 file\(s\)/);
  });

  it("is green with no changes, and fails clearly on a bad base", () => {
    const r = run("report", "--fail-on", "yellow");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /🟢 \*\*No problems found\*\*/);
    assert.match(r.out, /No changes to apps, models, URLs or app dependencies/);
    const bad = run("report", "--base", "nope");
    assert.equal(bad.code, 1);
    assert.match(bad.err, /Unknown git ref "nope"/);
  });
});
