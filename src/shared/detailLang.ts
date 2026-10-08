/**
 * Display-layer localization for analyzer-produced node detail lines,
 * subtitles and warning templates shown in the details pane.
 *
 * The analyzer (src/analyzer/*) always emits English; its data and
 * semantics are untouched. These pure, kind-aware formatters match known
 * templates with anchored patterns, re-emit them through the static
 * dictionaries in ./i18n, and pass everything else (identifiers, paths,
 * routes, field lines, dynamic error prose) through verbatim.
 * media/map.js embeds a mirror of this logic.
 */

import { t, type SupportedLang } from "./i18n";

const KIND_NOUN_KEYS: Record<string, string> = {
  app: "legendApp",
  url: "legendUrl",
  view: "legendView",
  model: "legendModel",
  template: "legendTemplate"
};

/** Localized singular node-kind noun; unknown kinds pass through. */
export function kindNoun(lang: SupportedLang, kind: string): string {
  const key = KIND_NOUN_KEYS[kind];
  return key ? t(lang, key) : kind;
}

const KNOWN_REASONS: Record<string, string> = {
  "listed in INSTALLED_APPS with Django package markers": "reasonInstalledMarkers",
  "package with multiple Django markers": "reasonMultiMarkers",
  "listed in INSTALLED_APPS": "reasonInstalled",
  "package with a Django marker file": "reasonMarkerFile",
  "heuristic: Django-like files without package markers": "reasonHeuristicFiles"
};

/** Translate a known app-discovery reason; dynamic/unknown reasons stay raw. */
export function translateReason(lang: SupportedLang, reason: string): string {
  const key = KNOWN_REASONS[reason];
  return key ? t(lang, key) : reason;
}

function translateConfidence(lang: SupportedLang, confidence: string): string {
  if (confidence === "high") {
    return t(lang, "confHigh");
  }
  if (confidence === "medium") {
    return t(lang, "confMedium");
  }
  if (confidence === "low") {
    return t(lang, "confLow");
  }
  return confidence;
}

const MODELS_NONE_EN =
  "Models: none detected (heuristic may miss dynamic queries)";
const FUNCTION_VIEW_EN = "Function-based view";
const UNRESOLVED_CAUSES_EN =
  "Common causes: django.contrib.admin, django.contrib.auth views, DRF routers, or string references.";
const MARKERS_FOUND_EN =
  "Django markers found (manage.py/settings/urls) but no app folders matched the discovery heuristic. Showing URL and view data without app grouping.";

/**
 * Localize one `GraphNode.detail` line. Matching is gated on the node kind
 * so identifier-heavy lines (e.g. a model field literally containing a
 * label-like prefix) can never be rewritten by another kind's template.
 */
export function formatDetailLine(lang: SupportedLang, kind: string, line: string): string {
  if (kind === "model") {
    const m = /^Model ([A-Za-z_]\w*) \((.*)\)$/.exec(line);
    if (m) {
      return t(lang, "detailModel", { name: m[1], base: m[2] });
    }
    return line;
  }
  if (kind === "app") {
    let m = /^Django app candidate \((high|medium|low) confidence\)$/.exec(line);
    if (m) {
      return t(lang, "detailAppCandidate", { confidence: translateConfidence(lang, m[1]) });
    }
    m = /^Directory: (.+)$/.exec(line);
    if (m) {
      return t(lang, "detailDirectory", { dir: m[1] });
    }
    m = /^Why: (.+)$/.exec(line);
    if (m) {
      return t(lang, "detailWhy", { reason: translateReason(lang, m[1]) });
    }
    return line;
  }
  if (kind === "view") {
    let m = /^Class-based view \((.*)\)$/.exec(line);
    if (m) {
      return t(lang, "detailClassView", { base: m[1] });
    }
    if (line === FUNCTION_VIEW_EN) {
      return t(lang, "detailFunctionView");
    }
    if (line === MODELS_NONE_EN) {
      return t(lang, "detailModelsNone");
    }
    m = /^Models: (.+)$/.exec(line);
    if (m) {
      return t(lang, "detailModels", { names: m[1] });
    }
    m = /^Templates: (.+)$/.exec(line);
    if (m) {
      return t(lang, "detailTemplates", { names: m[1] });
    }
    m = /^Referenced as "(.*)" but no matching view was found in scanned views\.py files\.$/.exec(line);
    if (m) {
      return t(lang, "detailUnresolvedRef", { ref: m[1] });
    }
    if (line === UNRESOLVED_CAUSES_EN) {
      return t(lang, "detailUnresolvedCauses");
    }
    return line;
  }
  if (kind === "url") {
    let m = /^Includes URLconf (\S+)$/.exec(line);
    if (m) {
      return t(lang, "detailIncludes", { module: m[1] });
    }
    m = /^Route: (.*)$/.exec(line);
    if (m) {
      return t(lang, "detailRoute", { route: m[1] });
    }
    m = /^Route prefix: (.*)$/.exec(line);
    if (m) {
      return t(lang, "detailRoutePrefix", { route: m[1] });
    }
    m = /^View ref: (.+)$/.exec(line);
    if (m) {
      return t(lang, "detailViewRef", { ref: m[1] });
    }
    m = /^Name: (.+)$/.exec(line);
    if (m) {
      return t(lang, "detailUrlName", { name: m[1] });
    }
    return line;
  }
  return line;
}

/**
 * Localize the static subtitles echoed in the details pane header.
 * Route/base/template subtitles are identifier-heavy and pass through.
 */
export function formatSubtitle(lang: SupportedLang, subtitle: string): string {
  const fields = /^(\d+) fields?$/.exec(subtitle);
  if (fields) {
    if (fields[1] === "1") {
      return t(lang, "subFieldsOne");
    }
    return t(lang, "subFieldsMany", { n: fields[1] });
  }
  if (subtitle === "function view") {
    return t(lang, "subFunctionView");
  }
  if (subtitle === "(project root)") {
    return t(lang, "subProjectRoot");
  }
  if (subtitle === "unresolved (external?)") {
    return t(lang, "subUnresolved");
  }
  return subtitle;
}

/**
 * Localize known analyzer warning templates. Dynamic fragments (file
 * paths, line numbers, decoder error prose) are preserved verbatim;
 * unknown messages pass through unchanged.
 */
export function formatWarning(lang: SupportedLang, message: string): string {
  let m = /^View "(.*)" references unknown model "(.*)" \(heuristic; may be external or mis-parsed\)\.$/.exec(message);
  if (m) {
    return t(lang, "warnUnknownModel", { view: m[1], model: m[2] });
  }
  m = /^include\("(.*)"\) does not match a discovered app; link may be missing\.$/.exec(message);
  if (m) {
    return t(lang, "warnIncludeNoApp", { module: m[1] });
  }
  m = /^Could not parse view reference at (.*):(\d+)\.$/.exec(message);
  if (m) {
    return t(lang, "warnParseViewRef", { file: m[1], line: m[2] });
  }
  m = /^Model "(.*)" targets unknown model "(.*)"\.$/.exec(message);
  if (m) {
    return t(lang, "warnUnknownTarget", { model: m[1], target: m[2] });
  }
  m = /^Scanned first (\d+) Python files \(workspace hits the (\d+)-file scan cap\); results may be partial\. Narrow the folder excludes or split the workspace\.$/.exec(message);
  if (m) {
    return t(lang, "warnScanCap", { max: m[1] });
  }
  m = /^Skipped large file (.*) \((\d+) KB > (\d+) KB cap\)\.$/.exec(message);
  if (m) {
    return t(lang, "warnLargeFile", { file: m[1], kb: m[2], cap: m[3] });
  }
  m = /^Skipped (.*?): (.*)\.$/.exec(message);
  if (m) {
    return t(lang, "warnSkipped", { file: m[1], reason: m[2] });
  }
  m = /^Could not read (.*?): (.*)$/.exec(message);
  if (m) {
    return t(lang, "warnCouldNotRead", { file: m[1], reason: m[2] });
  }
  m = /^Failed to parse (.*?) heuristically: (.*)$/.exec(message);
  if (m) {
    return t(lang, "warnParseFailed", { file: m[1], reason: m[2] });
  }
  if (message === MARKERS_FOUND_EN) {
    return t(lang, "warnMarkersFound");
  }
  return message;
}
