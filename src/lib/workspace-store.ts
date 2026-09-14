/**
 * Local daily-flow state: drafts, pin/archive, reading position, unread,
 * project order. Lives on this machine (the person's home), not the Grok account.
 */
import { useSyncExternalStore } from "react";
import { pathFolderKey } from "../../shared/sidebar-chats.mjs";
import {
  FLOW_KEY,
  migrateInlineDrafts,
  readAllDraftRecords,
  writeDraftRecord,
  writeJsonItem,
  sessionKeyFromDraftStorage,
} from "../../shared/flow-persist.mjs";
import {
  hasDraftContent,
  sessionOrgKey,
  prependProjectOrder,
  stableProjectOrder,
} from "../../shared/workspace-org.mjs";

export type DraftFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: string;
  path?: string;
  status?: string;
  text?: string;
  previewUrl?: string;
  dataUrl?: string;
  blobId?: string;
};

export type SessionDraft = {
  text: string;
  cursor: number;
  highDetail?: boolean;
  files: DraftFile[];
  quotes?: Array<{ id: string; text: string; sourceMessageId?: string }>;
  savedAt: number;
  cwd: string;
  title?: string;
};

export type UnreadMark = {
  unread: boolean;
  needsYou: boolean;
  failed: boolean;
  at: number;
};

export type FlowState = {
  projectOrder: string[];
  pinned: Record<string, number>;
  pinnedProjects: Record<string, number>;
  archived: Record<string, number>;
  drafts: Record<string, SessionDraft>;
  reading: Record<string, { scrollTop: number; at: number }>;
  unread: Record<string, UnreadMark>;
  lastSessions: Array<{ cwd: string; sessionId: string }>;
  sidebarScroll: number;
  showArchived: boolean;
};

const KEY = FLOW_KEY;

const EMPTY: FlowState = {
  projectOrder: [],
  pinned: {},
  pinnedProjects: {},
  archived: {},
  drafts: {},
  reading: {},
  unread: {},
  lastSessions: [],
  sidebarScroll: 0,
  showArchived: false,
};

function parseState(raw: string | null): FlowState {
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    return {
      projectOrder: Array.isArray(parsed.projectOrder) ? parsed.projectOrder : [],
      pinned: parsed.pinned && typeof parsed.pinned === "object" ? parsed.pinned : {},
      pinnedProjects:
        parsed.pinnedProjects && typeof parsed.pinnedProjects === "object"
          ? parsed.pinnedProjects
          : {},
      archived:
        parsed.archived && typeof parsed.archived === "object" ? parsed.archived : {},
      drafts: parsed.drafts && typeof parsed.drafts === "object" ? parsed.drafts : {},
      reading:
        parsed.reading && typeof parsed.reading === "object" ? parsed.reading : {},
      unread: parsed.unread && typeof parsed.unread === "object" ? parsed.unread : {},
      lastSessions: Array.isArray(parsed.lastSessions) ? parsed.lastSessions : [],
      sidebarScroll: Number(parsed.sidebarScroll) || 0,
      showArchived: Boolean(parsed.showArchived),
    };
  } catch {
    return { ...EMPTY };
  }
}

function storageOrNull(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function loadState(): FlowState {
  const storage = storageOrNull();
  const next = parseState(storage ? storage.getItem(KEY) : null);
  if (storage) {
    migrateInlineDrafts(storage, next.drafts);
    next.drafts = readAllDraftRecords(storage);
  }
  return next;
}

let state: FlowState = loadState();
const listeners = new Set<() => void>();
let lastPersistError: string | null = null;

function notify() {
  for (const fn of listeners) fn();
}

function persist(next: FlowState) {
  const { drafts, ...rest } = next;
  const storage = storageOrNull();
  if (storage) {
    const result = writeJsonItem(storage, KEY, rest);
    if (!result.ok) {
      lastPersistError = result.error || "storage write failed";
      return { ok: false as const, error: lastPersistError };
    }
  }
  lastPersistError = null;
  state = { ...next, drafts };
  notify();
  return { ok: true as const };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    if (event.key === KEY) {
      const disk = parseState(event.newValue);
      state = { ...disk, drafts: state.drafts };
      notify();
      return;
    }
    const sessionKey = sessionKeyFromDraftStorage(event.key);
    if (!sessionKey) return;
    const drafts = { ...state.drafts };
    if (!event.newValue) delete drafts[sessionKey];
    else {
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed && hasDraftContent(parsed)) {
          drafts[sessionKey] = parsed as SessionDraft;
        } else delete drafts[sessionKey];
      } catch {
        return;
      }
    }
    state = { ...state, drafts };
    notify();
  });
}

export function getFlowState(): FlowState {
  return state;
}

export function patchFlowState(
  patch: Partial<FlowState> | ((prev: FlowState) => FlowState),
) {
  const storage = storageOrNull();
  const disk = parseState(storage ? storage.getItem(KEY) : null);
  const base: FlowState = { ...disk, drafts: state.drafts };
  const next = typeof patch === "function" ? patch(base) : { ...base, ...patch };
  persist(next);
}

export function lastFlowPersistError(): string | null {
  return lastPersistError;
}

export function subscribeFlow(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useFlowState(): FlowState {
  return useSyncExternalStore(subscribeFlow, getFlowState, getFlowState);
}

export function rememberProjectOrder(known: string[]) {
  patchFlowState((prev) => ({
    ...prev,
    projectOrder: stableProjectOrder(prev.projectOrder, known),
  }));
}

export function setShowArchived(show: boolean) {
  patchFlowState({ showArchived: show });
}

export function setProjectOrder(order: string[]) {
  patchFlowState({ projectOrder: stableProjectOrder(order, []) });
}

/** Catalog-only: show a folder in the sidebar without opening it. */
export function addProjectToOrder(cwd: string) {
  patchFlowState((prev) => ({
    ...prev,
    projectOrder: prependProjectOrder(prev.projectOrder, cwd),
  }));
}

export function togglePinnedProject(cwd: string) {
  const key = pathFolderKey(cwd);
  if (!key) return;
  patchFlowState((prev) => {
    const pinnedProjects = { ...prev.pinnedProjects };
    if (pinnedProjects[key]) delete pinnedProjects[key];
    else pinnedProjects[key] = Date.now();
    return { ...prev, pinnedProjects };
  });
}

export function togglePinned(cwd: string, sessionId: string) {
  const key = sessionOrgKey(cwd, sessionId);
  if (!key) return;
  patchFlowState((prev) => {
    const pinned = { ...prev.pinned };
    if (pinned[key]) delete pinned[key];
    else pinned[key] = Date.now();
    return { ...prev, pinned };
  });
}

export function setArchived(cwd: string, sessionId: string, archived: boolean) {
  const key = sessionOrgKey(cwd, sessionId);
  if (!key) return;
  patchFlowState((prev) => {
    const next = { ...prev.archived };
    if (archived) next[key] = Date.now();
    else delete next[key];
    return { ...prev, archived: next };
  });
}

export function saveDraft(
  cwd: string,
  sessionId: string,
  draft: SessionDraft | null,
): { ok: boolean; error?: string } {
  const key = sessionOrgKey(cwd, sessionId);
  if (!key) return { ok: false, error: "missing session" };
  const storage = storageOrNull();
  const record =
    !draft || !hasDraftContent(draft)
      ? null
      : { ...draft, cwd, savedAt: Date.now() };
  if (storage) {
    const result = writeDraftRecord(storage, key, record);
    if (!result.ok) return result;
  }
  const drafts = { ...state.drafts };
  if (!record) delete drafts[key];
  else drafts[key] = record;
  state = { ...state, drafts };
  notify();
  return { ok: true };
}

export function readDraft(cwd: string, sessionId: string): SessionDraft | null {
  const key = sessionOrgKey(cwd, sessionId);
  const storage = storageOrNull();
  const fromDisk = storage ? readAllDraftRecords(storage)[key] : null;
  const draft = (fromDisk as SessionDraft | undefined) || state.drafts[key];
  return draft && hasDraftContent(draft) ? draft : null;
}

export function saveReading(cwd: string, sessionId: string, scrollTop: number) {
  const key = sessionOrgKey(cwd, sessionId);
  if (!key) return;
  patchFlowState((prev) => ({
    ...prev,
    reading: {
      ...prev.reading,
      [key]: { scrollTop: Math.max(0, Math.round(scrollTop)), at: Date.now() },
    },
  }));
}

export function readReading(cwd: string, sessionId: string): number | null {
  const key = sessionOrgKey(cwd, sessionId);
  const row = state.reading[key];
  return row ? row.scrollTop : null;
}

export function markUnread(
  cwd: string,
  sessionId: string,
  patch: Partial<UnreadMark>,
) {
  const key = sessionOrgKey(cwd, sessionId);
  if (!key) return;
  patchFlowState((prev) => {
    const cur = prev.unread[key] || {
      unread: false,
      needsYou: false,
      failed: false,
      at: 0,
    };
    return {
      ...prev,
      unread: {
        ...prev.unread,
        [key]: { ...cur, ...patch, at: Date.now() },
      },
    };
  });
}

export function clearUnread(cwd: string, sessionId: string) {
  const key = sessionOrgKey(cwd, sessionId);
  if (!key) return;
  patchFlowState((prev) => {
    if (!prev.unread[key]) return prev;
    const unread = { ...prev.unread };
    delete unread[key];
    return { ...prev, unread };
  });
}

export function pushSessionHistory(cwd: string, sessionId: string) {
  if (!cwd || !sessionId) return;
  patchFlowState((prev) => {
    const last = prev.lastSessions[prev.lastSessions.length - 1];
    if (
      last &&
      pathFolderKey(last.cwd) === pathFolderKey(cwd) &&
      last.sessionId === sessionId
    ) {
      return prev;
    }
    return {
      ...prev,
      lastSessions: [...prev.lastSessions, { cwd, sessionId }].slice(-24),
    };
  });
}

export function popSessionHistory(currentCwd: string, currentId: string) {
  const stack = state.lastSessions;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const row = stack[i];
    if (
      pathFolderKey(row.cwd) === pathFolderKey(currentCwd) &&
      row.sessionId === currentId
    ) {
      continue;
    }
    patchFlowState({ lastSessions: stack.slice(0, i) });
    return row;
  }
  return null;
}

export { hasDraftContent, sessionOrgKey };
