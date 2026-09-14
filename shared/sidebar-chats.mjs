/**
 * Codex-style sidebar: project folders on top, recents below.
 */

export const SIDEBAR_FOLDER_PREVIEW = 4;
export const SIDEBAR_RECENT_LIMIT = 24;

export function pathFolderKey(p) {
  let s = String(p || "").replace(/\\/g, "/");
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) {
    s = s.replace(/\/+$/, "");
  }
  if (/^[a-zA-Z]:/.test(s)) s = s[0].toUpperCase() + s.slice(1).toLowerCase();
  return s;
}

export function folderDisplayName(p) {
  const n = pathFolderKey(p);
  const i = n.lastIndexOf("/");
  const leaf = i >= 0 ? n.slice(i + 1) : n;
  return leaf || n || "项目";
}

function sortMs(session) {
  return (
    Date.parse(session?.lastMessageAt || "") ||
    Date.parse(session?.createdAt || "") ||
    0
  );
}

/**
 * @template {{ id: string, cwd?: string, lastMessageAt?: string | null, createdAt?: string | null }} T
 * @param {{
 *   sessions?: T[],
 *   projectOrder?: string[],
 *   previewLimit?: number,
 *   recentLimit?: number,
 * }} opts
 */
export function groupSidebarChats(opts = {}) {
  const sessions = Array.isArray(opts.sessions) ? opts.sessions : [];
  const order = Array.isArray(opts.projectOrder) ? opts.projectOrder : [];
  /** @type {Map<string, {cwd: string, chats: T[]}>} */
  const byKey = new Map();
  for (const s of sessions) {
    const cwd = String(s?.cwd || "");
    if (!cwd) continue;
    const k = pathFolderKey(cwd);
    if (!byKey.has(k)) byKey.set(k, { cwd, chats: [] });
    byKey.get(k).chats.push(s);
  }
  for (const row of byKey.values()) {
    row.chats.sort((a, b) => sortMs(b) - sortMs(a));
  }
  const used = new Set();
  /** @type {Array<{cwd: string, name: string, chats: T[]}>} */
  const projects = [];
  for (const cwd of order) {
    const k = pathFolderKey(cwd);
    if (!k || used.has(k)) continue;
    used.add(k);
    const row = byKey.get(k);
    projects.push({
      cwd: row?.cwd || cwd,
      name: folderDisplayName(row?.cwd || cwd),
      chats: row?.chats || [],
    });
  }
  for (const [k, row] of byKey) {
    if (used.has(k)) continue;
    used.add(k);
    projects.push({
      cwd: row.cwd,
      name: folderDisplayName(row.cwd),
      chats: row.chats,
    });
  }
  const recent = [...sessions].sort((a, b) => sortMs(b) - sortMs(a));
  const recentLimit = opts.recentLimit ?? SIDEBAR_RECENT_LIMIT;
  return {
    projects,
    recent: recent.slice(0, recentLimit),
  };
}

/** @template T @param {T[]} chats @returns {T[]} */
export function visibleFolderChats(chats, expanded, previewLimit = SIDEBAR_FOLDER_PREVIEW) {
  const list = Array.isArray(chats) ? chats : [];
  if (expanded || list.length <= previewLimit) return list;
  return list.slice(0, previewLimit);
}
