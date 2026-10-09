import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { main } from "../../cli";
import { addMemory } from "../../memory/memory";
import { findRisks } from "../../report/risks";
import { BUILTIN_TASKS, buildPrompt, findTask, listTasks, parseTaskFile } from "../../tasks/library";
import { createCustomTask, taskFileText, writeRun } from "../../tasks/runs";

let root: string;
const write = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const run = (...argv: string[]): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: root, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-tasks-"));
  write("manage.py", "");
  write("config/settings.py", 'INSTALLED_APPS = [\n    "apps.accounts",\n    "apps.rfq",\n]\nROOT_URLCONF = "config.urls"\n');
  write("config/urls.py", 'from django.urls import include, path\nurlpatterns = [path("rfq/", include("apps.rfq.urls"))]\n');
  for (const app of ["accounts", "rfq"]) {
    write(`apps/${app}/__init__.py`, "");
    write(`apps/${app}/apps.py`, "");
  }
  write("apps/accounts/models.py", "class Company(models.Model):\n    pass\n");
  write("apps/rfq/models.py", "class Loop(models.Model):\n    company = models.ForeignKey('accounts.Company', on_delete=models.CASCADE)\n");
  write("apps/rfq/urls.py", "urlpatterns = []\n");
  write(".agent-studio/scaffold.json", '{ "referenceApp": "apps/rfq" }');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("task library", () => {
  it("has unique, complete built-in tasks", () => {
    const ids = BUILTIN_TASKS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const t of BUILTIN_TASKS) {
      assert.ok(t.icon && t.title && t.titleAr && t.description && t.prompt.length > 200, t.id);
      assert.equal(t.prompt.includes("{{input}}"), t.input !== undefined, t.id);
    }
  });

  it("builds an app prompt with the project context and the app's memory", () => {
    addMemory(root, { type: "gotcha", title: "Loops are copied, never edited", related: ["apps/rfq"], date: "2026-10-01" });
    addMemory(root, { type: "knowledge", title: "Unrelated", related: ["apps/accounts"], date: "2026-10-02" });
    const prompt = buildPrompt(root, findTask(listTasks(root), "write-tests")!, { app: "apps/rfq" });
    assert.match(prompt, /^# 🧪 Write tests: apps\/rfq/);
    assert.match(prompt, /Write automated tests for the `apps\/rfq` app\./);
    assert.match(prompt, /Reference app .*`apps\/rfq`/);
    assert.match(prompt, /models: Loop/);
    assert.match(prompt, /URL prefix: `\/rfq\/`/);
    assert.match(prompt, /depends on: `apps\/accounts`/);
    assert.match(prompt, /⚠️ gotcha: Loops are copied, never edited/);
    assert.doesNotMatch(prompt, /Unrelated/);
    assert.doesNotMatch(prompt, /\{\{/);
    // No tool installed yet: no CLI instructions for memory or doctor.
    assert.doesNotMatch(prompt, /memory search/);

    const accounts = buildPrompt(root, findTask(listTasks(root), "security-audit")!, { app: "apps/accounts" });
    assert.match(accounts, /used by: `apps\/rfq`/);
  });

  it("covers the whole project, requires an app or input when the task needs it", () => {
    const tasks = listTasks(root);
    assert.match(buildPrompt(root, findTask(tasks, "security-audit")!), /security audit of the whole project/);
    assert.throws(() => buildPrompt(root, findTask(tasks, "learn-app")!), /needs an app/);
    assert.throws(() => buildPrompt(root, findTask(tasks, "write-tests")!, { app: "apps/nope" }), /not a Django app/);
    assert.throws(() => buildPrompt(root, findTask(tasks, "new-section")!), /needs input/);
    assert.match(buildPrompt(root, findTask(tasks, "new-section")!, { input: "invoices: bill each accepted quote" }), /new section for this project: invoices: bill each accepted quote/);
  });

  it("loads custom tasks, which may replace a built-in one, and reports broken ones", () => {
    write(".agent-studio/tasks/check-translations.md", '---\ntitle: "Check translations"\nicon: 🌐\nscope: app\n---\nFind untranslated strings in {{target}} ({{app}}).\n');
    write(".agent-studio/tasks/write-tests.md", taskFileText({ ...findTask(BUILTIN_TASKS, "write-tests")!, prompt: "Use pytest only for {{target}}." }));
    write(".agent-studio/tasks/broken.md", "no frontmatter");
    write(".agent-studio/tasks/README.md", "ignored");
    const problems: string[] = [];
    const tasks = listTasks(root, problems);
    assert.deepEqual(problems, [".agent-studio/tasks/broken.md: missing the --- frontmatter"]);
    assert.equal(tasks.filter((t) => t.id === "write-tests").length, 1);
    assert.match(buildPrompt(root, findTask(tasks, "write-tests")!, { app: "apps/rfq" }), /Use pytest only for the `apps\/rfq` app\./);
    const custom = findTask(tasks, "check-translations")!;
    assert.equal(custom.path, ".agent-studio/tasks/check-translations.md");
    assert.match(buildPrompt(root, custom, { app: "apps/rfq" }), /Find untranslated strings in the `apps\/rfq` app \(apps\/rfq\)\./);

    assert.match(String(parseTaskFile("---\ntitle: x\nscope: everywhere\n---\nbody", "t/x.md")), /scope must be/);
    assert.match(String(parseTaskFile("---\ntitle: x\n---\nbody", "t/Bad Name.md")), /file name/);
  });

  it("writes git-ignored runs and keeps the newest 20", () => {
    const first = writeRun(root, "security-audit", "prompt 0", new Date("2026-10-09T10:00:00Z"));
    assert.equal(first, ".agent-studio/runs/20261009-100000-security-audit.md");
    assert.equal(writeRun(root, "security-audit", "again", new Date("2026-10-09T10:00:00Z")), ".agent-studio/runs/20261009-100000-security-audit-2.md");
    for (let i = 1; i <= 25; i++) {
      writeRun(root, "find-bugs", `prompt ${i}`, new Date(Date.UTC(2026, 9, 10, 0, 0, i)));
    }
    const dir = path.join(root, ".agent-studio", "runs");
    const runs = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    assert.equal(runs.length, 20);
    assert.ok(!runs.includes("20261009-100000-security-audit.md"));
    assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\*$/m);
  });

  it("does not flag custom tasks or runs as guardrail changes", () => {
    const files = [".agent-studio/tasks/check.md", ".agent-studio/runs/x.md"].map((p) => ({ path: p, status: "added" as const, added: 1, removed: 0 }));
    assert.deepEqual(findRisks(files, []), []);
    assert.equal(findRisks([{ path: ".agent-studio/rules.md", status: "modified", added: 1, removed: 0 }], []).length, 1);
  });
});

describe("tasks cli", () => {
  it("lists, shows and creates tasks", () => {
    const list = run("tasks", "list");
    assert.equal(list.code, 0);
    assert.match(list.out, /🔒 security-audit +Security audit/);
    assert.equal(JSON.parse(run("tasks", "list", "--json").out).length, BUILTIN_TASKS.length);

    write(".agent-studio/tool/cli.js", "");
    const show = run("tasks", "show", "learn-app", "--app", "apps/rfq/");
    assert.equal(show.code, 0, show.err);
    assert.match(show.out, /--related apps\/rfq/);
    assert.match(show.out, /node \.agent-studio\/tool\/cli\.js memory search <words>/);
    assert.match(show.out, /node \.agent-studio\/tool\/cli\.js doctor/);

    assert.equal(run("tasks", "show", "learn-app").code, 1);
    assert.equal(run("tasks", "show", "nope").code, 1);
    assert.equal(run("tasks", "show", "x", "--bogus").code, 2);

    assert.equal(run("tasks", "new", "check-translations").code, 0);
    assert.match(run("tasks", "new", "check-translations").err, /already exists/);
    assert.equal(run("tasks", "new", "my-audit", "--from", "security-audit").code, 0);
    assert.match(fs.readFileSync(path.join(root, ".agent-studio/tasks/my-audit.md"), "utf8"), /^title: "Security audit"/m);
    assert.throws(() => createCustomTask(root, "Bad Name"), /lowercase/);
    const all = run("tasks", "list");
    assert.match(all.out, /⭐ check-translations +My task: .*\(custom\)/);
    assert.match(all.out, /🔒 my-audit +Security audit/);
  });
});
