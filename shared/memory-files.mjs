/**
 * Parse and edit Grok memory markdown under ~/.grok/memory/.
 * Entries are heading blocks; session logs are whole files.
 */

function splitBlocks(body) {
  const text = String(body || "").trim();
  if (!text) return [];
  const parts = text.split(/\n{2,}/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * @param {string} markdown
 * @param {{ file: string, scope: string, label?: string }} meta
 * @returns {Array<{
 *   id: string,
 *   file: string,
 *   scope: string,
 *   heading: string,
 *   text: string,
 *   wholeFile?: boolean,
 * }>}
 */
export function parseMemoryMarkdown(markdown, meta) {
  const file = String(meta?.file || "");
  const scope = String(meta?.scope || "global");
  const src = String(markdown || "").replace(/\r\n/g, "\n");
  if (!src.trim()) return [];

  const parts = src.split(/^(?=##\s)/m);
  /** @type {ReturnType<typeof parseMemoryMarkdown>} */
  const entries = [];
  let seq = 0;
  for (const part of parts) {
    const hm = part.match(/^##\s+(.+?)\s*(?:\n|$)/);
    if (!hm) {
      const intro = part.trim();
      if (!intro) continue;
      for (const block of splitBlocks(intro)) {
        entries.push({
          id: `${file}::${seq}`,
          file,
          scope,
          heading: "",
          text: block,
        });
        seq += 1;
      }
      continue;
    }
    const heading = hm[1].trim();
    const body = part.slice(hm[0].length);
    const blocks = splitBlocks(body);
    if (blocks.length === 0) {
      entries.push({
        id: `${file}::${seq}`,
        file,
        scope,
        heading,
        text: "",
      });
      seq += 1;
      continue;
    }
    for (const block of blocks) {
      entries.push({
        id: `${file}::${seq}`,
        file,
        scope,
        heading,
        text: block,
      });
      seq += 1;
    }
  }
  return entries;
}

/**
 * Rebuild markdown from parsed entries (same file).
 * @param {ReturnType<typeof parseMemoryMarkdown>} entries
 */
export function serializeMemoryMarkdown(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const chunks = [];
  let lastHeading = null;
  for (const e of list) {
    const heading = String(e.heading || "");
    if (heading && heading !== lastHeading) {
      if (chunks.length) chunks.push("");
      chunks.push(`## ${heading}`);
      lastHeading = heading;
    } else if (!heading) {
      lastHeading = "";
    }
    if (e.text) chunks.push(String(e.text).trim());
  }
  return chunks.join("\n\n").replace(/\s*$/, "") + (chunks.length ? "\n" : "");
}

/**
 * Drop one parsed entry. Returns null when the id is unknown.
 * @param {string} markdown
 * @param {string} entryId
 * @param {{ file: string, scope: string }} meta
 */
export function removeMemoryEntryFromMarkdown(markdown, entryId, meta) {
  const parsed = parseMemoryMarkdown(markdown, meta);
  const next = parsed.filter((e) => e.id !== entryId);
  if (next.length === parsed.length) return null;
  return serializeMemoryMarkdown(next);
}

/**
 * Prefer a workspace folder that looks like this project.
 * @param {string[]} slugs
 * @param {string} projectPath
 */
export function pickWorkspaceSlug(slugs, projectPath) {
  const list = Array.isArray(slugs) ? slugs : [];
  const raw = String(projectPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!raw || list.length === 0) return null;
  const base = raw.split("/").filter(Boolean).pop() || "";
  const lower = raw.toLowerCase();
  const baseLower = base.toLowerCase();
  const exact = list.find((s) => {
    const stem = String(s).replace(/-[a-f0-9]{8}$/i, "");
    return stem.toLowerCase() === baseLower;
  });
  if (exact) return exact;
  const contains = list.find((s) => {
    const stem = String(s).replace(/-[a-f0-9]{8}$/i, "").toLowerCase();
    return stem && (lower.includes(stem) || stem.includes(baseLower));
  });
  return contains || null;
}
