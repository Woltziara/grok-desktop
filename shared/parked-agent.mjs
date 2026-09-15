/** Put a parked agent back on the window after a failed switch. */

export function restoreParkedAgent(ws, sessionId) {
  if (!ws || ws.agent || !sessionId) return null;
  const map = ws.parkedAgents;
  if (!map || typeof map.get !== "function") return null;
  const id = String(sessionId);
  const restored = map.get(id);
  if (!restored) return null;
  map.delete(id);
  ws.agent = restored;
  return restored;
}

/**
 * After B has already become the live agent, park B and restore A.
 * Used when start succeeded but a later open step failed.
 */
export function rollbackLiveAgent(ws, previousLiveId) {
  if (!ws || !previousLiveId) return null;
  const current = ws.agent;
  if (current?.sessionId && String(current.sessionId) === String(previousLiveId)) {
    return current;
  }
  if (current?.sessionId && current.proc) {
    if (!ws.parkedAgents) ws.parkedAgents = new Map();
    ws.parkedAgents.set(String(current.sessionId), current);
    ws.agent = null;
  } else if (ws.agent) {
    ws.agent = null;
  }
  return restoreParkedAgent(ws, previousLiveId);
}
