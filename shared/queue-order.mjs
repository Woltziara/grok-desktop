/**
 * Mid-turn follow-ups: later vs send-now, plus edit / reorder / drop.
 */

export function moveQueuedItem(list, id, dir) {
  const rows = Array.isArray(list) ? list.slice() : [];
  const i = rows.findIndex((row) => row && row.id === id);
  if (i < 0) return rows;
  const j = dir < 0 ? i - 1 : i + 1;
  if (j < 0 || j >= rows.length) return rows;
  const copy = rows.slice();
  const tmp = copy[i];
  copy[i] = copy[j];
  copy[j] = tmp;
  return copy;
}

export function editQueuedItem(list, id, text) {
  const next = String(text || "");
  return (Array.isArray(list) ? list : []).map((row) =>
    row && row.id === id ? { ...row, text: next } : row,
  );
}

export function dropQueuedItem(list, id) {
  return (Array.isArray(list) ? list : []).filter((row) => row?.id !== id);
}
