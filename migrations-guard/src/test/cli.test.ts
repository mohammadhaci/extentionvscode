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
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd: root, encoding: "utf8" });
const run = (...argv: string[]): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: path.join(root, "apps"), out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const migration = (deps: string, ops: string): string =>
  `from django.db import migrations, models\n\n\nclass Migration(migrations.Migration):\n    dependencies = [${deps}]\n\n    operations = [\n${ops}\n    ]\n`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mig-guard-"));
  write("manage.py", "");
  write("apps/orders/migrations/__init__.py", "");
  write(
    "apps/orders/migrations/0001_initial.py",
    migration("", '        migrations.CreateModel(name="Order", fields=[("id", models.AutoField(primary_key=True)), ("code", models.CharField(max_length=5))]),')
  );
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("cli", () => {
  it("usage and rules", () => {
    assert.equal(run("--help").code, 0);
    assert.equal(run().code, 2);
    assert.equal(run("check", "--nope").code, 2);
    assert.equal(run("check", "--all", "--base", "main").code, 2);
    assert.match(run("rules").out, /remove-field/);
  });

  it("is clean when nothing changed, and old migrations are not re-judged", () => {
    const r = run("check");
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /0 error/);
  });

  it("fails on a new destructive migration and passes once allowed with a reason", () => {
    const file = "apps/orders/migrations/0002_drop.py";
    write(file, migration('("orders", "0001_initial")', '        migrations.RemoveField(model_name="order", name="code"),'));
    const r = run("check", "--json");
    assert.equal(r.code, 1);
    const report = JSON.parse(r.out);
    assert.equal(report.errors, 1);
    assert.equal(report.findings[0].rule, "remove-field");
    assert.equal(report.findings[0].file, file);
    write(file, "# migrations-guard: allow remove-field: unused since v2, approved by Omar\n" + fs.readFileSync(path.join(root, file), "utf8"));
    const ok = run("check");
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /Allowed by comment:[\s\S]*approved by Omar/);
  });

  it("flags edited and deleted committed migrations", () => {
    write("apps/orders/migrations/0001_initial.py", "# edited\n" + fs.readFileSync(path.join(root, "apps/orders/migrations/0001_initial.py"), "utf8"));
    assert.match(run("check").out, /edited-migration/);
    fs.rmSync(path.join(root, "apps/orders/migrations/0001_initial.py"));
    const r = run("check");
    assert.equal(r.code, 1);
    assert.match(r.out, /deleted-migration/);
  });

  it("--base checks what the branch added, including committed work", () => {
    git("checkout", "-qb", "feature");
    write("apps/orders/migrations/0002_total.py", migration('("orders", "0001_initial")', '        migrations.AddField(model_name="order", name="total", field=models.IntegerField()),'));
    git("add", "-A");
    git("commit", "-qm", "feature");
    assert.equal(run("check").code, 0, "nothing uncommitted");
    const r = run("check", "--base", "main");
    assert.equal(r.code, 1);
    assert.match(r.out, /add-field-not-null/);
    assert.match(r.out, /changes since main/);
    const bad = run("check", "--base", "does-not-exist");
    assert.equal(bad.code, 1);
    assert.match(bad.err, /Unknown git ref "does-not-exist"/);
  });

  it("--strict fails on warnings and --all checks everything", () => {
    write("apps/orders/migrations/0002_rename.py", migration('("orders", "0001_initial")', '        migrations.RenameField(model_name="order", old_name="code", new_name="ref"),'));
    assert.equal(run("check").code, 0);
    assert.equal(run("check", "--strict").code, 1);
    git("add", "-A");
    git("commit", "-qm", "rename");
    assert.equal(run("check", "--all", "--strict").code, 1);
  });

  it("detects conflicting migrations from two branches", () => {
    write("apps/orders/migrations/0002_a.py", migration('("orders", "0001_initial")', ""));
    write("apps/orders/migrations/0002_b.py", migration('("orders", "0001_initial")', ""));
    const r = run("check");
    assert.equal(r.code, 1);
    assert.match(r.out, /conflicting-leaves/);
  });
});
