import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverApps, findRootUrls } from "../../analyzer/appDiscovery";
import { parseSettings } from "../../analyzer/parseSettings";

describe("discoverApps", () => {
  const files = [
    "manage.py",
    "mysite/__init__.py",
    "mysite/settings.py",
    "mysite/urls.py",
    "blog/__init__.py",
    "blog/apps.py",
    "blog/models.py",
    "blog/views.py",
    "blog/urls.py",
    "shop/__init__.py",
    "shop/models.py",
    "shop/views.py",
    "utils/helpers.py",
    "blog/migrations/0001_initial.py"
  ];

  it("discovers apps with confidence levels", () => {
    const apps = discoverApps(files, ["django.contrib.admin", "blog.apps.BlogConfig", "shop"]);
    const blog = apps.find((a) => a.name === "blog")!;
    assert.equal(blog.dir, "blog");
    assert.equal(blog.confidence, "high");
    assert.equal(blog.files.models, "blog/models.py");
    const shop = apps.find((a) => a.name === "shop")!;
    assert.ok(["high", "medium"].includes(shop.confidence));
    // non-app dirs are excluded
    assert.ok(!apps.some((a) => a.dir === "utils" || a.dir === "mysite"));
    assert.ok(!apps.some((a) => a.dir === "blog/migrations"));
  });

  it("detects low-confidence app-like folders without package markers", () => {
    const apps = discoverApps(["legacy/models.py", "legacy/views.py", "legacy/urls.py"]);
    assert.equal(apps.length, 1);
    assert.equal(apps[0].confidence, "low");
  });
});

describe("findRootUrls", () => {
  it("maps ROOT_URLCONF dotted path to a file", () => {
    const files = ["mysite/urls.py", "blog/urls.py"];
    assert.equal(findRootUrls(files, "mysite.urls"), "mysite/urls.py");
  });

  it("falls back to conventional locations", () => {
    assert.equal(findRootUrls(["urls.py", "blog/urls.py"]), "urls.py");
  });
});

describe("parseSettings", () => {
  it("extracts INSTALLED_APPS and ROOT_URLCONF", () => {
    const info = parseSettings(`INSTALLED_APPS = [
    "django.contrib.admin",
    # "commented.out",
    "blog.apps.BlogConfig",
    "shop",
]
ROOT_URLCONF = "mysite.urls"
`);
    assert.deepEqual(info.installedApps, [
      "django.contrib.admin",
      "blog.apps.BlogConfig",
      "shop"
    ]);
    assert.equal(info.rootUrlconf, "mysite.urls");
    assert.equal(info.looksLikeDjango, true);
  });

  it("rejects non-django files", () => {
    const info = parseSettings("DEBUG = True\nALLOWED = []\n");
    assert.equal(info.looksLikeDjango, false);
  });
});
