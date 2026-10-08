/* Django Visual Map — sidebar (Activity Bar view) summary. */
(function () {
  "use strict";
  var vscode = acquireVsCodeApi();
  var app = document.getElementById("app");
  var state = { map: null, error: null, progress: "Analyzing…" };

  window.addEventListener("message", function (ev) {
    var msg = ev.data;
    if (!msg || typeof msg.type !== "string") { return; }
    if (msg.type === "mapData") { state.map = msg.payload; state.error = null; render(); }
    else if (msg.type === "error") { state.error = msg.payload; render(); }
    else if (msg.type === "progress") { state.progress = (msg.payload && msg.payload.message) || "Working…"; render(); }
  });
  vscode.postMessage({ type: "ready" });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function warningsHtml(warnings, limit) {
    var list = warnings || [];
    if (!list.length) { return ""; }
    var items = list.slice(0, limit).map(function (w) { return "<li>" + esc(w.message) + "</li>"; }).join("");
    var more = list.length > limit ? "<li>…and " + (list.length - limit) + " more (see full map).</li>" : "";
    return '<div class="dvm-warn"><b>Heuristic notes (' + list.length + ")</b><ul>" + items + more + "</ul></div>";
  }

  function render() {
    if (state.error) {
      app.innerHTML = '<div class="dvm-sidebar"><h1>Django Map</h1><p><b>' + esc(state.error.message) + "</b></p>" +
        (state.error.detail ? "<p class='dvm-hint'>" + esc(state.error.detail) + "</p>" : "") +
        '<div class="actions"><button class="dvm-btn" id="retry">Retry</button></div></div>';
      document.getElementById("retry").addEventListener("click", function () { vscode.postMessage({ type: "refresh" }); });
      return;
    }
    if (!state.map) {
      app.innerHTML = '<div class="dvm-sidebar"><h1>Django Map</h1><p class="dvm-hint">' + esc(state.progress) + "</p></div>";
      return;
    }
    var m = state.map;
    if (m.isEmpty) {
      app.innerHTML = '<div class="dvm-sidebar"><h1>Django Map</h1><p>' + esc(m.emptyReason || "No Django project detected.") + "</p>" +
        warningsHtml(m.warnings, 5) +
        '<div class="actions"><button class="dvm-btn" id="retry">Retry</button></div></div>';
      document.getElementById("retry").addEventListener("click", function () { vscode.postMessage({ type: "refresh" }); });
      return;
    }
    var s = m.stats;
    var topApps = m.nodes.filter(function (n) { return n.kind === "app"; }).slice(0, 6);
    app.innerHTML = '<div class="dvm-sidebar"><h1>' + esc(m.workspaceName) + "</h1>" +
      '<div class="row"><span>Apps</span><b>' + s.apps + "</b></div>" +
      '<div class="row"><span>URLs</span><b>' + s.urls + "</b></div>" +
      '<div class="row"><span>Views</span><b>' + s.views + "</b></div>" +
      '<div class="row"><span>Models</span><b>' + s.models + "</b></div>" +
      '<div class="row"><span>Relations</span><b>' + s.relations + "</b></div>" +
      (topApps.length ? "<h1 class='dvm-h1-gap'>Apps</h1>" + topApps.map(function (a) {
        return '<div class="row"><span>' + esc(a.label) + "</span><span class='dvm-hint'>" + esc(a.subtitle || "") + "</span></div>";
      }).join("") : "") +
      (m.warnings && m.warnings.length ? warningsHtml(m.warnings, 3) : "") +
      '<div class="actions"><button class="dvm-btn primary" id="open">Open Project Map</button><button class="dvm-btn" id="refresh">Refresh</button></div></div>';
    document.getElementById("open").addEventListener("click", function () { vscode.postMessage({ type: "openPanel" }); });
    document.getElementById("refresh").addEventListener("click", function () { vscode.postMessage({ type: "refresh" }); });
  }
  render();
})();
