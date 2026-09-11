/**
 * Composer attachments beyond screenshots: PDF / Word / Markdown / text.
 * Dropping a file is not the same as the agent being able to read it.
 */

export const MAX_ATTACH_BYTES = 24 * 1024 * 1024;
export const MAX_INLINE_TEXT_CHARS = 120_000;

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".heic",
]);
const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdown"]);
const TEXT_EXT = new Set([
  ".txt",
  ".json",
  ".csv",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".log",
  ".rtf",
]);
const PDF_EXT = new Set([".pdf"]);
const WORD_EXT = new Set([".doc", ".docx"]);

export function fileExt(name) {
  const base = String(name || "").replace(/\\/g, "/");
  const leaf = base.slice(base.lastIndexOf("/") + 1);
  const dot = leaf.lastIndexOf(".");
  return dot >= 0 ? leaf.slice(dot).toLowerCase() : "";
}

export function classifyAttachKind(name, mimeType = "") {
  const ext = fileExt(name);
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime === "application/pdf" || PDF_EXT.has(ext)) return "pdf";
  if (
    mime.includes("word") ||
    mime === "application/msword" ||
    WORD_EXT.has(ext)
  ) {
    return "word";
  }
  if (MARKDOWN_EXT.has(ext)) return "markdown";
  if (mime.startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  return "other";
}

export function isAllowedAttachKind(kind) {
  return (
    kind === "image" ||
    kind === "pdf" ||
    kind === "word" ||
    kind === "markdown" ||
    kind === "text"
  );
}

export function attachKindLabel(kind) {
  switch (kind) {
    case "image":
      return "图片";
    case "pdf":
      return "PDF";
    case "word":
      return "Word";
    case "markdown":
      return "Markdown";
    case "text":
      return "文本";
    default:
      return "文件";
  }
}

export function attachDuplicateKey(file) {
  const path = String(file?.path || "").trim();
  if (path) return `path:${path}`;
  const name = String(file?.name || "").trim().toLowerCase();
  const size = Number(file?.size) || 0;
  return `name:${name}:${size}`;
}

export function findDuplicateAttach(existing, next) {
  const key = attachDuplicateKey(next);
  const list = Array.isArray(existing) ? existing : [];
  return list.find((row) => attachDuplicateKey(row) === key) || null;
}

export function formatBytes(n) {
  const size = Number(n) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * Turn non-image attachments into prompt text. Images stay on the ACP image list.
 * @param {Array<{ name?: string, kind?: string, path?: string, text?: string, status?: string }>} files
 */
export function formatAttachedFilesPrompt(files) {
  const list = Array.isArray(files) ? files : [];
  const parts = [];
  for (const file of list) {
    if (file?.status === "error") continue;
    const name = String(file?.name || "未命名").trim() || "未命名";
    const kind = attachKindLabel(file?.kind);
    const path = String(file?.path || "").trim();
    if (
      (file?.kind === "text" || file?.kind === "markdown") &&
      String(file?.text || "").trim()
    ) {
      const body = String(file.text);
      const clipped =
        body.length > MAX_INLINE_TEXT_CHARS
          ? `${body.slice(0, MAX_INLINE_TEXT_CHARS)}\n…（正文已截断）`
          : body;
      parts.push(`--- 附件 ${name} ---\n${clipped}`);
      continue;
    }
    if (path) {
      parts.push(
        `请阅读附件「${name}」（${kind}）。路径：${path}`,
      );
    } else {
      parts.push(
        `这条消息附了「${name}」（${kind}），但没有可用的本地路径，请让我重新选择文件。`,
      );
    }
  }
  return parts.join("\n\n");
}

export function mergeComposerTextWithFiles(text, files) {
  const body = String(text || "").trim();
  const extra = formatAttachedFilesPrompt(files);
  if (!extra) return body;
  if (!body) return extra;
  return `${body}\n\n${extra}`;
}

export function attachAcceptAttr() {
  return [
    "image/*",
    ".pdf",
    ".doc",
    ".docx",
    ".md",
    ".markdown",
    ".txt",
    ".json",
    ".csv",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".xml",
    ".yaml",
    ".yml",
    ".rtf",
  ].join(",");
}
