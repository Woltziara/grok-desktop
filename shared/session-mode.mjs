export const PLAN_MODE_ID = "plan";
export const DEFAULT_SESSION_MODE_ID = "default";
export const ALREADY_IN_PLAN_NOTICE =
  "Already in plan mode. Use /view-plan to view the current plan.";

export function isPlanMode(modeId) {
  return String(modeId || "").trim() === PLAN_MODE_ID;
}

export function setSessionModeParams(sessionId, modeId) {
  return {
    sessionId: String(sessionId || ""),
    modeId: String(modeId || "").trim(),
  };
}

export function rememberSessionMode(session) {
  const modes = session?.modes;
  const current =
    modes?.currentModeId ||
    modes?.current_mode_id ||
    session?.currentModeId ||
    session?.current_mode_id ||
    null;
  return current == null || current === "" ? null : String(current);
}

export function currentModeIdFromUpdate(params) {
  const update = params?.update ?? params;
  const kind = String(update?.sessionUpdate || update?.session_update || "");
  if (kind !== "current_mode_update") return undefined;
  const modeId =
    update?.currentModeId || update?.modeId || update?.current_mode_id || null;
  return modeId ? String(modeId) : null;
}

export function planSlashAction(args, opts = {}) {
  if (opts.alreadyInPlan) return { type: "already-in-plan" };
  const text = String(args || "").trim();
  return text
    ? { type: "set-mode-then-prompt", modeId: PLAN_MODE_ID, text }
    : { type: "set-mode", modeId: PLAN_MODE_ID };
}

export function planSlashDisplay(args) {
  const text = String(args || "").trim();
  return text ? `/plan ${text}` : "/plan";
}

export function looksLikePlanQuestion(text) {
  const hits = String(text || "").match(/^\s*\d+[.)]\s+\S[^\n]{0,200}\?/gm);
  return Boolean(hits && hits.length >= 2);
}
