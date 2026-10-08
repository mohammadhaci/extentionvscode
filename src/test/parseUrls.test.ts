import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUrls, normalizeViewRef } from "../analyzer/parseUrls";

const URLS = `from django.contrib import admin
from django.urls import path, include
from . import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", views.post_list, name="post-list"),
    path("post/<int:pk>/", views.post_detail, name="post-detail"),
    path("archive/", views.PostListView.as_view(), name="post-archive"),
    path("shop/", include("shop.urls")),
    re_path(r"^legacy/(?P<slug>[-\\w]+)/$", views.legacy, name="legacy"),
    path(
        "multiline/",
        views.post_list,
        name="multiline",
    ),
]
`;

describe("parseUrls", () => {
  it("parses routes, view refs and names", () => {
    const patterns = parseUrls(URLS);
    const byName = Object.fromEntries(
      patterns.filter((p) => p.name).map((p) => [p.name, p])
    );
    assert.equal(byName["post-list"].route, "");
    assert.equal(byName["post-list"].viewRef, "views.post_list");
    assert.equal(byName["post-detail"].route, "post/<int:pk>/");
    assert.equal(byName["post-archive"].viewRef, "views.PostListView.as_view()");
    assert.equal(byName["legacy"].route, "^legacy/(?P<slug>[-\\w]+)/$");
  });

  it("detects include() with the target module", () => {
    const patterns = parseUrls(URLS);
    const inc = patterns.find((p) => p.isInclude)!;
    assert.equal(inc.route, "shop/");
    assert.equal(inc.includeModule, "shop.urls");
  });

  it("joins multi-line path() entries", () => {
    const patterns = parseUrls(URLS);
    assert.ok(patterns.some((p) => p.name === "multiline"));
  });

  it("reads every path() of a one-line list, each with its own name", () => {
    const patterns = parseUrls('urlpatterns = [path("", views.a, name="list"), path("<int:pk>/", views.b, name="detail")]\n');
    assert.deepEqual(patterns.map((p) => [p.route, p.name]), [["", "list"], ["<int:pk>/", "detail"]]);
  });

  it("does not read path() calls nested inside include([...]) as top-level", () => {
    const patterns = parseUrls('urlpatterns = [path("api/", include([path("x/", views.x)])), path("y/", views.y)]\n');
    assert.deepEqual(patterns.map((p) => p.route), ["api/", "y/"]);
  });

  it("normalizes view refs", () => {
    assert.equal(normalizeViewRef("views.PostListView.as_view()"), "PostListView");
    assert.equal(normalizeViewRef("views.post_list"), "post_list");
    assert.equal(normalizeViewRef("admin.site.urls"), "urls");
  });
});
