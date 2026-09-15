/**
 * Local session organization: pin, archive, stable project order, drafts.
 * Native conversation relocation is handled by electron/session-move.mjs; these helpers only organize the resulting catalog.
 */
import { pathFolderKey } from "./sidebar-chats.mjs";

export function sessionOrgKey(cwd, sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return "";
  return `${pathFolderKey(cwd)}::${id}`;
}

export function parseSessionOrgKey(key) {
  const raw = String(key || "");
  const at = raw.lastIndexOf("::");
  if (at <= 0) return { cwd: "", sessionId: "" };
  return { cwd: raw.slice(0, at), sessionId: raw.slice(at + 2) };
}

export function hasDraftContent(draft) {
  if (!draft || typeof draft !== "object") return false;
  if (String(draft.text || "").trim()) return true;
  if (Array.isArray(draft.files) && draft.files.length > 0) return true;
  if (Array.isArray(draft.images) && draft.images.length > 0) return true;
  if (Array.isArray(draft.quotes) && draft.quotes.length > 0) return true;
  if (draft.browserReference && typeof draft.browserReference === "object") return true;
  return false;
}

/**
 * Keep the user's project order. Newly seen folders append; current project
 * is never moved to the top just because it was opened.
 * @param {string[]} order
 * @param {string[]} known
 */
export function stableProjectOrder(order, known) {
  const out = [];
  const seen = new Set();
  const push = (cwd) => {
    const k = pathFolderKey(cwd);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(String(cwd));
  };
  for (const cwd of Array.isArray(order) ? order : []) push(cwd);
  for (const cwd of Array.isArray(known) ? known : []) push(cwd);
  return out;
}

/** Put a newly added folder first without touching the live session. */
export function prependProjectOrder(order, cwd) {
  const k = pathFolderKey(cwd);
  if (!k) return Array.isArray(order) ? order.slice() : [];
  const rest = (Array.isArray(order) ? order : []).filter(
    (p) => pathFolderKey(p) !== k,
  );
  return [String(cwd), ...rest];
}

/**
 * @template T
 * @param {T[]} projects
 * @param {Record<string, number>} pinnedProjects
 * @returns {T[]}
 */
export function organizeProjects(projects, pinnedProjects) {
  const list = Array.isArray(projects) ? projects.slice() : [];
  const pinned =
    pinnedProjects && typeof pinnedProjects === "object" ? pinnedProjects : {};
  const yes = [];
  const no = [];
  for (const row of list) {
    const key = pathFolderKey(row?.cwd);
    if (key && pinned[key]) yes.push(row);
    else no.push(row);
  }
  return [...yes, ...no];
}

export function togglePinnedMap(map, key) {
  const next = { ...(map && typeof map === "object" ? map : {}) };
  const k = String(key || "");
  if (!k) return next;
  if (next[k]) delete next[k];
  else next[k] = Date.now();
  return next;
}

export function moveProjectOrder(order, activeKey, overKey) {
  const list = Array.isArray(order) ? order.slice() : [];
  const from = list.findIndex((cwd) => pathFolderKey(cwd) === activeKey);
  const to = list.findIndex((cwd) => pathFolderKey(cwd) === overKey);
  if (from < 0 || to < 0 || from === to) return list;
  const [row] = list.splice(from, 1);
  list.splice(to, 0, row);
  return list;
}

/**
 * Pinned chats stay above the rest; archived chats drop out unless shown.
 * Last-message time still orders within each group so opening a chat does
 * not reshuffle the list.
 * @template {{ id?: string, cwd?: string, lastMessageAt?: string | null, createdAt?: string | null }} T
 * @param {T[]} chats
 * @param {{ pinned?: Record<string, number>, archived?: Record<string, number>, showArchived?: boolean }} org
 * @returns {T[]}
 */
export function organizeFolderChats(chats, org = {}) {
  const list = Array.isArray(chats) ? chats.slice() : [];
  const pinned = org.pinned && typeof org.pinned === "object" ? org.pinned : {};
  const archived =
    org.archived && typeof org.archived === "object" ? org.archived : {};
  const showArchived = Boolean(org.showArchived);
  const visible = list.filter((chat) => {
    const key = sessionOrgKey(chat?.cwd, chat?.id);
    if (!key) return false;
    if (archived[key] && !showArchived) return false;
    return true;
  });
  const sortMs = (chat) =>
    Date.parse(chat?.lastMessageAt || "") ||
    Date.parse(chat?.createdAt || "") ||
    0;
  visible.sort((a, b) => {
    const ka = sessionOrgKey(a.cwd, a.id);
    const kb = sessionOrgKey(b.cwd, b.id);
    const pa = pinned[ka] ? 0 : 1;
    const pb = pinned[kb] ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return sortMs(b) - sortMs(a);
  });
  return visible;
}

export function archivedChats(chats, archived) {
  const map = archived && typeof archived === "object" ? archived : {};
  const list = Array.isArray(chats) ? chats : [];
  return list
    .filter((chat) => map[sessionOrgKey(chat?.cwd, chat?.id)])
    .sort((a, b) => {
      const ka = sessionOrgKey(a.cwd, a.id);
      const kb = sessionOrgKey(b.cwd, b.id);
      return (map[kb] || 0) - (map[ka] || 0);
    });
}

/**
 * Empty shells that were never spoken in should not linger. A draft keeps them.
 */
export function shouldAbandonEmptySession(opts = {}) {
  if (opts.hadUserSpeech) return false;
  if (opts.hasDraft) return false;
  if (!opts.sessionId) return false;
  if (opts.sessionId === opts.nextSessionId) return false;
  return true;
}

export function timelineHasUserSpeech(items) {
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    if (item?.kind !== "user") continue;
    const text = String(item.text || "").trim();
    if (text) return true;
    if (Array.isArray(item.images) && item.images.length > 0) return true;
  }
  return false;
}

/**
 * Inject draft-only chats so a half-written new session stays findable.
 * @param {Array<Record<string, unknown>>} sessions
 * @param {Record<string, { text?: string, files?: unknown[], images?: unknown[], savedAt?: number, cwd?: string, title?: string }>} drafts
 */
export function mergeDraftSessions(sessions, drafts) {
  const list = Array.isArray(sessions) ? sessions.slice() : [];
  const have = new Set(
    list.map((row) => sessionOrgKey(row?.cwd, row?.id)).filter(Boolean),
  );
  const map = drafts && typeof drafts === "object" ? drafts : {};
  for (const [key, draft] of Object.entries(map)) {
    if (!hasDraftContent(draft) || have.has(key)) continue;
    const parsed = parseSessionOrgKey(key);
    const sessionId = parsed.sessionId;
    const cwd = draft.cwd || parsed.cwd;
    if (!sessionId || !cwd) continue;
    const savedAt = Number(draft.savedAt) || Date.now();
    list.push({
      id: sessionId,
      cwd,
      title: String(draft.title || "").trim() || "草稿",
      summary: null,
      createdAt: null,
      updatedAt: null,
      lastActiveAt: null,
      lastMessageAt: new Date(savedAt).toISOString(),
      numMessages: 0,
      numChatMessages: 0,
      modelId: null,
      isDraft: true,
    });
  }
  return list;
}

/**
 * Disk listing skips empty shells (no summary / no message yet).
 * The live chat must still appear in the sidebar as soon as it is created.
 */
export function ensureLiveSessionInList(sessions, live) {
  const id = String(live?.id || "").trim();
  const cwd = String(live?.cwd || "").trim();
  if (!id || !cwd) return Array.isArray(sessions) ? sessions.slice() : [];
  const list = Array.isArray(sessions) ? sessions.slice() : [];
  const key = sessionOrgKey(cwd, id);
  if (list.some((row) => sessionOrgKey(row?.cwd, row?.id) === key)) {
    return list;
  }
  const now = new Date().toISOString();
  list.unshift({
    id,
    cwd,
    title: String(live?.title || "").trim() || "新对话",
    summary: null,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    lastMessageAt: now,
    numMessages: 0,
    numChatMessages: 0,
    modelId: null,
    isLiveShell: true,
  });
  return list;
}

export function duplicateProjectNames(projects) {
  const counts = new Map();
  for (const row of Array.isArray(projects) ? projects : []) {
    const name = String(row?.name || "");
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

export function parentPathSnippet(cwd) {
  const n = pathFolderKey(cwd);
  const i = n.lastIndexOf("/");
  if (i <= 0) return n;
  const parent = n.slice(0, i);
  const j = parent.lastIndexOf("/");
  return j >= 0 ? parent.slice(j + 1) : parent;
}
