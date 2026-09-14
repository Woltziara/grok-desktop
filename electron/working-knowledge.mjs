import { objectEpoch } from "../shared/working-knowledge/object-transaction.mjs";
/**
 * Main-process facade: wrap ACP prompts and consume turn output.
 */
import crypto from "node:crypto";
import { buildWirePrompt } from "../shared/working-knowledge/briefing.mjs";
import { isSystemFollowupText } from "../shared/working-knowledge/envelope.mjs";
import {
  appendInbox,
  bindSession,
  ensureStore,
  lastReceipt,
  listInbox,
  listObjects,
  readConfig,
  readCurrent,
  resolveBoundObject,
  sessionBinding,
  writeConfig,
  writeReceipt,
} from "../shared/working-knowledge/store.mjs";
import {
  applyCommitFromAssistantText,
  uiCorrect,
  uiWithdraw,
} from "../shared/working-knowledge/updates.mjs";
import {
  isSafeObjectId,
  resolveKnowledgeRoot,
} from "../shared/working-knowledge/paths.mjs";

function rootOf() {
  return resolveKnowledgeRoot();
}

function ensureReady() {
  const root = rootOf();
  return ensureStore(root);
}

function objectTitle(root, objectId) {
  if (!objectId) return "未指定";
  const found = listObjects(root).find((o) => o.id === objectId);
  return found?.title || objectId;
}

export function snapshotWorkingKnowledge({ sessionId, cwd } = {}) {
  const root = ensureReady();
  const cfg = readConfig(root);
  const bound = sessionBinding(root, sessionId);
  // An empty session binding is an explicit user choice. Do not fall back to
  // the global selection merely because an empty string is falsy.
  const objectId = bound ? bound.objectId : cfg.currentObjectId || "";
  const current = objectId ? readCurrent(root, objectId) : { version: 0, items: [] };
  const inbox = objectId ? listInbox(root, objectId, "pending") : [];
  const receipt = lastReceipt(root);
  return {
    enabled: cfg.enabled,
    root,
    currentObjectId: cfg.currentObjectId || "",
    sessionObjectId: bound?.objectId ?? null,
    activeObjectId: objectId,
    activeObjectTitle: objectTitle(root, objectId),
    objects: listObjects(root).map((o) => ({
      id: o.id,
      title: o.title,
      test: Boolean(o.test),
    })),
    version: current.version || 0,
    items: current.items || [],
    inbox,
    probeArmed: Boolean(cfg.probeArmed),
    lastReceipt: receipt,
    cwd: cwd || bound?.cwd || "",
    sessionId: sessionId || "",
  };
}

export function setWorkingKnowledgeEnabled(enabled) {
  const root = ensureReady();
  const cfg = writeConfig(root, { enabled: Boolean(enabled), enableRevision: crypto.randomUUID() });
  return { enabled: cfg.enabled };
}

export function setWorkingKnowledgeObject({ objectId, sessionId, cwd }) {
  const root = ensureReady();
  const id = objectId ? String(objectId) : "";
  if (id && !isSafeObjectId(id)) {
    throw new Error(`Unknown object: ${id}`);
  }
  writeConfig(root, { currentObjectId: id });
  if (sessionId) {
    bindSession(root, {
      sessionId,
      objectId: id,
      cwd,
      source: "user",
    });
  }
  return snapshotWorkingKnowledge({ sessionId, cwd });
}

export function armWorkingKnowledgeProbe() {
  const root = ensureReady();
  writeConfig(root, { probeArmed: true });
  return snapshotWorkingKnowledge();
}

export function correctWorkingKnowledge(payload) {
  const root = ensureReady();
  const result = uiCorrect(root, payload);
  return { ...result, snapshot: snapshotWorkingKnowledge(payload) };
}

export function withdrawWorkingKnowledge(payload) {
  const root = ensureReady();
  const result = uiWithdraw(root, payload);
  return { ...result, snapshot: snapshotWorkingKnowledge(payload) };
}

function isUserOrigin(origin, text) {
  if (origin === "scheduled" || origin === "followup") return false;
  if (isSystemFollowupText(text)) return false;
  return true;
}

/**
 * Last Desktop-owned gate before ACP session/prompt.
 * Original user text stays with the caller; wire text adds machine briefing.
 */
export function wrapOutgoingPrompt({
  text,
  sessionId,
  cwd,
  origin = "user",
}) {
  const original = String(text || "");
  const root = ensureReady();
  const cfg = readConfig(root);
  const userTurn = isUserOrigin(origin, original);
  if (!cfg.enabled) {
    return {
      original,
      wireText: original,
      inboxId: null,
      objectId: "",
      probeToken: null,
      receipt: null,
      enabled: false,
    };
  }
  let probeToken = null;
  if (cfg.probeArmed && userTurn) {
    probeToken = crypto.randomBytes(6).toString("hex");
    writeConfig(root, { probeArmed: false });
  }

  const bound = cfg.enabled
    ? resolveBoundObject(root, {
        sessionId,
        cwd,
        inherit: Boolean(userTurn && cfg.enabled),
      })
    : { objectId: "", enabled: false, source: "disabled", cwd };

  const objectId = cfg.enabled ? bound.objectId || "" : "";
  // The extension is available while no object is selected, but ordinary
  // conversation remains untouched until the user explicitly selects one.
  // A manually armed probe is the only unbound exception.
  if (!objectId && !probeToken) {
    return {
      original,
      wireText: original,
      inboxId: null,
      objectId: "",
      probeToken: null,
      receipt: null,
      enabled: true,
    };
  }
  let inboxId = null;
  if (cfg.enabled && userTurn && objectId && original.trim() && !probeToken) {
    const row = appendInbox(root, {
      objectId,
      text: original,
      sessionId,
      cwd,
      source: "user",
      test: false,
    });
    inboxId = row.id;
  }

  const built = buildWirePrompt({
    userText: original,
    objectId,
    objectTitle: objectTitle(root, objectId),
    cwd,
    sessionId,
    root,
    probeToken,
    enabled: cfg.enabled,
  });

  const receipt = writeReceipt(root, {
    kind: probeToken ? "probe" : "briefing",
    test: Boolean(probeToken),
    probeToken,
    objectId,
    sessionId: sessionId || "",
    cwd: cwd || "",
    origin,
    inboxId,
    currentVersion: built.currentVersion,
    inboxCount: built.inboxCount,
    coreCount: built.coreCount,
    originalChars: original.length,
    wireChars: built.wireText.length,
    originalPreview: original.slice(0, 180),
  });

  return {
    original,
    wireText: built.wireText,
    inboxId,
    objectId,
    probeToken,
    receipt,
    enabled: cfg.enabled,
    inboxIds: [...new Set([...(built.inboxIds || []), inboxId].filter(Boolean))],
    bindingRevision: sessionBinding(root, sessionId)?.revision || sessionBinding(root, sessionId)?.at || null,
    enableRevision: cfg.enableRevision || null,
    objectEpoch: objectEpoch(root, objectId),
  };
}

/** Capture the original once without wrapping/consuming a second ACP turn. */
export function captureWorkingKnowledgeInterjection({ text, interjectionId, turn }) {
  if (!turn?.objectId || !String(text || "").trim()) return null;
  const root = ensureReady();
  const key = crypto.createHash("sha256").update(`${turn.sessionId}\0${interjectionId}`).digest("hex");
  return appendInbox(root, {
    id: `interjection_${key}`, objectId: turn.objectId, text: String(text),
    sessionId: turn.sessionId, cwd: turn.cwd, source: "user",
    delivery: "interjection", turnId: turn.id, interjectionId,
  });
}

export function consumeTurnOutput({
  assistantText,
  sessionId,
  cwd,
  inboxId,
  objectId,
  inboxIds,
  bindingRevision,
  enableRevision,
  objectEpoch: expectedObjectEpoch,
  cancelled = false,
}) {
  const root = ensureReady();
  if (cancelled) {
    return { ok: true, skipped: true, reason: "cancelled" };
  }
  const cfg = readConfig(root);
  const bound = sessionBinding(root, sessionId);
  if (!cfg.enabled || (enableRevision !== undefined && enableRevision !== (cfg.enableRevision || null))) {
    return { ok: true, skipped: true, reason: "disabled-or-reenabled" };
  }
  if (bindingRevision !== undefined && bindingRevision !== (bound?.revision || bound?.at || null)) {
    return { ok: true, skipped: true, reason: "binding-changed" };
  }
  // objectId can deliberately be "" for an unbound turn. Likewise, an
  // existing empty session binding must win over the global selection.
  const oid = objectId ?? (bound ? bound.objectId : cfg.currentObjectId || "");
  if (!oid) {
    return { ok: true, skipped: true, reason: "unbound" };
  }
  if (expectedObjectEpoch !== undefined && expectedObjectEpoch !== objectEpoch(root, oid)) {
    return { ok: true, skipped: true, reason: "object-transferred" };
  }
  const result = applyCommitFromAssistantText(root, assistantText || "", {
    objectId: oid,
    inboxId,
    inboxIds,
    sessionId,
    cwd,
    source: { type: "model", sessionId, cwd },
  });
  writeReceipt(root, {
    kind: "consume",
    objectId: oid,
    sessionId: sessionId || "",
    cwd: cwd || "",
    inboxId: inboxId || "",
    result,
  });
  return result;
}

export { resolveKnowledgeRoot };
