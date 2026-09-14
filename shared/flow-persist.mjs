/**
 * Flow / draft persistence helpers. Draft records are per-session keys so
 * two windows cannot clobber each other's drafts by rewriting one blob.
 */
export const FLOW_KEY = "grok-desktop-flow-v1";
export const DRAFT_PREFIX = "grok-desktop-draft-v1:";

export function draftStorageKey(sessionKey) {
  return `${DRAFT_PREFIX}${String(sessionKey || "")}`;
}

export function sessionKeyFromDraftStorage(key) {
  const raw = String(key || "");
  if (!raw.startsWith(DRAFT_PREFIX)) return "";
  return raw.slice(DRAFT_PREFIX.length);
}

export function writeJsonItem(storage, key, value) {
  if (!storage || !key) return { ok: false, error: "missing storage" };
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export function readJsonItem(storage, key) {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDraftRecord(storage, sessionKey, draft) {
  const id = String(sessionKey || "");
  if (!id) return { ok: false, error: "missing session" };
  return writeJsonItem(storage, draftStorageKey(id), draft);
}

export function readDraftRecord(storage, sessionKey) {
  const id = String(sessionKey || "");
  if (!id) return null;
  return readJsonItem(storage, draftStorageKey(id));
}

/** @returns {Record<string, any>} Decoded JSON records, keyed by session. */
export function readAllDraftRecords(storage) {
  const drafts = {};
  if (!storage || typeof storage.length !== "number") return drafts;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    const sessionKey = sessionKeyFromDraftStorage(key);
    if (!sessionKey) continue;
    const parsed = readJsonItem(storage, key);
    if (parsed) drafts[sessionKey] = parsed;
  }
  return drafts;
}

export function migrateInlineDrafts(storage, drafts) {
  const map = drafts && typeof drafts === "object" ? drafts : {};
  for (const [sessionKey, draft] of Object.entries(map)) {
    if (!sessionKey || readDraftRecord(storage, sessionKey)) continue;
    writeDraftRecord(storage, sessionKey, draft);
  }
}
