/**
 * Grok login identity helpers. Never put tokens on the returned object.
 */

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function pickAuthEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  for (const v of Object.values(/** @type {Record<string, unknown>} */ (raw))) {
    if (v && typeof v === "object") {
      const o = /** @type {Record<string, unknown>} */ (v);
      if (
        o.key ||
        o.refresh_token ||
        o.access_token ||
        o.email ||
        o.auth_mode ||
        o.authMode
      ) {
        return o;
      }
    }
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {{
 *   email: string | null,
 *   displayName: string | null,
 *   userId: string | null,
 *   expiresAt: string | null,
 *   expired: boolean,
 * } | null}
 */
export function summarizeAuthRaw(raw) {
  const entry = pickAuthEntry(raw);
  if (!entry) return null;
  const email = typeof entry.email === "string" ? entry.email : null;
  const first = typeof entry.first_name === "string" ? entry.first_name : "";
  const last = typeof entry.last_name === "string" ? entry.last_name : "";
  const displayName =
    [first, last].filter(Boolean).join(" ").trim() || email || null;
  const userId =
    typeof entry.user_id === "string"
      ? entry.user_id
      : typeof entry.principal_id === "string"
        ? entry.principal_id
        : null;
  const expiresAt = entry.expires_at || entry.expiresAt || null;
  const expiresStr = expiresAt == null ? null : String(expiresAt);
  let expired = false;
  if (expiresStr) {
    const t = Date.parse(expiresStr);
    if (!Number.isNaN(t)) expired = t < Date.now();
  }
  return {
    email,
    displayName,
    userId,
    expiresAt: expiresStr,
    expired,
  };
}

/**
 * @param {{ userId?: string | null, email?: string | null } | null | undefined} summary
 */
export function snapshotIdFromSummary(summary) {
  const base = (summary && (summary.userId || summary.email)) || "account";
  return String(base).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "account";
}

/**
 * Public row for the renderer. Tokens must never appear here.
 * @param {ReturnType<typeof summarizeAuthRaw>} summary
 * @param {Record<string, unknown>} [extra]
 */
export function publicAccountRow(summary, extra = {}) {
  if (!summary) return null;
  return {
    id: snapshotIdFromSummary(summary),
    email: summary.email,
    displayName: summary.displayName,
    expired: Boolean(summary.expired),
    ...extra,
  };
}
