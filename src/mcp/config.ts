// Registers the studio's MCP server with the agents that read project-level config files.
import * as fs from "fs";
import * as path from "path";
import { TOOL_DIR } from "../studio/paths";

export const MCP_SERVER_NAME = "agent-studio";

export interface McpTarget {
  /** Project-relative config file. */
  path: string;
  agent: string;
  /** Top-level key holding the servers. */
  key: "mcpServers" | "servers";
  entry: Record<string, unknown>;
}

export const MCP_TARGETS: readonly McpTarget[] = [
  {
    path: ".mcp.json",
    agent: "Claude Code",
    key: "mcpServers",
    entry: { command: "node", args: [`${TOOL_DIR}/cli.js`, "mcp"] },
  },
  {
    path: ".vscode/mcp.json",
    agent: "VS Code (Copilot)",
    key: "servers",
    entry: { type: "stdio", command: "node", args: [`\${workspaceFolder}/${TOOL_DIR}/cli.js`, "mcp"] },
  },
];

export type McpInstallStatus = "created" | "updated" | "unchanged" | "skipped";

export interface McpInstallResult {
  path: string;
  agent: string;
  status: McpInstallStatus;
  detail?: string;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Adds (or refreshes) the agent-studio server in each config file, keeping everything else. */
export function installMcpConfig(root: string, options: { check?: boolean } = {}): McpInstallResult[] {
  return MCP_TARGETS.map((t) => {
    const file = path.join(root, ...t.path.split("/"));
    let data: Record<string, unknown> = {};
    const exists = fs.existsSync(file);
    if (exists) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not a JSON object");
        }
        data = parsed as Record<string, unknown>;
      } catch (err) {
        return { path: t.path, agent: t.agent, status: "skipped", detail: `could not read it as JSON (${err instanceof Error ? err.message : String(err)}); add the server by hand` };
      }
    }
    const servers = (typeof data[t.key] === "object" && data[t.key] !== null ? data[t.key] : {}) as Record<string, unknown>;
    if (same(servers[MCP_SERVER_NAME], t.entry)) {
      return { path: t.path, agent: t.agent, status: "unchanged" };
    }
    if (!options.check) {
      data[t.key] = { ...servers, [MCP_SERVER_NAME]: t.entry };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    }
    return { path: t.path, agent: t.agent, status: exists ? "updated" : "created" };
  });
}

/** True when every config file already registers the server. */
export function mcpInstalled(root: string): boolean {
  return installMcpConfig(root, { check: true }).every((r) => r.status === "unchanged");
}

/** The Codex CLI keeps MCP servers in its own config; this is the command that adds ours. */
export function codexCommand(root: string): string {
  const cli = path.join(root, ...TOOL_DIR.split("/"), "cli.js");
  return `codex mcp add ${MCP_SERVER_NAME} -- node "${cli}" mcp`;
}
