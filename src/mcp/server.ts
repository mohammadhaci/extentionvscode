// A dependency-free MCP server (JSON-RPC 2.0 over stdio, one message per line) that gives
// Claude Code, Codex and Copilot the studio's tools, plus the agent tasks as prompts.
// Run as: node .agent-studio/tool/cli.js mcp
import * as readline from "readline";
import { STUDIO_VERSION } from "../generated/version";
import { buildPrompt, findTask, listTasks, projectSummary } from "../tasks/library";
import { ToolError, TOOLS } from "./tools";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Django Agent Studio: tools for this Django project.
- Start a task with project_overview (apps, reference app, rules) and memory_search for the area you touch.
- Use app_details and app_relations before changing an app, to see what depends on it.
- Save what the next agent should know with memory_add (one fact per entry, never secrets).
- Before you finish, run run_checks, and change_report for a branch.`;

type Id = string | number | null;
interface Request {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}
type Response = { jsonrpc: "2.0"; id: Id; result: unknown } | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const ok = (id: Id, result: unknown): Response => ({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string): Response => ({ jsonrpc: "2.0", id, error: { code, message } });

function promptsList(root: string): unknown {
  return {
    prompts: listTasks(root).map((t) => ({
      name: t.id,
      title: `${t.icon} ${t.title}`,
      description: t.description,
      arguments: [
        ...(t.scope === "project" ? [] : [{ name: "app", description: 'App folder, e.g. "apps/rfq"', required: t.scope === "app" }]),
        ...(t.input ? [{ name: "input", description: t.input, required: true }] : []),
      ],
    })),
  };
}

function promptGet(root: string, params: Record<string, unknown>): unknown {
  const task = findTask(listTasks(root), String(params.name ?? ""));
  if (!task) {
    throw new ToolError(`Unknown prompt "${String(params.name)}"`);
  }
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const summary = projectSummary(root);
  const rawApp = typeof args.app === "string" ? args.app.replace(/\\/g, "/").replace(/\/+$/, "") : undefined;
  const app = rawApp ? (summary.apps.find((a) => a.dir === rawApp) ?? summary.apps.find((a) => a.name === rawApp))?.dir ?? rawApp : undefined;
  let text: string;
  try {
    text = buildPrompt(root, task, { app, input: typeof args.input === "string" ? args.input : undefined }, summary);
  } catch (err) {
    // A missing app or input is the caller's mistake: invalid params.
    throw new ToolError(err instanceof Error ? err.message : String(err));
  }
  return { description: task.title, messages: [{ role: "user", content: { type: "text", text } }] };
}

/** Handles one JSON-RPC message; returns the response, or undefined for notifications. */
export function handle(root: string, message: unknown): Response | undefined {
  if (typeof message !== "object" || message === null || typeof (message as Request).method !== "string") {
    const id = (message as { id?: Id } | null)?.id;
    // Responses to requests we never send, or garbage: answer only if it carries an id.
    return id === undefined ? undefined : fail(id ?? null, -32600, "Invalid request");
  }
  const req = message as Request;
  const isNotification = req.id === undefined;
  const id = req.id ?? null;
  const params = req.params ?? {};
  try {
    let result: unknown;
    switch (req.method) {
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: "agent-studio", title: "Django Agent Studio", version: STUDIO_VERSION },
          instructions: INSTRUCTIONS,
        };
        break;
      }
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS.map(({ run: _run, ...t }) => t) };
        break;
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) {
          return isNotification ? undefined : fail(id, -32602, `Unknown tool "${String(params.name)}"`);
        }
        const args = params.arguments;
        if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
          return isNotification ? undefined : fail(id, -32602, "arguments must be an object");
        }
        try {
          result = { content: [{ type: "text", text: tool.run(root, (args ?? {}) as Record<string, unknown>) }] };
        } catch (err) {
          // Tool failures go back to the agent as results it can read and act on.
          const msg = err instanceof Error ? err.message : String(err);
          result = { content: [{ type: "text", text: err instanceof ToolError ? msg : `Error: ${msg}` }], isError: true };
        }
        break;
      }
      case "prompts/list":
        result = promptsList(root);
        break;
      case "prompts/get":
        result = promptGet(root, params);
        break;
      case "resources/list":
        result = { resources: [] };
        break;
      default:
        if (req.method.startsWith("notifications/")) {
          return undefined;
        }
        return isNotification ? undefined : fail(id, -32601, `Method not found: ${req.method}`);
    }
    return isNotification ? undefined : ok(id, result);
  } catch (err) {
    return isNotification ? undefined : fail(id, err instanceof ToolError ? -32602 : -32603, err instanceof Error ? err.message : String(err));
  }
}

/** Serves MCP over stdio until stdin closes. Logs go to stderr; stdout carries only protocol. */
export function serve(root: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const send = (r: Response | undefined): void => {
    if (r) {
      output.write(JSON.stringify(r) + "\n");
    }
  };
  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      send(fail(null, -32700, "Parse error"));
      return;
    }
    if (Array.isArray(msg)) {
      const replies = msg.map((m) => handle(root, m)).filter((r): r is Response => r !== undefined);
      if (replies.length) {
        output.write(JSON.stringify(replies) + "\n");
      }
    } else {
      send(handle(root, msg));
    }
  });
  return new Promise((resolve) => rl.on("close", () => resolve()));
}
