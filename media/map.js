/* Django Visual Map — webview UI (vanilla JS, no dependencies).
 * Renders the ProjectMap payload as a navigable layered SVG graph.
 * Columns: apps | urls | views | models | templates.
 * UI languages: English, Deutsch, العربية (static in-repo dictionaries).
 */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();

  // ---------- static UI dictionaries (mirrors src/shared/i18n.ts) ----------
  var I18N = {
    en: {
      appTitle: "Django Visual Map",
      loading: "Loading…",
      working: "Working…",
      analyzing: "Analyzing…",
      errorTitle: "Could not build the project map",
      retryAnalysis: "Retry analysis",
      tipManage: "Tip: open a folder with {manage} or {settings} ({apps}).",
      emptyTitle: "No Django project detected",
      emptyReasonFallback: "Nothing to show.",
      stepOpenFolder: "Open a Django project folder ({menu}).",
      stepNeedFiles: "Make sure it has {manage}, {settings} with {apps}, or app folders with {models} / {views} / {urls}.",
      stepClickRetry: "Click {retry}.",
      fileOpenMenu: "File → Open Folder",
      heuristicNotes: "Heuristic notes ({n})",
      andMore: "…and {n} more.",
      searchPlaceholder: "Search nodes…  ( / )",
      searchAria: "Search nodes",
      filterByApp: "Filter by app",
      allApps: "All apps",
      heuristicOn: "~ heuristic: on",
      heuristicOff: "~ heuristic: off",
      heuristicToggleTitle: "Show/hide heuristic (uncertain) items",
      toggleKindTitle: "Toggle {kind}",
      zoomInTitle: "Zoom in (+)",
      zoomOutTitle: "Zoom out (−)",
      fitTitle: "Fit to view (0)",
      fit: "Fit",
      refresh: "Refresh",
      refreshTitle: "Re-run analysis",
      statApps: "apps",
      statUrls: "urls",
      statViews: "views",
      statModels: "models",
      statTemplates: "templates",
      statRelations: "relations",
      showing: "showing {shown}/{total} nodes",
      match: "{n} match {q}",
      heuristicSeeDetails: "{n} heuristic notes (see details)",
      legendUses: "uses/routes/contains",
      legendFk: "FK / one-to-one",
      legendM2m: "many-to-many",
      legendHeuristic: "dashed edge or ~ badge = heuristic guess",
      graphAria: "Project graph. Use plus, minus, zero keys to zoom and fit; tab moves between nodes.",
      selectHint: "Select a node to inspect it.",
      kindApp: "Apps",
      kindUrl: "URLs",
      kindView: "Views",
      kindModel: "Models",
      kindTemplate: "Templates",
      legendApp: "app",
      legendUrl: "url",
      legendView: "view",
      legendModel: "model",
      legendTemplate: "template",
      heuristicBadge: "~ heuristic",
      heuristicBadgeTitle: "Inferred heuristically — verify in source",
      heuristicVerify: "(heuristic — verify in source)",
      heuristicShort: "heuristic",
      appLabel: "App:",
      openSource: "Open source",
      relationships: "Relationships ({n})",
      noRels: "No relationships.",
      keyboardHint: "Keyboard: {tab} move · {enter} select · {plus}/{minus} zoom · {zero} fit · {slash} search",
      detailsLabel: "Selected element details",
      languageLabel: "Language",
      noFolder: "No folder is open.",
      noFolderDetail: "Open a folder containing a Django project, then run the Open Project Map command again.",
      analysisFailed: "Analysis failed.",
      detailModel: "Model {name} ({base})",
      detailAppCandidate: "Django app candidate ({confidence} confidence)",
      confHigh: "high",
      confMedium: "medium",
      confLow: "low",
      detailDirectory: "Directory: {dir}",
      detailWhy: "Why: {reason}",
      reasonInstalledMarkers: "listed in INSTALLED_APPS with Django package markers",
      reasonMultiMarkers: "package with multiple Django markers",
      reasonInstalled: "listed in INSTALLED_APPS",
      reasonMarkerFile: "package with a Django marker file",
      reasonHeuristicFiles: "heuristic: Django-like files without package markers",
      detailClassView: "Class-based view ({base})",
      detailFunctionView: "Function-based view",
      detailModels: "Models: {names}",
      detailModelsNone: "Models: none detected (heuristic may miss dynamic queries)",
      detailTemplates: "Templates: {names}",
      detailIncludes: "Includes URLconf {module}",
      detailRoute: "Route: {route}",
      detailRoutePrefix: "Route prefix: {route}",
      detailViewRef: "View ref: {ref}",
      detailUrlName: "Name: {name}",
      detailUnresolvedRef: 'Referenced as "{ref}" but no matching view was found in scanned views.py files.',
      detailUnresolvedCauses: "Common causes: django.contrib.admin, django.contrib.auth views, DRF routers, or string references.",
      subFieldsOne: "1 field",
      subFieldsMany: "{n} fields",
      subFunctionView: "function view",
      subProjectRoot: "(project root)",
      subUnresolved: "unresolved (external?)",
      warnUnknownModel: 'View "{view}" references unknown model "{model}" (heuristic; may be external or mis-parsed).',
      warnIncludeNoApp: 'include("{module}") does not match a discovered app; link may be missing.',
      warnParseViewRef: "Could not parse view reference at {file}:{line}.",
      warnUnknownTarget: 'Model "{model}" targets unknown model "{target}".',
      warnScanCap: "Scanned first {max} Python files (workspace hits the {max}-file scan cap); results may be partial. Narrow the folder excludes or split the workspace.",
      warnLargeFile: "Skipped large file {file} ({kb} KB > {cap} KB cap).",
      warnSkipped: "Skipped {file}: {reason}.",
      warnCouldNotRead: "Could not read {file}: {reason}",
      warnParseFailed: "Failed to parse {file} heuristically: {reason}",
      warnMarkersFound: "Django markers found (manage.py/settings/urls) but no app folders matched the discovery heuristic. Showing URL and view data without app grouping."
    },
    de: {
      appTitle: "Django Visual Map",
      loading: "Wird geladen…",
      working: "Arbeite…",
      analyzing: "Analysiere…",
      errorTitle: "Projektkarte konnte nicht erstellt werden",
      retryAnalysis: "Analyse wiederholen",
      tipManage: "Tipp: Ordner mit {manage} oder {settings} ({apps}) öffnen.",
      emptyTitle: "Kein Django-Projekt gefunden",
      emptyReasonFallback: "Nichts anzuzeigen.",
      stepOpenFolder: "Django-Projektordner öffnen ({menu}).",
      stepNeedFiles: "Er muss {manage}, {settings} mit {apps} oder App-Ordner mit {models} / {views} / {urls} enthalten.",
      stepClickRetry: "{retry} anklicken.",
      fileOpenMenu: "Datei → Ordner öffnen",
      heuristicNotes: "Heuristische Hinweise ({n})",
      andMore: "…und {n} weitere.",
      searchPlaceholder: "Knoten suchen…  ( / )",
      searchAria: "Knoten suchen",
      filterByApp: "Nach App filtern",
      allApps: "Alle Apps",
      heuristicOn: "~ Heuristik: an",
      heuristicOff: "~ Heuristik: aus",
      heuristicToggleTitle: "Heuristische (unsichere) Einträge ein-/ausblenden",
      toggleKindTitle: "{kind} umschalten",
      zoomInTitle: "Vergrößern (+)",
      zoomOutTitle: "Verkleinern (−)",
      fitTitle: "An Ansicht anpassen (0)",
      fit: "Anpassen",
      refresh: "Aktualisieren",
      refreshTitle: "Analyse erneut ausführen",
      statApps: "Apps",
      statUrls: "URLs",
      statViews: "Views",
      statModels: "Modelle",
      statTemplates: "Templates",
      statRelations: "Beziehungen",
      showing: "{shown}/{total} Knoten werden gezeigt",
      match: "{n} Treffer für {q}",
      heuristicSeeDetails: "{n} heuristische Hinweise (siehe Details)",
      legendUses: "verwendet/route/enthält",
      legendFk: "FK / Eins-zu-eins",
      legendM2m: "Viele-zu-viele",
      legendHeuristic: "gestrichelte Kante oder ~ = heuristische Vermutung",
      graphAria: "Projektgraph. Mit Plus, Minus und Null zoomen und anpassen; Tab wechselt zwischen Knoten.",
      selectHint: "Knoten auswählen, um ihn zu prüfen.",
      kindApp: "Apps",
      kindUrl: "URLs",
      kindView: "Views",
      kindModel: "Modelle",
      kindTemplate: "Templates",
      legendApp: "App",
      legendUrl: "URL",
      legendView: "View",
      legendModel: "Modell",
      legendTemplate: "Template",
      heuristicBadge: "~ Heuristik",
      heuristicBadgeTitle: "Heuristisch abgeleitet — in Quelle prüfen",
      heuristicVerify: "(heuristisch — in Quelle prüfen)",
      heuristicShort: "Heuristik",
      appLabel: "App:",
      openSource: "Quelle öffnen",
      relationships: "Beziehungen ({n})",
      noRels: "Keine Beziehungen.",
      keyboardHint: "Tastatur: {tab} bewegen · {enter} wählen · {plus}/{minus} zoomen · {zero} anpassen · {slash} suchen",
      detailsLabel: "Details zum ausgewählten Element",
      languageLabel: "Sprache",
      noFolder: "Kein Ordner geöffnet.",
      noFolderDetail: "Ordner mit einem Django-Projekt öffnen und dann den Befehl „Projektkarte öffnen“ erneut ausführen.",
      analysisFailed: "Analyse fehlgeschlagen.",
      detailModel: "Modell {name} ({base})",
      detailAppCandidate: "Django-App-Kandidat (Konfidenz: {confidence})",
      confHigh: "hoch",
      confMedium: "mittel",
      confLow: "niedrig",
      detailDirectory: "Verzeichnis: {dir}",
      detailWhy: "Warum: {reason}",
      reasonInstalledMarkers: "in INSTALLED_APPS mit Django-Paketmarkern gelistet",
      reasonMultiMarkers: "Paket mit mehreren Django-Markern",
      reasonInstalled: "in INSTALLED_APPS gelistet",
      reasonMarkerFile: "Paket mit einer Django-Markerdatei",
      reasonHeuristicFiles: "Heuristik: Django-ähnliche Dateien ohne Paketmarker",
      detailClassView: "Klassenbasierte View ({base})",
      detailFunctionView: "Funktionsbasierte View",
      detailModels: "Modelle: {names}",
      detailModelsNone: "Modelle: keine erkannt (Heuristik übersieht ggf. dynamische Abfragen)",
      detailTemplates: "Templates: {names}",
      detailIncludes: "Bindet URLconf {module} ein",
      detailRoute: "Route: {route}",
      detailRoutePrefix: "Routenpräfix: {route}",
      detailViewRef: "View-Referenz: {ref}",
      detailUrlName: "Name: {name}",
      detailUnresolvedRef: 'Als "{ref}" referenziert, aber keine passende View in den gescannten views.py-Dateien gefunden.',
      detailUnresolvedCauses: "Häufige Ursachen: django.contrib.admin, django.contrib.auth-Views, DRF-Router oder String-Referenzen.",
      subFieldsOne: "1 Feld",
      subFieldsMany: "{n} Felder",
      subFunctionView: "Funktions-View",
      subProjectRoot: "(Projektwurzel)",
      subUnresolved: "nicht aufgelöst (extern?)",
      warnUnknownModel: 'View "{view}" verweist auf unbekanntes Modell "{model}" (Heuristik; evtl. extern oder falsch geparst).',
      warnIncludeNoApp: 'include("{module}") passt zu keiner gefundenen App; Verknüpfung fehlt ggf.',
      warnParseViewRef: "View-Referenz unter {file}:{line} konnte nicht geparst werden.",
      warnUnknownTarget: 'Modell "{model}" verweist auf unbekanntes Modell "{target}".',
      warnScanCap: "Erste {max} Python-Dateien gescannt (Limit von {max} Dateien erreicht); Ergebnisse ggf. unvollständig. Ordner-Einschlüsse einschränken oder Workspace teilen.",
      warnLargeFile: "Große Datei {file} übersprungen ({kb} KB > Limit von {cap} KB).",
      warnSkipped: "{file} übersprungen: {reason}.",
      warnCouldNotRead: "{file} konnte nicht gelesen werden: {reason}",
      warnParseFailed: "{file} konnte nicht heuristisch geparst werden: {reason}",
      warnMarkersFound: "Django-Marker gefunden (manage.py/settings/urls), aber keine App-Ordner passten zur Erkennungsheuristik. URL- und View-Daten werden ohne App-Gruppierung gezeigt."
    },
    ar: {
      appTitle: "خريطة جانغو المرئية",
      loading: "جارٍ التحميل…",
      working: "جارٍ العمل…",
      analyzing: "جارٍ التحليل…",
      errorTitle: "تعذّر إنشاء خريطة المشروع",
      retryAnalysis: "إعادة التحليل",
      tipManage: "تلميح: افتح مجلدًا يحتوي على {manage} أو {settings} ({apps}).",
      emptyTitle: "لم يتم العثور على مشروع جانغو",
      emptyReasonFallback: "لا يوجد ما يُعرض.",
      stepOpenFolder: "افتح مجلد مشروع جانغو ({menu}).",
      stepNeedFiles: "تأكد من وجود {manage} أو {settings} مع {apps} أو مجلدات تطبيقات تحتوي على {models} / {views} / {urls}.",
      stepClickRetry: "انقر على {retry}.",
      fileOpenMenu: "ملف ← فتح مجلد",
      heuristicNotes: "ملاحظات استدلالية ({n})",
      andMore: "…و{n} أخرى.",
      searchPlaceholder: "ابحث في العقد…  ( / )",
      searchAria: "البحث في العقد",
      filterByApp: "تصفية حسب التطبيق",
      allApps: "كل التطبيقات",
      heuristicOn: "~ استدلالي: مفعّل",
      heuristicOff: "~ استدلالي: معطّل",
      heuristicToggleTitle: "إظهار/إخفاء العناصر الاستدلالية (غير المؤكدة)",
      toggleKindTitle: "تبديل {kind}",
      zoomInTitle: "تكبير (+)",
      zoomOutTitle: "تصغير (−)",
      fitTitle: "ملاءمة للعرض (0)",
      fit: "ملاءمة",
      refresh: "تحديث",
      refreshTitle: "إعادة تشغيل التحليل",
      statApps: "تطبيقات",
      statUrls: "روابط",
      statViews: "عروض",
      statModels: "نماذج",
      statTemplates: "قوالب",
      statRelations: "علاقات",
      showing: "عرض {shown}/{total} من العقد",
      match: "{n} مطابقة لـ {q}",
      heuristicSeeDetails: "{n} ملاحظات استدلالية (انظر التفاصيل)",
      legendUses: "يستخدم/يوجّه/يحتوي",
      legendFk: "مفتاح خارجي / واحد لواحد",
      legendM2m: "متعدد لمتعدد",
      legendHeuristic: "حافة متقطعة أو شارة ~ = تخمين استدلالي",
      graphAria: "رسم المشروع. استخدم مفاتيح زائد وناقص وصفر للتكبير والملاءمة؛ ومفتاح Tab للتنقل بين العقد.",
      selectHint: "حدّد عقدة لفحصها.",
      kindApp: "التطبيقات",
      kindUrl: "الروابط",
      kindView: "العروض",
      kindModel: "النماذج",
      kindTemplate: "القوالب",
      legendApp: "تطبيق",
      legendUrl: "رابط",
      legendView: "عرض",
      legendModel: "نموذج",
      legendTemplate: "قالب",
      heuristicBadge: "~ استدلالي",
      heuristicBadgeTitle: "مستنتَج استدلاليًا — تحقق في المصدر",
      heuristicVerify: "(استدلالي — تحقق في المصدر)",
      heuristicShort: "استدلالي",
      appLabel: "التطبيق:",
      openSource: "فتح المصدر",
      relationships: "العلاقات ({n})",
      noRels: "لا توجد علاقات.",
      keyboardHint: "لوحة المفاتيح: {tab} تنقّل · {enter} تحديد · {plus}/{minus} تكبير · {zero} ملاءمة · {slash} بحث",
      detailsLabel: "تفاصيل العنصر المحدد",
      languageLabel: "اللغة",
      noFolder: "لا يوجد مجلد مفتوح.",
      noFolderDetail: "افتح مجلدًا يحتوي على مشروع جانغو ثم نفّذ أمر فتح خريطة المشروع مرة أخرى.",
      analysisFailed: "فشل التحليل.",
      detailModel: "النموذج {name} ({base})",
      detailAppCandidate: "تطبيق جانغو مرشّح (الثقة: {confidence})",
      confHigh: "عالية",
      confMedium: "متوسطة",
      confLow: "منخفضة",
      detailDirectory: "الدليل: {dir}",
      detailWhy: "السبب: {reason}",
      reasonInstalledMarkers: "مدرج في INSTALLED_APPS مع علامات حزمة جانغو",
      reasonMultiMarkers: "حزمة بعدة علامات جانغو",
      reasonInstalled: "مدرج في INSTALLED_APPS",
      reasonMarkerFile: "حزمة مع ملف علامة جانغو",
      reasonHeuristicFiles: "استدلالي: ملفات شبيهة بجانغو دون علامات حزمة",
      detailClassView: "عرض مبني على صنف ({base})",
      detailFunctionView: "عرض مبني على دالة",
      detailModels: "النماذج: {names}",
      detailModelsNone: "النماذج: لم يُكتشف أي نموذج (قد تفوت الاستدلالات الاستعلامات الديناميكية)",
      detailTemplates: "القوالب: {names}",
      detailIncludes: "يتضمن إعدادات الروابط {module}",
      detailRoute: "المسار: {route}",
      detailRoutePrefix: "بادئة المسار: {route}",
      detailViewRef: "مرجع العرض: {ref}",
      detailUrlName: "الاسم: {name}",
      detailUnresolvedRef: 'مُشار إليه باسم "{ref}" لكن لم يتم العثور على عرض مطابق في ملفات views.py المفحوصة.',
      detailUnresolvedCauses: "الأسباب الشائعة: django.contrib.admin أو عروض django.contrib.auth أو موجّهات DRF أو مراجع نصية.",
      subFieldsOne: "حقل واحد",
      subFieldsMany: "{n} حقول",
      subFunctionView: "عرض دالّي",
      subProjectRoot: "(جذر المشروع)",
      subUnresolved: "غير محلول (خارجي؟)",
      warnUnknownModel: 'العرض "{view}" يشير إلى نموذج غير معروف "{model}" (استدلالي؛ قد يكون خارجيًا أو محلّلًا خطأً).',
      warnIncludeNoApp: 'الدالة include("{module}") لا تطابق أي تطبيق مكتشف؛ قد يكون الرابط مفقودًا.',
      warnParseViewRef: "تعذّر تحليل مرجع العرض في {file}:{line}.",
      warnUnknownTarget: 'النموذج "{model}" يستهدف نموذجًا غير معروف "{target}".',
      warnScanCap: "تم فحص أول {max} ملف بايثون (تم بلوغ حد الفحص {max} ملفًا)؛ قد تكون النتائج جزئية. ضيّق استثناءات المجلد أو قسّم مساحة العمل.",
      warnLargeFile: "تم تخطي الملف الكبير {file} ({kb} ك.ب > حد {cap} ك.ب).",
      warnSkipped: "تم تخطي {file}: {reason}.",
      warnCouldNotRead: "تعذّر قراءة {file}: {reason}",
      warnParseFailed: "تعذّر تحليل {file} استدلاليًا: {reason}",
      warnMarkersFound: "تم العثور على علامات جانغو (manage.py/settings/urls) لكن لا مجلد تطبيق طابق استدلال الاكتشاف. تُعرض بيانات الروابط والعروض دون تجميع حسب التطبيق."
    }
  };
  var LANGS = ["en", "de", "ar"];
  var LANG_NAMES = { en: "English", de: "Deutsch", ar: "العربية" };

  function resolveLang(v) {
    return (v === "en" || v === "de" || v === "ar") ? v : "en";
  }
  function tr(key) {
    var lang = resolveLang(state.lang);
    if (I18N[lang] && Object.prototype.hasOwnProperty.call(I18N[lang], key)) {
      return I18N[lang][key];
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
  // Code identifiers / file names stay verbatim (LTR via CSS) in every language.
  function code(name) {
    return '<code dir="ltr">' + esc(name) + "</code>";
  }
  // Known English host strings mapped to the active language; dynamic
  // analyzer output (emptyReason, error details) passes through untouched.
  function localizeProgress(msg) {
    if (msg === "Analyzing Django project…") {
      return tr("analyzing");
    }
    return msg;
  }
  function localizeErrorMessage(msg) {
    if (msg === "No folder is open.") {
      return tr("noFolder");
    }
    if (msg === "Analysis failed.") {
      return tr("analysisFailed");
    }
    return msg;
  }
  function localizeErrorDetail(detail) {
    if (!detail) {
      return "";
    }
    if (detail.indexOf("Open a folder containing a Django project") === 0) {
      return tr("noFolderDetail");
    }
    return detail;
  }

  // ---------- analyzer-text localization (display layer only) ----------
  // Mirrors src/shared/detailLang.ts. Anchored, kind-gated patterns re-emit
  // known analyzer templates through the dictionaries above; identifiers,
  // paths, routes, field lines and unknown text pass through verbatim.
  var KIND_NOUN_KEYS = { app: "legendApp", url: "legendUrl", view: "legendView", model: "legendModel", template: "legendTemplate" };
  function kindNoun(kind) {
    return KIND_NOUN_KEYS[kind] ? tr(KIND_NOUN_KEYS[kind]) : kind;
  }
  var KNOWN_REASONS = {
    "listed in INSTALLED_APPS with Django package markers": "reasonInstalledMarkers",
    "package with multiple Django markers": "reasonMultiMarkers",
    "listed in INSTALLED_APPS": "reasonInstalled",
    "package with a Django marker file": "reasonMarkerFile",
    "heuristic: Django-like files without package markers": "reasonHeuristicFiles"
  };
  function translateReason(reason) {
    return KNOWN_REASONS[reason] ? tr(KNOWN_REASONS[reason]) : reason;
  }
  function translateConfidence(c) {
    if (c === "high") { return tr("confHigh"); }
    if (c === "medium") { return tr("confMedium"); }
    if (c === "low") { return tr("confLow"); }
    return c;
  }
  function formatDetailLine(kind, line) {
    var m;
    if (kind === "model") {
      m = /^Model ([A-Za-z_]\w*) \((.*)\)$/.exec(line);
      if (m) {
        return fmt(tr("detailModel"), { name: m[1], base: m[2] });
      }
      return line;
    }
    if (kind === "app") {
      m = /^Django app candidate \((high|medium|low) confidence\)$/.exec(line);
      if (m) {
        return fmt(tr("detailAppCandidate"), { confidence: translateConfidence(m[1]) });
      }
      m = /^Directory: (.+)$/.exec(line);
      if (m) {
        return fmt(tr("detailDirectory"), { dir: m[1] });
      }
      m = /^Why: (.+)$/.exec(line);
      if (m) {
        return fmt(tr("detailWhy"), { reason: translateReason(m[1]) });
      }
      return line;
    }
    if (kind === "view") {
      m = /^Class-based view \((.*)\)$/.exec(line);
      if (m) {
        return fmt(tr("detailClassView"), { base: m[1] });
      }
      if (line === "Function-based view") {
        return tr("detailFunctionView");
      }
      if (line === "Models: none detected (heuristic may miss dynamic queries)") {
        return tr("detailModelsNone");
      }
      m = /^Models: (.+)$/.exec(line);
      if (m) {
        return fmt(tr("detailModels"), { names: m[1] });
      }
      m = /^Templates: (.+)$/.exec(line);
      if (m) {
        return fmt(tr("detailTemplates"), { names: m[1] });
      }
      m = /^Referenced as "(.*)" but no matching view was found in scanned views\.py files\.$/.exec(line);
      if (m) {
        return fmt(tr("detailUnresolvedRef"), { ref: m[1] });
      }
      if (line === "Common causes: django.contrib.admin, django.contrib.auth views, DRF routers, or string references.") {
        return tr("detailUnresolvedCauses");
      }
      return line;
    }
    if (kind === "url") {
      m = /^Includes URLconf (\S+)$/.exec(line);
      if (m) {
        return fmt(tr("detailIncludes"), { module: m[1] });
      }
      m = /^Route: (.*)$/.exec(line);
      if (m) {
        return fmt(tr("detailRoute"), { route: m[1] });
      }
      m = /^Route prefix: (.*)$/.exec(line);
      if (m) {
        return fmt(tr("detailRoutePrefix"), { route: m[1] });
      }
      m = /^View ref: (.+)$/.exec(line);
      if (m) {
        return fmt(tr("detailViewRef"), { ref: m[1] });
      }
      m = /^Name: (.+)$/.exec(line);
      if (m) {
        return fmt(tr("detailUrlName"), { name: m[1] });
      }
      return line;
    }
    return line;
  }
  function formatSubtitle(subtitle) {
    var f = /^(\d+) fields?$/.exec(subtitle);
    if (f) {
      if (f[1] === "1") {
        return tr("subFieldsOne");
      }
      return fmt(tr("subFieldsMany"), { n: f[1] });
    }
    if (subtitle === "function view") {
      return tr("subFunctionView");
    }
    if (subtitle === "(project root)") {
      return tr("subProjectRoot");
    }
    if (subtitle === "unresolved (external?)") {
      return tr("subUnresolved");
    }
    return subtitle;
  }
  function formatWarning(message) {
    var m = /^View "(.*)" references unknown model "(.*)" \(heuristic; may be external or mis-parsed\)\.$/.exec(message);
    if (m) {
      return fmt(tr("warnUnknownModel"), { view: m[1], model: m[2] });
    }
    m = /^include\("(.*)"\) does not match a discovered app; link may be missing\.$/.exec(message);
    if (m) {
      return fmt(tr("warnIncludeNoApp"), { module: m[1] });
    }
    m = /^Could not parse view reference at (.*):(\d+)\.$/.exec(message);
    if (m) {
      return fmt(tr("warnParseViewRef"), { file: m[1], line: m[2] });
    }
    m = /^Model "(.*)" targets unknown model "(.*)"\.$/.exec(message);
    if (m) {
      return fmt(tr("warnUnknownTarget"), { model: m[1], target: m[2] });
    }
    m = /^Scanned first (\d+) Python files \(workspace hits the (\d+)-file scan cap\); results may be partial\. Narrow the folder excludes or split the workspace\.$/.exec(message);
    if (m) {
      return fmt(tr("warnScanCap"), { max: m[1] });
    }
    m = /^Skipped large file (.*) \((\d+) KB > (\d+) KB cap\)\.$/.exec(message);
    if (m) {
      return fmt(tr("warnLargeFile"), { file: m[1], kb: m[2], cap: m[3] });
    }
    m = /^Skipped (.*?): (.*)\.$/.exec(message);
    if (m) {
      return fmt(tr("warnSkipped"), { file: m[1], reason: m[2] });
    }
    m = /^Could not read (.*?): (.*)$/.exec(message);
    if (m) {
      return fmt(tr("warnCouldNotRead"), { file: m[1], reason: m[2] });
    }
    m = /^Failed to parse (.*?) heuristically: (.*)$/.exec(message);
    if (m) {
      return fmt(tr("warnParseFailed"), { file: m[1], reason: m[2] });
    }
    if (message === "Django markers found (manage.py/settings/urls) but no app folders matched the discovery heuristic. Showing URL and view data without app grouping.") {
      return tr("warnMarkersFound");
    }
    return message;
  }

  function loadLang() {
    try {
      var s = vscode.getState();
      if (s && typeof s.lang === "string") {
        return resolveLang(s.lang);
      }
    } catch (e) { /* webview state unavailable — fall back to English */ }
    return "en";
  }
  function saveLang() {
    try {
      var s = vscode.getState() || {};
      s.lang = state.lang;
      vscode.setState(s);
    } catch (e) { /* persistence is best-effort per webview */ }
  }
  function applyLangDir() {
    try {
      document.documentElement.lang = state.lang;
      document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
    } catch (e) { /* ignore */ }
  }

  var KIND_COLORS = {
    app: "#8b5cf6",
    url: "#0ea5e9",
    view: "#f59e0b",
    model: "#22c55e",
    template: "#ec4899"
  };
  function kindLabels() {
    return { app: tr("kindApp"), url: tr("kindUrl"), view: tr("kindView"), model: tr("kindModel"), template: tr("kindTemplate") };
  }
  var COLS = ["app", "url", "view", "model", "template"];
  var NODE_W = 210, NODE_H = 42, COL_GAP = 90, ROW_GAP = 10;

  // ---------- zoom bounds (mirrors src/shared/zoom.ts) ----------
  var MIN_ZOOM = 0.2, MAX_ZOOM = 8, FIT_MAX_ZOOM = 1.5;
  var BUTTON_ZOOM_FACTOR = 1.2, WHEEL_ZOOM_FACTOR = 1.1;
  function clampZoom(k) {
    if (typeof k !== "number" || !isFinite(k)) {
      return 1;
    }
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
  }

  var state = {
    map: null,
    error: null,
    progress: null,
    selectedId: null,
    search: "",
    kinds: { app: true, url: true, view: true, model: true, template: true },
    appFilter: "all",
    showUncertain: true,
    lang: loadLang(),
    t: { x: 20, y: 50, k: 1 },
    positions: {},
    order: []
  };
  state.progress = tr("loading");
  var keyBound = false;

  var app = document.getElementById("app");
  var svgNS = "http://www.w3.org/2000/svg";

  applyLangDir();

  // ---------- messaging ----------
  window.addEventListener("message", function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg.type !== "string") { return; }
    if (msg.type === "mapData") {
      state.map = msg.payload;
      state.error = null;
      state.progress = null;
      if (!state.selectedId && msg.payload.nodes.length) {
        var firstApp = msg.payload.nodes.filter(function (n) { return n.kind === "app"; })[0];
        state.selectedId = (firstApp || msg.payload.nodes[0]).id;
      }
      render();
      fitToView();
    } else if (msg.type === "progress") {
      state.progress = localizeProgress((msg.payload && msg.payload.message) || tr("working"));
      render();
    } else if (msg.type === "error") {
      state.error = msg.payload;
      state.progress = null;
      render();
    }
  });
  vscode.postMessage({ type: "ready" });

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nodeById(id) {
    if (!state.map) { return null; }
    for (var i = 0; i < state.map.nodes.length; i++) {
      if (state.map.nodes[i].id === id) { return state.map.nodes[i]; }
    }
    return null;
  }
  function neighbors(id) {
    var set = {};
    state.map.edges.forEach(function (e) {
      if (e.from === id) { set[e.to] = e; }
      else if (e.to === id) { set[e.from] = e; }
    });
    return set;
  }
  function visibleNode(n) {
    if (!state.kinds[n.kind]) { return false; }
    if (state.appFilter !== "all" && n.kind !== "app") {
      var nb = neighbors(n.id);
      var inApp = (n.app === state.appFilter);
      if (!inApp) {
        // keep nodes connected to the selected app's nodes? No — strict filter.
        return false;
      }
      void nb;
    }
    if (!state.showUncertain && n.uncertain) { return false; }
    return true;
  }
  function matchesSearch(n) {
    if (!state.search) { return true; }
    var q = state.search.toLowerCase();
    return (n.label + " " + (n.subtitle || "") + " " + (n.file || "") + " " + (n.app || "")).toLowerCase().indexOf(q) >= 0;
  }

  // ---------- layout ----------
  function layout() {
    var cols = {};
    COLS.forEach(function (c) { cols[c] = []; });
    var nodes = state.map.nodes.slice().sort(function (a, b) {
      var ka = (a.app || "") + "\0" + a.label, kb = (b.app || "") + "\0" + b.label;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    // apps first sorted by label
    nodes.forEach(function (n) { cols[n.kind].push(n); });
    var pos = {};
    var maxH = 0;
    COLS.forEach(function (c, ci) {
      var x = 20 + ci * (NODE_W + COL_GAP);
      cols[c].forEach(function (n, ri) {
        pos[n.id] = { x: x, y: 60 + ri * (NODE_H + ROW_GAP), w: NODE_W, h: NODE_H };
      });
      maxH = Math.max(maxH, 60 + cols[c].length * (NODE_H + ROW_GAP));
    });
    state.positions = pos;
    var totalW = 20 + COLS.length * (NODE_W + COL_GAP);
    return { w: totalW, h: Math.max(maxH, 300) };
  }

  function edgePath(e) {
    var a = state.positions[e.from], b = state.positions[e.to];
    if (!a || !b) { return null; }
    var x1 = a.x + a.w, y1 = a.y + a.h / 2;
    var x2 = b.x, y2 = b.y + b.h / 2;
    if (x2 < x1) { // back-edge (e.g. self loop or include->app): draw loop below
      if (e.from === e.to) {
        return "M " + x1 + " " + (y1 - 8) + " C " + (x1 + 26) + " " + (y1 - 8) + ", " + (x1 + 26) + " " + (y1 + 8) + ", " + x1 + " " + (y1 + 8);
      }
      var mx = (x1 + x2) / 2;
      return "M " + x1 + " " + y1 + " C " + (x1 + 40) + " " + y1 + ", " + (x2 - 40) + " " + y2 + ", " + x2 + " " + y2 +
        " ".replace(" ", "");
    }
    var mx2 = (x1 + x2) / 2;
    return "M " + x1 + " " + y1 + " C " + mx2 + " " + y1 + ", " + mx2 + " " + y2 + ", " + x2 + " " + y2;
  }
  void edgePath;

  // ---------- render ----------
  function render() {
    applyLangDir();
    if (state.error) { renderError(); return; }
    if (!state.map) { renderProgress(); return; }
    if (state.map.isEmpty) { renderEmpty(); return; }
    renderFull();
  }

  function langOptions() {
    return LANGS.map(function (l) {
      return '<option value="' + l + '"' + (state.lang === l ? " selected" : "") + ">" + esc(LANG_NAMES[l]) + "</option>";
    }).join("");
  }

  function renderProgress() {
    app.innerHTML = '<div class="dvm-root"><div class="dvm-progress"><h1>' + esc(tr("appTitle")) + "</h1><p>" +
      esc(state.progress || tr("loading")) + "</p></div></div>";
  }

  function renderError() {
    var detail = localizeErrorDetail(state.error.detail);
    app.innerHTML = '<div class="dvm-root"><div class="dvm-error"><h1>' + esc(tr("errorTitle")) + "</h1><p><b>" +
      esc(localizeErrorMessage(state.error.message)) + "</b></p>" +
      (detail ? "<p class='dvm-hint'>" + esc(detail) + "</p>" : "") +
      '<p><button class="dvm-btn primary" id="retry">' + esc(tr("retryAnalysis")) + "</button></p>" +
      '<p class="dvm-hint">' + fmt(tr("tipManage"), { manage: code("manage.py"), settings: code("settings.py"), apps: code("INSTALLED_APPS") }) + "</p></div></div>";
    document.getElementById("retry").addEventListener("click", function () {
      state.error = null; state.progress = tr("analyzing"); render();
      vscode.postMessage({ type: "refresh" });
    });
  }

  function renderEmpty() {
    var m = state.map;
    app.innerHTML = '<div class="dvm-root"><div class="dvm-empty"><h1>' + esc(tr("emptyTitle")) + "</h1>" +
      "<p>" + esc(m.emptyReason || tr("emptyReasonFallback")) + "</p>" +
      "<ol><li>" + fmt(tr("stepOpenFolder"), { menu: esc(tr("fileOpenMenu")) }) + "</li>" +
      "<li>" + fmt(tr("stepNeedFiles"), { manage: code("manage.py"), settings: code("settings.py"), apps: code("INSTALLED_APPS"), models: code("models.py"), views: code("views.py"), urls: code("urls.py") }) + "</li>" +
      "<li>" + fmt(tr("stepClickRetry"), { retry: "<b>" + esc(tr("retryAnalysis")) + "</b>" }) + "</li></ol>" +
      '<p><button class="dvm-btn primary" id="retry">' + esc(tr("retryAnalysis")) + "</button></p>" +
      warningsHtml() + "</div></div>";
    document.getElementById("retry").addEventListener("click", function () {
      vscode.postMessage({ type: "refresh" });
    });
  }

  function warningsHtml() {
    var m = state.map;
    if (!m || !m.warnings.length) { return ""; }
    return '<div class="dvm-warn"><b>' + esc(fmt(tr("heuristicNotes"), { n: m.warnings.length })) + "</b><ul>" +
      m.warnings.slice(0, 8).map(function (w) { return "<li>" + esc(formatWarning(w.message)) + "</li>"; }).join("") +
      (m.warnings.length > 8 ? "<li>" + esc(fmt(tr("andMore"), { n: m.warnings.length - 8 })) + "</li>" : "") + "</ul></div>";
  }

  function renderFull() {
    var m = state.map;
    var KIND_LABELS = kindLabels();
    var size = layout();
    var apps = m.nodes.filter(function (n) { return n.kind === "app"; });
    var appOptions = ['<option value="all">' + esc(tr("allApps")) + "</option>"].concat(apps.map(function (a) {
      return '<option value="' + esc(a.label) + '"' + (state.appFilter === a.label ? " selected" : "") + ">" + esc(a.label) + "</option>";
    })).join("");

    var chips = COLS.map(function (k) {
      return '<span class="dvm-chip" role="button" tabindex="0" data-kind="' + k + '" aria-pressed="' + state.kinds[k] + '" title="' + esc(fmt(tr("toggleKindTitle"), { kind: KIND_LABELS[k] })) + '">' +
        '<span class="dvm-dot bg-' + k + '"></span>' + esc(KIND_LABELS[k]) + "</span>";
    }).join("");

    app.innerHTML =
      '<div class="dvm-root" role="application" aria-label="' + esc(tr("appTitle")) + '">' +
      '<div class="dvm-toolbar">' +
      '<input id="q" class="dvm-search" type="search" placeholder="' + esc(tr("searchPlaceholder")) + '" aria-label="' + esc(tr("searchAria")) + '" value="' + esc(state.search) + '">' +
      '<div class="dvm-filters">' + chips + "</div>" +
      '<select id="appf" class="dvm-select" aria-label="' + esc(tr("filterByApp")) + '">' + appOptions + "</select>" +
      '<button id="unc" class="dvm-btn" aria-pressed="' + state.showUncertain + '" title="' + esc(tr("heuristicToggleTitle")) + '">' + esc(state.showUncertain ? tr("heuristicOn") : tr("heuristicOff")) + "</button>" +
      '<span class="dvm-lang-wrap"><label class="dvm-lang-label" for="lang">' + esc(tr("languageLabel")) + '</label><select id="lang" class="dvm-select dvm-lang" aria-label="' + esc(tr("languageLabel")) + '">' + langOptions() + "</select></span>" +
      '<span class="spacer"></span>' +
      '<button id="zin" class="dvm-btn" title="' + esc(tr("zoomInTitle")) + '">+</button>' +
      '<button id="zout" class="dvm-btn" title="' + esc(tr("zoomOutTitle")) + '">−</button>' +
      '<button id="fit" class="dvm-btn" title="' + esc(tr("fitTitle")) + '">' + esc(tr("fit")) + "</button>" +
      '<button id="refresh" class="dvm-btn" title="' + esc(tr("refreshTitle")) + '">' + esc(tr("refresh")) + "</button>" +
      "</div>" +
      '<div class="dvm-stats" id="stats"></div>' +
      '<div class="dvm-legend"><span><span class="dvm-dot bg-app"></span> ' + esc(tr("legendApp")) + "</span>" +
      "<span><span class='dvm-dot bg-url'></span> " + esc(tr("legendUrl")) + "</span>" +
      "<span><span class='dvm-dot bg-view'></span> " + esc(tr("legendView")) + "</span>" +
      "<span><span class='dvm-dot bg-model'></span> " + esc(tr("legendModel")) + "</span>" +
      "<span><span class='dvm-dot bg-template'></span> " + esc(tr("legendTemplate")) + "</span>" +
      "<span><span class='edge-sample'></span>" + esc(tr("legendUses")) + "</span>" +
      "<span><span class='edge-sample dashed'></span>" + esc(tr("legendFk")) + "</span>" +
      "<span><span class='edge-sample dotted'></span>" + esc(tr("legendM2m")) + "</span>" +
      "<span>" + esc(tr("legendHeuristic")) + "</span></div>" +
      '<div class="dvm-main"><div class="dvm-canvas-wrap" id="wrap">' +
      '<svg id="cv" tabindex="0" role="group" aria-label="' + esc(tr("graphAria")) + '"></svg>' +
      "</div>" +
      '<aside class="dvm-side" id="details" aria-live="polite" aria-label="' + esc(tr("detailsLabel")) + '"></aside>' +
      "</div></div>";

    renderStats(size);
    renderSvg(size);
    renderDetails();

    // wire controls
    var q = document.getElementById("q");
    q.addEventListener("input", function () { state.search = q.value; renderSvg(size); renderStats(size); });
    document.querySelectorAll(".dvm-chip").forEach(function (chip) {
      var toggle = function () {
        var k = chip.getAttribute("data-kind");
        state.kinds[k] = !state.kinds[k];
        chip.setAttribute("aria-pressed", String(state.kinds[k]));
        renderSvg(size);
      };
      chip.addEventListener("click", toggle);
      chip.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
      });
    });
    document.getElementById("appf").addEventListener("change", function (ev) {
      state.appFilter = ev.target.value; renderSvg(size);
    });
    document.getElementById("unc").addEventListener("click", function (ev) {
      state.showUncertain = !state.showUncertain;
      ev.target.textContent = state.showUncertain ? tr("heuristicOn") : tr("heuristicOff");
      ev.target.setAttribute("aria-pressed", String(state.showUncertain));
      renderSvg(size);
    });
    document.getElementById("lang").addEventListener("change", function (ev) {
      setLang(ev.target.value);
    });
    document.getElementById("zin").addEventListener("click", function () { zoom(BUTTON_ZOOM_FACTOR); });
    document.getElementById("zout").addEventListener("click", function () { zoom(1 / BUTTON_ZOOM_FACTOR); });
    document.getElementById("fit").addEventListener("click", fitToView);
    document.getElementById("refresh").addEventListener("click", function () {
      state.progress = tr("analyzing"); vscode.postMessage({ type: "refresh" });
    });
    if (!keyBound) {
      document.addEventListener("keydown", onKey);
      keyBound = true;
    }
  }

  function setLang(l) {
    var next = resolveLang(l);
    if (next === state.lang) {
      return;
    }
    state.lang = next;
    saveLang();
    render();
  }

  function renderStats(size) {
    var m = state.map, s = m.stats;
    var shown = m.nodes.filter(visibleNode).length;
    var q = state.search ? ' · <span>' + esc(fmt(tr("match"), { n: m.nodes.filter(function (n) { return visibleNode(n) && matchesSearch(n); }).length, q: state.search })) + "</span>" : "";
    document.getElementById("stats").innerHTML =
      "<span class='dvm-stat'><b>" + s.apps + "</b> " + esc(tr("statApps")) + "</span>" +
      "<span class='dvm-stat'><b>" + s.urls + "</b> " + esc(tr("statUrls")) + "</span>" +
      "<span class='dvm-stat'><b>" + s.views + "</b> " + esc(tr("statViews")) + "</span>" +
      "<span class='dvm-stat'><b>" + s.models + "</b> " + esc(tr("statModels")) + "</span>" +
      "<span class='dvm-stat'><b>" + s.templates + "</b> " + esc(tr("statTemplates")) + "</span>" +
      "<span class='dvm-stat'><b>" + s.relations + "</b> " + esc(tr("statRelations")) + "</span>" +
      "<span class='dvm-hint'>" + esc(fmt(tr("showing"), { shown: shown, total: m.nodes.length })) + q + "</span>" +
      (m.warnings.length ? " <span class='dvm-hint'>· " + esc(fmt(tr("heuristicSeeDetails"), { n: m.warnings.length })) + "</span>" : "");
    void size;
  }

  function renderSvg(size) {
    var KIND_LABELS = kindLabels();
    var svg = document.getElementById("cv");
    while (svg.firstChild) { svg.removeChild(svg.firstChild); }
    svg.setAttribute("viewBox", "0 0 " + size.w + " " + size.h);

    var g = document.createElementNS(svgNS, "g");
    g.setAttribute("id", "viewport");
    applyTransform(g);
    svg.appendChild(g);

    // column titles
    COLS.forEach(function (c, ci) {
      var t = document.createElementNS(svgNS, "text");
      t.setAttribute("x", String(20 + ci * (NODE_W + COL_GAP)));
      t.setAttribute("y", "30");
      t.setAttribute("class", "dvm-col-title");
      t.textContent = KIND_LABELS[c] + " (" + state.map.nodes.filter(function (n) { return n.kind === c; }).length + ")";
      g.appendChild(t);
    });

    var vis = {};
    state.map.nodes.forEach(function (n) { vis[n.id] = visibleNode(n); });
    var match = {};
    state.map.nodes.forEach(function (n) { match[n.id] = matchesSearch(n); });
    var nb = state.selectedId ? neighbors(state.selectedId) : {};

    // edges under nodes
    state.map.edges.forEach(function (e) {
      if (!vis[e.from] || !vis[e.to]) { return; }
      var p = state.positions[e.from], q2 = state.positions[e.to];
      if (!p || !q2) { return; }
      var cls = "dvm-edge";
      if (e.type === "rel-fk") { cls += " rel-o2o e-fk"; }
      else if (e.type === "rel-o2o") { cls += " rel-o2o e-o2o"; }
      else if (e.type === "rel-m2m") { cls += " rel-m2m e-m2m"; }
      if (e.uncertain) { cls += " uncertain"; }
      var isNb = state.selectedId && (e.from === state.selectedId || e.to === state.selectedId);
      if (isNb) { cls += " highlight"; }
      else if (state.selectedId && !(match[e.from] && match[e.to])) { cls += " dim"; }
      if (e.from === e.to) {
        // self-loop
        var path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", "M " + (p.x + p.w) + " " + (p.y + 14) + " c 24 -2, 24 22, 0 20");
        path.setAttribute("class", cls);
        appendTitle(path, edgeTip(e));
        g.appendChild(path);
      } else {
        var x1 = p.x + p.w, y1 = p.y + p.h / 2, x2 = q2.x, y2 = q2.y + q2.h / 2;
        var mx = (x1 + x2) / 2;
        var d = "M " + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2;
        var el = document.createElementNS(svgNS, "path");
        el.setAttribute("d", d);
        el.setAttribute("class", cls);
        appendTitle(el, edgeTip(e));
        g.appendChild(el);
        if (e.label && isNb) {
          var lbl = document.createElementNS(svgNS, "text");
          lbl.setAttribute("x", String(mx - 10));
          lbl.setAttribute("y", String((y1 + y2) / 2 - 4));
          lbl.setAttribute("class", "dvm-edge-label");
          lbl.textContent = e.label;
          g.appendChild(lbl);
        }
      }
    });

    // nodes
    state.order = [];
    state.map.nodes.forEach(function (n) {
      var p = state.positions[n.id];
      if (!p) { return; }
      var grp = document.createElementNS(svgNS, "g");
      grp.setAttribute("class", nodeClass(n, nb, match[n.id], vis[n.id]));
      grp.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
      grp.setAttribute("tabindex", "0");
      grp.setAttribute("role", "button");
      grp.setAttribute("aria-label", kindNoun(n.kind) + " " + n.label + (n.file ? ", " + n.file : ""));
      grp.setAttribute("data-id", n.id);

      var rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("width", String(p.w));
      rect.setAttribute("height", String(p.h));
      rect.setAttribute("rx", "7");
      rect.setAttribute("class", "body");
      rect.setAttribute("stroke", KIND_COLORS[n.kind]);
      grp.appendChild(rect);

      var bar = document.createElementNS(svgNS, "rect");
      bar.setAttribute("width", "4");
      bar.setAttribute("height", String(p.h));
      bar.setAttribute("rx", "2");
      bar.setAttribute("fill", KIND_COLORS[n.kind]);
      grp.appendChild(bar);

      var label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", "12");
      label.setAttribute("y", "18");
      label.textContent = truncate(n.label + (n.uncertain ? " ~" : ""), 26);
      grp.appendChild(label);

      var sub = document.createElementNS(svgNS, "text");
      sub.setAttribute("x", "12");
      sub.setAttribute("y", "32");
      sub.setAttribute("class", "sub");
      sub.setAttribute("fill", "var(--vscode-descriptionForeground)");
      sub.textContent = truncate(n.subtitle || n.file || "", 30);
      grp.appendChild(sub);

      appendTitle(grp, n.kind + ": " + n.label + (n.file ? "\n" + n.file + (n.line ? ":" + n.line : "") : "") + (n.uncertain ? "\n" + tr("heuristicVerify") : ""));
      grp.addEventListener("click", function () { select(n.id); });
      grp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(n.id); }
        else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
          ev.preventDefault(); moveSelection(ev.key);
        }
      });
      g.appendChild(grp);
      if (vis[n.id]) { state.order.push(n.id); }
    });

    enablePanZoom(svg, g);
  }

  function nodeClass(n, nb, isMatch, isVis) {
    var c = "dvm-node";
    if (state.selectedId === n.id) { c += " selected"; }
    else if (state.selectedId && nb[n.id]) { c += " neighbor"; }
    if (!isVis) { c += " hidden"; }
    else if (!isMatch || (state.selectedId && state.selectedId !== n.id && !nb[n.id] && state.search)) { c += " dim"; }
    else if (state.selectedId && state.selectedId !== n.id && !nb[n.id]) { c += " dim"; }
    return c;
  }

  function edgeTip(e) {
    var a = nodeById(e.from), b = nodeById(e.to);
    var t = e.type;
    if (t === "rel-fk") { t = "ForeignKey"; }
    else if (t === "rel-o2o") { t = "OneToOne"; }
    else if (t === "rel-m2m") { t = "ManyToMany"; }
    return t + ": " + (a ? a.label : e.from) + " → " + (b ? b.label : e.to) + (e.label ? " (" + e.label + ")" : "") + (e.uncertain ? " [" + tr("heuristicShort") + "]" : "");
  }

  function appendTitle(el, text) {
    var t = document.createElementNS(svgNS, "title");
    t.textContent = text;
    el.appendChild(t);
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function renderDetails() {
    var box = document.getElementById("details");
    var n = state.selectedId ? nodeById(state.selectedId) : null;
    if (!n) {
      box.innerHTML = '<p class="dvm-hint">' + esc(tr("selectHint")) + "</p>" + warningsHtml();
      return;
    }
    var nb = neighbors(n.id);
    var relItems = Object.keys(nb).map(function (id) {
      var o = nodeById(id);
      var e = nb[id];
      if (!o) { return ""; }
      return '<li><button data-open="' + esc(id) + '">' + esc(o.label) + "</button> " +
        '<span class="dvm-hint">' + esc(kindNoun(o.kind)) + (e.uncertain ? " ~" : "") + "</span></li>";
    }).join("");
    box.innerHTML =
      '<span class="dvm-kind ' + n.kind + '">' + esc(kindNoun(n.kind)) + "</span>" +
      (n.uncertain ? '<span class="dvm-badge" title="' + esc(tr("heuristicBadgeTitle")) + '">' + esc(tr("heuristicBadge")) + "</span>" : "") +
      "<h2>" + esc(n.label) + "</h2>" +
      (n.subtitle ? '<p class="dvm-hint">' + esc(formatSubtitle(n.subtitle)) + "</p>" : "") +
      (n.file ? '<p class="dvm-kv"><code dir="ltr">' + esc(n.file) + (n.line ? ":" + n.line : "") + "</code></p>" : "") +
      (n.app ? '<p class="dvm-kv">' + esc(tr("appLabel")) + " <code dir=\"ltr\">" + esc(n.app) + "</code></p>" : "") +
      ((n.detail && n.detail.length) ? '<div class="dvm-kv">' + n.detail.map(function (d) { return "<div>" + esc(formatDetailLine(n.kind, d)) + "</div>"; }).join("") + "</div>" : "") +
      (n.file ? '<p><button class="dvm-btn primary" id="openf">' + esc(tr("openSource")) + "</button></p>" : "") +
      "<h3 class='dvm-h3'>" + esc(fmt(tr("relationships"), { n: Object.keys(nb).length })) + "</h3>" +
      (relItems ? '<ul class="dvm-rel-list">' + relItems + "</ul>" : '<p class="dvm-hint">' + esc(tr("noRels")) + "</p>") +
      warningsHtml() +
      '<p class="dvm-hint">' + fmt(tr("keyboardHint"), {
        tab: "<kbd dir=\"ltr\">Tab</kbd>",
        enter: "<kbd dir=\"ltr\">Enter</kbd>",
        plus: "<kbd dir=\"ltr\">+</kbd>",
        minus: "<kbd dir=\"ltr\">−</kbd>",
        zero: "<kbd dir=\"ltr\">0</kbd>",
        slash: "<kbd dir=\"ltr\">/</kbd>"
      }) + "</p>";

    var openBtn = document.getElementById("openf");
    if (openBtn && n.file) {
      (function (file, line) {
        openBtn.addEventListener("click", function () {
          vscode.postMessage({ type: "openFile", payload: { file: file, line: line } });
        });
      })(n.file, n.line);
    }
    box.querySelectorAll("[data-open]").forEach(function (btn) {
      btn.addEventListener("click", function () { select(btn.getAttribute("data-open")); });
    });
  }

  function select(id) {
    state.selectedId = id;
    var size = { w: 0, h: 0 };
    renderSvg(layout());
    renderDetails();
    // move focus to selected node for keyboard users
    var svg = document.getElementById("cv");
    var el = svg.querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (el) { el.focus({ preventScroll: true }); }
    void size;
  }

  function moveSelection(key) {
    if (!state.order.length) { return; }
    var i = state.order.indexOf(state.selectedId);
    if (key === "ArrowRight" || key === "ArrowDown") { i = (i + 1) % state.order.length; }
    else { i = (i - 1 + state.order.length) % state.order.length; }
    select(state.order[i]);
  }

  // ---------- zoom / pan ----------
  function applyTransform(g) {
    g.setAttribute("transform", "translate(" + state.t.x + "," + state.t.y + ") scale(" + state.t.k + ")");
  }
  function zoom(f) {
    if (typeof f !== "number" || !(f > 0)) {
      return;
    }
    state.t.k = clampZoom(state.t.k * f);
    var g = document.getElementById("viewport");
    if (g) { applyTransform(g); }
  }
  function zoomAtPoint(f, cx, cy) {
    if (typeof f !== "number" || !(f > 0)) {
      return;
    }
    var oldK = clampZoom(state.t.k);
    var nextK = clampZoom(oldK * f);
    if (nextK !== oldK && typeof cx === "number" && typeof cy === "number" && isFinite(cx) && isFinite(cy)) {
      var ratio = nextK / oldK;
      state.t.x = cx - (cx - state.t.x) * ratio;
      state.t.y = cy - (cy - state.t.y) * ratio;
    }
    state.t.k = nextK;
    var g = document.getElementById("viewport");
    if (g) { applyTransform(g); }
  }
  function fitToView() {
    var svg = document.getElementById("cv");
    var wrap = document.getElementById("wrap");
    if (!svg || !wrap || !state.map) { return; }
    var r = wrap.getBoundingClientRect();
    var size = layout();
    var k = Math.min((r.width - 40) / size.w, (r.height - 40) / size.h, FIT_MAX_ZOOM);
    k = Math.max(MIN_ZOOM, k || 0.5);
    state.t = { x: 20, y: 10, k: k };
    var g = document.getElementById("viewport");
    if (g) { applyTransform(g); }
  }
  function enablePanZoom(svg, g) {
    var drag = null;
    svg.onmousedown = function (ev) {
      if (ev.target !== svg && ev.target.tagName !== "rect" && ev.target.tagName !== "svg") {
        // allow node clicks; still pan with background only? Simpler: pan on any drag.
      }
      drag = { x: ev.clientX, y: ev.clientY, ox: state.t.x, oy: state.t.y };
    };
    window.onmouseup = function () { drag = null; };
    window.onmousemove = function (ev) {
      if (!drag) { return; }
      state.t.x = drag.ox + (ev.clientX - drag.x);
      state.t.y = drag.oy + (ev.clientY - drag.y);
      applyTransform(g);
    };
    svg.onwheel = function (ev) {
      ev.preventDefault();
      var r = svg.getBoundingClientRect();
      var cx = ev.clientX - r.left;
      var cy = ev.clientY - r.top;
      zoomAtPoint(ev.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR, cx, cy);
    };
    // touch pan (single finger)
    var lastTouch = null;
    svg.ontouchstart = function (ev) {
      if (ev.touches.length === 1) { lastTouch = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, ox: state.t.x, oy: state.t.y }; }
    };
    svg.ontouchmove = function (ev) {
      if (lastTouch && ev.touches.length === 1) {
        state.t.x = lastTouch.ox + (ev.touches[0].clientX - lastTouch.x);
        state.t.y = lastTouch.oy + (ev.touches[0].clientY - lastTouch.y);
        applyTransform(g);
        ev.preventDefault();
      }
    };
    svg.ontouchend = function () { lastTouch = null; };
  }

  function onKey(ev) {
    var tag = (ev.target && ev.target.tagName) || "";
    var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (ev.key === "/" && !typing) { ev.preventDefault(); var q = document.getElementById("q"); if (q) { q.focus(); } }
    else if ((ev.key === "+" || ev.key === "=") && !typing) { zoom(BUTTON_ZOOM_FACTOR); }
    else if ((ev.key === "-" || ev.key === "_") && !typing) { zoom(1 / BUTTON_ZOOM_FACTOR); }
    else if (ev.key === "0" && !typing) { fitToView(); }
  }
})();
