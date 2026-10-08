/* Django Visual Map — webview UI (vanilla JS, no dependencies).
 * Renders the ProjectMap payload as a navigable layered SVG graph.
 * Columns: apps | urls | views | models | templates.
 */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();

  var KIND_COLORS = {
    app: "#8b5cf6",
    url: "#0ea5e9",
    view: "#f59e0b",
    model: "#22c55e",
    template: "#ec4899"
  };
  var KIND_LABELS = { app: "Apps", url: "URLs", view: "Views", model: "Models", template: "Templates" };
  var COLS = ["app", "url", "view", "model", "template"];
  var NODE_W = 210, NODE_H = 42, COL_GAP = 90, ROW_GAP = 10;

  var state = {
    map: null,
    error: null,
    progress: "Loading…",
    selectedId: null,
    search: "",
    kinds: { app: true, url: true, view: true, model: true, template: true },
    appFilter: "all",
    showUncertain: true,
    t: { x: 20, y: 50, k: 1 },
    positions: {},
    order: []
  };

  var app = document.getElementById("app");
  var svgNS = "http://www.w3.org/2000/svg";

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
      state.progress = (msg.payload && msg.payload.message) || "Working…";
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
    if (state.error) { renderError(); return; }
    if (!state.map) { renderProgress(); return; }
    if (state.map.isEmpty) { renderEmpty(); return; }
    renderFull();
  }

  function renderProgress() {
    app.innerHTML = '<div class="dvm-root"><div class="dvm-progress"><h1>Django Visual Map</h1><p>' +
      esc(state.progress || "Loading…") + "</p></div></div>";
  }

  function renderError() {
    app.innerHTML = '<div class="dvm-root"><div class="dvm-error"><h1>Could not build the project map</h1><p><b>' +
      esc(state.error.message) + "</b></p>" +
      (state.error.detail ? "<p class='dvm-hint'>" + esc(state.error.detail) + "</p>" : "") +
      '<p><button class="dvm-btn primary" id="retry">Retry analysis</button></p>' +
      '<p class="dvm-hint">Tip: open a folder with <code>manage.py</code> or <code>settings.py</code> (INSTALLED_APPS).</p></div></div>';
    document.getElementById("retry").addEventListener("click", function () {
      state.error = null; state.progress = "Analyzing…"; render();
      vscode.postMessage({ type: "refresh" });
    });
  }

  function renderEmpty() {
    var m = state.map;
    app.innerHTML = '<div class="dvm-root"><div class="dvm-empty"><h1>No Django project detected</h1>' +
      "<p>" + esc(m.emptyReason || "Nothing to show.") + "</p>" +
      "<ol><li>Open a Django project folder (<code>File → Open Folder</code>).</li>" +
      "<li>Make sure it has <code>manage.py</code>, <code>settings.py</code> with <code>INSTALLED_APPS</code>, or app folders with <code>models.py</code> / <code>views.py</code> / <code>urls.py</code>.</li>" +
      "<li>Click <b>Retry analysis</b>.</li></ol>" +
      '<p><button class="dvm-btn primary" id="retry">Retry analysis</button></p>' +
      warningsHtml() + "</div></div>";
    document.getElementById("retry").addEventListener("click", function () {
      vscode.postMessage({ type: "refresh" });
    });
  }

  function warningsHtml() {
    var m = state.map;
    if (!m || !m.warnings.length) { return ""; }
    return '<div class="dvm-warn"><b>Heuristic notes (' + m.warnings.length + ')</b><ul>' +
      m.warnings.slice(0, 8).map(function (w) { return "<li>" + esc(w.message) + "</li>"; }).join("") +
      (m.warnings.length > 8 ? "<li>…and " + (m.warnings.length - 8) + " more.</li>" : "") + "</ul></div>";
  }

  function renderFull() {
    var m = state.map;
    var size = layout();
    var apps = m.nodes.filter(function (n) { return n.kind === "app"; });
    var appOptions = ['<option value="all">All apps</option>'].concat(apps.map(function (a) {
      return '<option value="' + esc(a.label) + '"' + (state.appFilter === a.label ? " selected" : "") + ">" + esc(a.label) + "</option>";
    })).join("");

    var chips = COLS.map(function (k) {
      return '<span class="dvm-chip" role="button" tabindex="0" data-kind="' + k + '" aria-pressed="' + state.kinds[k] + '" title="Toggle ' + KIND_LABELS[k] + '">' +
        '<span class="dvm-dot bg-' + k + '"></span>' + KIND_LABELS[k] + "</span>";
    }).join("");

    app.innerHTML =
      '<div class="dvm-root" role="application" aria-label="Django project map">' +
      '<div class="dvm-toolbar">' +
      '<input id="q" class="dvm-search" type="search" placeholder="Search nodes…  ( / )" aria-label="Search nodes" value="' + esc(state.search) + '">' +
      '<div class="dvm-filters">' + chips + "</div>" +
      '<select id="appf" class="dvm-select" aria-label="Filter by app">' + appOptions + "</select>" +
      '<button id="unc" class="dvm-btn" aria-pressed="' + state.showUncertain + '" title="Show/hide heuristic (uncertain) items">~ heuristic: ' + (state.showUncertain ? "on" : "off") + "</button>" +
      '<span class="spacer"></span>' +
      '<button id="zin" class="dvm-btn" title="Zoom in (+)">+</button>' +
      '<button id="zout" class="dvm-btn" title="Zoom out (−)">−</button>' +
      '<button id="fit" class="dvm-btn" title="Fit to view (0)">Fit</button>' +
      '<button id="refresh" class="dvm-btn" title="Re-run analysis">Refresh</button>' +
      "</div>" +
      '<div class="dvm-stats" id="stats"></div>' +
      '<div class="dvm-legend"><span><span class="dvm-dot bg-app"></span> app</span>' +
      "<span><span class='dvm-dot bg-url'></span> url</span>" +
      "<span><span class='dvm-dot bg-view'></span> view</span>" +
      "<span><span class='dvm-dot bg-model'></span> model</span>" +
      "<span><span class='dvm-dot bg-template'></span> template</span>" +
      "<span><span class='edge-sample'></span>uses/routes/contains</span>" +
      "<span><span class='edge-sample dashed'></span>FK / one-to-one</span>" +
      "<span><span class='edge-sample dotted'></span>many-to-many</span>" +
      "<span>┄ dashed edge or ~ badge = heuristic guess</span></div>" +
      '<div class="dvm-main"><div class="dvm-canvas-wrap" id="wrap">' +
      '<svg id="cv" tabindex="0" role="group" aria-label="Project graph. Use plus, minus, zero keys to zoom and fit; tab moves between nodes."></svg>' +
      "</div>" +
      '<aside class="dvm-side" id="details" aria-live="polite" aria-label="Selected element details"></aside>' +
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
      ev.target.textContent = "~ heuristic: " + (state.showUncertain ? "on" : "off");
      ev.target.setAttribute("aria-pressed", String(state.showUncertain));
      renderSvg(size);
    });
    document.getElementById("zin").addEventListener("click", function () { zoom(1.2); });
    document.getElementById("zout").addEventListener("click", function () { zoom(1 / 1.2); });
    document.getElementById("fit").addEventListener("click", fitToView);
    document.getElementById("refresh").addEventListener("click", function () {
      state.progress = "Analyzing…"; vscode.postMessage({ type: "refresh" });
    });
    document.addEventListener("keydown", onKey);
  }

  function renderStats(size) {
    var m = state.map, s = m.stats;
    var shown = m.nodes.filter(visibleNode).length;
    var q = state.search ? ' · <span>' + m.nodes.filter(function (n) { return visibleNode(n) && matchesSearch(n); }).length + " match " + esc(state.search) + "</span>" : "";
    document.getElementById("stats").innerHTML =
      "<span class='dvm-stat'><b>" + s.apps + "</b> apps</span>" +
      "<span class='dvm-stat'><b>" + s.urls + "</b> urls</span>" +
      "<span class='dvm-stat'><b>" + s.views + "</b> views</span>" +
      "<span class='dvm-stat'><b>" + s.models + "</b> models</span>" +
      "<span class='dvm-stat'><b>" + s.templates + "</b> templates</span>" +
      "<span class='dvm-stat'><b>" + s.relations + "</b> relations</span>" +
      "<span class='dvm-hint'>showing " + shown + "/" + m.nodes.length + " nodes" + q + "</span>" +
      (m.warnings.length ? " <span class='dvm-hint'>· " + m.warnings.length + " heuristic notes (see details)</span>" : "");
    void size;
  }

  function renderSvg(size) {
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
      grp.setAttribute("aria-label", n.kind + " " + n.label + (n.file ? ", " + n.file : ""));
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

      appendTitle(grp, n.kind + ": " + n.label + (n.file ? "\n" + n.file + (n.line ? ":" + n.line : "") : "") + (n.uncertain ? "\n(heuristic — verify in source)" : ""));
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
    return t + ": " + (a ? a.label : e.from) + " → " + (b ? b.label : e.to) + (e.label ? " (" + e.label + ")" : "") + (e.uncertain ? " [heuristic]" : "");
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
      box.innerHTML = '<p class="dvm-hint">Select a node to inspect it.</p>' + warningsHtml();
      return;
    }
    var nb = neighbors(n.id);
    var relItems = Object.keys(nb).map(function (id) {
      var o = nodeById(id);
      var e = nb[id];
      if (!o) { return ""; }
      return '<li><button data-open="' + esc(id) + '">' + esc(o.label) + "</button> " +
        '<span class="dvm-hint">' + esc(o.kind) + (e.uncertain ? " ~" : "") + "</span></li>";
    }).join("");
    box.innerHTML =
      '<span class="dvm-kind ' + n.kind + '">' + n.kind + "</span>" +
      (n.uncertain ? '<span class="dvm-badge" title="Inferred heuristically — verify in source">~ heuristic</span>' : "") +
      "<h2>" + esc(n.label) + "</h2>" +
      (n.subtitle ? '<p class="dvm-hint">' + esc(n.subtitle) + "</p>" : "") +
      (n.file ? '<p class="dvm-kv"><code>' + esc(n.file) + (n.line ? ":" + n.line : "") + "</code></p>" : "") +
      (n.app ? '<p class="dvm-kv">App: <code>' + esc(n.app) + "</code></p>" : "") +
      ((n.detail && n.detail.length) ? '<div class="dvm-kv">' + n.detail.map(function (d) { return "<div>" + esc(d) + "</div>"; }).join("") + "</div>" : "") +
      (n.file ? '<p><button class="dvm-btn primary" id="openf">Open source</button></p>' : "") +
      "<h3 class='dvm-h3'>Relationships (" + Object.keys(nb).length + ")</h3>" +
      (relItems ? '<ul class="dvm-rel-list">' + relItems + "</ul>" : '<p class="dvm-hint">No relationships.</p>') +
      warningsHtml() +
      '<p class="dvm-hint">Keyboard: <kbd>Tab</kbd> move · <kbd>Enter</kbd> select · <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>0</kbd> fit · <kbd>/</kbd> search</p>';

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
    state.t.k = Math.min(3, Math.max(0.2, state.t.k * f));
    var g = document.getElementById("viewport");
    if (g) { applyTransform(g); }
  }
  function fitToView() {
    var svg = document.getElementById("cv");
    var wrap = document.getElementById("wrap");
    if (!svg || !wrap || !state.map) { return; }
    var r = wrap.getBoundingClientRect();
    var size = layout();
    var k = Math.min((r.width - 40) / size.w, (r.height - 40) / size.h, 1.5);
    k = Math.max(0.2, k || 0.5);
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
      zoom(ev.deltaY < 0 ? 1.1 : 1 / 1.1);
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
    else if ((ev.key === "+" || ev.key === "=") && !typing) { zoom(1.2); }
    else if ((ev.key === "-" || ev.key === "_") && !typing) { zoom(1 / 1.2); }
    else if (ev.key === "0" && !typing) { fitToView(); }
  }
})();
