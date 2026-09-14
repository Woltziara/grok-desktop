/**
 * Local JSON working-knowledge store. Keyed by business object, not cwd.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  README_TEXT,
  STORE_SCHEMA,
  isSafeObjectId,
  resolveKnowledgeRoot,
} from "./paths.mjs";

export const KINDS = [
  "utterance",
  "background",
  "preference",
  "decision",
  "inference",
  "unknown",
  "conflict",
  "question",
  "correction",
  "withdrawal",
  "replacement",
  "action",
  "result",
];

export const STATUSES = [
  "active",
  "superseded",
  "withdrawn",
  "pending",
  "asked",
  "deferred",
  "refused",
  "reopened",
  "processed",
  "failed",
];

export const EPISTEMIC = [
  "user_said",
  "model_inferred",
  "decided",
  "executed",
  "observed_success",
  "unknown",
];

const CORE_KINDS = new Set([
  "preference",
  "decision",
  "correction",
  "background",
  "withdrawal",
  "replacement",
]);

function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix = "wk") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip broken line */
    }
  }
  return out;
}

function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, "utf8");
}

export function objectDir(root, objectId) {
  return path.join(resolveKnowledgeRoot(root), "objects", objectId);
}

function configPath(root) {
  return path.join(resolveKnowledgeRoot(root), "config.json");
}

function bindingsPath(root) {
  return path.join(resolveKnowledgeRoot(root), "bindings.json");
}

function receiptPath(root) {
  return path.join(resolveKnowledgeRoot(root), "probe", "last-receipt.json");
}

function probeHistoryPath(root) {
  return path.join(resolveKnowledgeRoot(root), "probe", "history.jsonl");
}

export function defaultConfig() {
  return {
    schema: STORE_SCHEMA,
    enabled: true,
    currentObjectId: "",
    probeArmed: false,
    createdAt: nowIso(),
  };
}

export function ensureStore(root) {
  const base = resolveKnowledgeRoot(root);
  fs.mkdirSync(base, { recursive: true });
  const readme = path.join(base, "README.txt");
  if (!fs.existsSync(readme)) {
    atomicWrite(readme, README_TEXT);
  }
  const cfgFile = configPath(base);
  if (!fs.existsSync(cfgFile)) {
    atomicWrite(cfgFile, `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  }
  fs.mkdirSync(path.join(base, "objects"), { recursive: true });
  fs.mkdirSync(path.join(base, "probe"), { recursive: true });
  return base;
}

export function readConfig(root) {
  ensureStore(root);
  const cfg = readJson(configPath(root), defaultConfig());
  return {
    ...defaultConfig(),
    ...cfg,
    schema: STORE_SCHEMA,
    enabled: cfg.enabled !== false,
    // Preserve an existing selected object exactly. New installations start
    // unassigned; a missing legacy field is also unassigned rather than being
    // silently mapped to a particular business object.
    currentObjectId:
      cfg.currentObjectId == null ? "" : String(cfg.currentObjectId),
    probeArmed: Boolean(cfg.probeArmed),
  };
}

export function writeConfig(root, patch) {
  const current = readConfig(root);
  const next = { ...current, ...patch, schema: STORE_SCHEMA, updatedAt: nowIso() };
  atomicWrite(configPath(root), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function readBindings(root) {
  ensureStore(root);
  const raw = readJson(bindingsPath(root), {});
  return raw && typeof raw === "object" ? raw : {};
}

export function bindSession(root, { sessionId, objectId, cwd, source }) {
  const sid = String(sessionId || "").trim();
  if (!sid) return readBindings(root);
  const all = readBindings(root);
  all[sid] = {
    sessionId: sid,
    objectId: objectId ? String(objectId) : "",
    cwd: cwd ? String(cwd) : "",
    source: source || "user",
    at: nowIso(),
  };
  atomicWrite(bindingsPath(root), `${JSON.stringify(all, null, 2)}\n`);
  return all[sid];
}

export function sessionBinding(root, sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  return readBindings(root)[sid] || null;
}

export function ensureObject(root, objectId, meta = {}) {
  if (!isSafeObjectId(objectId)) {
    throw new Error(`Invalid object id: ${objectId}`);
  }
  const dir = objectDir(root, objectId);
  fs.mkdirSync(dir, { recursive: true });
  const metaFile = path.join(dir, "object.json");
  if (!fs.existsSync(metaFile)) {
    atomicWrite(
      metaFile,
      `${JSON.stringify(
        {
          id: objectId,
          title: meta.title || objectId,
          createdAt: nowIso(),
          test: Boolean(meta.test),
        },
        null,
        2,
      )}\n`,
    );
  }
  const records = path.join(dir, "records.jsonl");
  if (!fs.existsSync(records)) fs.writeFileSync(records, "", "utf8");
  const inbox = path.join(dir, "inbox.jsonl");
  if (!fs.existsSync(inbox)) fs.writeFileSync(inbox, "", "utf8");
  const current = path.join(dir, "current.json");
  if (!fs.existsSync(current)) {
    atomicWrite(
      current,
      `${JSON.stringify({ objectId, version: 0, items: [], updatedAt: nowIso() }, null, 2)}\n`,
    );
  }
  return readJson(metaFile, { id: objectId, title: objectId });
}

export function listObjects(root) {
  ensureStore(root);
  const dir = path.join(resolveKnowledgeRoot(root), "objects");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isSafeObjectId(d.name))
    .map((d) => {
      const meta = readJson(path.join(dir, d.name, "object.json"), {
        id: d.name,
        title: d.name,
      });
      return { ...meta, id: d.name };
    });
}

export function readRecords(root, objectId) {
  if (!isSafeObjectId(objectId)) return [];
  const file = path.join(objectDir(root, objectId), "records.jsonl");
  return readJsonl(file);
}

function rebuildCurrent(root, objectId) {
  const records = readRecords(root, objectId);
  const byId = new Map();
  for (const rec of records) {
    if (!rec || !rec.id) continue;
    byId.set(rec.id, rec);
  }
  const items = [];
  for (const rec of byId.values()) {
    if (rec.test) continue;
    if (rec.status === "superseded" || rec.status === "withdrawn") continue;
    if (rec.kind === "utterance") continue;
    items.push(rec);
  }
  items.sort((a, b) => String(a.recordedAt || "").localeCompare(String(b.recordedAt || "")));
  const prev = readJson(path.join(objectDir(root, objectId), "current.json"), {
    version: 0,
  });
  const snap = {
    objectId,
    version: Number(prev.version || 0),
    items,
    updatedAt: nowIso(),
  };
  atomicWrite(
    path.join(objectDir(root, objectId), "current.json"),
    `${JSON.stringify(snap, null, 2)}\n`,
  );
  return snap;
}

export function readCurrent(root, objectId) {
  if (!isSafeObjectId(objectId)) {
    return { objectId: "", version: 0, items: [] };
  }
  ensureObject(root, objectId);
  const file = path.join(objectDir(root, objectId), "current.json");
  const snap = readJson(file, null);
  if (!snap) return rebuildCurrent(root, objectId);
  return snap;
}

export function bumpVersion(root, objectId) {
  const snap = readCurrent(root, objectId);
  snap.version = Number(snap.version || 0) + 1;
  snap.updatedAt = nowIso();
  atomicWrite(
    path.join(objectDir(root, objectId), "current.json"),
    `${JSON.stringify(snap, null, 2)}\n`,
  );
  return snap.version;
}

export function writeRecord(root, record) {
  const rec = { ...record };
  if (!isSafeObjectId(rec.objectId)) {
    throw new Error("Record missing object id");
  }
  if (!KINDS.includes(rec.kind)) {
    throw new Error(`Unknown kind: ${rec.kind}`);
  }
  ensureObject(root, rec.objectId);
  rec.id = rec.id || newId("rec");
  rec.recordedAt = rec.recordedAt || nowIso();
  rec.status = rec.status || "active";
  rec.epistemic = rec.epistemic || "unknown";
  rec.version = rec.version || 1;
  rec.test = Boolean(rec.test);
  const file = path.join(objectDir(root, rec.objectId), "records.jsonl");
  appendJsonl(file, rec);

  if (Array.isArray(rec.supersedes)) {
    const all = readRecords(root, rec.objectId);
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const oldId of rec.supersedes) {
      const old = byId.get(oldId);
      if (!old) continue;
      const nextStatus =
        rec.kind === "withdrawal" ? "withdrawn" : "superseded";
      if (old.status === nextStatus) continue;
      appendJsonl(file, {
        ...old,
        status: nextStatus,
        recordedAt: nowIso(),
        supersededBy: rec.id,
      });
    }
  }
  const snap = rebuildCurrent(root, rec.objectId);
  snap.version = Number(snap.version || 0) + 1;
  snap.updatedAt = nowIso();
  atomicWrite(
    path.join(objectDir(root, rec.objectId), "current.json"),
    `${JSON.stringify(snap, null, 2)}\n`,
  );
  return { record: rec, current: snap };
}

export function appendInbox(root, item) {
  if (!isSafeObjectId(item.objectId)) {
    throw new Error("Inbox missing object id");
  }
  ensureObject(root, item.objectId);
  const row = {
    id: item.id || newId("in"),
    objectId: item.objectId,
    text: String(item.text || ""),
    sessionId: item.sessionId || "",
    cwd: item.cwd || "",
    at: item.at || nowIso(),
    recordedAt: nowIso(),
    status: "pending",
    test: Boolean(item.test),
    source: item.source || "user",
  };
  appendJsonl(path.join(objectDir(root, item.objectId), "inbox.jsonl"), row);
  return row;
}

export function listInbox(root, objectId, status = "pending") {
  if (!isSafeObjectId(objectId)) return [];
  const rows = readJsonl(path.join(objectDir(root, objectId), "inbox.jsonl"));
  const latest = new Map();
  for (const row of rows) {
    if (row?.id) latest.set(row.id, row);
  }
  const out = [...latest.values()];
  if (status) return out.filter((r) => r.status === status && !r.test);
  return out.filter((r) => !r.test);
}

export function markInbox(root, objectId, inboxId, patch) {
  if (!isSafeObjectId(objectId) || !inboxId) {
    return { ok: false, error: "missing inbox" };
  }
  const rows = listInbox(root, objectId, "");
  const found = rows.find((r) => r.id === inboxId);
  if (!found) return { ok: false, error: "inbox not found" };
  const next = { ...found, ...patch, id: found.id, objectId, recordedAt: nowIso() };
  appendJsonl(path.join(objectDir(root, objectId), "inbox.jsonl"), next);
  return { ok: true, item: next };
}

export function writeReceipt(root, receipt) {
  ensureStore(root);
  const row = { ...receipt, at: receipt.at || nowIso() };
  atomicWrite(receiptPath(root), `${JSON.stringify(row, null, 2)}\n`);
  appendJsonl(probeHistoryPath(root), row);
  return row;
}

export function lastReceipt(root) {
  ensureStore(root);
  return readJson(receiptPath(root), null);
}

export function findIdempotent(root, objectId, key) {
  if (!key) return null;
  const records = readRecords(root, objectId);
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]?.idempotencyKey === key && records[i]?.commitResult) {
      return records[i].commitResult;
    }
  }
  const file = path.join(objectDir(root, objectId), "commits.jsonl");
  const commits = readJsonl(file);
  for (let i = commits.length - 1; i >= 0; i--) {
    if (commits[i]?.idempotencyKey === key) return commits[i];
  }
  return null;
}

export function rememberCommit(root, objectId, result) {
  if (!isSafeObjectId(objectId)) return;
  ensureObject(root, objectId);
  appendJsonl(path.join(objectDir(root, objectId), "commits.jsonl"), result);
}

export function coreItems(items) {
  return (items || []).filter(
    (it) =>
      CORE_KINDS.has(it.kind) &&
      (it.status === "active" || !it.status) &&
      it.epistemic !== "model_inferred",
  );
}

export function nonCoreItems(items) {
  return (items || []).filter((it) => !CORE_KINDS.has(it.kind));
}

export function resolveBoundObject(root, { sessionId, cwd, inherit = true }) {
  const cfg = readConfig(root);
  const existing = sessionBinding(root, sessionId);
  if (existing) {
    return {
      objectId: existing.objectId || "",
      source: "session",
      cwd: existing.cwd || cwd || "",
      enabled: cfg.enabled,
    };
  }
  const current = cfg.currentObjectId || "";
  if (inherit && current && sessionId) {
    bindSession(root, {
      sessionId,
      objectId: current,
      cwd,
      source: "inherit-current",
    });
    return {
      objectId: current,
      source: "inherit-current",
      cwd: cwd || "",
      enabled: cfg.enabled,
    };
  }
  return {
    objectId: current,
    source: "current",
    cwd: cwd || "",
    enabled: cfg.enabled,
  };
}
