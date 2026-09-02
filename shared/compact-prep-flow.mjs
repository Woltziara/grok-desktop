/**
 * Manual meter-click compact: Compact Prep first, then native compact.
 * Auto-compact must not use this path.
 */

export const COMPACT_PREP_PROMPT = "/compact-prep";

export const COMPACT_PRESERVE_HINT =
  "Preserve the Continuation Capsule above as the recovery contract.";

/** User-visible catch-up after native compact. Forces a read of the capsule. */
export const COMPACT_CATCH_UP_PROMPT = [
  "Catch up：先读这份继续施工胶囊（Continuation Capsule），把它当作恢复合同。",
  "按终局、已裁决决定、当前事实、未完义务和下一可执行动作继续。",
  "不要重问已经裁定的事。",
].join("");

/** Remaining % at or below which the meter is a clickable compact control. */
export const MANUAL_COMPACT_REMAINING_PCT = 25;

/**
 * After Compact Prep settles, native compact should run only on a finished capsule.
 * @param {{ ok?: boolean, cancelled?: boolean }} result
 */
export function shouldCompactAfterPrep(result = {}) {
  return Boolean(result.ok) && !result.cancelled;
}

/** Catch-up is only sent after native compact actually succeeded. */
export function shouldSendCatchUpAfterCompact(compacted) {
  return compacted === true;
}

/**
 * User already inserted a follow-up: do not send Catch up on top of it.
 * @param {{ sendNow?: unknown, queued?: unknown[] }} state
 */
export function shouldSendCatchUpAfterUserInsert(state = {}) {
  if (state.sendNow) return false;
  if (Array.isArray(state.queued) && state.queued.length > 0) return false;
  return true;
}
