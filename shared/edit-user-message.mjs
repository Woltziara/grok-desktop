/**
 * Edit a user bubble: rewind agent history to drop that prompt and everything
 * after it, then resend the new text.
 */

export function isUserPromptItem(item) {
  return item && item.kind === "user";
}

/** 0-based index among user prompts, or -1. */
export function userPromptIndexOf(items, itemId) {
  const id = String(itemId || "");
  if (!id) return -1;
  let i = 0;
  for (const item of items || []) {
    if (!isUserPromptItem(item)) continue;
    if (item.id === id) return i;
    i += 1;
  }
  return -1;
}

/**
 * ACP rewind keeps the selected prompt and drops after it.
 * To drop prompt `index`, target the previous prompt (or 0 when it is first).
 * @param {number} index
 * @returns {number | null}
 */
export function dropUserPromptExecIndex(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return null;
  return i === 0 ? 0 : i - 1;
}

/** Keep timeline items strictly before this user bubble. */
export function cutIndexBeforeUserId(items, itemId) {
  const id = String(itemId || "");
  const list = Array.isArray(items) ? items : [];
  const at = list.findIndex((item) => item && item.id === id);
  return at < 0 ? list.length : at;
}

/** Last user-prompt index at or before this item (assistant branch point). */
export function userPromptIndexAtOrBefore(items, itemId) {
  const id = String(itemId || "");
  let last = -1;
  let i = 0;
  for (const item of items || []) {
    if (isUserPromptItem(item)) {
      last = i;
      i += 1;
    }
    if (item && item.id === id) return last;
  }
  return -1;
}

export function lastUserPromptIndex(items) {
  let last = -1;
  let i = 0;
  for (const item of items || []) {
    if (!isUserPromptItem(item)) continue;
    last = i;
    i += 1;
  }
  return last;
}

/** Fork copies the whole chat; rewind the child only when later turns exist. */
export function shouldRewindFork(throughIndex, lastIndex) {
  return (
    Number.isInteger(throughIndex) &&
    throughIndex >= 0 &&
    Number.isInteger(lastIndex) &&
    throughIndex < lastIndex
  );
}
