/** Keep navigation diagnostics useful without persisting login URL parameters. */
export function sanitizeDiagnostic(value, seen = new WeakSet()) {
  if (typeof value === "string") {
    return value.replace(/\b(?:https?|wss?):\/\/[^\s<>"'`]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.href;
      } catch {
        return "[redacted URL]";
      }
    });
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => sanitizeDiagnostic(item, seen))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /^(?:authorization|proxy-authorization|cookies?|set-cookie|password|passphrase|secret|client[_-]?secret|(?:access[_-]?|refresh[_-]?|id[_-]?)?token|api[_-]?key)$/i.test(key)
        ? "[redacted]"
        : sanitizeDiagnostic(item, seen),
    ]));
  seen.delete(value);
  return result;
}
