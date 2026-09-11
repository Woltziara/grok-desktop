/**
 * Search this conversation's user/assistant text and return snippets
 * that can scroll to a message id.
 */
import { snippetAround, normalizeSearchText } from "./title-search.mjs";
import { collapsedRangeToOriginal } from "./highlight-text.mjs";

export function timelineHitKey(hit) {
  if (!hit) return "";
  if (hit.key) return String(hit.key);
  const id = String(hit.id || "");
  const nth = hit.nth == null ? "" : String(hit.nth);
  const offset = hit.offset == null ? "" : String(hit.offset);
  return `${id}:${nth}:${offset}`;
}

export function searchableTimelineItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.filter(
    (item) =>
      (item?.kind === "user" || item?.kind === "assistant") &&
      String(item?.text || "").trim(),
  );
}

export function questionIndex(items) {
  return searchableTimelineItems(items)
    .filter((item) => item.kind === "user")
    .map((item, i) => ({
      id: item.id,
      n: i + 1,
      title: String(item.text || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48),
      at: item.at,
    }));
}

/**
 * @param {Array<{ id?: string, kind?: string, text?: string }>} items
 * @param {string} query
 * @param {number} [limit]
 */
export function searchTimeline(items, query, limit = 40) {
  const q = String(query || "").trim();
  if (!q) return [];
  const needle = normalizeSearchText(q);
  const hits = [];
  for (const item of searchableTimelineItems(items)) {
    const text = String(item.text || "");
    const norm = normalizeSearchText(text);
    let from = 0;
    let at = norm.indexOf(needle, from);
    if (at < 0) continue;
    let nth = 0;
    while (at >= 0) {
      nth += 1;
      const orig = collapsedRangeToOriginal(text, at, needle.length);
      hits.push({
        id: item.id,
        kind: item.kind,
        snippet: snippetAround(text, q, 36),
        at: item.at || 0,
        offset: orig.start,
        nth,
        key: `${item.id}:${nth}:${orig.start}`,
      });
      if (hits.length >= limit) return hits;
      from = at + Math.max(needle.length, 1);
      at = norm.indexOf(needle, from);
    }
  }
  return hits;
}
