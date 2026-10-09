import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { STUDIO_VERSION } from "../../generated/version";
import { installedToolVersion, isToolFile, missingSkills, setUpProject } from "../../studio/install";
import { scoreOf } from "../../studio/score";
import { collectStatus, StudioStatus } from "../../studio/status";

/** Repository root (out/test/studio -> ../../..), holding out/ and agent-kit/. */
const EXT_ROOT = path.resolve(__dirname, "..", "..", "..");

const base: StudioStatus = {
  folder: "proj",
  django: { detected: true, apps: 3, models: 5 },
  git: true,
  tool: { installed: false, outdated: false },
  skills: { missing: ["django-new-app"] },
  ci: "missing",
  scaffold: { state: "off", ok: 0, total: 0 },
  context: { state: "off", stale: [] },
  guard: { state: "pass", errors: 0, warnings: 0 },
  report: { state: "pass", verdict: "green", files: 0, commits: 0 },
};
const allSet: StudioStatus = {
  ...base,
  tool: { installed: true, version: STUDIO_VERSION, outdated: false },
  skills: { missing: [] },
  ci: "installed",
  scaffold: { state: "pass", reference: "apps/orders", ok: 3, total: 3 },
  context: { state: "pass", stale: [] },
  report: { state: "pass", verdict: "green", files: 2, commits: 1 },
};

describe("score", () => {
  it("is sleepy, not worried, before setup when nothing fails", () => {
    const s = scoreOf(base);
    assert.equal(s.mood, "sleepy");
    assert.equal(s.level, 0);
    assert.equal(s.quests.find((q) => q.id === "green")!.done, false);
    assert.equal(s.health, 50);
  });

  it("is worried as soon as a check fails", () => {
    assert.equal(scoreOf({ ...allSet, guard: { state: "fail", errors: 2, warnings: 0 } }).mood, "worried");
    assert.equal(scoreOf({ ...allSet, report: { ...allSet.report, verdict: "red", state: "fail" } }).mood, "worried");
  });

  it("parties at 100 with every quest and badge", () => {
    const s = scoreOf(allSet);
    assert.equal(s.health, 100);
    assert.equal(s.mood, "party");
    assert.equal(s.level, 6);
    assert.ok(s.badges.every((b) => b.earned));
  });

  it("counts partial structure and outdated tools", () => {
    const s = scoreOf({ ...allSet, scaffold: { ...allSet.scaffold, state: "fail", ok: 1, total: 2 }, tool: { installed: true, version: "0.0.1", outdated: true } });
    assert.ok(s.health < 100 && s.health > 50, String(s.health));
    assert.equal(s.quests.find((q) => q.id === "tool")!.done, false);
    assert.equal(s.badges.find((b) => b.id === "template-keeper")!.earned, false);
  });

  it("scores 0 when there is nothing at all", () => {
    assert.equal(scoreOf({ ...base, django: { detected: false, apps: 0, models: 0 }, report: { state: "off", files: 0, commits: 0 }, guard: { state: "off", errors: 0, warnings: 0 } }).health, 0);
  });
});

describe("install", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-install-"));
    const w = (rel: string, text: string): void => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    w("manage.py", "");
    w("config/settings.py", 'INSTALLED_APPS = [\n    "apps.orders",\n]\n');
    w("config/urls.py", 'urlpatterns = [\n    path("orders/", include("apps.orders.urls")),\n]\n');
    w("apps/orders/__init__.py", "");
    w("apps/orders/apps.py", 'class OrdersConfig(AppConfig):\n    name = "apps.orders"\n');
    w("apps/orders/models.py", "class Order(models.Model):\n    total = models.IntegerField(null=True)\n");
    w("apps/orders/migrations/__init__.py", "");
    w("package.json", '{"type": "module"}');
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("keeps editor-only modules out of the tool", () => {
    assert.ok(isToolFile("cli.js"));
    assert.ok(isToolFile("guard/rules.js"));
    assert.ok(isToolFile("studio/paths.js"));
    for (const f of ["extension.js", "guard/ui.js", "map/ui.js", "skillsDashboard/skills/x.js", "test/a.test.js", "studio/home.js", "studio/setup.js", "analyzer/analyzeWorkspace.js", "cli.js.map"]) {
      assert.ok(!isToolFile(f), f);
    }
  });

  it("sets up a project whose CLI runs standalone, even under type: module", () => {
    const r = setUpProject(EXT_ROOT, root, { ci: "force" });
    assert.ok(r.toolFiles > 20);
    assert.equal(r.skills.length, 9);
    assert.equal(r.rulesCreated, true);
    assert.equal(r.ci, "created");
    assert.equal(installedToolVersion(root), STUDIO_VERSION);
    assert.deepEqual(missingSkills(root), []);
    const cli = path.join(root, ".agent-studio", "tool", "cli.js");
    assert.equal(execFileSync(process.execPath, [cli, "version"], { cwd: root, encoding: "utf8" }).trim(), STUDIO_VERSION);
    const usesVscode: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
        } else if (fs.readFileSync(p, "utf8").includes('require("vscode")')) {
          usesVscode.push(p);
        }
      }
    };
    walk(path.join(root, ".agent-studio", "tool"));
    assert.deepEqual(usesVscode, []);
  });

  it("collects a status the Home view can score", () => {
    setUpProject(EXT_ROOT, root, { ci: "force" });
    execFileSync(process.execPath, [path.join(root, ".agent-studio/tool/cli.js"), "context", "sync"], { cwd: root });
    const s = collectStatus(root);
    assert.equal(s.django.detected, true);
    assert.equal(s.django.apps, 1);
    assert.equal(s.tool.installed, true);
    assert.equal(s.ci, "installed");
    assert.equal(s.context.state, "pass");
    assert.equal(s.scaffold.state, "off");
    assert.equal(s.guard.state, "pass");
    assert.ok(scoreOf(s).health > 0);
  });
});
