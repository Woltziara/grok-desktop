/**
 * Split text so a search hit can be wrapped in <mark>.
 * Returns every occurrence, not only the first.
 *
 * Search uses collapsed whitespace (same as title search). Highlight slices
 * must be mapped back onto the original string so "alpha   beta Wiki" still
 * marks "Wiki", not a shifted range.
 */
import { normalizeSearchText } from "./title-search.mjs";

/**
 * Map an index in normalizeSearchText(src) back to an original-string index.
 * @param {string} src
 * @param {number} collapsedIndex
 */
export function mapCollapsedToOriginal(src, collapsedIndex) {
  const s = String(src || "");
  const target = Math.max(0, Number(collapsedIndex) || 0);
  let i = 0;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  let collapsed = 0;
  while (i < s.length && collapsed < target) {
    if (/\s/.test(s[i])) {
      while (i < s.length && /\s/.test(s[i])) i += 1;
      collapsed += 1;
    } else {
      i += 1;
      collapsed += 1;
    }
  }
  return i;
}

export function collapsedRangeToOriginal(src, start, length) {
  const from = mapCollapsedToOriginal(src, start);
  const to = mapCollapsedToOriginal(src, start + Math.max(0, Number(length) || 0));
  return { start: from, end: Math.max(from, to) };
}

export function splitHighlight(text, query) {
  const src = String(text || "");
  const q = String(query || "").trim();
  if (!src || !q) return [{ text: src, hit: false }];
  const lower = normalizeSearchText(src);
  const needle = normalizeSearchText(q);
  if (!needle) return [{ text: src, hit: false }];
  const parts = [];
  let origFrom = 0;
  let collapsedFrom = 0;
  let at = lower.indexOf(needle, collapsedFrom);
  if (at < 0) return [{ text: src, hit: false }];
  while (at >= 0) {
    const range = collapsedRangeToOriginal(src, at, needle.length);
    if (range.start > origFrom) {
      parts.push({ text: src.slice(origFrom, range.start), hit: false });
    }
    if (range.end > range.start) {
      parts.push({ text: src.slice(range.start, range.end), hit: true });
    }
    origFrom = range.end;
    collapsedFrom = at + Math.max(needle.length, 1);
    at = lower.indexOf(needle, collapsedFrom);
  }
  if (origFrom < src.length) parts.push({ text: src.slice(origFrom), hit: false });
  return parts;
}
