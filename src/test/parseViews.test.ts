import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseViews } from "../analyzer/parseViews";

const VIEWS = `from django.shortcuts import render, get_object_or_404
from django.views.generic import ListView
from .models import Post, Author


def post_list(request):
    posts = Post.objects.all()
    return render(request, "blog/post_list.html", {"posts": posts})


def post_detail(request, pk):
    post = get_object_or_404(Post, pk=pk)
    return render(request, "blog/post_detail.html", {"post": post})


def helper(x, y):
    return x + y


class PostListView(ListView):
    model = Post
    template_name = "blog/post_archive.html"
    queryset = Post.objects.filter(published=True)


class NotAView:
    pass
`;

describe("parseViews", () => {
  it("finds function views only when first arg is request", () => {
    const views = parseViews(VIEWS);
    const names = views.map((v) => v.name);
    assert.ok(names.includes("post_list"));
    assert.ok(names.includes("post_detail"));
    assert.ok(names.includes("PostListView"));
    assert.ok(!names.includes("helper"));
    assert.ok(!names.includes("NotAView"));
  });

  it("captures templates and explicit model refs for FBVs", () => {
    const views = parseViews(VIEWS);
    const list = views.find((v) => v.name === "post_list")!;
    assert.equal(list.kind, "function");
    assert.deepEqual(
      list.templates.map((t) => t.name),
      ["blog/post_list.html"]
    );
    assert.ok(list.models.some((m) => m.name === "Post" && m.certain));
    const detail = views.find((v) => v.name === "post_detail")!;
    assert.ok(detail.models.some((m) => m.name === "Post"));
  });

  it("captures model/template_name/queryset for CBVs", () => {
    const views = parseViews(VIEWS);
    const cbv = views.find((v) => v.name === "PostListView")!;
    assert.equal(cbv.kind, "class");
    assert.ok(cbv.base.includes("ListView"));
    assert.deepEqual(
      cbv.templates.map((t) => t.name),
      ["blog/post_archive.html"]
    );
    assert.ok(cbv.models.some((m) => m.name === "Post"));
  });

  it("records 1-based line numbers", () => {
    const views = parseViews(VIEWS);
    assert.equal(views.find((v) => v.name === "post_list")!.line, 6);
  });
});
