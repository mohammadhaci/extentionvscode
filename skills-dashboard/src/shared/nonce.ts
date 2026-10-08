import { randomBytes } from "node:crypto";

/**
 * Cryptographically secure nonce for webview Content-Security-Policy
 * `script-src 'nonce-...'`.
 */
export function nonce(): string {
  return randomBytes(16).toString("hex");
}
