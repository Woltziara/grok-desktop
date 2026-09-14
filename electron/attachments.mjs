/**
 * Native attach import: dialog paths + copy PDF/Word into the session folder
 * so the agent can read them even when the file sat outside the project.
 */
import fs from "node:fs";
import path from "node:path";
import {
  MAX_ATTACH_BYTES,
  MAX_INLINE_TEXT_CHARS,
  classifyAttachKind,
  isAllowedAttachKind,
} from "../shared/pending-attach.mjs";
import { sessionsRootForCwd } from "./sessions.mjs";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
};

export const ATTACH_DIALOG_FILTERS = [
  {
    name: "附件",
    extensions: [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "pdf",
      "doc",
      "docx",
      "md",
      "markdown",
      "txt",
      "json",
      "csv",
      "html",
      "css",
      "js",
      "ts",
      "tsx",
      "jsx",
      "xml",
      "yaml",
      "yml",
      "rtf",
    ],
  },
];

function uniqueDest(dir, name) {
  const base = path.basename(name || "file");
  let dest = path.join(dir, base);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let i = 2; i < 50; i += 1) {
    dest = path.join(dir, `${stem}-${i}${ext}`);
    if (!fs.existsSync(dest)) return dest;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

export async function importAttachmentFile(sourcePath, opts = {}) {
  const src = String(sourcePath || "").trim();
  if (!src) throw new Error("没有选择文件");
  if (!fs.existsSync(src)) throw new Error("文件不存在，请重新选择");
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    return {
      kind: "folder",
      name: path.basename(src) || src,
      path: src,
      size: 0,
      mimeType: "inode/directory",
    };
  }
  if (!st.isFile()) throw new Error("这不是一个文件");
  const name = path.basename(src);
  const ext = path.extname(name).toLowerCase();
  const kind = classifyAttachKind(name, "");
  if (!isAllowedAttachKind(kind)) {
    throw new Error(`还不能附上这种文件（${name}）`);
  }
  if (st.size > MAX_ATTACH_BYTES) {
    throw new Error(`${name} 太大了（最大 24 MB）`);
  }
  const mimeType = MIME[ext] || "application/octet-stream";
  if (kind === "image") {
    const buf = fs.readFileSync(src);
    return {
      kind,
      name,
      path: src,
      size: st.size,
      mimeType,
      data: buf.toString("base64"),
    };
  }
  if (kind === "text" || kind === "markdown") {
    let text = fs.readFileSync(src, "utf8");
    if (text.length > MAX_INLINE_TEXT_CHARS) {
      text = `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n…（正文已截断）`;
    }
    return { kind, name, path: src, size: st.size, mimeType, text };
  }
  const cwd = opts.cwd;
  const sessionId = opts.sessionId;
  if (!cwd || !sessionId) {
    throw new Error("先打开一场对话，再附上这个文件");
  }
  const destDir = path.join(sessionsRootForCwd(cwd), sessionId, "attachments");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = uniqueDest(destDir, name);
  fs.copyFileSync(src, dest);
  return {
    kind,
    name: path.basename(dest),
    path: dest,
    size: st.size,
    mimeType,
    staged: true,
  };
}
