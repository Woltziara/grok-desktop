/**
 * Open-generation gate: while a session is hydrating from disk, live ACP
 * updates are buffered instead of painted. Commit replays them onto the
 * history snapshot so a late setItems(history) cannot wipe a live tail.
 *
 * Overlap with the snapshot is decided by `_desktopSeq` vs `afterSeq`,
 * never by comparing message text (that swallows "100"+"0" and "哈"+"哈").
 */
import { applySessionUpdate } from "./session-timeline.mjs";

export function createOpenGate() {
  return {
    opening: false,
    gen: 0,
    buffer: [],
    sessionId: null,
    afterSeq: null,
  };
}

export function eventSessionId(params) {
  if (!params || typeof params !== "object") return "";
  return String(
    params.sessionId ||
      params.session_id ||
      params._meta?.sessionId ||
      params.update?.sessionId ||
      "",
  );
}

export function eventDesktopSeq(params) {
  if (!params || typeof params !== "object") return null;
  const n = Number(params._desktopSeq);
  return Number.isFinite(n) ? n : null;
}

/**
 * Keep events that belong to this session and, when a snapshot boundary
 * exists, only those with a seq strictly after it. Duplicate seqs drop.
 * Unsequenced events still apply: losing a live tail is worse than a
 * possible overlap when the agent did not stamp seq.
 */
export function filterLiveEvents(events, { sessionId, afterSeq } = {}) {
  const want = sessionId ? String(sessionId) : "";
  const floor =
    afterSeq == null || afterSeq === "" || !Number.isFinite(Number(afterSeq))
      ? null
      : Number(afterSeq);
  const seen = new Set();
  const out = [];
  for (const ev of Array.isArray(events) ? events : []) {
    const id = eventSessionId(ev);
    if (want && id && id !== want) continue;
    const seq = eventDesktopSeq(ev);
    if (floor != null && seq != null && seq <= floor) continue;
    if (seq != null) {
      if (seen.has(seq)) continue;
      seen.add(seq);
    }
    out.push(ev);
  }
  return out;
}

export function beginOpen(gate, sessionId) {
  gate.opening = true;
  gate.gen += 1;
  gate.buffer = [];
  gate.sessionId = sessionId ? String(sessionId) : null;
  gate.afterSeq = null;
  return gate.gen;
}

export function bindOpenSession(gate, sessionId, afterSeq) {
  const sid = sessionId ? String(sessionId) : "";
  if (sid) gate.sessionId = sid;
  if (afterSeq != null && afterSeq !== "" && Number.isFinite(Number(afterSeq))) {
    gate.afterSeq = Number(afterSeq);
  }
  gate.buffer = filterLiveEvents(gate.buffer, {
    sessionId: gate.sessionId,
    afterSeq: gate.afterSeq,
  });
}

/**
 * @returns {"apply" | "buffer" | "stale"}
 */
export function enqueueLiveUpdate(gate, params) {
  if (!gate || !gate.opening) return "apply";
  const id = eventSessionId(params);
  if (gate.sessionId && id && id !== String(gate.sessionId)) return "stale";
  const seq = eventDesktopSeq(params);
  if (
    gate.afterSeq != null &&
    seq != null &&
    seq <= Number(gate.afterSeq)
  ) {
    return "stale";
  }
  gate.buffer.push(params);
  return "buffer";
}

export function abortOpen(gate, gen) {
  if (!gate) return;
  if (gen != null && gen !== gate.gen) return;
  gate.opening = false;
  gate.buffer = [];
}

export function applyBufferedUpdates(items, events, gateOrOpts) {
  const sessionId = gateOrOpts?.sessionId;
  const afterSeq = gateOrOpts?.afterSeq;
  let next = Array.isArray(items) ? items : [];
  for (const ev of filterLiveEvents(events, { sessionId, afterSeq })) {
    next = applySessionUpdate(next, ev);
  }
  return next;
}

/**
 * Replay live session/update events onto [banner, ...history].
 */
export function replayLiveOntoHistory(
  banner,
  history,
  liveEvents,
  sessionId,
  afterSeq,
) {
  return applyBufferedUpdates(
    [banner, ...(Array.isArray(history) ? history : [])],
    liveEvents,
    { sessionId, afterSeq },
  );
}

/**
 * Drain currently buffered live events onto history. Leaves `opening` true
 * so events that arrive before the React replace flushes still buffer.
 * Returns null when `gen` does not match (stale open).
 */
export function drainOpenTimeline(gate, { banner, history, gen } = {}) {
  if (!gate) return null;
  if (gen != null && gen !== gate.gen) return null;
  const events = gate.buffer.slice();
  gate.buffer = [];
  const items = replayLiveOntoHistory(
    banner,
    history,
    events,
    gate.sessionId,
    gate.afterSeq,
  );
  return { items, events, sessionId: gate.sessionId, gen: gate.gen };
}

/**
 * Drain leftover events and mark the open complete.
 */
export function finishOpen(gate, gen) {
  if (!gate) return [];
  if (gen != null && gen !== gate.gen) return [];
  const events = gate.buffer.slice();
  gate.opening = false;
  gate.buffer = [];
  return events;
}

/**
 * Drain the gate and return the committed timeline. Sets opening=false.
 * Returns null when `gen` does not match (stale open).
 */
export function commitOpenTimeline(gate, { banner, history, gen } = {}) {
  const drained = drainOpenTimeline(gate, { banner, history, gen });
  if (!drained) return null;
  gate.opening = false;
  return drained;
}
