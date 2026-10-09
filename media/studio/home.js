/* Django Agent Studio — Home view.
 * Renders the state posted by the extension (src/studio/home.ts). Builds every
 * node with createElement/textContent: project data is never parsed as HTML.
 */
(function () {
  "use strict";
  var vscode = acquireVsCodeApi();
  var app = document.getElementById("app");
  var lastState = null;

  var T = {
    en: {
      noFolderTitle: "Open your Django project",
      noFolderText: "Agent Studio comes alive when a project folder is open.",
      score: "health",
      lvl: "Lv",
      levels: ["Newcomer", "Explorer", "Builder", "Guardian", "Commander", "Architect", "Legend"],
      mood: {
        party: "Everything is green. Your agents are behaving! 🎉",
        happy: "Looking great, just a little polish left.",
        ok: "Good progress. Finish the quest to unlock more.",
        worried: "Some checks are failing. Let's fix them together.",
        sleepy: "Nothing set up yet. Start the quest below!"
      },
      outdated: "Your project uses tool v{old}; this is v{new}.",
      update: "Update",
      quest: "Setup quest",
      questProgress: "{done} / {total}",
      doIt: "Do it",
      steps: {
        tool: ["Install the studio", "CLI and skills agents use, in .agent-studio/"],
        reference: ["Pick your reference app", "The approved app every new app is cloned from"],
        rules: ["Write the agent rules", "One file for Claude, Codex and Copilot"],
        skills: ["Teach your agents", "Studio skills in every agent's skill folder"],
        ci: ["Guard every pull request", "GitHub Actions runs every check"],
        green: ["Go all green", "Every check passes on this branch"]
      },
      tools: "Your tools",
      cards: {
        map: "Project map",
        scaffold: "New apps",
        context: "Agent rules",
        guard: "Migrations",
        report: "Change report",
        skills: "Skills"
      },
      appsModels: "{apps} apps · {models} models",
      noDjango: "No Django project detected",
      refApp: "Reference: {ref}",
      matching: "{ok} / {total} apps match the template",
      noRef: "No reference app yet",
      inSync: "CLAUDE.md, AGENTS.md and Copilot are in sync",
      stale: "Stale: {files}",
      noRules: "No rules file yet",
      guardLine: "{errors} errors · {warnings} warnings ({scope})",
      guardOff: "Runs when Django migrations exist",
      reportLine: "{branch} vs {base} · {files} files · {commits} commits",
      reportOff: "Needs a git repository",
      skillsOk: "All studio skills installed",
      skillsMissing: "Missing: {list}",
      pill: { pass: "OK", fail: "Fix", warn: "Check", off: "Off", info: "Info", red: "Red", yellow: "Review", green: "Green" },
      a: {
        openMap: "Open map", newApp: "New app", setRef: "Set reference", check: "Check",
        sync: "Sync", rules: "Rules", show: "Show", copy: "Copy", skills: "Browse", setup: "Set up"
      },
      badges: "Badges",
      badgeCount: "{n} / {total}",
      b: {
        "clean-migrations": ["🧹", "Clean migrations: no errors or warnings"],
        "template-keeper": ["🧬", "Template keeper: every app matches the reference"],
        "in-sync": ["🔗", "In sync: agent instructions are up to date"],
        skilled: ["🧠", "Skilled: every agent has the studio skills"],
        guarded: ["🛡️", "Guarded: CI checks every pull request"],
        "green-branch": ["🌿", "Green branch: this branch's report is green"],
        "all-star": ["🏆", "All-star: 100% health"]
      },
      refresh: "Refresh",
      error: "Something went wrong",
      celebrate: "Level up!"
    },
    ar: {
      noFolderTitle: "افتح مشروع Django تبعك",
      noFolderText: "الاستوديو بيشتغل لما يكون في مجلد مشروع مفتوح.",
      score: "صحة",
      lvl: "مستوى",
      levels: ["مبتدئ", "مستكشف", "بنّاء", "حارس", "قائد", "مهندس", "أسطورة"],
      mood: {
        party: "كل شي أخضر. الوكلاء ماشيين عالسراط المستقيم! 🎉",
        happy: "ممتاز، باقي شوية لمسات.",
        ok: "تقدّم منيح، كمّل المهمة لتفتح أكتر.",
        worried: "في فحوصات فاشلة، يلا نصلّحها سوا.",
        sleepy: "لسا ما في شي مجهّز. ابدأ المهمة تحت!"
      },
      outdated: "مشروعك عم يستعمل الأداة v{old}، والجديدة v{new}.",
      update: "حدّث",
      quest: "مهمة التجهيز",
      questProgress: "{done} / {total}",
      doIt: "يلا",
      steps: {
        tool: ["ثبّت الاستوديو", "الأداة والمهارات اللي بيستعملها الوكلاء، بـ \u2068.agent-studio/\u2069"],
        reference: ["اختار القسم المرجعي", "القسم المعتمد اللي بيتنسخ منه كل قسم جديد"],
        rules: ["اكتب قواعد الوكلاء", "ملف واحد لـ Claude وCodex وCopilot"],
        skills: ["علّم وكلاءك", "مهارات الاستوديو بمجلد كل وكيل"],
        ci: ["احمي كل PR", "GitHub Actions بيشغّل كل الفحوصات"],
        green: ["خلّي كل شي أخضر", "كل الفحوصات ناجحة على هالفرع"]
      },
      tools: "أدواتك",
      cards: {
        map: "خريطة المشروع",
        scaffold: "أقسام جديدة",
        context: "قواعد الوكلاء",
        guard: "الـ Migrations",
        report: "تقرير التغييرات",
        skills: "المهارات"
      },
      appsModels: "{apps} أقسام · {models} models",
      noDjango: "ما لقيت مشروع Django",
      refApp: "المرجع: {ref}",
      matching: "{ok} من {total} أقسام مطابقة للقالب",
      noRef: "لسا ما في قسم مرجعي",
      inSync: "CLAUDE.md وAGENTS.md وCopilot متزامنين",
      stale: "قديمة: {files}",
      noRules: "لسا ما في ملف قواعد",
      guardLine: "{errors} أخطاء · {warnings} تحذيرات ({scope})",
      guardOff: "بيشتغل لما يكون في migrations",
      reportLine: "{branch} مقابل {base} · {files} ملفات · {commits} commits",
      reportOff: "بدها مستودع git",
      skillsOk: "كل مهارات الاستوديو مثبّتة",
      skillsMissing: "ناقص: {list}",
      pill: { pass: "تمام", fail: "صلّح", warn: "راجع", off: "مطفي", info: "معلومة", red: "أحمر", yellow: "راجع", green: "أخضر" },
      a: {
        openMap: "افتح الخريطة", newApp: "قسم جديد", setRef: "حدّد المرجع", check: "افحص",
        sync: "زامن", rules: "القواعد", show: "اعرض", copy: "انسخ", skills: "تصفّح", setup: "جهّز"
      },
      badges: "الأوسمة",
      badgeCount: "{n} / {total}",
      b: {
        "clean-migrations": ["🧹", "migrations نظيفة: لا أخطاء ولا تحذيرات"],
        "template-keeper": ["🧬", "حارس القالب: كل الأقسام مطابقة للمرجع"],
        "in-sync": ["🔗", "متزامن: تعليمات الوكلاء محدّثة"],
        skilled: ["🧠", "متمكّن: كل وكيل عنده مهارات الاستوديو"],
        guarded: ["🛡️", "محمي: الـ CI بيفحص كل PR"],
        "green-branch": ["🌿", "فرع أخضر: تقرير هالفرع أخضر"],
        "all-star": ["🏆", "نجم: صحة 100%"]
      },
      refresh: "تحديث",
      error: "صار خطأ",
      celebrate: "مستوى جديد!"
    }
  };

  var MOOD = {
    party: { face: "🥳", color: "var(--as-green)" },
    happy: { face: "😎", color: "var(--as-green)" },
    ok: { face: "🙂", color: "var(--as-sky)" },
    worried: { face: "😬", color: "var(--as-amber)" },
    sleepy: { face: "😴", color: "var(--as-grey)" }
  };

  // Values (paths, branch names) are wrapped in Unicode bidi isolates so
  // Latin text keeps its order inside Arabic sentences.
  function fmt(s, params) {
    return String(s).replace(/\{(\w+)\}/g, function (_m, k) {
      return params && params[k] !== undefined ? "\u2068" + String(params[k]) + "\u2069" : "";
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) {
          return;
        }
        if (k === "class") {
          node.className = v;
        } else if (k === "text") {
          node.textContent = v;
        } else if (k === "style") {
          // CSSOM, not the style attribute: the CSP has no 'unsafe-inline'.
          String(v).split(";").forEach(function (decl) {
            var i = decl.indexOf(":");
            if (i > 0) {
              node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
            }
          });
        } else if (k.indexOf("on") === 0) {
          node.addEventListener(k.slice(2), v);
        } else {
          node.setAttribute(k, v === true ? "" : v);
        }
      });
    }
    (function add(list) {
      list.forEach(function (c) {
        if (c === null || c === undefined || c === false) {
          return;
        }
        if (Array.isArray(c)) {
          add(c);
        } else {
          node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        }
      });
    })(kids);
    return node;
  }

  function run(command) {
    vscode.postMessage({ type: "run", command: command });
  }

  function button(label, command, ghost) {
    return el("button", { class: ghost ? "ghost" : "", text: label, onclick: function () { run(command); } });
  }

  function ring(health, mood) {
    var r = 36;
    var c = 2 * Math.PI * r;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 84 84");
    svg.setAttribute("aria-hidden", "true");
    [["track", c], ["value", c * (1 - Math.max(0, Math.min(100, health)) / 100)]].forEach(function (p) {
      var circle = document.createElementNS(ns, "circle");
      circle.setAttribute("class", p[0]);
      circle.setAttribute("cx", "42");
      circle.setAttribute("cy", "42");
      circle.setAttribute("r", String(r));
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke-width", "7");
      if (p[0] === "value") {
        circle.setAttribute("stroke-dasharray", String(c));
        circle.setAttribute("stroke-dashoffset", String(c));
        // animate from empty on first paint
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { circle.setAttribute("stroke-dashoffset", String(p[1])); });
        });
      }
      svg.appendChild(circle);
    });
    return el("div", { class: "ring" }, svg, el("div", { class: "face" }, el("span", { text: MOOD[mood].face })));
  }

  function confetti() {
    var colors = ["#22c55e", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899", "#ef4444"];
    var box = el("div", { class: "confetti", "aria-hidden": "true" });
    for (var i = 0; i < 70; i++) {
      box.appendChild(el("i", {
        style:
          "left:" + Math.random() * 100 + "%;" +
          "background:" + colors[i % colors.length] + ";" +
          "animation-duration:" + (1.6 + Math.random() * 1.6).toFixed(2) + "s;" +
          "animation-delay:" + (Math.random() * 0.4).toFixed(2) + "s;" +
          "--dx:" + (Math.random() * 120 - 60).toFixed(0) + "px;" +
          "--rot:" + (Math.random() * 720 - 360).toFixed(0) + "deg"
      }));
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3800);
  }

  function stateClass(state) {
    return { pass: "s-pass", fail: "s-fail", warn: "s-warn", off: "s-off", error: "s-warn", info: "s-info" }[state] || "s-off";
  }

  function card(t, icon, name, state, pill, body, actions) {
    return el("div", { class: "card " + stateClass(state) },
      el("div", { class: "card-head" },
        el("span", { class: "card-icon", text: icon }),
        el("span", { class: "card-name", text: name }),
        el("span", { class: "pill", text: pill })),
      el("div", { class: "card-body" }, body),
      el("div", { class: "card-actions" }, actions));
  }

  function render(payload) {
    lastState = payload;
    var lang = payload.lang === "ar" ? "ar" : "en";
    var t = T[lang];
    document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", lang);
    app.textContent = "";

    if (payload.noFolder) {
      app.appendChild(el("div", { class: "empty" },
        el("div", { class: "big", text: "📂" }),
        el("h3", { text: t.noFolderTitle }),
        el("p", { text: t.noFolderText })));
      app.appendChild(footer(t, lang, payload.version));
      return;
    }

    var s = payload.status;
    var sc = payload.score;
    var mood = MOOD[sc.mood] ? sc.mood : "ok";

    // Hero
    var hero = el("div", { class: "hero", id: "hero", style: "--mood:" + MOOD[mood].color },
      ring(sc.health, mood),
      el("div", { class: "hero-text" },
        el("div", { class: "hero-title mono", text: s.folder }),
        el("div", { class: "hero-score" }, String(sc.health), el("small", { text: "% " + t.score })),
        el("div", { class: "hero-line", text: t.mood[mood] }),
        el("div", { class: "level" },
          el("span", { class: "chip", text: t.lvl + " " + sc.level + " · " + t.levels[Math.min(sc.level, t.levels.length - 1)] }),
          el("span", { class: "bar" }, el("i", { style: "width:" + Math.round((sc.level / sc.quests.length) * 100) + "%" })))));
    app.appendChild(hero);

    if (s.tool.outdated) {
      app.appendChild(el("div", { class: "banner" },
        el("span", { text: "⬆️ " + fmt(t.outdated, { old: s.tool.version, new: payload.version }) }),
        button(t.update, "agentStudio.setup")));
    }

    // Quest
    var done = sc.quests.filter(function (q) { return q.done; }).length;
    var nextFound = false;
    app.appendChild(el("div", { class: "section-title" },
      el("span", { text: "🗺️ " + t.quest }),
      el("span", { text: fmt(t.questProgress, { done: done, total: sc.quests.length }) })));
    var quest = el("div", { class: "quest" });
    sc.quests.forEach(function (q) {
      var isNext = !q.done && !nextFound;
      if (isNext) {
        nextFound = true;
      }
      var info = t.steps[q.id];
      quest.appendChild(el("div", { class: "step" + (q.done ? " done" : "") + (isNext ? " next" : "") },
        el("span", { class: "tick", text: "✓" }),
        el("div", { class: "label" }, el("b", { text: info[0] }), el("div", { text: info[1] })),
        q.done ? null : button(t.doIt, q.action, !isNext)));
    });
    app.appendChild(quest);

    // Tool cards
    app.appendChild(el("div", { class: "section-title" }, el("span", { text: "🧰 " + t.tools })));
    var cards = el("div", { class: "cards" });

    cards.appendChild(card(t, "🗺️", t.cards.map, s.django.detected ? "info" : "off",
      s.django.detected ? t.pill.info : t.pill.off,
      s.django.detected ? fmt(t.appsModels, { apps: s.django.apps, models: s.django.models }) : t.noDjango,
      [button(t.a.openMap, "agentStudio.openMap")]));

    var sc0 = s.scaffold;
    cards.appendChild(card(t, "🧬", t.cards.scaffold, sc0.state === "off" ? "off" : sc0.state,
      t.pill[sc0.state === "error" ? "warn" : sc0.state],
      sc0.state === "off" ? t.noRef : el("span", null,
        el("span", { text: fmt(t.refApp, { ref: "" }) }), el("code", { text: sc0.reference || "" }),
        el("br"), el("span", { text: fmt(t.matching, { ok: sc0.ok, total: sc0.total }) })),
      sc0.state === "off" ? [button(t.a.setRef, "agentStudio.setReference")] : [button(t.a.newApp, "agentStudio.newApp"), button(t.a.check, "agentStudio.checkApps", true)]));

    var cx = s.context;
    cards.appendChild(card(t, "📜", t.cards.context, cx.state === "off" ? "off" : cx.state === "fail" ? "warn" : cx.state,
      t.pill[cx.state === "fail" ? "warn" : cx.state === "error" ? "warn" : cx.state],
      cx.state === "off" ? t.noRules : cx.state === "pass" ? t.inSync : fmt(t.stale, { files: cx.stale.join(", ") }),
      [button(cx.state === "fail" ? t.a.sync : t.a.rules, cx.state === "fail" ? "agentStudio.syncContext" : "agentStudio.openRules", cx.state !== "fail")]));

    var g = s.guard;
    var gState = g.state === "pass" && g.warnings > 0 ? "warn" : g.state;
    cards.appendChild(card(t, "🛡️", t.cards.guard, gState === "error" ? "warn" : gState,
      t.pill[gState === "error" ? "warn" : gState],
      g.state === "off" ? t.guardOff : fmt(t.guardLine, { errors: g.errors, warnings: g.warnings, scope: g.scope || "" }),
      [button(t.a.check, "agentStudio.checkMigrations")]));

    var r = s.report;
    var rState = !r.verdict ? "off" : r.verdict === "green" ? "pass" : r.verdict === "yellow" ? "warn" : "fail";
    cards.appendChild(card(t, "📋", t.cards.report, rState,
      r.verdict ? t.pill[r.verdict] : t.pill.off,
      r.verdict ? fmt(t.reportLine, { branch: r.branch, base: r.base, files: r.files, commits: r.commits }) : t.reportOff,
      r.verdict ? [button(t.a.show, "agentStudio.showReport"), button(t.a.copy, "agentStudio.copyReport", true)] : []));

    var missing = s.skills.missing;
    cards.appendChild(card(t, "🧠", t.cards.skills, missing.length ? "warn" : "pass",
      missing.length ? t.pill.warn : t.pill.pass,
      missing.length ? fmt(t.skillsMissing, { list: missing.join(", ") }) : t.skillsOk,
      missing.length ? [button(t.a.setup, "agentStudio.setup"), button(t.a.skills, "agentStudio.openSkills", true)] : [button(t.a.skills, "agentStudio.openSkills", true)]));
    app.appendChild(cards);

    // Badges
    var earned = sc.badges.filter(function (b) { return b.earned; }).length;
    app.appendChild(el("div", { class: "section-title" },
      el("span", { text: "🏅 " + t.badges }),
      el("span", { text: fmt(t.badgeCount, { n: earned, total: sc.badges.length }) })));
    var badges = el("div", { class: "badges" });
    sc.badges.forEach(function (b) {
      var info = t.b[b.id];
      badges.appendChild(el("div", {
        class: "badge " + (b.earned ? "earned" : "locked"),
        title: (b.earned ? "" : "🔒 ") + info[1],
        role: "img",
        "aria-label": info[1],
        text: info[0]
      }));
    });
    app.appendChild(badges);

    app.appendChild(footer(t, lang, payload.version));

    if (payload.celebrate) {
      confetti();
    }
  }

  function footer(t, lang, version) {
    function langButton(code, label) {
      return el("button", {
        "aria-pressed": lang === code ? "true" : "false",
        text: label,
        onclick: function () { vscode.postMessage({ type: "lang", lang: code }); }
      });
    }
    return el("div", { class: "footer" },
      el("span", { class: "lang", role: "group" }, langButton("en", "EN"), langButton("ar", "عربي")),
      el("span", { class: "mono", text: "v" + (version || "") }),
      el("button", { class: "link", text: "↻ " + t.refresh, onclick: function () { vscode.postMessage({ type: "refresh" }); } }));
  }

  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || typeof m !== "object") {
      return;
    }
    if (m.type === "state") {
      render(m.payload);
    } else if (m.type === "busy") {
      var hero = document.getElementById("hero");
      if (hero) {
        hero.classList.add("busy");
      }
    } else if (m.type === "error") {
      var t = T[m.payload && m.payload.lang === "ar" ? "ar" : "en"];
      app.textContent = "";
      app.appendChild(el("div", { class: "empty" },
        el("div", { class: "big", text: "🛠️" }),
        el("h3", { text: t.error }),
        el("p", { class: "mono", text: (m.payload && m.payload.message) || "" }),
        el("button", { text: t.refresh, onclick: function () { vscode.postMessage({ type: "refresh" }); } })));
    }
  });

  vscode.postMessage({ type: "ready" });
  void lastState;
})();
