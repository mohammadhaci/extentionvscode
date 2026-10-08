/* Skills Dashboard webview. Plain script (no build step); all untrusted text via textContent. */
(function () {
  "use strict";
  var vscode = acquireVsCodeApi();
  var state = { skills: [], roots: [], folder: "", folders: [], filter: "", selectedId: null, detail: null, preview: null, importFolderId: null, status: "", busy: false };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }

  function post(type, payload) {
    vscode.postMessage(payload === undefined ? { type: type } : { type: type, payload: payload });
  }

  function setStatus(msg, isError) {
    state.status = msg;
    var s = document.getElementById("status");
    if (!s) { return; }
    s.textContent = msg;
    s.classList.toggle("error", !!isError);
  }

  function filtered() {
    var q = state.filter.trim().toLowerCase();
    if (!q) { return state.skills; }
    return state.skills.filter(function (s) {
      return (s.skillName + " " + s.description + " " + s.root + " " + s.relativeDirPath).toLowerCase().indexOf(q) !== -1;
    });
  }

  function selectedTargets() {
    var boxes = document.querySelectorAll(".target-check:checked");
    var out = [];
    for (var i = 0; i < boxes.length; i++) { out.push(boxes[i].value); }
    return out;
  }

  // Destination options for GitHub import: opaque ids from the host, never paths.
  function folderOptions() {
    if (state.preview && state.preview.workspaceFolders && state.preview.workspaceFolders.length) {
      return state.preview.workspaceFolders;
    }
    return state.folders || [];
  }

  function currentFolderId() {
    var opts = folderOptions();
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].id === state.importFolderId) { return state.importFolderId; }
    }
    return opts.length ? opts[0].id : null;
  }

  function folderNameFor(id) {
    var opts = folderOptions();
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].id === id) { return opts[i].name; }
    }
    return "";
  }

  function previewPayload(url) {
    var p = { url: url };
    var fid = currentFolderId();
    if (fid) { p.workspaceFolderId = fid; }
    return p;
  }

  function render() {
    var app = document.getElementById("app");
    while (app.firstChild) { app.removeChild(app.firstChild); }

    // Header
    var header = el("div", "header");
    var title = el("div", "title", "Skills Dashboard");
    var sub = el("div", "subtitle", state.folder ? "Folder: " + state.folder : "No folder open");
    var hleft = el("div", "hleft");
    hleft.appendChild(title); hleft.appendChild(sub);
    var search = document.createElement("input");
    search.className = "search"; search.placeholder = "Search skills…"; search.value = state.filter;
    search.setAttribute("aria-label", "Search skills");
    search.addEventListener("input", function () { state.filter = search.value; renderList(); });
    var refresh = el("button", "btn", "Refresh");
    refresh.addEventListener("click", function () { setStatus("Refreshing…"); post("refresh"); });
    var hright = el("div", "hright");
    hright.appendChild(search); hright.appendChild(refresh);
    header.appendChild(hleft); header.appendChild(hright);
    app.appendChild(header);

    if (state.skills.length === 0) {
      var empty = el("div", "empty");
      empty.appendChild(el("div", "empty-title", "No skills found"));
      empty.appendChild(el("div", "empty-body",
        "Create a folder with a SKILL.md file under a skill root, e.g. .claude/skills/my-skill/SKILL.md, or import one from GitHub below. Roots: " +
        (state.roots.length ? state.roots.join(", ") : "(none)")));
      app.appendChild(empty);
    } else {
      var main = el("div", "main");
      var listWrap = el("div", "list-wrap");
      var listHead = el("div", "section-head", "Skills (" + filtered().length + ")");
      listWrap.appendChild(listHead);
      var list = el("div", "list");
      list.id = "skill-list";
      listWrap.appendChild(list);
      var detailWrap = el("div", "detail-wrap");
      detailWrap.id = "detail";
      main.appendChild(listWrap); main.appendChild(detailWrap);
      app.appendChild(main);
      renderList(); renderDetail();
    }

    app.appendChild(renderTargets());
    app.appendChild(renderImport());
    var status = el("div", "status", state.status);
    status.id = "status";
    app.appendChild(status);
  }

  function renderList() {
    var list = document.getElementById("skill-list");
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }
    var items = filtered();
    if (!state.selectedId && items.length) { state.selectedId = items[0].id; }
    items.forEach(function (s) {
      var b = el("button", "item" + (s.id === state.selectedId ? " active" : ""));
      b.setAttribute("data-id", s.id);
      b.appendChild(el("div", "item-name", s.skillName));
      b.appendChild(el("div", "item-desc", s.description || "(no description)"));
      b.appendChild(el("div", "item-meta", s.root + "  •  " + (s.fileCount !== undefined ? s.fileCount + " files" : "")));
      var tools = el("div", "item-tools", "In: " + (s.presentInRoots.length ? s.presentInRoots.join(", ") : s.root));
      b.appendChild(tools);
      b.addEventListener("click", function () {
        state.selectedId = s.id;
        post("selectSkill", { id: s.id });
        renderList(); renderDetail();
      });
      list.appendChild(b);
    });
    if (!items.length) { list.appendChild(el("div", "empty-body", "No skills match the search.")); }
  }

  function current() {
    if (state.detail && state.detail.id === state.selectedId) { return state.detail; }
    for (var i = 0; i < state.skills.length; i++) {
      if (state.skills[i].id === state.selectedId) { return state.skills[i]; }
    }
    return null;
  }

  function renderDetail() {
    var wrap = document.getElementById("detail");
    if (!wrap) { return; }
    while (wrap.firstChild) { wrap.removeChild(wrap.firstChild); }
    var s = current();
    if (!s) { wrap.appendChild(el("div", "empty-body", "Select a skill.")); return; }
    wrap.appendChild(el("div", "section-head", "Details"));
    wrap.appendChild(el("div", "d-name", s.skillName));
    wrap.appendChild(el("div", "d-row", "Path: " + s.relativeDirPath));
    wrap.appendChild(el("div", "d-row", "Source: " + s.root + " (" + s.workspaceFolderName + ")"));
    wrap.appendChild(el("div", "d-row", "SKILL.md: " + s.skillMdPath));
    if (s.description) { wrap.appendChild(el("div", "d-desc", s.description)); }
    var open = el("button", "btn", "Open SKILL.md");
    open.addEventListener("click", function () { post("openSkillFile", { id: s.id }); });
    wrap.appendChild(open);
    wrap.appendChild(el("div", "section-head", "Preview (plain text)"));
    if (s.oversized) {
      wrap.appendChild(el("div", "warn", "SKILL.md exceeds the 256 KB preview limit and was not loaded."));
    }
    var pre = el("pre", "preview", (s.fullPreview || s.preview || "(empty)"));
    wrap.appendChild(pre);
    // Copy / remove actions
    var actions = el("div", "actions");
    var ow = document.createElement("label");
    ow.className = "ow";
    var owBox = document.createElement("input");
    owBox.type = "checkbox"; owBox.id = "overwrite-copy";
    ow.appendChild(owBox);
    ow.appendChild(el("span", "", "Overwrite existing"));
    var copyBtn = el("button", "btn primary", "Copy to selected");
    copyBtn.addEventListener("click", function () {
      var t = selectedTargets().filter(function (r) { return r !== s.root; });
      if (!t.length) { setStatus("Select at least one different target directory.", true); return; }
      post("copySkill", { skillId: s.id, targets: t, overwrite: !!owBox.checked });
      setStatus("Copying…");
    });
    var rmSel = document.createElement("select");
    rmSel.className = "select"; rmSel.id = "remove-target";
    s.presentInRoots.forEach(function (r) {
      var o = document.createElement("option"); o.value = r; o.textContent = r;
      rmSel.appendChild(o);
    });
    var rmBtn = el("button", "btn danger", "Remove from directory");
    rmBtn.addEventListener("click", function () {
      post("removeSkill", { skillId: s.id, target: rmSel.value });
      setStatus("Requesting delete confirmation…");
    });
    actions.appendChild(ow); actions.appendChild(copyBtn);
    actions.appendChild(el("span", "gap", "Remove:"));
    actions.appendChild(rmSel); actions.appendChild(rmBtn);
    wrap.appendChild(actions);
  }

  function renderTargets() {
    var box = el("div", "targets");
    box.appendChild(el("div", "section-head", "Target directories"));
    if (!state.roots.length) { box.appendChild(el("div", "empty-body", "No roots configured.")); return box; }
    var grid = el("div", "target-grid");
    state.roots.forEach(function (r) {
      var lab = document.createElement("label");
      lab.className = "target";
      var c = document.createElement("input");
      c.type = "checkbox"; c.className = "target-check"; c.value = r;
      lab.appendChild(c);
      lab.appendChild(el("span", "", r));
      grid.appendChild(lab);
    });
    box.appendChild(grid);
    return box;
  }

  function renderImport() {
    var box = el("div", "import");
    box.appendChild(el("div", "section-head", "Import from GitHub"));
    var hint = el("div", "hint",
      "Paste a repository folder URL (…/tree/BRANCH/path/to/skill) or a SKILL.md URL (blob / raw). Files are fetched read-only; nothing is executed. Review the preview, then install.");
    box.appendChild(hint);
    var row = el("div", "import-row");
    var input = document.createElement("input");
    input.className = "url"; input.id = "gh-url";
    input.placeholder = "https://github.com/OWNER/REPO/tree/BRANCH/path/to/skill";
    input.setAttribute("aria-label", "GitHub skill URL");
    if (state.preview) { input.value = state.preview.url; }
    // Compact destination folder picker (opaque id; conflicts recalculated per folder).
    var destLab = el("label", "ow", "Destination:");
    destLab.setAttribute("for", "import-folder");
    var destSel = document.createElement("select");
    destSel.className = "select"; destSel.id = "import-folder";
    destSel.setAttribute("aria-label", "Destination workspace folder");
    folderOptions().forEach(function (f) {
      var o = document.createElement("option"); o.value = f.id; o.textContent = f.name;
      destSel.appendChild(o);
    });
    var cur = currentFolderId();
    if (cur) { destSel.value = cur; state.importFolderId = cur; }
    destSel.addEventListener("change", function () {
      state.importFolderId = destSel.value;
      // Recalculate conflicts/preview for the newly selected folder.
      if (input.value.trim()) {
        setStatus("Fetching skill from GitHub…");
        post("previewImport", previewPayload(input.value.trim()));
      }
    });
    var fetchBtn = el("button", "btn", "Fetch preview");
    fetchBtn.addEventListener("click", function () {
      if (!input.value.trim()) { setStatus("Paste a GitHub URL first.", true); return; }
      state.importFolderId = destSel.value || state.importFolderId;
      setStatus("Fetching skill from GitHub…");
      post("previewImport", previewPayload(input.value.trim()));
    });
    row.appendChild(input); row.appendChild(destLab); row.appendChild(destSel); row.appendChild(fetchBtn);
    box.appendChild(row);
    if (state.preview) {
      var p = state.preview;
      box.appendChild(el("div", "d-name", p.skillName + "  (" + p.owner + "/" + p.repo + "@" + p.ref + ")"));
      var destName = folderNameFor(p.workspaceFolderId);
      box.appendChild(el("div", "d-row", "Destination: " + (destName || "(unknown folder — refresh and pick again)") + "  •  Repo path: " + p.skillPath));
      box.appendChild(el("div", "d-row", p.files.length + " files, " + p.totalBytes + " bytes"));
      var ul = el("ul", "file-list");
      p.files.forEach(function (f) {
        ul.appendChild(el("li", "", f.path + " (" + f.size + " B)"));
      });
      box.appendChild(ul);
      if (p.skippedSymlinks && p.skippedSymlinks.length) {
        box.appendChild(el("div", "warn", "Skipped " + p.skippedSymlinks.length + " symlink(s), never fetched or installed: " + p.skippedSymlinks.join(", ")));
      }
      if (p.conflicts.length) {
        box.appendChild(el("div", "warn", "Already exists in: " + p.conflicts.join(", ") + ". Tick overwrite to replace, or the install will report a conflict."));
      }
      var irow = el("div", "import-row");
      var owL = document.createElement("label");
      owL.className = "ow";
      var owB = document.createElement("input");
      owB.type = "checkbox"; owB.id = "overwrite-import";
      owL.appendChild(owB);
      owL.appendChild(el("span", "", "Overwrite existing"));
      var inst = el("button", "btn primary", "Install to selected targets");
      inst.addEventListener("click", function () {
        var t = selectedTargets();
        if (!t.length) { setStatus("Select at least one target directory.", true); return; }
        var fid = currentFolderId() || p.workspaceFolderId;
        if (!fid) { setStatus("No destination folder available. Open a folder first.", true); return; }
        post("confirmImport", { url: p.url, targets: t, overwrite: !!owB.checked, workspaceFolderId: fid });
        setStatus("Installing…");
      });
      irow.appendChild(owL); irow.appendChild(inst);
      box.appendChild(irow);
    }
    return box;
  }

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || typeof m.type !== "string") { return; }
    if (m.type === "skillsData") {
      state.skills = m.payload.skills || [];
      state.roots = m.payload.roots || [];
      state.folder = m.payload.workspaceFolderName || "";
      state.folders = m.payload.workspaceFolders || [];
      if (state.preview) {
        state.preview.workspaceFolders = state.folders;
      }
      // Keep the chosen destination when it still exists; otherwise default.
      var known = {};
      state.folders.forEach(function (f) { known[f.id] = 1; });
      if (!state.importFolderId || !known[state.importFolderId]) {
        if (state.preview && known[state.preview.workspaceFolderId]) {
          state.importFolderId = state.preview.workspaceFolderId;
        } else {
          state.importFolderId = state.folders.length ? state.folders[0].id : null;
        }
      }
      if (m.payload.detail) {
        state.detail = m.payload.detail;
        state.selectedId = m.payload.detail.id;
      }
      if (state.selectedId && !state.skills.some(function (s) { return s.id === state.selectedId; })) {
        state.selectedId = state.skills.length ? state.skills[0].id : null;
      }
      setStatus(state.skills.length ? "" : "No skills found.");
      render();
    } else if (m.type === "importPreview") {
      state.preview = m.payload;
      if (m.payload.workspaceFolders) {
        state.folders = m.payload.workspaceFolders;
      }
      state.importFolderId = m.payload.workspaceFolderId || null;
      setStatus("Preview ready: " + m.payload.skillName + " (" + m.payload.files.length + " files).");
      render();
    } else if (m.type === "progress") {
      setStatus(m.payload.message || "");
    } else if (m.type === "operationResult") {
      setStatus(m.payload.message || "", !m.payload.ok);
    } else if (m.type === "error") {
      setStatus(m.payload.message + (m.payload.detail ? " " + m.payload.detail : ""), true);
    }
  });

  post("ready");
})();
