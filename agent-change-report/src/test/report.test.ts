import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, isEmptyDiff } from "../report/diff";
import { renderReport, verdictOf, Report } from "../report/render";
import { findRisks } from "../report/risks";
import { snapshot, SourceText } from "../report/snapshot";

const settings = (apps: string[]): SourceText => ({
  path: "config/settings.py",
  text: `INSTALLED_APPS = [\n${apps.map((a) => `    "${a}",`).join("\n")}\n]\nROOT_URLCONF = "config.urls"\n`,
});
const app = (dir: string, models: string, urls = ""): SourceText[] => [
  { path: `${dir}/__init__.py`, text: "" },
  { path: `${dir}/apps.py`, text: "" },
  { path: `${dir}/models.py`, text: models },
  { path: `${dir}/urls.py`, text: urls },
];

const base: SourceText[] = [
  { path: "manage.py", text: "" },
  settings(["apps.users", "apps.orders"]),
  { path: "config/urls.py", text: 'urlpatterns = [\n    path("orders/", include("apps.orders.urls")),\n]\n' },
  ...app("apps/users", "class Profile(models.Model):\n    name = models.CharField(max_length=5)\n"),
  ...app(
    "apps/orders",
    "class Order(models.Model):\n    total = models.IntegerField()\n    rank = models.IntegerField()\n",
    'urlpatterns = [path("", views.OrderList.as_view(), name="order-list")]\n'
  ),
];

const head: SourceText[] = [
  { path: "manage.py", text: "" },
  settings(["apps.users", "apps.orders", "apps.payments"]),
  { path: "config/urls.py", text: 'urlpatterns = [\n    path("orders/", include("apps.orders.urls")),\n    path("payments/", include("apps.payments.urls")),\n]\n' },
  ...app("apps/users", "class Profile(models.Model):\n    name = models.CharField(max_length=5)\n"),
  ...app(
    "apps/orders",
    'class Order(models.Model):\n    total = models.DecimalField(max_digits=9, decimal_places=2)\n    owner = models.ForeignKey("users.Profile", on_delete=models.CASCADE)\n',
    'urlpatterns = [\n    path("", views.OrderList.as_view(), name="order-list"),\n    path("<int:pk>/", views.OrderDetail.as_view(), name="order-detail"),\n]\n'
  ),
  ...app("apps/payments", "class Payment(models.Model):\n    order = models.ForeignKey(Order, on_delete=models.CASCADE)\n    amount = models.IntegerField()\n"),
  { path: "apps/payments/services.py", text: "from apps.orders.models import Order\n" },
];

describe("snapshot + diff", () => {
  const d = diffSnapshots(snapshot(base), snapshot(head));

  it("finds added apps, model and field changes", () => {
    assert.deepEqual(d.apps, { added: ["apps/payments"], removed: [] });
    const orders = d.models.find((m) => m.model === "Order")!;
    assert.equal(orders.kind, "changed");
    assert.deepEqual(
      orders.fields.map((f) => [f.name, f.from?.type, f.to?.type]),
      [["owner", undefined, "ForeignKey"], ["rank", "IntegerField", undefined], ["total", "IntegerField", "DecimalField"]]
    );
    const payment = d.models.find((m) => m.model === "Payment")!;
    assert.equal(payment.kind, "added");
    assert.deepEqual(payment.fields.map((f) => f.name), ["order", "amount"]);
    assert.ok(!d.models.some((m) => m.model === "Profile"));
  });

  it("finds URL and dependency changes", () => {
    assert.deepEqual(d.rootIncludes, { added: ["payments/ -> apps.payments.urls"], removed: [] });
    assert.deepEqual(d.appUrls["apps/orders"], { added: ["<int:pk>/|order-detail"], removed: [] });
    assert.deepEqual(d.deps, { added: ["apps/orders -> apps/users", "apps/payments -> apps/orders"], removed: [] });
  });

  it("is empty for identical snapshots", () => {
    assert.ok(isEmptyDiff(diffSnapshots(snapshot(base), snapshot(base))));
  });
});

describe("risks", () => {
  it("flags tooling, secrets, settings, deps, deleted tests and untested apps", () => {
    const risks = findRisks(
      [
        { path: ".migrations-guard/tool/cli.js", status: "modified" },
        { path: ".github/workflows/agent-guardrails.yml", status: "modified" },
        { path: ".env.production", status: "added" },
        { path: "config/settings.py", status: "modified" },
        { path: "requirements.txt", status: "modified" },
        { path: ".agent-change-report/tool/package.json", status: "modified" },
        { path: "apps/orders/models.py", status: "modified" },
        { path: "apps/orders/migrations/0002_x.py", status: "added" },
        { path: "apps/users/views.py", status: "modified" },
        { path: "apps/users/tests/test_views.py", status: "modified" },
        { path: "apps/legacy/tests.py", status: "deleted" },
        { path: "apps/orders/migrations/0001_initial.py", status: "deleted" },
      ],
      ["apps/orders", "apps/users", "apps/legacy"]
    );
    const byTitle = new Map(risks.map((r) => [r.title, r]));
    assert.deepEqual(byTitle.get("Agent guardrails or tooling changed")!.files, [".agent-change-report/tool/package.json", ".github/workflows/agent-guardrails.yml", ".migrations-guard/tool/cli.js"]);
    assert.equal(byTitle.get("Secrets or environment files changed")!.level, "red");
    assert.deepEqual(byTitle.get("Committed migrations deleted")!.files, ["apps/orders/migrations/0001_initial.py"]);
    assert.deepEqual(byTitle.get("Settings changed")!.files, ["config/settings.py"]);
    assert.deepEqual(byTitle.get("Dependencies changed")!.files, ["requirements.txt"]);
    assert.deepEqual(byTitle.get("Tests deleted")!.files, ["apps/legacy/tests.py"]);
    assert.deepEqual(byTitle.get("Code changed without test changes")!.files, ["apps/orders"]);
  });

  it("stays quiet for a tested app change", () => {
    assert.deepEqual(findRisks([{ path: "apps/a/views.py", status: "modified" }, { path: "apps/a/tests.py", status: "modified" }], ["apps/a"]), []);
  });
});

describe("render", () => {
  const diff = diffSnapshots(snapshot(base), snapshot(head));
  const report = (over: Partial<Report>): Report => ({
    branch: "agent/payments",
    base: "origin/main",
    mergeBase: "abcdef1234567",
    commits: [{ sha: "1234567", subject: "add payments" }],
    files: [{ path: "apps/payments/models.py", status: "added", added: 10, removed: 0 }],
    diff,
    risks: [],
    tools: [],
    verdict: "green",
    ...over,
  });

  it("computes verdicts", () => {
    assert.equal(verdictOf([], []), "green");
    assert.equal(verdictOf([{ level: "yellow", title: "t", why: "w", files: ["f"] }], []), "yellow");
    assert.equal(verdictOf([], [{ name: "g", state: "fail", summary: "", problems: [{ level: "red", text: "x" }] }]), "red");
    assert.equal(verdictOf([], [{ name: "g", state: "broken", summary: "", problems: [] }]), "yellow");
  });

  it("renders the Django-level summary", () => {
    const md = renderReport(report({}));
    assert.match(md, /🟢 \*\*No problems found\*\*/);
    assert.match(md, /`agent\/payments` vs `origin\/main` \(merge base `abcdef1`\) · 1 commit\(s\) · 1 file\(s\) · \+10 −0/);
    assert.match(md, /- ➕ `apps\/payments`/);
    assert.match(md, /\| orders \| Order \| ➕ owner \(ForeignKey → users.Profile\)<br>➖ rank \(IntegerField\)<br>✏️ total: IntegerField → DecimalField \|/);
    assert.match(md, /\| payments \| Payment \| ➕ new: order \(ForeignKey → Order\), amount \(IntegerField\) \|/);
    assert.match(md, /- ➕ `\/payments\/` → `apps.payments.urls`/);
    assert.match(md, /- ➕ orders: `<int:pk>\/` \(order-detail\)/);
    assert.match(md, /- ➕ payments → orders/);
    assert.ok(!md.includes("## Needs attention"));
    assert.ok(!md.includes("## Guardrails"));
  });

  it("renders problems, risks and guardrails with custom links", () => {
    const md = renderReport(
      report({
        verdict: "red",
        risks: [{ level: "yellow", title: "Settings changed", why: "Why.", files: ["config/settings.py"] }],
        tools: [
          { name: "Migrations Guard", state: "fail", summary: "1 error(s)", problems: [{ level: "red", text: "Migrations Guard `remove-field`: drops x.", file: "a/m.py", line: 3 }] },
          { name: "App structure", state: "missing", summary: "not installed", problems: [] },
        ],
      }),
      (p, line) => `[${p}${line ? `:${line}` : ""}](x)`
    );
    assert.match(md, /🔴 \*\*Needs changes before merging\*\* \(1 blocking, 1 to review\)/);
    assert.match(md, /## Needs attention\n\n- 🔴 Migrations Guard `remove-field`: drops x. \(\[a\/m.py:3\]\(x\)\)\n- 🟡 \*\*Settings changed\*\*: \[config\/settings.py\]\(x\). Why./);
    assert.match(md, /\| Migrations Guard \| ❌ 1 error\(s\) \|\n\| App structure \| ➖ not installed \|/);
  });
});
