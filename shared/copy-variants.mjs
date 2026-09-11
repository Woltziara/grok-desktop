/**
 * Copy a reply as plain body, markdown, or tables — never chrome labels.
 */

export function markdownToPlain(markdown) {
  const raw = String(markdown || "");
  return raw
    .replace(/```[\s\S]*?```/g, (block) => {
      const inner = block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
      return inner.trim();
    })
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractMarkdownTables(markdown) {
  const lines = String(markdown || "").split(/\n/);
  const tables = [];
  let buf = [];
  const flush = () => {
    if (buf.length >= 2 && /\|/.test(buf[0]) && /^\s*\|?\s*[-: ]+\|/.test(buf[1])) {
      tables.push(buf.join("\n"));
    }
    buf = [];
  };
  for (const line of lines) {
    if (/\|/.test(line)) buf.push(line);
    else flush();
  }
  flush();
  return tables;
}

export function markdownTableToTsv(table) {
  const rows = String(table || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\|?\s*[-:| ]+\|?$/.test(line))
    .map((line) => {
      let s = line;
      if (s.startsWith("|")) s = s.slice(1);
      if (s.endsWith("|")) s = s.slice(0, -1);
      return s
        .split("|")
        .map((cell) => cell.trim())
        .join("\t");
    });
  return rows.join("\n");
}

export function copyPayloads(markdown) {
  const md = String(markdown || "");
  const tables = extractMarkdownTables(md);
  return {
    plain: markdownToPlain(md),
    markdown: md.trim(),
    tables: tables.map((table) => ({
      markdown: table,
      tsv: markdownTableToTsv(table),
    })),
  };
}
