import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Module = require("module");
import { createMock, fakeView, recorded } from "./vscodeMock";

const EXT_ROOT = path.resolve(__dirname, "..", "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, "package.json"), "utf8")) as {
  main: string;
  contributes: { commands: { command: string }[]; views: Record<string, { id: string }[]> };
};

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("extension activation (mocked vscode)", () => {
  it("registers exactly the contributed commands and views, and Home posts real state", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-activate-"));
    const w = (rel: string, text: string): void => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    w("manage.py", "");
    w("config/settings.py", 'INSTALLED_APPS = [\n    "apps.orders",\n]\n');
    w("apps/orders/__init__.py", "");
    w("apps/orders/apps.py", "");
    w("apps/orders/models.py", "class Order(models.Model):\n    total = models.IntegerField(null=True)\n");

    const mock = createMock(root);
    const loader = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown };
    const original = loader._load;
    loader._load = (req: string, ...rest: unknown[]) => (req === "vscode" ? mock : original(req, ...rest));
    try {
      const ext = require(path.join(EXT_ROOT, pkg.main)) as { activate(c: unknown): void; deactivate(): void };
      const memento = (): { get: (k: string) => unknown; update: (k: string, v: unknown) => Promise<void> } => {
        const m = new Map<string, unknown>();
        return { get: (k) => m.get(k), update: async (k, v) => void m.set(k, v) };
      };
      const context = {
        subscriptions: [] as unknown[],
        extensionUri: (mock.Uri as { file(p: string): unknown }).file(EXT_ROOT),
        extensionPath: EXT_ROOT,
        globalState: memento(),
        workspaceState: memento(),
        globalStorageUri: (mock.Uri as { file(p: string): unknown }).file(path.join(root, ".storage")),
      };
      ext.activate(context);

      const declared = pkg.contributes.commands.map((c) => c.command).sort();
      assert.deepEqual([...recorded.commands.keys()].sort(), declared);
      const views = Object.values(pkg.contributes.views).flat().map((v) => v.id).sort();
      assert.deepEqual([...recorded.views.keys()].sort(), views);

      const home = recorded.views.get("agentStudio.home")!;
      const { view, send } = fakeView();
      home.resolveWebviewView(view);
      const html = (view as { webview: { html: string } }).webview.html;
      assert.match(html, /Content-Security-Policy/);
      assert.match(html, /script-src 'nonce-/);
      assert.ok(!/unsafe-inline/.test(html));

      await send({ type: "ready" });
      await wait(400);
      const state = recorded.messages.find((m) => (m as { type: string }).type === "state") as {
        payload: { lang: string; status: { django: { detected: boolean; apps: number } }; score: { mood: string } };
      };
      assert.ok(state, JSON.stringify(recorded.messages));
      assert.equal(state.payload.lang, "ar"); // follows vscode.env.language
      assert.equal(state.payload.status.django.detected, true);
      assert.equal(state.payload.status.django.apps, 1);
      assert.equal(state.payload.score.mood, "sleepy");

      // A command the webview may not run is ignored; an allowed one runs.
      await send({ type: "run", command: "workbench.action.files.delete" });
      await send({ type: "lang", lang: "en" });
      await wait(400);
      const last = recorded.messages.filter((m) => (m as { type: string }).type === "state").pop() as { payload: { lang: string } };
      assert.equal(last.payload.lang, "en");

      ext.deactivate();
    } finally {
      loader._load = original;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
