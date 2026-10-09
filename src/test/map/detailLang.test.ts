import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDetailLine,
  formatSubtitle,
  formatWarning,
  kindNoun,
  translateReason
} from "../../shared/detailLang";

describe("kind nouns", () => {
  it("translates all node kinds and passes unknown kinds through", () => {
    assert.equal(kindNoun("de", "model"), "Modell");
    assert.equal(kindNoun("de", "app"), "App");
    assert.equal(kindNoun("ar", "view"), "عرض");
    assert.equal(kindNoun("ar", "template"), "قالب");
    assert.equal(kindNoun("en", "url"), "url");
    assert.equal(kindNoun("de", "weird"), "weird");
  });
});

describe("model detail lines", () => {
  it("translates the Model title and preserves identifiers", () => {
    assert.equal(
      formatDetailLine("de", "model", "Model Post (models.Model)"),
      "Modell Post (models.Model)"
    );
    assert.equal(
      formatDetailLine("ar", "model", "Model Post (models.Model)"),
      "النموذج Post (models.Model)"
    );
  });

  it("leaves field and relation lines (identifiers) untouched", () => {
    for (const line of ["title: CharField", "author: ForeignKey → auth.User", "tags: ManyToManyField → blog.Tag"]) {
      assert.equal(formatDetailLine("de", "model", line), line);
      assert.equal(formatDetailLine("ar", "model", line), line);
    }
  });

  it("never applies another kind's template to model lines", () => {
    // A field literally starting with a label-like word stays verbatim.
    assert.equal(formatDetailLine("de", "model", "Name: CharField"), "Name: CharField");
  });

  it("round-trips English byte-for-byte", () => {
    assert.equal(
      formatDetailLine("en", "model", "Model Post (models.Model)"),
      "Model Post (models.Model)"
    );
  });
});

describe("app detail lines", () => {
  it("translates the candidate line with localized confidence", () => {
    assert.equal(
      formatDetailLine("de", "app", "Django app candidate (high confidence)"),
      "Django-App-Kandidat (Konfidenz: hoch)"
    );
    assert.equal(
      formatDetailLine("ar", "app", "Django app candidate (low confidence)"),
      "تطبيق جانغو مرشّح (الثقة: منخفضة)"
    );
  });

  it("translates Directory/Why labels and known reasons, preserving paths", () => {
    assert.equal(formatDetailLine("de", "app", "Directory: blog"), "Verzeichnis: blog");
    assert.equal(formatDetailLine("ar", "app", "Directory: ."), "الدليل: .");
    assert.equal(
      formatDetailLine("de", "app", "Why: listed in INSTALLED_APPS"),
      "Warum: in INSTALLED_APPS gelistet"
    );
    assert.equal(
      formatDetailLine("ar", "app", "Why: heuristic: Django-like files without package markers"),
      "السبب: استدلالي: ملفات شبيهة بجانغو دون علامات حزمة"
    );
  });

  it("keeps unknown reasons verbatim", () => {
    assert.equal(
      formatDetailLine("de", "app", "Why: some future heuristic v2"),
      "Warum: some future heuristic v2"
    );
    assert.equal(translateReason("ar", "custom"), "custom");
  });
});

describe("view detail lines", () => {
  it("translates view-kind labels and preserves class bases", () => {
    assert.equal(
      formatDetailLine("de", "view", "Class-based view (ListView)"),
      "Klassenbasierte View (ListView)"
    );
    assert.equal(formatDetailLine("ar", "view", "Function-based view"), "عرض مبني على دالة");
  });

  it("translates Models/Templates labels and preserves name lists and paths", () => {
    assert.equal(
      formatDetailLine("de", "view", "Models: Post, Comment"),
      "Modelle: Post, Comment"
    );
    assert.equal(
      formatDetailLine("ar", "view", "Templates: blog/post_list.html"),
      "القوالب: blog/post_list.html"
    );
    assert.equal(
      formatDetailLine("de", "view", "Models: none detected (heuristic may miss dynamic queries)"),
      "Modelle: keine erkannt (Heuristik übersieht ggf. dynamische Abfragen)"
    );
  });

  it("translates the unresolved-view explanation and preserves the ref", () => {
    const src = 'Referenced as "admin:index" but no matching view was found in scanned views.py files.';
    const de = formatDetailLine("de", "view", src);
    assert.ok(de.includes('"admin:index"'), `ref must survive: ${de}`);
    assert.ok(!de.includes("but no matching view"), `English prose must go: ${de}`);
    const ar = formatDetailLine("ar", "view", src);
    assert.ok(ar.includes('"admin:index"'));
  });
});

describe("url detail lines", () => {
  it("translates route labels and preserves routes, refs and names", () => {
    assert.equal(
      formatDetailLine("de", "url", "Route: /post/<int:pk>/"),
      "Route: /post/<int:pk>/"
    );
    assert.equal(
      formatDetailLine("ar", "url", "Route: /post/<int:pk>/"),
      "المسار: /post/<int:pk>/"
    );
    assert.equal(
      formatDetailLine("de", "url", "View ref: blog.views.post_detail"),
      "View-Referenz: blog.views.post_detail"
    );
    assert.equal(formatDetailLine("ar", "url", "Name: post-detail"), "الاسم: post-detail");
    assert.equal(
      formatDetailLine("de", "url", "Includes URLconf blog.urls"),
      "Bindet URLconf blog.urls ein"
    );
    assert.equal(
      formatDetailLine("ar", "url", "Route prefix: /blog/"),
      "بادئة المسار: /blog/"
    );
  });
});

describe("subtitles in the details pane", () => {
  it("localizes static subtitles and preserves identifier-heavy ones", () => {
    assert.equal(formatSubtitle("de", "3 fields"), "3 Felder");
    assert.equal(formatSubtitle("ar", "3 fields"), "3 حقول");
    assert.equal(formatSubtitle("de", "1 field"), "1 Feld");
    assert.equal(formatSubtitle("ar", "1 field"), "حقل واحد");
    assert.equal(formatSubtitle("de", "function view"), "Funktions-View");
    assert.equal(formatSubtitle("ar", "(project root)"), "(جذر المشروع)");
    assert.equal(formatSubtitle("de", "unresolved (external?)"), "nicht aufgelöst (extern?)");
    assert.equal(formatSubtitle("de", "ListView"), "ListView");
    assert.equal(formatSubtitle("ar", '→ blog:index · name="index"'), '→ blog:index · name="index"');
    assert.equal(formatSubtitle("de", "blog"), "blog");
  });
});

describe("warning templates", () => {
  it("translates known warnings and preserves identifiers, paths and numbers", () => {
    const w1 = 'View "PostList" references unknown model "Tag" (heuristic; may be external or mis-parsed).';
    const de1 = formatWarning("de", w1);
    assert.ok(de1.includes('"PostList"') && de1.includes('"Tag"'), de1);
    assert.ok(!de1.includes("references unknown model"), de1);

    const w2 = 'include("shop.urls") does not match a discovered app; link may be missing.';
    assert.ok(formatWarning("ar", w2).includes('"shop.urls"'));

    const w3 = "Could not parse view reference at blog/urls.py:12.";
    const de3 = formatWarning("de", w3);
    assert.ok(de3.includes("blog/urls.py:12"), de3);

    const w4 = 'Model "Post.author" targets unknown model "auth.User".';
    const ar4 = formatWarning("ar", w4);
    assert.ok(ar4.includes('"Post.author"') && ar4.includes('"auth.User"'), ar4);

    const w5 = "Skipped large file data/dump.py (300 KB > 256 KB cap).";
    const de5 = formatWarning("de", w5);
    assert.ok(de5.includes("data/dump.py") && de5.includes("300") && de5.includes("256"), de5);
  });

  it("translates the skip/read/parse wrappers but keeps decoder prose raw", () => {
    const w = "Skipped blog/views.py: invalid bytes at offset 42.";
    const de = formatWarning("de", w);
    assert.ok(de.includes("blog/views.py"), de);
    assert.ok(de.includes("invalid bytes at offset 42."), `decoder prose must survive: ${de}`);
    assert.ok(!de.startsWith("Skipped"), de);
  });

  it("passes unknown warnings through unchanged", () => {
    const w = "Something entirely new happened.";
    assert.equal(formatWarning("de", w), w);
    assert.equal(formatWarning("ar", w), w);
  });

  it("round-trips English warnings byte-for-byte", () => {
    const w = 'Model "Post.author" targets unknown model "auth.User".';
    assert.equal(formatWarning("en", w), w);
  });
});
