import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseContextConfig, RULES_TEMPLATE } from "../context/config";
import { upsertBlock } from "../context/managedBlock";
import { summarizeProject } from "../context/projectMap";
import { BLOCK_END, BLOCK_START, cleanRules, demoteHeadings, renderBlock } from "../context/render";

const project = [
  { path: "manage.py", text: "" },
  { path: "config/settings.py", text: 'INSTALLED_APPS = [\n    "django.contrib.admin",\n    "apps.users",\n    "apps.orders",\n    "apps.invoices",\n]\nROOT_URLCONF = "config.urls"\n' },
  { path: "config/urls.py", text: 'urlpatterns = [\n    path("admin/", admin.site.urls),\n    path("orders/", include("apps.orders.urls")),\n    path("api/invoices/", include("apps.invoices.urls")),\n]\n' },
  { path: "apps/__init__.py", text: "" },
  { path: "apps/users/__init__.py", text: "" },
  { path: "apps/users/apps.py", text: "" },
  { path: "apps/users/models.py", text: "class Profile(models.Model):\n    name = models.CharField(max_length=10)\n" },
  { path: "apps/orders/__init__.py", text: "" },
  { path: "apps/orders/apps.py", text: "" },
  { path: "apps/orders/models.py", text: 'class Order(models.Model):\n    owner = models.ForeignKey("users.Profile", on_delete=models.CASCADE)\n\nclass OrderItem(models.Model):\n    order = models.ForeignKey(Order, on_delete=models.CASCADE)\n' },
  { path: "apps/orders/urls.py", text: "" },
  { path: "apps/invoices/__init__.py", text: "" },
  { path: "apps/invoices/apps.py", text: "" },
  { path: "apps/invoices/models/__init__.py", text: "" },
  { path: "apps/invoices/models/invoice.py", text: "class Invoice(models.Model):\n    order = models.OneToOneField(Order, on_delete=models.PROTECT)\n" },
  { path: "apps/invoices/services.py", text: "from apps.users.selectors import get_profile\nimport apps.orders.models\nfrom .models import Invoice\n" },
  { path: "apps/invoices/urls.py", text: "" },
];

describe("summarizeProject", () => {
  const s = summarizeProject(project, "apps/orders");

  it("detects apps, models, URL prefixes and settings", () => {
    assert.equal(s.isDjango, true);
    assert.deepEqual(s.settings, ["config/settings.py"]);
    assert.equal(s.rootUrls, "config/urls.py");
    assert.deepEqual(s.apps.map((a) => a.dir), ["apps/invoices", "apps/orders", "apps/users"]);
    const byDir = new Map(s.apps.map((a) => [a.dir, a]));
    assert.deepEqual(byDir.get("apps/orders")!.models, ["Order", "OrderItem"]);
    assert.deepEqual(byDir.get("apps/invoices")!.models, ["Invoice"]);
    assert.equal(byDir.get("apps/orders")!.urlPrefix, "/orders/");
    assert.equal(byDir.get("apps/invoices")!.urlPrefix, "/api/invoices/");
    assert.equal(byDir.get("apps/users")!.urlPrefix, undefined);
  });

  it("derives dependencies from relations and imports", () => {
    const byDir = new Map(s.apps.map((a) => [a.dir, a]));
    assert.deepEqual(byDir.get("apps/orders")!.dependsOn, ["apps/users"]);
    assert.deepEqual(byDir.get("apps/invoices")!.dependsOn, ["apps/orders", "apps/users"]);
    assert.deepEqual(byDir.get("apps/users")!.dependsOn, []);
  });

  it("reports non-Django folders", () => {
    assert.equal(summarizeProject([{ path: "tool.py", text: "print(1)" }]).isDjango, false);
  });
});

describe("render", () => {
  it("strips template comments and empty bullets", () => {
    const rules = cleanRules(RULES_TEMPLATE);
    assert.ok(!rules.includes("<!--"));
    assert.ok(!rules.includes("# Project rules"));
    assert.ok(!/^\s*-\s*$/m.test(rules));
    assert.match(rules, /## Commands/);
  });

  it("renders rules and the map deterministically", () => {
    const summary = summarizeProject(project, "apps/orders");
    const a = renderBlock("# Rules\n\n- Use services.py\n", summary, { maxModelsPerApp: 1 });
    assert.equal(a, renderBlock("# Rules\n\n- Use services.py\n", summary, { maxModelsPerApp: 1 }));
    assert.ok(a.startsWith(BLOCK_START) && a.endsWith(BLOCK_END));
    assert.match(a, /## Project rules\n\n- Use services.py/);
    assert.match(a, /\| `apps\/orders` \(reference\) \| Order \+1 more \| `\/orders\/` \| users \|/);
    assert.match(a, /\| `apps\/invoices` \| Invoice \| `\/api\/invoices\/` \| orders, users \|/);
    assert.match(a, /cloned from the approved reference app `apps\/orders`/);
  });

  it("nests rule headings outside code fences", () => {
    assert.equal(demoteHeadings("## Stack\n```\n# comment\n```\n# Top"), "### Stack\n```\n# comment\n```\n## Top");
    assert.match(renderBlock("## Stack\n- x\n", undefined, { maxModelsPerApp: 8 }), /## Project rules\n\n### Stack\n- x/);
  });

  it("omits empty sections", () => {
    const b = renderBlock(undefined, undefined, { maxModelsPerApp: 8 });
    assert.ok(!b.includes("## Project rules"));
    assert.ok(!b.includes("## Project map"));
  });
});

describe("upsertBlock", () => {
  const block = `${BLOCK_START}\nnew\n${BLOCK_END}`;

  it("creates, prepends and keeps titles", () => {
    assert.equal(upsertBlock(undefined, block), block + "\n");
    assert.equal(upsertBlock("Notes\n", block), `${block}\n\nNotes\n`);
    assert.equal(upsertBlock("# Title\n\nNotes\n", block), `# Title\n\n${block}\n\nNotes\n`);
  });

  it("replaces only the managed block", () => {
    const existing = `# T\n\nbefore\n${BLOCK_START}\nold\n${BLOCK_END}\nafter\n`;
    assert.equal(upsertBlock(existing, block), `# T\n\nbefore\n${block}\nafter\n`);
    assert.equal(upsertBlock(upsertBlock(existing, block), block), upsertBlock(existing, block));
  });

  it("keeps CRLF files CRLF", () => {
    const out = upsertBlock(`# T\r\n\r\nx\r\n`, block);
    assert.equal(out, `# T\r\n\r\n${BLOCK_START}\r\nnew\r\n${BLOCK_END}\r\n\r\nx\r\n`);
    assert.equal(upsertBlock(out, block), out);
  });

  it("refuses broken markers", () => {
    assert.throws(() => upsertBlock(`${BLOCK_START}\nx\n`, block));
    assert.throws(() => upsertBlock(`${BLOCK_END}\n${BLOCK_START}\n`, block));
    assert.throws(() => upsertBlock(`${BLOCK_START}${BLOCK_END}${BLOCK_START}${BLOCK_END}`, block));
  });
});

describe("config", () => {
  it("parses and validates", () => {
    assert.deepEqual(parseContextConfig('{"targets":["AGENTS.md"],"projectMap":false,"maxModelsPerApp":3}'), {
      config: { targets: ["AGENTS.md"], projectMap: false, maxModelsPerApp: 3 },
      errors: [],
    });
    const bad = parseContextConfig('{"targets":["../x.md"],"maxModelsPerApp":-1}');
    assert.equal(bad.errors.length, 2);
    assert.deepEqual(bad.config.targets, ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"]);
    assert.match(parseContextConfig("{").errors[0], /not valid JSON/);
  });
});
