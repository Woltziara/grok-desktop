/**
 * Title / project / command search. Chinese titles match by substring first;
 * Latin typos fall through to Fuse.js.
 */
import Fuse from "fuse.js";

export function normalizeSearchText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Short excerpt around the first hit so a result can land on the sentence.
 * @param {string} text
 * @param {string} query
 * @param {number} [radius]
 */
export function snippetAround(text, query, radius = 28) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const q = String(query || "").trim();
  if (!raw) return "";
  if (!q) return raw.length > radius * 2 ? `${raw.slice(0, radius * 2)}…` : raw;
  const lower = raw.toLowerCase();
  const needle = q.toLowerCase();
  const at = lower.indexOf(needle);
  if (at < 0) {
    return raw.length > radius * 2 ? `${raw.slice(0, radius * 2)}…` : raw;
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(raw.length, at + needle.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < raw.length ? "…" : "";
  return `${prefix}${raw.slice(start, end)}${suffix}`;
}

function haystack(item, keys) {
  return keys
    .map((key) => String(item?.[key] ?? ""))
    .filter(Boolean)
    .join(" · ");
}

/**
 * @template {Record<string, unknown>} T
 * @param {T[]} items
 * @param {string} query
 * @param {{ keys?: string[], limit?: number }} [opts]
 * @returns {Array<{ item: T, score: number, snippet: string }>}
 */
export function searchByTitle(items, query, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const keys = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : ["title"];
  const limit = opts.limit ?? 40;
  const q = String(query || "").trim();
  if (!q) {
    return list.slice(0, limit).map((item) => ({
      item,
      score: 1,
      snippet: snippetAround(haystack(item, keys), ""),
    }));
  }

  const needle = normalizeSearchText(q);
  /** @type {Array<{ item: T, score: number, snippet: string }>} */
  const exact = [];
  /** @type {T[]} */
  const rest = [];
  for (const item of list) {
    const hay = haystack(item, keys);
    const norm = normalizeSearchText(hay);
    const at = norm.indexOf(needle);
    if (at >= 0) {
      exact.push({
        item,
        score: at / Math.max(norm.length, 1),
        snippet: snippetAround(hay, q),
      });
    } else {
      rest.push(item);
    }
  }
  exact.sort((a, b) => a.score - b.score);

  let fuzzy = [];
  if (rest.length && /[a-z0-9]/i.test(q)) {
    const fuse = new Fuse(rest, {
      keys,
      threshold: 0.42,
      ignoreLocation: true,
      includeScore: true,
      includeMatches: true,
    });
    fuzzy = fuse.search(q).map((row) => ({
      item: row.item,
      score: 1 + (typeof row.score === "number" ? row.score : 0.5),
      snippet: snippetAround(haystack(row.item, keys), q),
    }));
  }

  return [...exact, ...fuzzy].slice(0, limit);
}
