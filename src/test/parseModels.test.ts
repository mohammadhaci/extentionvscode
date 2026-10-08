import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseModels } from "../analyzer/parseModels";

const BLOG_MODELS = `from django.db import models


class Author(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)

    def __str__(self):
        return self.name


class Post(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE)
    tags = models.ManyToManyField("blog.Tag", blank=True)
    parent = models.ForeignKey("self", null=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["-id"]


class Profile(models.Model):
    user = models.OneToOneField("auth.User", on_delete=models.CASCADE)
    bio = models.TextField()


class PostForm:
    pass
`;

describe("parseModels", () => {
  it("finds model classes with 1-based line numbers", () => {
    const models = parseModels(BLOG_MODELS);
    assert.deepEqual(
      models.map((m) => m.name),
      ["Author", "Post", "Profile"]
    );
    assert.equal(models[0].line, 4);
    assert.equal(models[1].line, 12);
  });

  it("captures plain fields and relation fields with targets", () => {
    const models = parseModels(BLOG_MODELS);
    const post = models.find((m) => m.name === "Post")!;
    const byName = Object.fromEntries(post.fields.map((f) => [f.name, f]));
    assert.equal(byName["title"].fieldType, "CharField");
    assert.equal(byName["title"].relation, undefined);
    assert.equal(byName["author"].relation, "ForeignKey");
    assert.equal(byName["author"].relationTarget, "Author");
    assert.equal(byName["tags"].relation, "ManyToManyField");
    assert.equal(byName["tags"].relationTarget, "blog.Tag");
    assert.equal(byName["parent"].relationTarget, "self");
  });

  it("ignores non-model classes", () => {
    const models = parseModels(BLOG_MODELS);
    assert.ok(!models.some((m) => m.name === "PostForm"));
  });

  it("detects models.Model with module prefix variants", () => {
    const models = parseModels("from django.db.models import Model\n\n\nclass X(Model):\n    a = models.CharField(max_length=1)\n");
    assert.equal(models.length, 1);
    assert.equal(models[0].name, "X");
  });
});
