/* Django Visual Map — sidebar (Activity Bar view) summary.
 * UI languages: English, Deutsch, العربية (static in-repo dictionaries).
 */
(function () {
  "use strict";
  var vscode = acquireVsCodeApi();

  var I18N = {
    en: {
      sidebarTitle: "Django Map",
      working: "Working…",
      analyzing: "Analyzing…",
      retry: "Retry",
      emptyReasonFallback: "No Django project detected.",
      heuristicNotes: "Heuristic notes ({n})",
      andMoreFull: "…and {n} more (see full map).",
      openMap: "Open Project Map",
      refresh: "Refresh",
      appsHeader: "Apps",
      rowApps: "Apps",
      rowUrls: "URLs",
      rowViews: "Views",
      rowModels: "Models",
      rowRelations: "Relations",
      languageLabel: "Language",
      noFolder: "No folder is open.",
      noFolderSidebar: "Open a Django project folder to see its map summary.",
      analysisFailed: "Analysis failed."
    },
    de: {
      sidebarTitle: "Django-Karte",
      working: "Arbeite…",
      analyzing: "Analysiere…",
      retry: "Wiederholen",
      emptyReasonFallback: "Kein Django-Projekt gefunden.",
      heuristicNotes: "Heuristische Hinweise ({n})",
      andMoreFull: "…und {n} weitere (siehe Gesamtkarte).",
      openMap: "Projektkarte öffnen",
      refresh: "Aktualisieren",
      appsHeader: "Apps",
      rowApps: "Apps",
      rowUrls: "URLs",
      rowViews: "Views",
      rowModels: "Modelle",
      rowRelations: "Beziehungen",
      languageLabel: "Sprache",
      noFolder: "Kein Ordner geöffnet.",
      noFolderSidebar: "Django-Projektordner öffnen, um die Zusammenfassung zu sehen.",
      analysisFailed: "Analyse fehlgeschlagen."
    },
    ar: {
      sidebarTitle: "خريطة جانغو",
      working: "جارٍ العمل…",
      analyzing: "جارٍ التحليل…",
      retry: "إعادة المحاولة",
      emptyReasonFallback: "لم يتم العثور على مشروع جانغو.",
      heuristicNotes: "ملاحظات استدلالية ({n})",
      andMoreFull: "…و{n} أخرى (انظر الخريطة الكاملة).",
      openMap: "فتح خريطة المشروع",
      refresh: "تحديث",
      appsHeader: "التطبيقات",
      rowApps: "التطبيقات",
      rowUrls: "الروابط",
      rowViews: "العروض",
      rowModels: "النماذج",
      rowRelations: "العلاقات",
      languageLabel: "اللغة",
      noFolder: "لا يوجد مجلد مفتوح.",
      noFolderSidebar: "افتح مجلد مشروع جانغو لعرض الملخص.",
      analysisFailed: "فشل التحليل."
    }
  };
  var LANGS = ["en", "de", "ar"];
  var LANG_NAMES = { en: "English", de: "Deutsch", ar: "العربية" };

  var app = document.getElementById("app");

  function resolveLang(v) {
    return (v === "en" || v === "de" || v === "ar") ? v : "en";
  }
  function loadLang() {
    try {
      var s = vscode.getState();
      if (s && typeof s.lang === "string") {
        return resolveLang(s.lang);
      }
    } catch (e) { /* best-effort per webview */ }
    return "en";
  }

  var state = { map: null, error: null, progress: null, lang: loadLang() };

  function tr(key) {
    if (I18N[state.lang] && Object.prototype.hasOwnProperty.call(I18N[state.lang], key)) {
      return I18N[state.lang][key];
    }
    if (Object.prototype.hasOwnProperty.call(I18N.en, key)) {
      return I18N.en[key];
    }
    return key;
  }
  function fmt(tpl, params) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, name) {
      if (params && Object.prototype.hasOwnProperty.call(params, name)) {
        return String(params[name]);
      }
      return m;
    });
  }
  function applyLangDir() {
    try {
      document.documentElement.lang = state.lang;
      document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
    } catch (e) { /* ignore */ }
  }
  function saveLang() {
    try {
      var s = vscode.getState() || {};
      s.lang = state.lang;
      vscode.setState(s);
    } catch (e) { /* ignore */ }
  }
  function localizeProgress(msg) {
    if (msg === "Analyzing Django project…") {
      return tr("analyzing");
    }
    return msg;
  }
  function localizeMessage(msg) {
    if (msg === "No folder is open.") {
      return tr("noFolder");
    }
    if (msg === "Analysis failed.") {
      return tr("analysisFailed");
    }
    return msg;
  }
  function localizeDetail(detail) {
    if (!detail) {
      return "";
    }
    if (detail === "Open a Django project folder to see its map summary.") {
      return tr("noFolderSidebar");
    }
    return detail;
  }

  state.progress = tr("analyzing");
  applyLangDir();

  window.addEventListener("message", function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg.type !== "string") { return; }
    if (msg.type === "mapData") { state.map = msg.payload; state.error = null; render(); }
    else if (msg.type === "error") { state.error = msg.payload; render(); }
    else if (msg.type === "progress") { state.progress = localizeProgress((msg.payload && msg.payload.message) || tr("working")); render(); }
  });
  vscode.postMessage({ type: "ready" });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function warningsHtml(warnings, limit, moreKey) {
    var list = warnings || [];
    if (!list.length) { return ""; }
    var items = list.slice(0, limit).map(function (w) { return "<li>" + esc(w.message) + "</li>"; }).join("");
    var more = list.length > limit ? "<li>" + esc(fmt(tr(moreKey || "andMoreFull"), { n: list.length - limit })) + "</li>" : "";
    return '<div class="dvm-warn"><b>' + esc(fmt(tr("heuristicNotes"), { n: list.length })) + "</b><ul>" + items + more + "</ul></div>";
  }

  function langSelector() {
    var opts = LANGS.map(function (l) {
      return '<option value="' + l + '"' + (state.lang === l ? " selected" : "") + ">" + esc(LANG_NAMES[l]) + "</option>";
    }).join("");
    return '<div class="dvm-lang-wrap"><label class="dvm-lang-label" for="lang">' + esc(tr("languageLabel")) +
      '</label><select id="lang" class="dvm-select dvm-lang" aria-label="' + esc(tr("languageLabel")) + '">' + opts + "</select></div>";
  }

  function wireLang() {
    var sel = document.getElementById("lang");
    if (sel) {
      sel.addEventListener("change", function (ev) {
        state.lang = resolveLang(ev.target.value);
        saveLang();
        render();
      });
    }
  }

  function render() {
    applyLangDir();
    if (state.error) {
      app.innerHTML = '<div class="dvm-sidebar"><h1>' + esc(tr("sidebarTitle")) + "</h1>" + langSelector() +
        "<p><b>" + esc(localizeMessage(state.error.message)) + "</b></p>" +
        (localizeDetail(state.error.detail) ? "<p class='dvm-hint'>" + esc(localizeDetail(state.error.detail)) + "</p>" : "") +
        '<div class="actions"><button class="dvm-btn" id="retry">' + esc(tr("retry")) + "</button></div></div>";
      document.getElementById("retry").addEventListener("click", function () { vscode.postMessage({ type: "refresh" }); });
      wireLang();
      return;
    }
    if (!state.map) {
      app.innerHTML = '<div class="dvm-sidebar"><h1>' + esc(tr("sidebarTitle")) + "</h1>" + langSelector() +
        '<p class="dvm-hint">' + esc(state.progress || tr("working")) + "</p></div>";
      wireLang();
      return;
    }
    var m = state.map;
    if (m.isEmpty) {
      app.innerHTML = '<div class="dvm-sidebar"><h1>' + esc(tr("sidebarTitle")) + "</h1>" + langSelector() +
        "<p>" + esc(m.emptyReason || tr("emptyReasonFallback")) + "</p>" +
        warningsHtml(m.warnings, 5) +
        '<div class="actions"><button class="dvm-btn" id="retry">' + esc(tr("retry")) + "</button></div></div>";
      document.getElementById("retry").addEventListener("click", function () { vscode.postMessage({ type: "refresh" }); });
      wireLang();
      return;
    }
    var s = m.stats;
    var topApps = m.nodes.filter(function (n) { return n.kind === "app"; }).slice(0, 6);
    app.innerHTML = '<div class="dvm-sidebar"><h1>' + esc(m.workspaceName) + "</h1>" + langSelector() +
      '<div class="row"><span>' + esc(tr("rowApps")) + "</span><b>" + s.apps + "</b></div>" +
      '<div class="row"><span>' + esc(tr("rowUrls")) + "</span><b>" + s.urls + "</b></div>" +
      '<div class="row"><span>' + esc(tr("rowViews")) + "</span><b>" + s.views + "</b></div>" +
      '<div class="row"><span>' + esc(tr("rowModels")) + "</span><b>" + s.models + "</b></div>" +
      '<div class="row"><span>' + esc(tr("rowRelations")) + "</span><b>" + s.relations + "</b></div>" +
      (topApps.length ? "<h1 class='dvm-h1-gap'>" + esc(tr("appsHeader")) + "</h1>" + topApps.map(function (a) {
        return '<div class="row"><span dir="ltr">' + esc(a.label) + "</span><span class='dvm-hint'>" + esc(a.subtitle || "") + "</span></div>";
      }).join("") : "") +
      (m.warnings && m.warnings.length ? warningsHtml(m.warnings, 3) : "") +
      '<div class="actions"><button class="dvm-btn primary" id="open">' + esc(tr("openMap")) + '</button><button class="dvm-btn" id="refresh">' + esc(tr("refresh")) + "</button></div></div>";
    document.getElementById("open").addEventListener("click", function () { vscode.postMessage({ type: "openPanel" }); });
    document.getElementById("refresh").addEventListener("click", function () { vscode.postMessage({ type: "refresh" }); });
    wireLang();
  }
  render();
})();
