import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { installMcpConfig, mcpInstalled } from "../../mcp/config";
import { handle, serve } from "../../mcp/server";
import { relationsDiagram, TOOLS } from "../../mcp/tools";
import { projectSummary } from "../../tasks/library";

/** Repository root (out/test/mcp -> ../../..). */
const EXT_ROOT = path.resolve(__dirname, "..", "..", "..");

let root: string;
const write = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
let nextId = 1;
const call = (method: string, params?: Record<string, unknown>): { result?: any; error?: { code: number; message: string } } =>
  handle(root, { jsonrpc: "2.0", id: nextId++, method, params }) as any;
const tool = (name: string, args: Record<string, unknown> = {}): { text: string; isError: boolean } => {
  const r = call("tools/call", { name, arguments: args });
  assert.equal(r.error, undefined, r.error?.message);
  return { text: r.result.content[0].text, isError: r.result.isError === true };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-"));
  write("manage.py", "");
  write("config/settings.py", 'INSTALLED_APPS = [\n    "apps.accounts",\n    "apps.rfq",\n]\nROOT_URLCONF = "config.urls"\n');
  write("config/urls.py", 'from django.urls import include, path\nurlpatterns = [path("rfq/", include("apps.rfq.urls"))]\n');
  for (const app of ["accounts", "rfq"]) {
    write(`apps/${app}/__init__.py`, "");
    write(`apps/${app}/apps.py`, "");
  }
  write("apps/accounts/models.py", "from django.db import models\n\nclass Company(models.Model):\n    name = models.CharField(max_length=100)\n");
  write(
    "apps/rfq/models.py",
    "from django.db import models\n\nclass Loop(models.Model):\n    company = models.ForeignKey('accounts.Company', on_delete=models.CASCADE)\n    number = models.PositiveIntegerField()\n"
  );
  write("apps/rfq/urls.py", 'from django.urls import path\nfrom . import views\nurlpatterns = [path("", views.LoopList.as_view(), name="loop-list")]\n');
  write(".agent-studio/rules.md", "- Every queryset is scoped to the user's company.\n");
  write(".agent-studio/scaffold.json", '{ "referenceApp": "apps/rfq" }');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("mcp protocol", () => {
  it("initializes, negotiates the version and ignores notifications", () => {
    const r = call("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(r.result.protocolVersion, "2025-03-26");
    assert.equal(r.result.serverInfo.name, "agent-studio");
    assert.ok(r.result.capabilities.tools && r.result.capabilities.prompts);
    assert.match(r.result.instructions, /memory_search/);
    assert.equal(call("initialize", { protocolVersion: "1999-01-01" }).result.protocolVersion, "2025-06-18");
    assert.equal(handle(root, { jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
    assert.deepEqual(call("ping").result, {});
    assert.equal(call("nope/method").error!.code, -32601);
    assert.equal(handle(root, { jsonrpc: "2.0", id: 9 })!.hasOwnProperty("error"), true);
  });

  it("lists tools with valid schemas", () => {
    const tools = call("tools/list").result.tools;
    assert.deepEqual(
      tools.map((t: { name: string }) => t.name),
      TOOLS.map((t) => t.name)
    );
    for (const t of tools) {
      assert.match(t.name, /^[a-z_]+$/);
      assert.equal(t.inputSchema.type, "object");
      assert.ok(t.description.length > 20);
      assert.equal(t.run, undefined);
    }
  });

  it("answers project, app and relation questions", () => {
    const overview = tool("project_overview").text;
    assert.match(overview, /Django project with 2 app\(s\)/);
    assert.match(overview, /Reference app \(approved template\): apps\/rfq/);
    assert.match(overview, /- apps\/rfq \(\/rfq\/\): Loop; depends on apps\/accounts/);
    assert.match(overview, /scoped to the user's company/);

    const details = tool("app_details", { app: "rfq" }).text;
    assert.match(details, /# apps\/rfq \(reference app\)/);
    assert.match(details, /- Loop\(models\.Model\) at apps\/rfq\/models\.py:3/);
    assert.match(details, /company: ForeignKey → accounts\.Company/);
    assert.match(details, /number: PositiveIntegerField/);
    assert.match(details, /- (\(empty\)) → views\.LoopList\.as_view\(\) \(name: loop-list\)|loop-list/);
    assert.match(details, /- models\.py/);
    assert.match(tool("app_details", { app: "apps/accounts" }).text, /Used by: apps\/rfq/);

    const missing = tool("app_details", { app: "apps/nope" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /not a Django app\. Apps: apps\/accounts, apps\/rfq/);
    assert.match(tool("app_details", {}).text, /"app" is required/);

    const relations = tool("app_relations").text;
    assert.match(relations, /- apps\/rfq → apps\/accounts/);
    assert.match(relations, /```mermaid\ngraph LR/);
    assert.match(relationsDiagram(projectSummary(root)), /apps_rfq\["apps\/rfq ⭐"\][\s\S]*apps_rfq --> apps_accounts/);
  });

  it("reads and writes project memory, refreshing agent instructions", () => {
    assert.match(tool("memory_search", { query: "loops" }).text, /No matching memories/);
    const saved = tool("memory_add", { type: "gotcha", title: "Loops are copied, never edited", body: "Edit the newest loop only.", tags: ["rfq"], related: ["apps/rfq"], author: "claude" });
    assert.equal(saved.isError, false, saved.text);
    assert.match(saved.text, /Saved ⚠️ Loops are copied, never edited to \.agent-studio\/memory\//);
    assert.match(saved.text, /Agent instructions updated/);
    assert.match(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), /Loops are copied, never edited/);

    const found = tool("memory_search", { query: "loops copied" }).text;
    assert.match(found, /Edit the newest loop only\./);
    const id = /\(id ([^)]+)\)/.exec(found)![1];
    assert.match(tool("memory_get", { id }).text, /related: apps\/rfq/);
    assert.match(tool("app_details", { app: "apps/rfq" }).text, /## Project memory\n- ⚠️ gotcha: Loops are copied/);

    assert.match(tool("memory_mark_outdated", { id }).text, /Marked "Loops are copied, never edited" as outdated/);
    assert.match(tool("memory_search", { query: "loops" }).text, /No matching memories/);
    assert.match(tool("memory_search", { query: "loops", include_outdated: true }).text, /\(outdated\)/);

    assert.equal(tool("memory_add", { type: "rumour", title: "x" }).isError, true);
    assert.equal(tool("memory_add", { type: "gotcha", title: "x", tags: 5 }).isError, true);
    assert.equal(tool("memory_get", { id: "missing" }).isError, true);
  });

  it("runs checks and serves tasks as tools and prompts", () => {
    const checks = tool("run_checks").text;
    assert.match(checks, /## (✅|❌) Migrations/);
    assert.match(checks, /## (✅|❌) App structure/);
    assert.match(checks, /## (✅|❌) Agent instructions/);
    assert.match(tool("migrations_check").text, /migration/i);

    assert.match(tool("list_tasks").text, /- 🔒 security-audit: Security audit\./);
    assert.match(tool("get_task", { id: "write-tests", app: "rfq" }).text, /^# 🧪 Write tests: apps\/rfq/);
    assert.match(tool("get_task", { id: "write-tests" }).text, /needs an app/);
    assert.equal(tool("get_task", { id: "nope" }).isError, true);

    const prompts = call("prompts/list").result.prompts;
    const audit = prompts.find((p: { name: string }) => p.name === "security-audit");
    assert.deepEqual(audit.arguments, [{ name: "app", description: 'App folder, e.g. "apps/rfq"', required: false }]);
    assert.deepEqual(prompts.find((p: { name: string }) => p.name === "new-section").arguments.map((a: { name: string }) => a.name), ["input"]);
    const got = call("prompts/get", { name: "learn-app", arguments: { app: "rfq" } }).result;
    assert.equal(got.messages[0].role, "user");
    assert.match(got.messages[0].content.text, /Study the `apps\/rfq` app/);
    assert.equal(call("prompts/get", { name: "learn-app" }).error!.code, -32602);

    assert.equal(call("tools/call", { name: "nope" }).error!.code, -32602);
    assert.equal(call("tools/call", { name: "list_tasks", arguments: [] }).error!.code, -32602);
  });

  it("serves newline-delimited JSON over streams", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (c: Buffer) => chunks.push(c.toString()));
    const done = serve(root, input, output);
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    input.write("not json\n");
    input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    input.write('[{"jsonrpc":"2.0","id":2,"method":"ping"},{"jsonrpc":"2.0","id":3,"method":"tools/list"}]\n');
    input.end();
    await done;
    const lines = chunks.join("").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines[0], { jsonrpc: "2.0", id: 1, result: {} });
    assert.equal(lines[1].error.code, -32700);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[2].map((r: { id: number }) => r.id), [2, 3]);
  });

  it("runs as a real process through the project CLI", async () => {
    const cli = path.join(EXT_ROOT, "out", "cli.js");
    const child = spawn(process.execPath, [cli, "mcp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "project_overview" } }) + "\n");
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    assert.equal(code, 0);
    const [init, overview] = out.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(init.result.serverInfo.name, "agent-studio");
    assert.match(overview.result.content[0].text, /Django project with 2 app\(s\)/);
  });
});

describe("mcp config", () => {
  it("registers the server for Claude Code and VS Code, keeping other servers", () => {
    write(".mcp.json", JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    assert.equal(mcpInstalled(root), false);
    const r = installMcpConfig(root);
    assert.deepEqual(r.map((x) => [x.path, x.status]), [[".mcp.json", "updated"], [".vscode/mcp.json", "created"]]);
    const claude = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    assert.deepEqual(claude.mcpServers.other, { command: "x" });
    assert.deepEqual(claude.mcpServers["agent-studio"], { command: "node", args: [".agent-studio/tool/cli.js", "mcp"] });
    const vscode = JSON.parse(fs.readFileSync(path.join(root, ".vscode/mcp.json"), "utf8"));
    assert.deepEqual(vscode.servers["agent-studio"].args, ["${workspaceFolder}/.agent-studio/tool/cli.js", "mcp"]);
    assert.equal(mcpInstalled(root), true);
    assert.ok(installMcpConfig(root).every((x) => x.status === "unchanged"));
  });

  it("leaves a config with comments alone", () => {
    write(".vscode/mcp.json", '// mine\n{ "servers": {} }');
    const r = installMcpConfig(root).find((x) => x.path === ".vscode/mcp.json")!;
    assert.equal(r.status, "skipped");
    assert.equal(fs.readFileSync(path.join(root, ".vscode/mcp.json"), "utf8"), '// mine\n{ "servers": {} }');
  });
});
