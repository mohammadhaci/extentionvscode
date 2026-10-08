import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverApps } from "../analyzer/appDiscovery";
import { buildProjectMap, viewNameMentionsModel } from "../analyzer/graphBuilder";
import { parseModels } from "../analyzer/parseModels";
import { parseUrls } from "../analyzer/parseUrls";
import { parseViews } from "../analyzer/parseViews";
import type { ModelInfo } from "../analyzer/parseModels";
import type { ViewInfo } from "../analyzer/parseViews";

const MODELS_BLOG = `from django.db import models

class Author(models.Model):
    name = models.CharField(max_length=100)

class Post(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE)
    co_author = models.ForeignKey("Author", null=True, on_delete=models.SET_NULL)
    tags = models.ManyToManyField("blog.Tag")

class Tag(models.Model):
    label = models.CharField(max_length=50)
`;

const VIEWS_BLOG = `from django.shortcuts import render, get_object_or_404
from django.views.generic import ListView
from .models import Post

def post_list(request):
    posts = Post.objects.all()
    return render(request, "blog/post_list.html", {"posts": posts})

class PostListView(ListView):
    model = Post
    template_name = "blog/post_archive.html"
`;

const URLS_BLOG = `from django.urls import path
from . import views

urlpatterns = [
    path("", views.post_list, name="post-list"),
    path("archive/", views.PostListView.as_view(), name="post-archive"),
]
`;

const ROOT_URLS = `from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("blog/", include("blog.urls")),
]
`;

function buildSample() {
  const files = [
    "manage.py",
    "mysite/settings.py",
    "mysite/urls.py",
    "blog/__init__.py",
    "blog/models.py",
    "blog/views.py",
    "blog/urls.py"
  ];
  const installed = ["django.contrib.admin", "blog"];
  const apps = discoverApps(files, installed);
  return buildProjectMap({
    workspaceName: "sample",
    apps,
    modelsByFile: new Map([["blog/models.py", parseModels(MODELS_BLOG)]]),
    viewsByFile: new Map([["blog/views.py", parseViews(VIEWS_BLOG)]]),
    urlsByFile: new Map([
      ["blog/urls.py", parseUrls(URLS_BLOG)],
      ["mysite/urls.py", parseUrls(ROOT_URLS)]
    ]),
    rootUrlsFile: "mysite/urls.py",
    warnings: []
  });
}

describe("buildProjectMap", () => {
  it("builds stats for apps/urls/views/models/templates/relations", () => {
    const map = buildSample();
    assert.equal(map.isEmpty, false);
    assert.equal(map.stats.apps, 1);
    assert.equal(map.stats.models, 3);
    assert.equal(map.stats.views, 3); // post_list, PostListView + unresolved admin placeholder
    assert.equal(map.stats.templates, 2);
    assert.ok(map.stats.relations >= 3);
  });

  it("links app -> view/model, url -> view, view -> model/template", () => {
    const map = buildSample();
    const has = (t: string, f: string, to: string) =>
      map.edges.some((e) => e.type === t && e.from === f && e.to === to);
    assert.ok(has("contains", "app:blog", "view:blog:post_list"));
    assert.ok(has("contains", "app:blog", "model:blog:Post"));
    assert.ok(has("routes", "url:blog:post-list:4", "view:blog:post_list") || map.edges.some((e) => e.type === "routes" && e.to === "view:blog:post_list"));
    assert.ok(has("uses", "view:blog:post_list", "model:blog:Post"));
    assert.ok(
      map.edges.some((e) => e.type === "renders" && e.from === "view:blog:post_list")
    );
  });

  it("creates model relation edges with field-name labels", () => {
    const map = buildSample();
    const rels = map.edges.filter((e) => e.type === "rel-fk" || e.type === "rel-m2m");
    assert.ok(rels.length >= 3);
    assert.ok(rels.some((e) => e.label === "author" && e.from === "model:blog:Post" && e.to === "model:blog:Author"));
    assert.ok(rels.some((e) => e.type === "rel-m2m" && e.label === "tags"));
  });

  it("marks unresolved external views as uncertain placeholders", () => {
    const map = buildSample();
    const admin = map.nodes.find((n) => n.id.startsWith("view:?"));
    assert.ok(admin, "expected an unresolved placeholder view node");
    assert.equal(admin!.uncertain, true);
  });

  it("links include() to the target app", () => {
    const map = buildSample();
    assert.ok(
      map.edges.some((e) => e.type === "routes" && e.label === "include" && e.to === "app:blog")
    );
  });

  it("returns an empty map for non-django input", () => {
    const map = buildProjectMap({
      workspaceName: "empty",
      apps: [],
      modelsByFile: new Map(),
      viewsByFile: new Map(),
      urlsByFile: new Map(),
      warnings: []
    });
    assert.equal(map.isEmpty, true);
    assert.ok(map.emptyReason && map.emptyReason.length > 0);
  });
});

describe("viewNameMentionsModel (same-name heuristic)", () => {
  it("matches token/boundary names", () => {
    assert.equal(viewNameMentionsModel("PostListView", "post"), true);
    assert.equal(viewNameMentionsModel("post_detail", "post"), true);
    assert.equal(viewNameMentionsModel("BlogPostListView", "blogpost"), true);
    assert.equal(viewNameMentionsModel("blog_post_detail", "blogpost"), true);
  });

  it("rejects mere substrings", () => {
    assert.equal(viewNameMentionsModel("UserPostsView", "post"), false);
    assert.equal(viewNameMentionsModel("PosterView", "post"), false);
    assert.equal(viewNameMentionsModel("PostageView", "tag"), false);
    assert.equal(viewNameMentionsModel("PostView", "ox"), false);
  });

  it("links heuristic matches as uncertain without spurious edges", () => {
    const apps = discoverApps(["blog/models.py", "blog/views.py"], ["blog"]);
    const post: ModelInfo = { name: "Post", base: "models.Model", line: 1, fields: [], isModel: true };
    const bare = (name: string): ViewInfo => ({
      name,
      kind: "class",
      base: "View",
      line: 1,
      templates: [],
      models: []
    });
    const map = buildProjectMap({
      workspaceName: "heuristic",
      apps,
      modelsByFile: new Map([["blog/models.py", [post]]]),
      viewsByFile: new Map([
        ["blog/views.py", [bare("PostListView"), bare("post_detail"), bare("UserPostsView"), bare("PosterView")]]
      ]),
      urlsByFile: new Map(),
      warnings: []
    });
    const uses = map.edges.filter((e) => e.type === "uses");
    const targets = (view: string) => uses.filter((e) => e.from === `view:blog:${view}`).map((e) => e.to);
    assert.deepEqual(targets("PostListView"), ["model:blog:Post"]);
    assert.deepEqual(targets("post_detail"), ["model:blog:Post"]);
    assert.deepEqual(targets("UserPostsView"), []);
    assert.deepEqual(targets("PosterView"), []);
    for (const e of uses) {
      assert.equal(e.uncertain, true);
      assert.equal(e.label, "name heuristic");
    }
  });
});
