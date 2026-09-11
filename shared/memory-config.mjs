/**
 * Surgical [memory] enabled toggle for ~/.grok/config.toml.
 * Does not rewrite unrelated keys or comments.
 */

function memorySectionRange(text) {
  const src = String(text || "");
  const start = src.search(/^\s*\[memory\]\s*$/m);
  if (start < 0) return null;
  const after = src.slice(start + 1);
  const rel = after.search(/^\s*\[[^\]]+\]\s*$/m);
  const end = rel < 0 ? src.length : start + 1 + rel;
  return { start, end, body: src.slice(start, end) };
}

/**
 * @param {string} toml
 * @returns {boolean}
 */
export function memoryEnabledFromToml(toml) {
  const section = memorySectionRange(toml);
  if (!section) return false;
  const m = section.body.match(/^\s*enabled\s*=\s*(true|false)\b/im);
  return Boolean(m && m[1].toLowerCase() === "true");
}

/**
 * @param {string} toml
 * @param {boolean} enabled
 * @returns {string}
 */
export function setMemoryEnabledInToml(toml, enabled) {
  const value = enabled ? "true" : "false";
  const src = String(toml || "");
  const section = memorySectionRange(src);
  if (!section) {
    const trimmed = src.replace(/\s*$/, "");
    const block = `[memory]\nenabled = ${value}\n`;
    return trimmed ? `${trimmed}\n\n${block}` : block;
  }
  const body = section.body;
  if (/^\s*enabled\s*=/im.test(body)) {
    const nextBody = body.replace(
      /^(\s*enabled\s*=\s*)(true|false)\b/im,
      `$1${value}`,
    );
    return src.slice(0, section.start) + nextBody + src.slice(section.end);
  }
  const header = body.match(/^\s*\[memory\]\s*\n?/);
  const insertAt = header ? header[0].length : 0;
  const nextBody =
    body.slice(0, insertAt) + `enabled = ${value}\n` + body.slice(insertAt);
  return src.slice(0, section.start) + nextBody + src.slice(section.end);
}
