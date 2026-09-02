/**
 * Turn ACP tool rawInput / content into human-readable strings for the chat UI.
 * Avoid dumping pure JSON when we can show command + plain output.
 */

import {
  countDiffEdits,
  extractStructuredDiff,
  extractStructuredDiffFromRaw,
  fileFromDiffPayload,
  formatUnifiedHunks,
  pickDiffStrings,
  shouldRenderDiff,
  type StructuredDiff,
} from "./line-diff.ts";

export type { StructuredDiff, StructuredDiffFile } from "./line-diff.ts";
export { extractStructuredDiff, extractStructuredDiffFromRaw } from "./line-diff.ts";

export type ToolDisplay = {
  /** One-line subtitle under the title (e.g. description) */
  subtitle?: string;
  /** Primary input block (command, path, pattern…) */
  input?: string;
  /** Tool result / stdout */
  output?: string;
  /** Structured ACP write/search_replace diff (rendered by DiffView) */
  diff?: StructuredDiff;
};

/**
 * Structured card for Approvals / tool rows — readable action + body.
 */
export type ToolCard = {
  /** Short verb: Execute, Read, Search… */
  action: string;
  /** Why / human description (not the full shell line) */
  summary?: string;
  /** Command, path, or pattern block */
  detail?: string;
  /** Full original title for tooltip */
  fullTitle?: string;
  /** Prefix detail with $ when it's a shell command */
  isCommand?: boolean;
};

const INPUT_BODY_CAP = 2000;
const OUTPUT_CAP = 24_000; // ~24 KiB — keep React timeline light

const PATH_KEYS = ["path", "target_file", "file_path"] as const;
const BODY_KEYS = ["contents", "content"] as const;

/**
 * Strip ANSI / VT escape sequences so tool stdout is readable in plain <pre>.
 * Without this, ESC bytes render as □ boxes (e.g. pytest green "passed" → □[32m).
 *
 * Covers CSI (colors/styles), OSC (titles), and common single-char ESC forms.
 */
export function stripAnsi(input: string): string {
  if (!input) return input;
  return (
    input
      // CSI: ESC [ ... final byte  (colors, cursor, erase, …)
      .replace(/\u001B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, "")
      // OSC: ESC ] … BEL | ST
      .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
      // Charset selects: ESC ( B, ESC ) 0, …
      .replace(/\u001B[()][0-2AB]/g, "")
      // Any leftover ESC (broken/partial sequences)
      .replace(/\u001B/g, "")
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (${s.length} chars)`;
}

/** First string field among `keys` on a plain object. */
function pickString(
  raw: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function formatDiffBlock(
  opts: {
    path?: string;
    oldText?: string | null;
    newText?: string | null;
    patch?: string;
  },
  cap = INPUT_BODY_CAP,
): string {
  const file = fileFromDiffPayload(opts);
  if (file.hunks.length === 0 && opts.patch) {
    return [opts.path, truncate(opts.patch, cap)].filter(Boolean).join("\n");
  }
  return truncate(
    formatUnifiedHunks(file.hunks, {
      path: file.path,
      truncated: file.truncated,
    }),
    cap,
  );
}

function slimJson(raw: Record<string, unknown>): string | undefined {
  try {
    const keys = Object.keys(raw).filter(
      (k) => !["variant", "is_background", "_meta"].includes(k),
    );
    if (keys.length === 0) return undefined;
    const slim: Record<string, unknown> = {};
    for (const k of keys.slice(0, 12)) slim[k] = raw[k];
    const s = JSON.stringify(slim, null, 2);
    if (s === "{}" || s === "[]" || s === "null") return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/** Pull text out of ACP content blocks / nested content. */
export function extractTextFromContent(
  content: unknown,
  opts?: { skipDiff?: boolean },
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => extractTextFromContent(block, opts))
      .filter(Boolean)
      .join("\n\n");
  }

  if (!isPlainObject(content)) return "";

  // Skip image / media payloads
  if (
    content.type === "image" ||
    (typeof content.mimeType === "string" &&
      String(content.mimeType).startsWith("image/"))
  ) {
    return "(image)";
  }

  // { type: "content", content: { type: "text", text: "..." } }
  if (content.type === "content" && content.content != null) {
    return extractTextFromContent(content.content, opts);
  }
  // { type: "text", text: "..." }
  if (typeof content.text === "string") return content.text;

  // ACP diff: { type: "diff", path, oldText, newText } (also legacy diff/patch)
  if (content.type === "diff") {
    if (opts?.skipDiff) return "";
    const picked = pickDiffStrings(content);
    return formatDiffBlock(picked, OUTPUT_CAP);
  }

  // { type: "terminal", terminalId } — live output not wired yet
  if (content.type === "terminal" && content.terminalId) {
    return `(terminal ${content.terminalId})`;
  }

  for (const key of ["content", "output", "stdout", "result", "message"]) {
    if (content[key] != null) {
      const inner = extractTextFromContent(content[key], opts);
      if (inner) return inner;
    }
  }

  // Prefer empty over dumping input-shaped objects (shown via formatToolInput)
  if (
    "variant" in content ||
    "command" in content ||
    "path" in content ||
    "pattern" in content
  ) {
    return "";
  }

  return slimJson(content) || "";
}

function appendBodyLines(
  lines: string[],
  raw: Record<string, unknown>,
  skipBody = false,
): void {
  if (skipBody) return;
  const body = pickString(raw, BODY_KEYS);
  if (body != null) {
    lines.push(truncate(body, INPUT_BODY_CAP));
  }
  if (typeof raw.old_string === "string" || typeof raw.new_string === "string") {
    if (raw.old_string) lines.push(`- ${String(raw.old_string).slice(0, 400)}`);
    if (raw.new_string) lines.push(`+ ${String(raw.new_string).slice(0, 400)}`);
  }
  if (raw.oldText != null || raw.newText != null) {
    const block = formatDiffBlock({
      oldText: raw.oldText != null ? String(raw.oldText) : null,
      newText: raw.newText != null ? String(raw.newText) : null,
    });
    if (block) lines.push(block);
  }
}

/** Format tool rawInput into a short human label + detail. Always owns fallbacks. */
export function formatToolInput(
  raw: unknown,
  opts?: { skipBody?: boolean },
): {
  subtitle?: string;
  input?: string;
} {
  if (raw == null) return {};
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? { input: t } : {};
  }
  if (!isPlainObject(raw)) {
    try {
      return { input: JSON.stringify(raw, null, 2) };
    } catch {
      return {};
    }
  }

  const subtitle =
    pickString(raw, ["description", "label"]) ?? undefined;

  // Bash / shell first
  if (typeof raw.command === "string") {
    const parts = [raw.command];
    if (Array.isArray(raw.args) && raw.args.length) {
      parts.push(raw.args.map(String).join(" "));
    }
    return {
      subtitle,
      input: truncate(parts.filter(Boolean).join(" "), INPUT_BODY_CAP),
    };
  }

  // Grep / search BEFORE path (raw often has both pattern + path)
  if (typeof raw.pattern === "string" || typeof raw.query === "string") {
    const pat =
      typeof raw.pattern === "string" ? raw.pattern : String(raw.query);
    const bits = [`/${pat}/`];
    const p = pickString(raw, PATH_KEYS);
    if (p) bits.push(p);
    if (typeof raw.glob === "string") bits.push(`glob: ${raw.glob}`);
    return { subtitle, input: bits.join("  ") };
  }

  // File path (ACP path / editor target_file / file_path)
  const filePath = pickString(raw, PATH_KEYS);
  if (filePath) {
    const lines = [filePath];
    appendBodyLines(lines, raw, opts?.skipBody);
    return { subtitle, input: lines.join("\n") };
  }

  // Generic preferred keys + body
  const preferred = ["query", "url", "prompt", "name", "id"] as const;
  const lines: string[] = [];
  for (const k of preferred) {
    if (raw[k] != null && typeof raw[k] !== "object") {
      lines.push(`${k}: ${String(raw[k])}`);
    }
  }
  appendBodyLines(lines, raw, opts?.skipBody);
  if (lines.length) return { subtitle, input: lines.join("\n") };

  const fallback = slimJson(raw);
  return { subtitle, input: fallback };
}

export function formatToolDisplay(item: {
  raw?: unknown;
  content?: unknown;
  title?: string;
}): ToolDisplay {
  const diff =
    extractStructuredDiff(item.content) ??
    extractStructuredDiffFromRaw(item.raw);
  const hasDiff = shouldRenderDiff(diff);

  let { subtitle, input } = formatToolInput(item.raw, {
    skipBody: hasDiff,
  });
  if (hasDiff && input && diff) {
    const paths = new Set(
      diff.files.map((f) => f.path).filter((p): p is string => Boolean(p)),
    );
    if (paths.has(input.trim())) input = undefined;
  }

  // Title often is `Execute \`long command\`` when rawInput is thin
  if (!input && item.title) {
    const fromTitle = commandFromExecuteTitle(item.title);
    if (fromTitle) input = truncate(fromTitle, INPUT_BODY_CAP);
  }

  let output = extractTextFromContent(item.content, { skipDiff: hasDiff });

  if (
    output.startsWith('"') &&
    output.endsWith('"') &&
    output.includes("\\n")
  ) {
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed === "string") output = parsed;
    } catch {
      /* keep */
    }
  }

  if (output && input && output.trim() === input.trim()) {
    output = "";
  }

  // Plain <pre> cannot render VT colors — strip so "101 passed" is readable.
  if (output) output = stripAnsi(output);
  if (output) output = truncate(output, OUTPUT_CAP);

  return {
    subtitle,
    input: input || undefined,
    output: output || undefined,
    diff: hasDiff ? diff : undefined,
  };
}

const KIND_LABELS: Record<string, string> = {
  execute: "Execute",
  read: "Read",
  edit: "Edit",
  write: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Search",
  fetch: "Fetch",
  think: "Think",
  other: "Tool",
  switch_mode: "Switch mode",
};

/**
 * Pull shell command out of agent titles like:
 *   Execute `ls -la`
 *   Execute ls -la && …
 */
export function commandFromExecuteTitle(title: string): string | undefined {
  const t = String(title || "").trim();
  if (!t) return undefined;
  const tick = t.match(/^Execute\s+`([\s\S]+)`\s*$/i);
  if (tick?.[1]) return tick[1].trim();
  const plain = t.match(/^Execute\s+(.+)$/i);
  if (plain?.[1] && plain[1].length > 12) return plain[1].trim();
  return undefined;
}

/**
 * Short human action label for permission / tool cards.
 */
export function prettyToolAction(
  kind?: string | null,
  title?: string | null,
): string {
  const k = String(kind || "")
    .toLowerCase()
    .replace(/-/g, "_");
  if (KIND_LABELS[k]) return KIND_LABELS[k];
  const t = String(title || "").trim();
  const m = t.match(/^([A-Za-z][\w /-]{0,24}?)(?:\s*[`:]|\s*$)/);
  if (m && !m[1].includes("/")) return m[1].trim();
  return "Permission required";
}

/**
 * Approval-friendly layout: action + why + command/path (not one giant heading).
 */
export function formatToolCard(item: {
  title?: string | null;
  kind?: string | null;
  raw?: unknown;
  content?: unknown;
}): ToolCard & ToolDisplay {
  const display = formatToolDisplay({
    title: item.title || undefined,
    raw: item.raw,
    content: item.content,
  });
  const action = prettyToolAction(item.kind, item.title);
  const rawObj = isPlainObject(item.raw) ? item.raw : null;
  const isCommand =
    Boolean(rawObj && typeof rawObj.command === "string") ||
    Boolean(item.title && /^Execute\b/i.test(String(item.title)));

  let summary = display.subtitle;
  if (!summary) {
    const t = String(item.title || "").trim();
    // Don't use the full Execute `…` line as the summary
    if (t && !commandFromExecuteTitle(t) && t.length < 120) {
      summary = t;
    }
  }

  return {
    action,
    summary: summary || undefined,
    detail: display.input || undefined,
    fullTitle: item.title ? String(item.title) : undefined,
    isCommand,
    subtitle: display.subtitle,
    input: display.input,
    output: display.output,
    diff: display.diff,
  };
}

/** Shell detail with `$ ` prefix for display (idempotent). */
export function formatCommandDetail(card: Pick<ToolCard, "detail" | "isCommand">): string | undefined {
  if (!card.detail) return undefined;
  if (card.isCommand && !card.detail.startsWith("$")) {
    return `$ ${card.detail}`;
  }
  return card.detail;
}

/** Short heading under the action label (summary, or truncated title). */
export function toolCardHeading(
  card: Pick<ToolCard, "summary" | "fullTitle" | "detail">,
  maxLen = 100,
): string | undefined {
  if (card.summary) return card.summary;
  const t = card.fullTitle?.trim();
  if (!t) return undefined;
  if (commandFromExecuteTitle(t) && card.detail) return undefined;
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

export function fileBasename(path: string | undefined | null): string | undefined {
  if (!path) return undefined;
  const trimmed = String(path).replace(/[/\\]+$/, "");
  const base = trimmed.split(/[/\\]/).filter(Boolean).pop();
  return base || String(path);
}

function looksChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

function inferToolKind(
  kind?: string | null,
  title?: string | null,
  raw?: unknown,
): string {
  const explicit = String(kind || "")
    .toLowerCase()
    .replace(/-/g, "_");
  if (explicit && KIND_LABELS[explicit]) return explicit;

  const action = prettyToolAction(kind, title)
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (KIND_LABELS[action]) return action;

  if (isPlainObject(raw)) {
    if (typeof raw.command === "string") return "execute";
    if (
      raw.old_string != null ||
      raw.new_string != null ||
      raw.oldText != null ||
      raw.newText != null
    ) {
      return "edit";
    }
    if (typeof raw.pattern === "string" || typeof raw.query === "string") {
      return "search";
    }
    if (typeof raw.url === "string") return "fetch";
    if (pickString(raw, PATH_KEYS) && pickString(raw, BODY_KEYS)) return "edit";
    if (pickString(raw, PATH_KEYS)) return "read";
  }
  return "other";
}

function firstBin(cmd: string): string {
  const tok = cmd.trim().split(/\s+/)[0] || "";
  return tok.replace(/^.*\//, "") || "命令";
}

function looksLikeScriptName(tok: string): boolean {
  const base = tok.replace(/^.*\//, "");
  return (
    Boolean(base) &&
    !base.startsWith("-") &&
    /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl)$/i.test(base)
  );
}

/**
 * Short execute label. Prefer a filename or a two-word gist; never ellipsize
 * a long raw command.
 */
export function summarizeExecuteLabel(cmd: string): string {
  let s = String(cmd || "").trim();
  s = s.replace(/^([A-Z_][A-Z0-9_]*=\S+\s+)+/, "");
  if (!s) return "命令";

  if (/<<-?\s*['"]?\w+['"]?/.test(s)) {
    const bin = firstBin(s);
    if (/^python/.test(bin)) return "python3 脚本";
    if (/^node/.test(bin)) return "node 脚本";
    if (/^(bash|sh|zsh)$/.test(bin)) return `${bin} 脚本`;
    return `${bin} 脚本`;
  }
  if (/\bpython3?\s+-c\b/.test(s)) return "python3 脚本";
  if (/\bnode(js)?\s+-e\b/.test(s)) return "node 脚本";
  if (/\b(bash|sh|zsh)\s+-c\b/.test(s)) return "shell 脚本";

  const tokens = s.split(/\s+/).filter(Boolean);
  for (const t of tokens.slice(0, 8)) {
    if (looksLikeScriptName(t)) return t.replace(/^.*\//, "");
  }

  const bin = firstBin(s);
  if (bin === "git") {
    const sub = tokens.find((t, i) => i > 0 && !t.startsWith("-"));
    return sub ? `git ${sub}` : "git";
  }
  if (bin === "npm" || bin === "pnpm" || bin === "yarn" || bin === "npx") {
    if (tokens[1] === "run" && tokens[2]) return `${bin} run ${tokens[2]}`;
    if (tokens[1] && !tokens[1].startsWith("-")) return `${bin} ${tokens[1]}`;
    return bin;
  }
  if ((bin === "cargo" || bin === "go" || bin === "make") && tokens[1]) {
    return `${bin} ${tokens[1]}`;
  }
  return bin;
}

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).host || url;
  } catch {
    return url.replace(/^https?:\/\//i, "").split("/")[0] || url;
  }
}

function statusBusy(status?: string | null): boolean {
  const s = String(status || "").toLowerCase();
  return s === "in_progress" || s === "pending" || s === "running";
}

function statusFailed(status?: string | null): boolean {
  const s = String(status || "").toLowerCase();
  return s === "failed" || s === "error";
}

function finishPhrase(done: string, doing: string, status?: string | null): string {
  if (statusBusy(status)) return `${doing}…`;
  return done;
}

function failLabel(kind: string): string {
  if (kind === "edit" || kind === "write") return "修改失败";
  if (kind === "read") return "读取失败";
  if (kind === "search") return "搜索失败";
  if (kind === "fetch") return "访问失败";
  if (kind === "delete") return "删除失败";
  if (kind === "move") return "移动失败";
  if (kind === "execute") return "运行失败";
  return "操作失败";
}

/**
 * One-line Chinese summary for a collapsed tool row (Codex-style).
 * Built from action + path/command, not from dumping the diff.
 */
export function formatToolPlainSummary(item: {
  title?: string | null;
  kind?: string | null;
  raw?: unknown;
  content?: unknown;
  status?: string | null;
}): string {
  const rawObj = isPlainObject(item.raw) ? item.raw : null;
  const chineseHint = pickString(rawObj ?? {}, ["description", "label"]);
  if (chineseHint && looksChinese(chineseHint) && chineseHint.length <= 80) {
    return finishPhrase(chineseHint, chineseHint, item.status);
  }

  const k = inferToolKind(item.kind, item.title, item.raw);
  const diff =
    extractStructuredDiff(item.content) ??
    extractStructuredDiffFromRaw(item.raw);
  const diffFiles = diff?.files.map((f) => f.path).filter(Boolean) as
    | string[]
    | undefined;
  const path =
    pickString(rawObj ?? {}, PATH_KEYS) ||
    diffFiles?.[0] ||
    undefined;
  const file = fileBasename(path);

  if (k === "edit" || k === "write") {
    if (diffFiles && diffFiles.length > 1) {
      return finishPhrase(
        `修改了 ${diffFiles.length} 个文件`,
        `正在修改 ${diffFiles.length} 个文件`,
        item.status,
      );
    }
    if (file) {
      return finishPhrase(`修改了 ${file}`, `正在修改 ${file}`, item.status);
    }
    return finishPhrase("修改了文件", "正在修改文件", item.status);
  }

  if (k === "read") {
    return file
      ? finishPhrase(`读取了 ${file}`, `正在读取 ${file}`, item.status)
      : finishPhrase("读取了文件", "正在读取文件", item.status);
  }

  if (k === "execute") {
    const cmd =
      (rawObj && typeof rawObj.command === "string" ? rawObj.command : undefined) ||
      commandFromExecuteTitle(String(item.title || ""));
    const label = cmd ? summarizeExecuteLabel(cmd) : "命令";
    return finishPhrase(`运行了 ${label}`, `正在运行 ${label}`, item.status);
  }

  if (k === "search") {
    const pat =
      (rawObj && typeof rawObj.pattern === "string" && rawObj.pattern) ||
      (rawObj && typeof rawObj.query === "string" && rawObj.query) ||
      "";
    const shown = pat ? (pat.length > 32 ? `${pat.slice(0, 30)}…` : pat) : "内容";
    return finishPhrase(`搜索了 ${shown}`, `正在搜索 ${shown}`, item.status);
  }

  if (k === "fetch") {
    const url = rawObj && typeof rawObj.url === "string" ? rawObj.url : "";
    const host = url ? hostFromUrl(url) : undefined;
    return host
      ? finishPhrase(`访问了 ${host}`, `正在访问 ${host}`, item.status)
      : finishPhrase("访问了网页", "正在访问网页", item.status);
  }

  if (k === "delete") {
    return file
      ? finishPhrase(`删除了 ${file}`, `正在删除 ${file}`, item.status)
      : finishPhrase("删除了文件", "正在删除文件", item.status);
  }

  if (k === "move") {
    return file
      ? finishPhrase(`移动了 ${file}`, `正在移动 ${file}`, item.status)
      : finishPhrase("移动了文件", "正在移动文件", item.status);
  }

  const t = String(item.title || "").trim();
  if (t && t.length < 80 && !commandFromExecuteTitle(t)) {
    return finishPhrase(t, t, item.status);
  }
  if (file) {
    return finishPhrase(`处理了 ${file}`, `正在处理 ${file}`, item.status);
  }
  return finishPhrase("调用了工具", "正在调用工具", item.status);
}

/** Same clock the TUI uses: `2.7s` or `1m57s`. `ms` is elapsed milliseconds. */
export function formatTuiDuration(ms: number): string {
  const n = Math.max(0, Number(ms) || 0);
  const secs = n / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  let rem = Math.round(secs - mins * 60);
  if (rem === 60) return `${mins + 1}m0s`;
  return `${mins}m${rem}s`;
}

/** TUI thinking header: `Thinking… 0.3s` while live, `Thought for 2.7s` when done. */
export function formatThoughtSummary(ms: number, running: boolean): string {
  const clock = formatTuiDuration(ms);
  return running ? `Thinking… ${clock}` : `Thought for ${clock}`;
}

/** One muted inline line: monochrome mark + Chinese summary. */
export function formatToolInlineSummary(item: {
  title?: string | null;
  kind?: string | null;
  raw?: unknown;
  content?: unknown;
  status?: string | null;
}): string {
  const k = inferToolKind(item.kind, item.title, item.raw);
  if (statusFailed(item.status)) return `✗ ${failLabel(k)}`;
  return `· ${formatToolPlainSummary(item)}`;
}

export function formatThoughtInlineSummary(
  ms: number,
  running: boolean,
): string {
  return `◆ ${formatThoughtSummary(ms, running)}`;
}

export function formatWorkedFor(ms: number): string {
  return `Worked for ${formatTuiDuration(ms)}`;
}

const TRIVIAL_BINS = new Set([
  "cd",
  "ls",
  "pwd",
  "open",
  "kill",
  "true",
  ":",
  "sleep",
  "lsof",
  "ps",
  "which",
  "date",
  "clear",
]);

export function isTrivialExecute(cmd: string | undefined | null): boolean {
  if (!cmd) return false;
  return TRIVIAL_BINS.has(firstBin(cmd));
}

export type ToolActivityBits = {
  kind: string;
  file?: string;
  added: number;
  deleted: number;
  command?: string;
  failed: boolean;
  running: boolean;
  trivial: boolean;
};

export function toolFilePath(item: {
  raw?: unknown;
  content?: unknown;
}): string | undefined {
  const rawObj = isPlainObject(item.raw) ? item.raw : null;
  const diff =
    extractStructuredDiff(item.content) ??
    extractStructuredDiffFromRaw(item.raw);
  const diffFiles = diff?.files.map((f) => f.path).filter(Boolean) as
    | string[]
    | undefined;
  return pickString(rawObj ?? {}, PATH_KEYS) || diffFiles?.[0] || undefined;
}

export function isFileWriteTool(
  kind?: string | null,
  title?: string | null,
  raw?: unknown,
): boolean {
  const k = inferToolKind(kind, title, raw);
  return k === "edit" || k === "write";
}

export function describeToolActivity(item: {
  title?: string | null;
  kind?: string | null;
  raw?: unknown;
  content?: unknown;
  status?: string | null;
}): ToolActivityBits {
  const k = inferToolKind(item.kind, item.title, item.raw);
  const rawObj = isPlainObject(item.raw) ? item.raw : null;
  const diff =
    extractStructuredDiff(item.content) ??
    extractStructuredDiffFromRaw(item.raw);
  const path = toolFilePath(item);
  const file = fileBasename(path);
  const edits = countDiffEdits(diff);
  const cmd =
    (rawObj && typeof rawObj.command === "string" ? rawObj.command : undefined) ||
    commandFromExecuteTitle(String(item.title || ""));
  return {
    kind: k,
    file,
    added: edits.added,
    deleted: edits.deleted,
    command: cmd ? summarizeExecuteLabel(cmd) : undefined,
    failed: statusFailed(item.status),
    running: statusBusy(item.status),
    trivial: k === "execute" && isTrivialExecute(cmd),
  };
}

export function shouldShowThought(opts: {
  ms: number;
  running?: boolean;
  prevKind?: string | null;
  nextKind?: string | null;
}): boolean {
  if (opts.running) return true;
  return Math.max(0, Number(opts.ms) || 0) >= 500;
}
