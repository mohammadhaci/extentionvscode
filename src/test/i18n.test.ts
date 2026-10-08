import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_LANGS,
  UI_STRINGS,
  dictKeys,
  formatTemplate,
  isSupportedLang,
  langDir,
  languageName,
  resolveLang,
  t,
  translate
} from "../shared/i18n";

describe("i18n dictionaries", () => {
  it("supports exactly en, de, ar", () => {
    assert.deepEqual([...SUPPORTED_LANGS], ["en", "de", "ar"]);
  });

  it("all dictionaries expose identical keys (no missing UI text)", () => {
    const base = dictKeys("en");
    assert.ok(base.length > 40, `expected a full UI dictionary, got ${base.length} keys`);
    for (const lang of SUPPORTED_LANGS) {
      assert.deepEqual(dictKeys(lang), base, `dictionary ${lang} diverges from en`);
    }
  });

  it("no translated value is empty", () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, value] of Object.entries(UI_STRINGS[lang])) {
        assert.ok(value.trim().length > 0, `${lang}.${key} must not be empty`);
      }
    }
  });

  it("non-English dictionaries actually differ from English", () => {
    for (const lang of ["de", "ar"] as const) {
      const same = dictKeys("en").filter((k) => UI_STRINGS[lang][k] === UI_STRINGS.en[k]);
      // A few proper nouns (titles) may legitimately match; most must differ.
      assert.ok(same.length < dictKeys("en").length / 2, `${lang} looks untranslated: ${same.join(",")}`);
    }
  });
});

describe("language helpers", () => {
  it("resolves unknown input to English", () => {
    assert.equal(resolveLang("de"), "de");
    assert.equal(resolveLang("ar"), "ar");
    assert.equal(resolveLang("fr"), "en");
    assert.equal(resolveLang(null), "en");
    assert.equal(resolveLang(undefined), "en");
    assert.equal(isSupportedLang("xx"), false);
  });

  it("falls back to English, then the key itself", () => {
    assert.equal(translate("de", "fit"), UI_STRINGS.de.fit);
    assert.equal(translate("ar", "noSuchKey"), "noSuchKey");
  });

  it("formats {placeholders} without touching unknown ones", () => {
    assert.equal(formatTemplate("a {n} b", { n: 3 }), "a 3 b");
    assert.equal(formatTemplate("a {missing} b", {}), "a {missing} b");
    assert.equal(t("en", "relationships", { n: 2 }), "Relationships (2)");
    assert.equal(t("de", "relationships", { n: 2 }), "Beziehungen (2)");
    assert.equal(t("ar", "relationships", { n: 2 }), "العلاقات (2)");
  });

  it("maps Arabic to RTL and others to LTR", () => {
    assert.equal(langDir("ar"), "rtl");
    assert.equal(langDir("en"), "ltr");
    assert.equal(langDir("de"), "ltr");
  });

  it("exposes native language names", () => {
    assert.equal(languageName("en"), "English");
    assert.equal(languageName("de"), "Deutsch");
    assert.equal(languageName("ar"), "العربية");
  });
});
