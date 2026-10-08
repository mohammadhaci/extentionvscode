import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findProjectRoot, main } from "../cli";

let root: string;

const write = (rel: string, text: string): void => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const run = (...argv: string[]): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: root, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ctx-"));
  write("manage.py", "");
  write("config/settings.py", 'INSTALLED_APPS = [\n    "apps.orders",\n]\n');
  write("config/urls.py", 'urlpatterns = [path("orders/", include("apps.orders.urls"))]\n');
  write("apps/orders/__init__.py", "");
  write("apps/orders/apps.py", "");
  write("apps/orders/models.py", "class Order(models.Model):\n    pass\n");
  write("apps/orders/migrations/0001_initial.py", "class Migration: pass\n");
  write(".venv/lib/site.py", "class Fake(models.Model):\n    pass\n");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("cli", () => {
  it("prints usage and rejects bad input", () => {
    assert.equal(run("--help").code, 0);
    assert.equal(run().code, 2);
    assert.equal(run("sync", "--force").code, 2);
    assert.equal(run("nope").code, 2);
  });

  it("init creates the rules once", () => {
    assert.equal(run("init").code, 0);
    assert.ok(fs.existsSync(path.join(root, ".agent-context/rules.md")));
    assert.match(run("init").out, /already exists/);
  });

  it("sync writes all three targets, keeps user text, and check passes", () => {
    write("CLAUDE.md", "# Claude notes\n\nMy own note.\n");
    write(".agent-context/rules.md", "# Rules\n\n- Business logic goes in services.py\n");
    const r = run("sync");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /updated\s+CLAUDE\.md/);
    assert.match(r.out, /created\s+AGENTS\.md/);
    assert.match(r.out, /created\s+\.github\/copilot-instructions\.md/);
    for (const t of ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"]) {
      assert.match(read(t), /- Business logic goes in services\.py/);
      assert.match(read(t), /\| `apps\/orders` \| Order \| `\/orders\/` \| — \|/);
      assert.ok(!read(t).includes("Fake"));
    }
    assert.match(read("CLAUDE.md"), /^# Claude notes\n\n<!-- agent-context:start -->[\s\S]*<!-- agent-context:end -->\n\nMy own note\.\n$/);
    assert.equal(run("check").code, 0);
    assert.match(run("sync").out, /unchanged\s+AGENTS\.md/);
  });

  it("check fails after the project changes, sync fixes it", () => {
    write(".agent-context/rules.md", "- rule\n");
    run("sync");
    write("apps/orders/models.py", "class Order(models.Model):\n    pass\n\nclass Refund(models.Model):\n    pass\n");
    const c = run("check", "--json");
    assert.equal(c.code, 1);
    assert.equal(JSON.parse(c.out).results.every((r: { status: string }) => r.status === "stale"), true);
    assert.equal(run("sync").code, 0);
    assert.match(read("AGENTS.md"), /Order, Refund/);
    assert.equal(run("check").code, 0);
  });

  it("uses the scaffolder reference app and custom targets", () => {
    write(".django-scaffold.json", '{"referenceApp": "apps/orders"}');
    write(".agent-context/config.json", '{"targets": ["docs/AGENTS.md"]}');
    assert.equal(run("sync").code, 0);
    assert.match(read("docs/AGENTS.md"), /`apps\/orders` \(reference\)/);
    assert.ok(!fs.existsSync(path.join(root, "CLAUDE.md")));
  });

  it("reports broken markers without writing", () => {
    write("AGENTS.md", "<!-- agent-context:start -->\nhalf\n");
    const r = run("sync");
    assert.equal(r.code, 1);
    assert.match(r.out, /error\s+AGENTS\.md/);
    assert.equal(read("AGENTS.md"), "<!-- agent-context:start -->\nhalf\n");
  });

  it("finds the root from a subfolder", () => {
    assert.equal(findProjectRoot(path.join(root, "apps/orders")), root);
  });
});

describe("install-ci", () => {
  const wf = ".github/workflows/agent-guardrails.yml";

  it("writes the workflow, is idempotent, and protects customised copies", () => {
    const first = run("install-ci");
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /created\s+\.github\/workflows\/agent-guardrails\.yml/);
    assert.match(read(wf), /name: Agent guardrails/);
    assert.match(run("install-ci").out, /unchanged/);
    write(wf, read(wf) + "# custom\n");
    const refused = run("install-ci");
    assert.equal(refused.code, 1);
    assert.match(refused.err, /--force/);
    assert.match(read(wf), /# custom/);
    assert.match(run("install-ci", "--force").out, /updated/);
    assert.ok(!read(wf).includes("# custom"));
  });

  it("only accepts --force with install-ci", () => {
    assert.equal(run("sync", "--force").code, 2);
  });
});
