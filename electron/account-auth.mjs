/**
 * Keep more than one Grok login on this Mac and switch which one is active.
 * Files live in ~/.grok/account-snapshots. Never return tokens to the renderer.
 */
import fs from "node:fs";
import path from "node:path";
import { authJsonPath, grokHomeDir } from "./grok-home.mjs";
import {
  publicAccountRow,
  snapshotIdFromSummary,
  summarizeAuthRaw,
} from "../shared/account-auth.mjs";

export function snapshotsDir() {
  return path.join(grokHomeDir(), "account-snapshots");
}

function readAuthObject(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return /** @type {Record<string, unknown>} */ (raw);
  } catch {
    return null;
  }
}

function writeAuthFile(filePath, raw) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
}

export function currentAccountSummary() {
  const raw = readAuthObject(authJsonPath());
  return raw ? summarizeAuthRaw(raw) : null;
}

/**
 * @param {Record<string, unknown>} raw
 */
export function saveAuthRaw(raw) {
  const summary = summarizeAuthRaw(raw);
  if (!summary) return null;
  const id = snapshotIdFromSummary(summary);
  const dir = snapshotsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeAuthFile(path.join(dir, `${id}.json`), raw);
  return publicAccountRow(summary);
}

export function saveAuthSnapshotFromFile(filePath) {
  const raw = readAuthObject(filePath);
  if (!raw) return null;
  return saveAuthRaw(raw);
}

export function saveCurrentSnapshot() {
  return saveAuthSnapshotFromFile(authJsonPath());
}

export function listAccountSnapshots() {
  const current = currentAccountSummary();
  const currentId = current ? snapshotIdFromSummary(current) : null;
  const dir = snapshotsDir();
  /** @type {Map<string, { row: ReturnType<typeof publicAccountRow>, mtime: number }>} */
  const byId = new Map();
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const full = path.join(dir, name);
      const raw = readAuthObject(full);
      if (!raw) continue;
      const summary = summarizeAuthRaw(raw);
      if (!summary) continue;
      const id = snapshotIdFromSummary(summary);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        mtime = 0;
      }
      const prev = byId.get(id);
      if (prev && prev.mtime >= mtime) continue;
      byId.set(id, {
        mtime,
        row: publicAccountRow(summary, { active: id === currentId }),
      });
    }
  }
  const saved = [...byId.values()]
    .map((x) => x.row)
    .filter(Boolean)
    .sort((a, b) => {
      const ae = a.email || a.displayName || a.id;
      const be = b.email || b.displayName || b.id;
      return String(ae).localeCompare(String(be));
    });
  if (current && currentId && !byId.has(currentId)) {
    saved.unshift(publicAccountRow(current, { active: true }));
  }
  return {
    current: publicAccountRow(current, { active: true }),
    saved,
  };
}

/**
 * Make a saved login the active ~/.grok/auth.json. Does not clear chats.
 * @param {string} id
 */
export function activateAccount(id) {
  const wanted = String(id || "").trim();
  if (!wanted) return { ok: false, error: "没有指定要换哪一份登录。" };
  const src = path.join(snapshotsDir(), `${wanted}.json`);
  if (!fs.existsSync(src)) {
    return { ok: false, error: "没有这份登录。" };
  }
  const incoming = readAuthObject(src);
  if (!incoming || !summarizeAuthRaw(incoming)) {
    return { ok: false, error: "这份登录已经不能用了。" };
  }
  saveCurrentSnapshot();
  const dest = authJsonPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
  fs.copyFileSync(src, dest);
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    /* ignore */
  }
  const current = currentAccountSummary();
  return {
    ok: true,
    needsRestart: true,
    current: publicAccountRow(current, { active: true }),
    ...listAccountSnapshots(),
  };
}
