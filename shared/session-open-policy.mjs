/**
 * Same-row sidebar click is a no-op only while that conversation is actually
 * on screen and connected. An empty timeline or error state must be retryable.
 *
 * @param {{
 *   currentSessionId?: string | null,
 *   requestedSessionId?: string | null,
 *   sameProject?: boolean,
 *   conn?: string,
 *   hasVisibleTimeline?: boolean,
 * }} [opts]
 */
export function isRedundantSessionResume({
  currentSessionId,
  requestedSessionId,
  sameProject = true,
  conn,
  hasVisibleTimeline,
} = {}) {
  if (!sameProject) return false;
  const current = String(currentSessionId || "");
  const requested = String(requestedSessionId || "");
  if (!current || !requested || current !== requested) return false;
  if (conn === "connecting") return true;
  if (conn === "error") return false;
  if (!hasVisibleTimeline) return false;
  return true;
}
