/**
 * Codex-style quotes: selected reply text becomes a chip beside the composer,
 * not pasted into the textarea.
 */

export const COMPOSER_QUOTE_TEXT_MAX = 8000;

export function makeComposerQuoteId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return `qte-${c.randomUUID()}`;
  }
  return `qte-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeComposerQuote(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id.trim()
      : makeComposerQuoteId();
  const sourceMessageId =
    typeof raw.sourceMessageId === "string" && raw.sourceMessageId.trim()
      ? raw.sourceMessageId.trim()
      : undefined;
  return {
    id,
    text:
      text.length > COMPOSER_QUOTE_TEXT_MAX
        ? text.slice(0, COMPOSER_QUOTE_TEXT_MAX)
        : text,
    sourceMessageId,
  };
}

export function normalizeComposerQuotes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const q = normalizeComposerQuote(item);
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

export function addComposerQuote(list, next) {
  const q = normalizeComposerQuote(next);
  if (!q) return Array.isArray(list) ? list.slice() : [];
  const cur = Array.isArray(list) ? list.slice() : [];
  if (cur.some((row) => row.text === q.text)) return cur;
  return [...cur, q];
}

/** What the agent sees. Keep quotes out of the typed composer field. */
export function serializeQuotesForAgent(quotes, body) {
  const blocks = [];
  for (const raw of Array.isArray(quotes) ? quotes : []) {
    const q = normalizeComposerQuote(raw);
    if (!q) continue;
    blocks.push(`Quoted excerpt:\n"""\n${q.text}\n"""`);
  }
  const typed = String(body || "").trim();
  if (!blocks.length) return typed;
  if (!typed) return blocks.join("\n\n");
  return `${blocks.join("\n\n")}\n\n${typed}`;
}

export function parseQuotesFromContent(content) {
  const src = String(content || "").replace(/\r\n/g, "\n");
  const quotes = [];
  let rest = src;
  const re = /^Quoted excerpt:\n"""\n([\s\S]*?)\n"""(?:\n\n|$)/;
  while (true) {
    const m = re.exec(rest);
    if (!m || m.index !== 0) break;
    const text = (m[1] || "").trim();
    if (text) quotes.push({ id: makeComposerQuoteId(), text });
    rest = rest.slice(m[0].length);
  }
  return { text: rest, quotes };
}

export function isQuotesOnlySend(body, quotes) {
  return (
    !String(body || "").trim() &&
    (Array.isArray(quotes) ? quotes : []).some((q) =>
      String(q?.text || "").trim(),
    )
  );
}
