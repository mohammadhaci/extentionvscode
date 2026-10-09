import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PromoteFs,
  formatTargetReport,
  stagedPromote,
  stagingNames,
} from "../../skillsDashboard/skills/stagedPromote";
import { isSafeSkillName } from "../../skillsDashboard/skills/pathSafety";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** In-memory fake of the PromoteFs surface (posix rel paths, no VS Code API). */
class FakeFs implements PromoteFs {
  dirs = new Set<string>();
  files = new Map<string, Uint8Array>();
  writes = 0;
  failWritesAfter = Number.POSITIVE_INFINITY;
  failRenameAt: number | null = null;
  renames = 0;
  removed: string[] = [];

  constructor(seed: Array<{ path: string; dir: boolean; body?: string }> = []) {
    for (const e of seed) {
      if (e.dir) {
        this.dirs.add(e.path);
      } else {
        const parent = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "";
        if (parent !== "") {
          this.dirs.add(parent);
        }
        this.files.set(e.path, enc(e.body ?? ""));
      }
    }
  }

  async statType(rel: string): Promise<number | null> {
    if (this.files.has(rel)) {
      return 1;
    }
    if (this.dirs.has(rel)) {
      return 2;
    }
    return null;
  }

  async listNames(rel: string): Promise<string[]> {
    const prefix = rel === "" ? "" : `${rel}/`;
    const out = new Set<string>();
    for (const d of this.dirs) {
      if (d.startsWith(prefix)) {
        const rest = d.slice(prefix.length);
        if (rest !== "" && !rest.includes("/")) {
          out.add(rest);
        }
      }
    }
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        if (rest !== "" && !rest.includes("/")) {
          out.add(rest);
        }
      }
    }
    return [...out];
  }

  async mkdirp(rel: string): Promise<void> {
    this.dirs.add(rel);
  }

  async writeFile(rel: string, bytes: Uint8Array): Promise<void> {
    this.writes += 1;
    if (this.writes > this.failWritesAfter) {
      throw new Error("disk full");
    }
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    if (parent !== "" && !this.dirs.has(parent)) {
      throw new Error(`missing parent ${parent}`);
    }
    this.files.set(rel, bytes);
  }

  async renameRel(fromRel: string, toRel: string): Promise<void> {
    this.renames += 1;
    if (this.failRenameAt === this.renames) {
      throw new Error("rename failed");
    }
    const moveFile = (from: string, to: string): void => {
      const b = this.files.get(from);
      if (b !== undefined) {
        this.files.delete(from);
        this.files.set(to, b);
      }
    };
    if (this.files.has(fromRel)) {
      moveFile(fromRel, toRel);
      return;
    }
    const prefix = `${fromRel}/`;
    const movedDirs: string[] = [];
    for (const d of this.dirs) {
      if (d === fromRel || d.startsWith(prefix)) {
        movedDirs.push(d);
      }
    }
    const movedFiles: string[] = [];
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix)) {
        movedFiles.push(f);
      }
    }
    if (movedDirs.length === 0 && movedFiles.length === 0) {
      throw new Error(`rename missing ${fromRel}`);
    }
    for (const d of movedDirs) {
      this.dirs.delete(d);
    }
    for (const d of movedDirs) {
      this.dirs.add(d === fromRel ? toRel : toRel + d.slice(fromRel.length));
    }
    for (const f of movedFiles) {
      const b = this.files.get(f) as Uint8Array;
      this.files.delete(f);
      this.files.set(toRel + f.slice(fromRel.length), b);
    }
  }

  async removeRel(rel: string): Promise<void> {
    this.removed.push(rel);
    const prefix = `${rel}/`;
    for (const d of [...this.dirs]) {
      if (d === rel || d.startsWith(prefix)) {
        this.dirs.delete(d);
      }
    }
    for (const f of [...this.files.keys()]) {
      if (f === rel || f.startsWith(prefix)) {
        this.files.delete(f);
      }
    }
  }

  siblings(root: string): string[] {
    return [...this.dirs]
      .filter((d) => d.startsWith(`${root}/`) && !d.slice(root.length + 1).includes("/"))
      .map((d) => d.slice(root.length + 1));
  }
}

const FILES = [
  { rel: "SKILL.md", bytes: enc("# New") },
  { rel: "docs/a.md", bytes: enc("a") },
];

describe("stagedPromote", () => {
  it("leaves the prior destination intact when a write fails midway (overwrite)", async () => {
    const fs = new FakeFs([
      { path: "r", dir: true },
      { path: "r/demo", dir: true },
      { path: "r/demo/SKILL.md", dir: false, body: "# Old" },
      { path: "r/demo/old.md", dir: false, body: "old" },
    ]);
    fs.failWritesAfter = 1; // first staged write ok, second throws
    await assert.rejects(stagedPromote(fs, "r", "demo", FILES, true, "a1"), /left untouched/);
    // Prior destination byte-identical, staging cleaned up.
    assert.equal(new TextDecoder().decode(fs.files.get("r/demo/SKILL.md")), "# Old");
    assert.equal(new TextDecoder().decode(fs.files.get("r/demo/old.md")), "old");
    assert.deepEqual(fs.siblings("r"), ["demo"]);
  });

  it("restores the original when promotion fails after backup", async () => {
    const fs = new FakeFs([
      { path: "r", dir: true },
      { path: "r/demo", dir: true },
      { path: "r/demo/SKILL.md", dir: false, body: "# Old" },
    ]);
    fs.failRenameAt = 2; // dest->backup ok, staging->dest throws
    await assert.rejects(stagedPromote(fs, "r", "demo", FILES, true, "b2"), /restored/);
    assert.equal(new TextDecoder().decode(fs.files.get("r/demo/SKILL.md")), "# Old");
    assert.deepEqual(fs.siblings("r"), ["demo"]);
  });

  it("installs fresh targets completely and removes temp dirs", async () => {
    const fs = new FakeFs([{ path: "r", dir: true }]);
    const outcome = await stagedPromote(fs, "r", "demo", FILES, false, "c3");
    assert.equal(outcome.status, "installed");
    assert.equal(new TextDecoder().decode(fs.files.get("r/demo/SKILL.md")), "# New");
    assert.equal(new TextDecoder().decode(fs.files.get("r/demo/docs/a.md")), "a");
    assert.deepEqual(fs.siblings("r"), ["demo"]);
  });

  it("skips without touching anything when the skill exists and overwrite is off", async () => {
    const fs = new FakeFs([
      { path: "r", dir: true },
      { path: "r/demo", dir: true },
      { path: "r/demo/SKILL.md", dir: false, body: "# Old" },
    ]);
    const outcome = await stagedPromote(fs, "r", "demo", FILES, false, "d4");
    assert.equal(outcome.status, "skipped");
    assert.equal(fs.writes, 0);
    assert.equal(new TextDecoder().decode(fs.files.get("r/demo/SKILL.md")), "# Old");
  });

  it("uses sibling temp names that discovery ignores and keeps distinct", () => {
    const names = stagingNames("demo", "ab12");
    assert.ok(names);
    assert.notEqual(names?.staging, names?.backup);
    // Leading dot: not a valid skill name, so discovery skips temp dirs.
    assert.equal(isSafeSkillName(names?.staging.split("/").pop() as string), false);
    assert.equal(stagingNames("demo", "../x"), null);
    assert.equal(stagingNames("../evil", "ab12"), null);
  });
});

describe("formatTargetReport", () => {
  it("never reports a failed target as successful and names every outcome", () => {
    const r = formatTargetReport(
      "Copied",
      "demo",
      ["a"],
      ["b"],
      [{ root: "c", message: "boom" }],
      []
    );
    assert.equal(r.ok, false);
    assert.match(r.message, /Copied "demo" to a\./);
    assert.match(r.message, /Exists in b \(not overwritten\)\./);
    assert.match(r.message, /Failed in c: boom/);
  });

  it("keeps the previous success/skip wording when nothing failed", () => {
    assert.deepEqual(formatTargetReport("Copied", "demo", ["a"], [], [], []), {
      ok: true,
      message: 'Copied "demo" to a.',
    });
    assert.deepEqual(formatTargetReport("Installed", "demo", [], ["a"], [], []), {
      ok: false,
      message: "Already exists in a. Tick overwrite to replace.",
    });
  });
});
