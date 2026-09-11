/**
 * Do not clamp a saved chat position onto an empty timeline.
 * Wait until the restored session has actually rendered enough height.
 */

export function canApplyReadingRestore(savedTop, scrollHeight, clientHeight) {
  const saved = Number(savedTop);
  if (!Number.isFinite(saved) || saved < 8) return false;
  const height = Number(scrollHeight) || 0;
  const view = Number(clientHeight) || 0;
  return height > view + 8 && height >= saved;
}

export function shouldKeepPendingRestore(savedTop, currentTop) {
  const saved = Number(savedTop);
  const cur = Number(currentTop) || 0;
  if (!Number.isFinite(saved) || saved < 8) return false;
  return cur < 8 && saved > 8;
}

export function shouldSaveReadingPosition(opts = {}) {
  if (opts.opening) return false;
  if (opts.ignoreScroll) return false;
  if (opts.pendingRestore && (opts.scrollTop || 0) < 8) return false;
  return true;
}
