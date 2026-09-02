import type { TimelineItem } from "../vite-env";
import { describeToolActivity } from "./tool-display.ts";

export type ActivityItem = Extract<TimelineItem, { kind: "tool" | "thought" }>;

export type TimelineCluster =
  | { type: "solo"; item: TimelineItem }
  | { type: "activity"; items: ActivityItem[] };

function isActivity(item: TimelineItem): item is ActivityItem {
  return item.kind === "tool" || item.kind === "thought";
}

/** Consecutive tool/thought rows become one burst between prose messages. */
export function clusterTimeline(items: TimelineItem[]): TimelineCluster[] {
  const out: TimelineCluster[] = [];
  let buf: ActivityItem[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    if (buf.length === 1) out.push({ type: "solo", item: buf[0] });
    else out.push({ type: "activity", items: buf });
    buf = [];
  };
  for (const item of items) {
    if (isActivity(item)) buf.push(item);
    else {
      flush();
      out.push({ type: "solo", item });
    }
  }
  flush();
  return out;
}

function thoughtSeconds(
  items: ActivityItem[],
  index: number,
  now: number,
  lastRunning: boolean,
): number {
  const item = items[index];
  if (item.kind !== "thought" || typeof item.at !== "number") return 0;
  const next = items[index + 1];
  if (next && typeof next.at === "number" && next.at > item.at) {
    return Math.max(0, Math.round((next.at - item.at) / 1000));
  }
  if (lastRunning && index === items.length - 1) {
    return Math.max(1, Math.round((now - item.at) / 1000));
  }
  return 0;
}

function listJoin(names: string[], max = 3): string {
  if (names.length <= max) return names.join("、");
  return `${names.slice(0, max).join("、")} 等 ${names.length} 个`;
}

/**
 * Collapse a burst into one muted line so the page stays an essay, not a log.
 */
export function formatActivityDigest(
  items: ActivityItem[],
  opts?: { now?: number; lastRunning?: boolean },
): string {
  const now = opts?.now ?? Date.now();
  const lastRunning = Boolean(opts?.lastRunning);
  const readFiles: string[] = [];
  const editByFile = new Map<string, { added: number; deleted: number }>();
  const execs: string[] = [];
  let fails = 0;
  let think = 0;
  let runningLabel: string | null = null;

  items.forEach((item, i) => {
    if (item.kind === "thought") {
      think += thoughtSeconds(items, i, now, lastRunning);
      if (lastRunning && i === items.length - 1) runningLabel = "正在思考";
      return;
    }
    const bits = describeToolActivity({
      title: item.title,
      kind: item.toolKind,
      raw: item.raw,
      content: item.content,
      status: item.status,
    });
    if (bits.failed) fails += 1;
    if (bits.running) {
      if (bits.kind === "edit" || bits.kind === "write") {
        runningLabel = bits.file ? `正在修改 ${bits.file}` : "正在修改文件";
      } else if (bits.kind === "read") {
        runningLabel = bits.file ? `正在读取 ${bits.file}` : "正在读取";
      } else if (bits.kind === "execute") {
        runningLabel = bits.command ? `正在运行 ${bits.command}` : "正在运行";
      } else {
        runningLabel = "进行中";
      }
    }
    if (bits.kind === "read" || bits.kind === "search" || bits.kind === "fetch") {
      if (bits.file && !readFiles.includes(bits.file)) readFiles.push(bits.file);
      else if (!bits.file && bits.kind === "search") readFiles.push("搜索");
      return;
    }
    if (bits.kind === "edit" || bits.kind === "write") {
      const key = bits.file || "文件";
      const prev = editByFile.get(key) || { added: 0, deleted: 0 };
      prev.added += bits.added;
      prev.deleted += bits.deleted;
      editByFile.set(key, prev);
      return;
    }
    if (bits.kind === "execute" && !bits.trivial && bits.command) {
      if (!execs.includes(bits.command)) execs.push(bits.command);
    }
  });

  const parts: string[] = [];
  if (readFiles.length === 1) parts.push(`读了 ${readFiles[0]}`);
  else if (readFiles.length > 1) parts.push(`读了 ${readFiles.length} 个文件`);

  if (editByFile.size > 0) {
    const names = [...editByFile.keys()];
    parts.push(`改了 ${listJoin(names)}`);
  }

  if (execs.length === 1) parts.push(`运行了 ${execs[0]}`);
  else if (execs.length > 1) parts.push(`运行了 ${execs.length} 条命令`);

  if (think >= 8) parts.push(`思考 ${think} 秒`);
  if (fails > 0) parts.push(fails === 1 ? "有 1 项失败" : `有 ${fails} 项失败`);
  if (runningLabel) parts.push(`${runningLabel}…`);

  if (parts.length === 0) {
    const n = items.filter((i) => i.kind === "tool").length;
    if (n > 0) return n === 1 ? "做了 1 步" : `做了 ${n} 步`;
    return "处理中";
  }
  return parts.join("，");
}

export function shouldCollapseActivity(items: ActivityItem[]): boolean {
  return items.length >= 2;
}
