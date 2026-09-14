/**
 * After a send (or coming back to a grown timeline), land on the new turn —
 * not the old reading position, and not the live tail of a long reply.
 */

export const REVEAL_HEAD_THRESHOLD_PX = 72;
export const REVEAL_HEAD_PADDING_PX = 12;

/** ScrollTop that puts an element's top at the scroller's top, plus padding. */
export function scrollTopToAlignStart(
  scrollTop,
  elTop,
  viewTop,
  padding = REVEAL_HEAD_PADDING_PX,
) {
  const next =
    Number(scrollTop) + (Number(elTop) - Number(viewTop)) - Number(padding);
  return next > 0 ? next : 0;
}

/** Last user message in the timeline — the turn we should reveal. */
export function latestUserTurnId(items) {
  if (!Array.isArray(items)) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const row = items[i];
    if (row && row.kind === "user" && row.id) return row.id;
  }
  return null;
}

export function timelineGrewSince(snapshot, items) {
  const list = Array.isArray(items) ? items : [];
  const last = list[list.length - 1];
  const lastId = last && last.id ? String(last.id) : "";
  if (!snapshot) return false;
  return (
    lastId !== String(snapshot.lastId || "") ||
    list.length !== Number(snapshot.length || 0)
  );
}

/**
 * Coming back: only jump down if the new turn's head is still below the view.
 * If the head is already at or above the top, the person is in that reply.
 */
export function shouldRevealTurnOnReturn(
  headTop,
  viewTop,
  threshold = REVEAL_HEAD_THRESHOLD_PX,
) {
  return Number(headTop) - Number(viewTop) > Number(threshold);
}
