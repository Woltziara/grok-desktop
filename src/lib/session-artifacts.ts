import { fileBasename, isFileWriteTool, toolFilePath } from "./tool-display.ts";
import type { TimelineItem } from "../vite-env";

function joinProjectPath(root: string, rel: string): string {
  const r = root.replace(/[/\\]+$/, "");
  const p = String(rel || "").replace(/\\/g, "/");
  if (!p) return r;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return rel;
  const sep = root.includes("\\") ? "\\" : "/";
  return `${r}${sep}${p.replace(/\//g, sep)}`;
}

export type ArtifactKind = "html" | "image" | "markdown" | "text" | "other";

export type SessionArtifact = {
  absPath: string;
  relPath: string;
  name: string;
  kind: ArtifactKind;
  at: number;
  toolCallId: string;
};

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
]);

export function artifactKindFromPath(filePath: string): ArtifactKind {
  const base = filePath.replace(/\\/g, "/");
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  if (ext === ".html" || ext === ".htm") return "html";
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (
    ext === ".txt" ||
    ext === ".json" ||
    ext === ".csv" ||
    ext === ".css" ||
    ext === ".js" ||
    ext === ".ts" ||
    ext === ".tsx" ||
    ext === ".jsx"
  ) {
    return "text";
  }
  return "other";
}

export function isTryableArtifact(kind: ArtifactKind): boolean {
  return kind === "html" || kind === "image" || kind === "markdown";
}

function displayRel(project: string, absPath: string): string {
  const root = project.replace(/[/\\]+$/, "").replace(/\\/g, "/");
  const abs = absPath.replace(/\\/g, "/");
  if (abs === root) return abs.split("/").pop() || abs;
  if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
  return abs.split("/").pop() || abs;
}

/**
 * Files this conversation wrote or edited, newest last.
 * One row per path (later writes replace earlier ones).
 */
export function collectSessionArtifacts(
  items: TimelineItem[],
  project: string | null | undefined,
): SessionArtifact[] {
  if (!project) return [];
  const byPath = new Map<string, SessionArtifact>();
  for (const item of items) {
    if (item.kind !== "tool") continue;
    if (item.status === "failed" || item.status === "cancelled") continue;
    if (!isFileWriteTool(item.toolKind, item.title, item.raw)) continue;
    const rawPath = toolFilePath(item);
    if (!rawPath) continue;
    const absPath = joinProjectPath(project, rawPath);
    const key = absPath.replace(/\\/g, "/").toLowerCase();
    const relPath = displayRel(project, absPath);
    byPath.set(key, {
      absPath,
      relPath,
      name: fileBasename(relPath) || relPath,
      kind: artifactKindFromPath(absPath),
      at: item.at,
      toolCallId: item.toolCallId,
    });
  }
  return [...byPath.values()].sort((a, b) => a.at - b.at);
}
