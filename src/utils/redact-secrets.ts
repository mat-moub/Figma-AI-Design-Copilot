/**
 * redact-secrets.ts — Shared secret-redaction utility
 *
 * Replaces known API key patterns with masked equivalents before any
 * string is shown in the UI or logged to the console.
 *
 * Used by both the plugin sandbox (main.ts) and the iframe UI (ui.ts).
 */

export function redactSecrets(raw: unknown): string {
  const text = typeof raw === "string" ? raw : String(raw);
  return text
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "AIza***")
    .replace(/sk-ant-[A-Za-z0-9\-_]+/g, "sk-ant-***")
    .replace(/sk-[A-Za-z0-9\-_]{10,}/g, "sk-***")
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_***")
    .replace(/(key=)[^&\s]+/gi, "$1***");
}
