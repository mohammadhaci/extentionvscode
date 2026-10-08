import type { ProjectMap } from "./graphTypes";

/**
 * Strictly typed message payloads exchanged between the extension host
 * and the webview. Both sides must validate `type` before using `payload`.
 *
 * Webview -> Extension
 */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "openPanel" }
  | { type: "openFile"; payload: { file: string; line?: number } };

/**
 * Extension -> Webview
 */
export type HostToWebviewMessage =
  | { type: "mapData"; payload: ProjectMap }
  | { type: "progress"; payload: { message: string } }
  | { type: "error"; payload: { message: string; detail?: string } };

function isOpenFilePayload(v: unknown): v is { file: string; line?: number } {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const payload = v as { file?: unknown; line?: unknown };
  if (typeof payload.file !== "string") {
    return false;
  }
  if (
    "line" in payload &&
    payload.line !== undefined &&
    typeof payload.line !== "number"
  ) {
    return false;
  }
  return true;
}

export function isWebviewToHostMessage(v: unknown): v is WebviewToHostMessage {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const t = (v as { type?: unknown }).type;
  if (t === "ready" || t === "refresh" || t === "openPanel") {
    return true;
  }
  if (t === "openFile") {
    return isOpenFilePayload((v as { payload?: unknown }).payload);
  }
  return false;
}
