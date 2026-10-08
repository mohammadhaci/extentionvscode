import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createModelFields, fieldInfo, matchBracket, parseMigration, splitArgs } from "../guard/parse";
import { analyze, MigrationFile } from "../guard/rules";

const mig = (app: string, name: string, deps: string[], ops: string, extra = ""): MigrationFile => ({
  path: `apps/${app}/migrations/${name}.py`,
  app,
  name,
  text: `${extra}from django.db import migrations, models\n\n\nclass Migration(migrations.Migration):\n    dependencies = [${deps
    .map((d) => `\n        ("${d.split(":")[0]}", "${d.split(":")[1]}"),`)
    .join("")}\n    ]\n\n    operations = [\n${ops}\n    ]\n`,
});

const initial = mig(
  "orders",
  "0001_initial",
  [],
  `        migrations.CreateModel(
            name="Order",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True)),
                ("note", models.TextField(null=True, blank=True)),
                ("code", models.CharField(max_length=10, default="x")),
            ],
        ),`
);

const rules = (files: MigrationFile[], changed?: string[]) =>
  analyze({ migrations: files, changes: changed ? new Map(changed.map((p) => [p, "added" as const])) : undefined });

describe("parse", () => {
  it("matches brackets across strings and comments", () => {
    const s = 'f(")", "(", # )\n  [1, 2])';
    assert.equal(matchBracket(s, 1), s.length);
    assert.deepEqual(splitArgs('"a,b", f(1, 2), x=[3, 4]'), ['"a,b"', "f(1, 2)", "x=[3, 4]"]);
    assert.equal(matchBracket('("""a ) b""")', 0), 13);
  });

  it("reads dependencies, operations, imports and allow comments", () => {
    const p = parseMigration(
      mig("orders", "0002_x", ["orders:0001_initial", "users:0003_y"], '        migrations.RemoveField(model_name="order", name="note"),\n        # migrations.DeleteModel(name="Gone"),', "# migrations-guard: allow remove-field, rename-field: approved by Sami\nfrom apps.users.models import Profile\n").text
    );
    assert.deepEqual(p.dependencies, [{ app: "orders", name: "0001_initial" }, { app: "users", name: "0003_y" }]);
    assert.deepEqual(p.operations.map((o) => o.kind), ["RemoveField"]);
    assert.equal(p.operations[0].kwargs.get("name"), '"note"');
    assert.deepEqual(p.modelImports.map((i) => i.module), ["apps.users.models"]);
    assert.equal(p.allows.get("remove-field"), "approved by Sami");
    assert.equal(p.allows.get("rename-field"), "approved by Sami");
  });

  it("reads field flags and CreateModel fields", () => {
    assert.deepEqual(fieldInfo("models.CharField(max_length=5, null=True)"), { type: "CharField", nullable: true, hasDefault: false });
    assert.deepEqual(fieldInfo('models.IntegerField(default=0)'), { type: "IntegerField", nullable: false, hasDefault: true });
    const op = parseMigration(initial.text).operations[0];
    assert.deepEqual(createModelFields(op).map((f) => f.name), ["id", "note", "code"]);
  });
});

describe("analyze", () => {
  it("is clean for a normal initial migration", () => {
    assert.deepEqual(rules([initial]), []);
  });

  it("flags destructive and risky operations", () => {
    const m = mig(
      "orders",
      "0002_risky",
      ["orders:0001_initial"],
      `        migrations.RemoveField(model_name="order", name="code"),
        migrations.DeleteModel(name="Legacy"),
        migrations.AddField(model_name="order", name="total", field=models.IntegerField()),
        migrations.AddField(model_name="order", name="ok", field=models.IntegerField(default=0)),
        migrations.AddField(model_name="order", name="tags", field=models.ManyToManyField(to="tags.tag")),
        migrations.AlterField(model_name="order", name="note", field=models.TextField()),
        migrations.RenameField(model_name="order", old_name="ok", new_name="okay"),
        migrations.RenameModel(old_name="Order", new_name="Purchase"),
        migrations.RunPython(forwards),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.RunSQL("UPDATE x SET y = 1"),
        migrations.AddIndex(model_name="purchase", index=models.Index(fields=["okay"], name="i")),`
    );
    const found = rules([initial, m], [m.path]).map((f) => `${f.severity}:${f.rule}:${f.line}`);
    assert.deepEqual(found, [
      "error:remove-field:10",
      "error:delete-model:11",
      "error:add-field-not-null:12",
      "warning:alter-field-not-null:15",
      "warning:rename-field:16",
      "warning:rename-model:17",
      "warning:run-python-irreversible:18",
      "warning:run-sql-irreversible:20",
      "info:blocking-index:21",
    ]);
  });

  it("only checks operations of migrations in scope", () => {
    const old = mig("orders", "0002_old", ["orders:0001_initial"], '        migrations.RemoveField(model_name="order", name="code"),');
    const fresh = mig("orders", "0003_new", ["orders:0002_old"], '        migrations.AddField(model_name="order", name="n", field=models.IntegerField(null=True)),');
    assert.deepEqual(rules([initial, old, fresh], [fresh.path]), []);
  });

  it("does not flag NOT NULL alters with a default or of unknown fields", () => {
    const m = mig(
      "orders",
      "0002_alter",
      ["orders:0001_initial"],
      `        migrations.AlterField(model_name="order", name="note", field=models.TextField(default="")),
        migrations.AlterField(model_name="order", name="unknown", field=models.TextField()),`
    );
    assert.deepEqual(rules([initial, m], [m.path]), []);
  });

  it("detects conflicting leaves and missing dependencies", () => {
    const a = mig("orders", "0002_a", ["orders:0001_initial"], "");
    const b = mig("orders", "0002_b", ["orders:0001_initial"], "");
    const c = mig("orders", "0003_c", ["orders:0002_missing"], "");
    const found = rules([initial, a, b, c], []).map((f) => `${f.rule}:${f.file.split("/").pop()}`);
    assert.ok(found.includes("missing-dependency:0003_c.py"));
    assert.deepEqual(found.filter((f) => f.startsWith("conflicting")).sort(), [
      "conflicting-leaves:0002_a.py",
      "conflicting-leaves:0002_b.py",
      "conflicting-leaves:0003_c.py",
    ]);
    const merge = mig("orders", "0003_merge", ["orders:0002_a", "orders:0002_b"], "");
    assert.deepEqual(rules([initial, a, b, merge], []), []);
  });

  it("treats squashed migrations as replacing the originals", () => {
    const a = mig("orders", "0002_a", ["orders:0001_initial"], "");
    const squash = { ...mig("orders", "0001_squashed_0002_a", [], ""), text: mig("orders", "0001_squashed_0002_a", [], "").text.replace("    dependencies", '    replaces = [("orders", "0001_initial"), ("orders", "0002_a")]\n    dependencies') };
    const next = mig("orders", "0003_b", ["orders:0002_a"], "");
    assert.deepEqual(rules([initial, a, squash, next], []), []);
  });

  it("reports edits, deletions and direct model imports", () => {
    const m = mig("orders", "0002_data", ["orders:0001_initial"], "        migrations.RunPython(f, migrations.RunPython.noop),", "from apps.orders.models import Order\n");
    const found = analyze({
      migrations: [initial, m],
      changes: new Map([
        [initial.path, "modified"],
        [m.path, "added"],
        ["apps/orders/migrations/0009_gone.py", "deleted"],
      ]),
    }).map((f) => f.rule);
    assert.deepEqual(found.sort(), ["deleted-migration", "direct-model-import", "edited-migration"]);
  });

  it("honours allow comments only with a reason", () => {
    const op = '        migrations.RemoveField(model_name="order", name="code"),';
    const withReason = mig("orders", "0002_a", ["orders:0001_initial"], op, "# migrations-guard: allow remove-field: column unused since v3, approved by Lina\n");
    const [f] = rules([initial, withReason], [withReason.path]);
    assert.equal(f.allowedReason, "column unused since v3, approved by Lina");
    const noReason = mig("orders", "0002_a", ["orders:0001_initial"], op, "# migrations-guard: allow remove-field\n");
    const [g] = rules([initial, noReason], [noReason.path]);
    assert.equal(g.allowedReason, undefined);
    assert.match(g.message, /needs a reason/);
  });
});
