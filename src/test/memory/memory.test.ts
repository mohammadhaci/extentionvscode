import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { main } from "../../cli";
import { addMemory, findMemory, listMemories, markOutdated, parseMemory, searchMemories, serializeMemory, slugify } from "../../memory/memory";
import { renderMemory } from "../../context/render";

let root: string;
const write = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");
const run = (...argv: string[]): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, { cwd: root, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-memory-"));
  write("manage.py", "");
  write("config/settings.py", 'INSTALLED_APPS = [\n    "apps.rfq",\n]\n');
  write("apps/rfq/__init__.py", "");
  write("apps/rfq/apps.py", "");
  write("apps/rfq/models.py", "class Loop(models.Model):\n    pass\n");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("memory store", () => {
  it("round-trips entries, including quotes and Arabic titles", () => {
    const text = serializeMemory({
      type: "knowledge",
      title: 'RFQ "loops" — حلقات العروض',
      tags: ["rfq", "loops"],
      related: ["apps/rfq"],
      author: "claude",
      date: "2026-10-09",
      status: "active",
      body: "Each loop copies the previous one.",
    });
    const e = parseMemory(text, ".agent-studio/memory/x.md")!;
    assert.equal(e.title, 'RFQ "loops" — حلقات العروض');
    assert.deepEqual(e.tags, ["rfq", "loops"]);
    assert.deepEqual(e.related, ["apps/rfq"]);
    assert.equal(e.body, "Each loop copies the previous one.");
    assert.equal(parseMemory("no frontmatter", "x.md"), undefined);
    assert.equal(parseMemory("---\ntype: nope\ntitle: x\n---\n", "x.md"), undefined);
  });

  it("slugifies Latin titles and falls back for others", () => {
    assert.equal(slugify("RFQ loops are versioned!"), "rfq-loops-are-versioned");
    assert.equal(slugify("حلقات العروض"), "");
    const e = addMemory(root, { type: "gotcha", title: "حلقات العروض", date: "2026-10-09" });
    assert.match(e.id, /^2026-10-09-gotcha-[0-9a-f]{4}$/);
  });

  it("adds, lists newest first, searches, finds and retires", () => {
    const a = addMemory(root, { type: "decision", title: "Exports run in Celery", body: "Requests time out after 30s.", tags: ["Exports"], date: "2026-10-01" });
    const b = addMemory(root, { type: "gotcha", title: "User email is not unique", body: "Legacy data.", related: ["apps/accounts"], date: "2026-10-05" });
    assert.deepEqual(listMemories(root).map((e) => e.id), [b.id, a.id]);
    assert.deepEqual(a.tags, ["exports"]);
    assert.deepEqual(searchMemories(listMemories(root), "celery").map((e) => e.id), [a.id]);
    assert.deepEqual(searchMemories(listMemories(root), "accounts").map((e) => e.id), [b.id]);
    assert.deepEqual(searchMemories(listMemories(root), "celery accounts"), []);
    assert.equal(findMemory(listMemories(root), b.id.slice(-4)).id, b.id);
    assert.throws(() => findMemory(listMemories(root), "2026-10"), /matches 2/);
    markOutdated(root, b);
    assert.equal(listMemories(root).find((e) => e.id === b.id)!.status, "outdated");
    assert.throws(() => addMemory(root, { type: "decision", title: "  " }), /title/);
  });

  it("renders a capped index with instructions", () => {
    const entries = Array.from({ length: 45 }, (_, i) => addMemory(root, { type: "lesson", title: `Lesson ${i}`, date: "2026-10-09" }));
    const md = renderMemory(entries);
    assert.match(md, /## Project memory/);
    assert.match(md, /memory search <words>/);
    assert.match(md, /…and 5 more/);
    assert.match(renderMemory([]), /_No entries yet\._/);
  });
});

describe("memory cli", () => {
  it("adds through the CLI and refreshes every agent's instructions", () => {
    assert.equal(run("context", "init").code, 0);
    assert.equal(run("context", "sync").code, 0);
    assert.match(read("AGENTS.md"), /## Project memory[\s\S]*_No entries yet\._/);

    const r = run("memory", "add", "--type", "knowledge", "--title", "RFQ loops are versioned", "--tags", "rfq,loops", "--related", "apps/rfq", "--author", "claude", "--body", "A new loop copies the previous one.");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Saved 📚 RFQ loops are versioned/);
    assert.match(r.out, /Agent instructions updated/);
    for (const f of ["CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"]) {
      assert.match(read(f), /📚 knowledge: RFQ loops are versioned \(rfq, loops\): `\.agent-studio\/memory\/2\d{3}-\d\d-\d\d-rfq-loops-are-versioned-[0-9a-f]{4}\.md`/);
    }
    assert.equal(run("context", "check").code, 0);

    const listed = JSON.parse(run("memory", "list", "--json").out);
    assert.equal(listed.length, 1);
    assert.match(run("memory", "search", "loops").out, /RFQ loops are versioned/);
    assert.match(run("memory", "show", listed[0].id).out, /A new loop copies the previous one\./);

    assert.equal(run("memory", "outdated", listed[0].id).code, 0);
    assert.doesNotMatch(read("AGENTS.md"), /RFQ loops are versioned/);
    assert.match(run("memory", "list", "--all").out, /\(outdated\)/);
    assert.match(run("memory", "list").out, /No memories yet/);
  });

  it("validates input", () => {
    assert.equal(run("memory").code, 2);
    assert.equal(run("memory", "add", "--title", "x").code, 2);
    assert.equal(run("memory", "add", "--type", "nope", "--title", "x").code, 2);
    assert.equal(run("memory", "add", "--type", "gotcha", "--bogus").code, 2);
    assert.equal(run("memory", "show", "missing").code, 1);
  });

  it("change report lists new memories and does not flag them as tooling", () => {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], { cwd: root });
    execFileSync("git", ["checkout", "-qb", "agent/work"], { cwd: root });
    run("memory", "add", "--type", "gotcha", "--title", "User email is not unique", "--author", "codex");
    const report = run("report", "--no-tools");
    assert.match(report.out, /\*\*Project memory\*\*\n\n- ➕ gotcha: User email is not unique/);
    assert.doesNotMatch(report.out, /Agent guardrails or tooling changed/);
  });

  it("change report treats a tool version bump as a yellow studio update", () => {
    write(".agent-studio/tool/package.json", '{"version":"0.2.0"}');
    write(".agent-studio/rules.md", "- rule\n");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: root });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], { cwd: root });
    execFileSync("git", ["checkout", "-qb", "agent/work"], { cwd: root });
    write(".agent-studio/tool/cli.js", "// new");

    // Tool files changed without a version bump: red.
    let json = JSON.parse(run("report", "--no-tools", "--json").out);
    assert.equal(json.verdict, "red");

    write(".agent-studio/tool/package.json", '{"version":"0.2.1"}');
    json = JSON.parse(run("report", "--no-tools", "--json").out);
    assert.equal(json.verdict, "yellow");
    assert.ok(json.risks.some((r: { level: string; title: string }) => r.level === "yellow" && r.title === "Agent Studio updated from v0.2.0 to v0.2.1"));

    // Editing the rules alongside the update stays red.
    write(".agent-studio/rules.md", "- changed\n");
    json = JSON.parse(run("report", "--no-tools", "--json").out);
    assert.equal(json.verdict, "red");
  });
});
