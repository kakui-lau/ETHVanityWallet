import * as Sentry from "@sentry/react";

const REDACTED = "[Filtered]";
const SENSITIVE_KEY_PATTERN =
  /password|passphrase|private[_-]?key|secret|mnemonic|seed|keystore|sessionPassword/i;
const ETH_PRIVATE_KEY_PATTERN = /\b0x[a-fA-F0-9]{64}\b/g;
const LONG_HEX_PATTERN = /\b[a-fA-F0-9]{64,}\b/g;

function isEnabled() {
  const configured = Boolean(import.meta.env.VITE_SENTRY_DSN);
  const explicitlyDisabled = import.meta.env.VITE_SENTRY_ENABLED === "false";
  return configured && !explicitlyDisabled;
}

function scrubText(value: string) {
  return value
    .replace(ETH_PRIVATE_KEY_PATTERN, REDACTED)
    .replace(LONG_HEX_PATTERN, REDACTED);
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return REDACTED;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : scrubValue(item, depth + 1);
  }
  return result;
}

export function initSentry() {
  if (!isEnabled()) return;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? "eth-vanity-wallet@0.1.0",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      return scrubValue(event) as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubValue(breadcrumb) as typeof breadcrumb;
    },
  });

  Sentry.setTag("app", "eth-vanity-wallet");
  Sentry.setTag("runtime", "tauri-webview");
  Sentry.setTag("platform", navigator.platform || "unknown");
  Sentry.setTag("locale", navigator.language || "unknown");
}

export { Sentry };
