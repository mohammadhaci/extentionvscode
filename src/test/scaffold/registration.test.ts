import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, isRegistered, moduleCandidates, planSettingsRegistration, planUrlsRegistration } from "../../scaffold/registration";
import { buildRenamePairs, createRenamer } from "../../scaffold/rename";

const renamer = createRenamer(buildRenamePairs("orders", "invoices", "order", "invoice"));

describe("moduleCandidates", () => {
  it("lists dotted suffixes", () => {
    assert.deepEqual(moduleCandidates("src/apps/orders"), ["src.apps.orders", "apps.orders", "orders"]);
  });
});

describe("settings registration", () => {
  it("adds the app after the reference entry", () => {
    const text = 'INSTALLED_APPS = [\n    "django.contrib.admin",\n    "apps.orders",  # first section\n    "apps.users",\n]\n';
    const r = planSettingsRegistration(text, "apps/orders", renamer, "settings.py");
    assert.equal(r.edits.length, 1);
    assert.equal(
      applyEdits(text, r.edits),
      'INSTALLED_APPS = [\n    "django.contrib.admin",\n    "apps.orders",  # first section\n    "apps.invoices",  # first section\n    "apps.users",\n]\n'
    );
  });

  it("supports AppConfig paths and LOCAL_APPS lists", () => {
    const text = "LOCAL_APPS = [\n    'apps.orders.apps.OrdersConfig',\n]\nINSTALLED_APPS = DJANGO_APPS + LOCAL_APPS\n";
    const out = applyEdits(text, planSettingsRegistration(text, "apps/orders", renamer, "s.py").edits);
    assert.match(out, /'apps\.invoices\.apps\.InvoicesConfig',/);
  });

  it("inserts before a last entry without a trailing comma", () => {
    const text = 'INSTALLED_APPS = [\n    "django.contrib.admin",\n    "apps.orders"\n]\n';
    const out = applyEdits(text, planSettingsRegistration(text, "apps/orders", renamer, "s.py").edits);
    assert.equal(out, 'INSTALLED_APPS = [\n    "django.contrib.admin",\n    "apps.invoices",\n    "apps.orders"\n]\n');
  });

  it("does not register twice", () => {
    const text = 'INSTALLED_APPS = [\n    "apps.orders",\n    "apps.invoices",\n]\n';
    const r = planSettingsRegistration(text, "apps/orders", renamer, "s.py");
    assert.equal(r.edits.length, 0);
    assert.match(r.notes[0], /already registered/);
  });

  it("ignores files without app lists and look-alike entries", () => {
    assert.equal(planSettingsRegistration('X = ["apps.orders"]\n', "apps/orders", renamer, "s.py").edits.length, 0);
    const text = 'INSTALLED_APPS = [\n    "apps.orders_archive",\n]\n';
    assert.equal(planSettingsRegistration(text, "apps/orders", renamer, "s.py").edits.length, 0);
  });

  it("detects registration", () => {
    const settings = ['INSTALLED_APPS = [\n    "apps.orders.apps.OrdersConfig",\n]\n'];
    assert.equal(isRegistered(settings, "apps/orders"), true);
    assert.equal(isRegistered(settings, "apps/invoices"), false);
  });
});

describe("urls registration", () => {
  it("duplicates a one-line include", () => {
    const text = 'urlpatterns = [\n    path("admin/", admin.site.urls),\n    path("orders/", include("apps.orders.urls")),\n]\n';
    const r = planUrlsRegistration(text, "apps/orders", renamer, "urls.py");
    assert.equal(
      applyEdits(text, r.edits),
      'urlpatterns = [\n    path("admin/", admin.site.urls),\n    path("orders/", include("apps.orders.urls")),\n    path("invoices/", include("apps.invoices.urls")),\n]\n'
    );
  });

  it("duplicates a multi-line include with namespace", () => {
    const text = [
      "urlpatterns = [",
      "    path(",
      '        "api/orders/",',
      '        include(("apps.orders.api.urls", "orders"), namespace="orders"),',
      "    ),",
      "]",
      "",
    ].join("\n");
    const out = applyEdits(text, planUrlsRegistration(text, "apps/orders", renamer, "urls.py").edits);
    assert.match(out, /"api\/invoices\/",\n {8}include\(\("apps\.invoices\.api\.urls", "invoices"\), namespace="invoices"\),\n {4}\),\n\]/);
    assert.equal((out.match(/path\(/g) ?? []).length, 2);
  });

  it("adds a comma when the reference entry is last", () => {
    const text = 'urlpatterns = [\n    path("orders/", include("apps.orders.urls"))\n]\n';
    const out = applyEdits(text, planUrlsRegistration(text, "apps/orders", renamer, "urls.py").edits);
    assert.equal(out, 'urlpatterns = [\n    path("invoices/", include("apps.invoices.urls")),\n    path("orders/", include("apps.orders.urls"))\n]\n');
  });

  it("reports layouts it cannot edit safely", () => {
    const text = 'urlpatterns = [path("orders/", include("apps.orders.urls")), path("x/", v)]\n';
    const r = planUrlsRegistration(text, "apps/orders", renamer, "urls.py");
    assert.equal(r.edits.length, 0);
    assert.match(r.notes[0], /manually/);
  });

  it("ignores includes of other apps", () => {
    const text = 'urlpatterns = [\n    path("users/", include("apps.users.urls")),\n]\n';
    assert.deepEqual(planUrlsRegistration(text, "apps/orders", renamer, "urls.py"), { edits: [], notes: [] });
  });

  it("preserves CRLF", () => {
    const text = 'urlpatterns = [\r\n    path("orders/", include("apps.orders.urls")),\r\n]\r\n';
    const out = applyEdits(text, planUrlsRegistration(text, "apps/orders", renamer, "urls.py").edits);
    assert.equal(out, 'urlpatterns = [\r\n    path("orders/", include("apps.orders.urls")),\r\n    path("invoices/", include("apps.invoices.urls")),\r\n]\r\n');
  });
});
