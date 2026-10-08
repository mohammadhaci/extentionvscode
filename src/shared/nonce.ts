import { randomBytes } from "node:crypto";

/**
 * Cryptographically secure nonce for webview Content-Security-Policy
 * `script-src 'nonce-...'`. Uses CSPRNG instead of Math.random so the
 * nonce is unpredictable. Hex keeps the previous 32-char alphanumeric shape.
 */
export function nonce(): string {
  return randomBytes(16).toString("hex");
}
