/**
 * Resolve OS paths from a desktop file drop.
 * Electron 32+ no longer puts `File.path` on renderer File objects;
 * the host must call webUtils.getPathForFile.
 */

export function resolveDroppedFilePath(file, pathForFile) {
  if (typeof pathForFile === "function") {
    try {
      const p = pathForFile(file);
      if (typeof p === "string" && p.trim()) return p.trim();
    } catch {
      /* host helper missing or File not from a native drop */
    }
  }
  const legacy = file && typeof file.path === "string" ? file.path.trim() : "";
  return legacy || "";
}

/**
 * @param {DataTransfer | null | undefined} dataTransfer
 * @param {(file: File) => string} [pathForFile]
 * @returns {string[]}
 */
export function collectDroppedPaths(dataTransfer, pathForFile) {
  if (!dataTransfer) return [];
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };
  const files = dataTransfer.files ? Array.from(dataTransfer.files) : [];
  for (const file of files) {
    add(resolveDroppedFilePath(file, pathForFile));
  }
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  for (const item of items) {
    if (item?.kind !== "file") continue;
    const file = typeof item.getAsFile === "function" ? item.getAsFile() : null;
    if (file) add(resolveDroppedFilePath(file, pathForFile));
  }
  return out;
}
