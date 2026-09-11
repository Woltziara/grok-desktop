/**
 * Drop matching in-flight JSON-RPC waits so Stop can return immediately.
 * @param {Map<any, { method?: string, timer?: any, reject?: Function }>} pending
 * @param {string} method
 * @param {Error} err
 */
export function rejectPendingByMethod(pending, method, err) {
  const hit = [];
  for (const [id, p] of pending) {
    if (p?.method !== method) continue;
    hit.push([id, p]);
  }
  for (const [id, p] of hit) {
    pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    try {
      p.reject?.(err);
    } catch {
      /* ignore */
    }
  }
  return hit.length;
}
