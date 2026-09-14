import {
  MAX_ATTACH_BYTES,
  MAX_INLINE_TEXT_CHARS,
  attachDuplicateKey,
  attachKindLabel,
  classifyAttachKind,
  findDuplicateAttach,
  formatBytes,
  isAllowedAttachKind,
} from "../../shared/pending-attach.mjs";
import { uid } from "./timeline";

export type PendingFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "pdf" | "word" | "markdown" | "text" | "folder" | "other";
  status: "ready" | "loading" | "error";
  error?: string;
  path?: string;
  text?: string;
  previewUrl?: string;
  source?: Blob;
};

type PathFile = File & { path?: string };

function filePath(file: File): string | undefined {
  const p = (file as PathFile).path;
  return typeof p === "string" && p.trim() ? p : undefined;
}

export async function fileToPendingFile(file: File): Promise<PendingFile> {
  const name = file.name || "未命名";
  const kind = classifyAttachKind(name, file.type);
  const path = filePath(file);
  const base: PendingFile = {
    id: uid("file"),
    name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind,
    status: "loading",
    path,
    source: file,
  };
  if (!isAllowedAttachKind(kind)) {
    const looksLikeFolder = !file.type && file.size === 0 && !path;
    return {
      ...base,
      status: "error",
      error: looksLikeFolder
        ? `没能读到「${name}」的路径。请点输入框旁的「文件夹」再选一次`
        : `还不能附上这种文件（${name}）`,
    };
  }
  if (file.size > MAX_ATTACH_BYTES) {
    return { ...base, status: "error", error: `${name} 太大了（最大 24 MB）` };
  }
  if (kind === "image") {
    return {
      ...base,
      status: "ready",
      previewUrl: URL.createObjectURL(file),
    };
  }
  if (kind === "text" || kind === "markdown") {
    try {
      const text = await file.text();
      return {
        ...base,
        status: "ready",
        text:
          text.length > MAX_INLINE_TEXT_CHARS
            ? `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n…（正文已截断）`
            : text,
      };
    } catch (e) {
      return {
        ...base,
        status: "error",
        error: e instanceof Error ? e.message : "读不了这个文件",
      };
    }
  }
  if (!path) {
    return {
      ...base,
      status: "error",
      error: `「${name}」需要从文件夹拖进来，才能带上路径给 AI 读`,
    };
  }
  return { ...base, status: "ready" };
}

export function importedToPendingFile(row: {
  kind: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
  text?: string;
  data?: string;
  staged?: boolean;
}): PendingFile {
  const kind = (row.kind as PendingFile["kind"]) || "other";
  if (kind === "image" && row.data) {
    const previewUrl = `data:${row.mimeType};base64,${row.data}`;
    return {
      id: uid("file"),
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      kind,
      status: "ready",
      path: row.path,
      previewUrl,
    };
  }
  return {
    id: uid("file"),
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    kind,
    status: "ready",
    path: row.path,
    text: row.text,
  };
}

export async function filesToPendingFiles(
  files: ArrayLike<File>,
  existing: PendingFile[] = [],
): Promise<{ files: PendingFile[]; error: string | null; duplicates: string[] }> {
  const out: PendingFile[] = [];
  const duplicates: string[] = [];
  let error: string | null = null;
  const known = [...existing];
  for (const file of Array.from(files)) {
    const dup = findDuplicateAttach(known, {
      path: filePath(file),
      name: file.name,
      size: file.size,
    });
    if (dup) {
      duplicates.push(file.name || dup.name);
      continue;
    }
    const next = await fileToPendingFile(file);
    if (next.status === "error" && !error) error = next.error || "附件失败";
    out.push(next);
    known.push(next);
  }
  return { files: out, error, duplicates };
}

export function revokePendingFile(file: PendingFile) {
  if (file.previewUrl?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(file.previewUrl);
    } catch {
      /* ignore */
    }
  }
}

export {
  attachDuplicateKey,
  attachKindLabel,
  classifyAttachKind,
  formatBytes,
  isAllowedAttachKind,
};
