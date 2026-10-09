// Minimal stand-in for the `vscode` module, enough to activate the extension in
// plain Node and drive the Home view. Records what the extension registers.
import * as fs from "fs";
import * as path from "path";

export interface Recorded {
  commands: Map<string, (...args: unknown[]) => unknown>;
  views: Map<string, { resolveWebviewView(view: unknown): void }>;
  messages: unknown[];
  infos: string[];
}

export const recorded: Recorded = { commands: new Map(), views: new Map(), messages: [], infos: [] };

class Uri {
  constructor(readonly scheme: string, readonly path: string) {}
  get fsPath(): string {
    return this.path;
  }
  static file(p: string): Uri {
    return new Uri("file", p);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, path.join(base.path, ...parts));
  }
  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

const disposable = { dispose(): void {} };
const event = (): typeof disposable => disposable;

export function createMock(workspaceRoot: string): Record<string, unknown> {
  const folder = { uri: Uri.file(workspaceRoot), name: path.basename(workspaceRoot), index: 0 };
  const config = { get: <T>(_k: string, d?: T): T | undefined => d };
  return {
    Uri,
    ViewColumn: { One: 1, Beside: -2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    ProgressLocation: { Notification: 15 },
    EndOfLine: { LF: 1, CRLF: 2 },
    Range: class {
      constructor(...a: unknown[]) {
        void a;
      }
    },
    Position: class {
      constructor(...a: unknown[]) {
        void a;
      }
    },
    Diagnostic: class {
      source?: string;
      code?: string;
      constructor(...a: unknown[]) {
        void a;
      }
    },
    env: { language: "ar", clipboard: { writeText: async () => undefined } },
    commands: {
      registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
        if (recorded.commands.has(id)) {
          throw new Error(`command ${id} registered twice`);
        }
        recorded.commands.set(id, fn);
        return disposable;
      },
      executeCommand: async (id: string, ...args: unknown[]) => recorded.commands.get(id)?.(...args),
    },
    window: {
      registerWebviewViewProvider: (id: string, provider: { resolveWebviewView(view: unknown): void }) => {
        recorded.views.set(id, provider);
        return disposable;
      },
      createOutputChannel: () => ({ appendLine(): void {}, show(): void {}, dispose(): void {} }),
      showInformationMessage: async (msg: string) => {
        recorded.infos.push(msg);
        return undefined;
      },
      showWarningMessage: async () => undefined,
      showErrorMessage: async (msg: string) => {
        recorded.infos.push(`ERROR: ${msg}`);
        return undefined;
      },
      setStatusBarMessage: () => disposable,
      createWebviewPanel: () => {
        throw new Error("panels are not exercised in this smoke test");
      },
    },
    workspace: {
      workspaceFolders: [folder],
      getWorkspaceFolder: () => folder,
      getConfiguration: () => config,
      createFileSystemWatcher: () => ({ onDidChange: event, onDidCreate: event, onDidDelete: event, dispose(): void {} }),
      fs: {
        readFile: async (u: Uri) => fs.readFileSync(u.fsPath),
        stat: async (u: Uri) => fs.statSync(u.fsPath),
      },
      findFiles: async () => [],
    },
    languages: {
      createDiagnosticCollection: () => {
        const map = new Map<string, unknown>();
        return {
          set: (u: Uri, d: unknown) => map.set(u.toString(), d),
          delete: (u: Uri) => map.delete(u.toString()),
          forEach: (fn: (u: Uri) => void) => [...map.keys()].forEach((k) => fn(Uri.file(k.replace(/^file:\/\//, "")))),
          dispose(): void {},
        };
      },
    },
  };
}

/** A fake webview view that collects the messages posted to it. */
export function fakeView(): { view: unknown; send(m: unknown): Promise<void> } {
  let handler: ((m: unknown) => unknown) | undefined;
  const view = {
    visible: true,
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-resource:",
      asWebviewUri: (u: Uri) => u,
      postMessage: async (m: unknown) => {
        recorded.messages.push(m);
        return true;
      },
      onDidReceiveMessage: (fn: (m: unknown) => unknown) => {
        handler = fn;
        return disposable;
      },
    },
    onDidChangeVisibility: event,
  };
  return { view, send: async (m: unknown) => void (await handler?.(m)) };
}
