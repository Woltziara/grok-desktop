/**
 * Conversation → Markdown for “导出这场对话”.
 */

function itemText(item) {
  return String(item?.text || "")
    .replace(/\[object Object\]/g, "")
    .trim();
}

/**
 * @param {any[]} items
 * @param {{ title?: string, project?: string }} [meta]
 */
export function timelineToMarkdown(items, meta = {}) {
  const title = String(meta.title || "对话").trim() || "对话";
  const project = String(meta.project || "").trim();
  const lines = [`# ${title}`, ""];
  if (project) {
    lines.push(`项目：${project}`, "");
  }
  const list = Array.isArray(items) ? items : [];
  let wrote = false;
  for (const item of list) {
    const kind = item?.kind;
    const text = itemText(item);
    if (!text) continue;
    if (kind === "user") {
      lines.push("**你**", "", text, "");
      wrote = true;
      continue;
    }
    if (kind === "assistant") {
      lines.push("**Grok**", "", text, "");
      wrote = true;
      continue;
    }
    if (kind === "recap") {
      lines.push("**回顾**", "", text, "");
      wrote = true;
    }
  }
  if (!wrote) {
    lines.push("（这场对话还没有可导出的正文。）", "");
  }
  return lines.join("\n").replace(/\s*$/, "\n");
}

/**
 * @param {string} title
 */
export function exportFilename(title) {
  const stem = String(title || "对话")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${stem || "对话"}.md`;
}
