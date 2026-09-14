/**
 * Main-process crash/exit evidence. It is independent of the debug-log switch
 * and deliberately never throws while an application is already failing.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const nodeRequire = createRequire(import.meta.url);
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINE = 32 * 1024;
let logPath = null;
let installed = false;

function electronApp() {
  try {
    return nodeRequire("electron");
  } catch {
    return null;
  }
}

export function errorFields(err) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack ? String(err.stack).slice(0, 8000) : null,
      code: "code" in err ? err.code : undefined,
    };
  }
  if (err && typeof err === "object") {
    return { message: String(err.message || err) };
  }
  return { message: String(err) };
}

export function getCrashLogPath() {
  if (logPath) return logPath;
  try {
    const app = electronApp()?.app;
    if (app?.getPath) return (logPath = path.join(app.getPath("userData"), "desktop-crash.log"));
  } catch {
    /* unavailable before Electron initializes */
  }
  return (logPath = path.join(process.env.APPDATA || os.homedir(), "grok-desktop", "desktop-crash.log"));
}

function rotateIfNeeded(file) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    try { fs.unlinkSync(`${file}.1`); } catch { /* absent */ }
    fs.renameSync(file, `${file}.1`);
  } catch {
    /* missing / unavailable */
  }
}

export function writeCrashLog(scope, message, data, file) {
  const row = { t: new Date().toISOString(), pid: process.pid, scope: String(scope || "app"), msg: String(message || ""), ...(data && typeof data === "object" ? { data } : {}) };
  let line;
  try { line = `${JSON.stringify(row)}\n`; }
  catch { line = `${JSON.stringify({ t: row.t, pid: row.pid, scope: row.scope, msg: row.msg, data: { serialize: "failed" } })}\n`; }
  if (line.length > MAX_LINE) line = `${line.slice(0, MAX_LINE - 2)}…\n`;
  try {
    const target = file || getCrashLogPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    rotateIfNeeded(target);
    fs.appendFileSync(target, line, "utf8");
  } catch {
    /* reporting must not become the crash */
  }
}

/** Call once from main-process boot, before app.whenReady. */
export function installCrashLogging() {
  if (installed) return getCrashLogPath();
  installed = true;
  const electron = electronApp();
  try {
    electron?.crashReporter?.start?.({ productName: "Grok Desktop", uploadToServer: false, compress: true });
  } catch (err) {
    writeCrashLog("crashReporter", "start-failed", errorFields(err));
  }
  writeCrashLog("app", "crash-logging-installed", { version: electron?.app?.getVersion?.() || null, packaged: Boolean(electron?.app?.isPackaged), platform: process.platform, electron: process.versions?.electron || null });
  process.on("uncaughtException", (err) => writeCrashLog("uncaughtException", err?.message || String(err), errorFields(err)));
  process.on("unhandledRejection", (reason) => writeCrashLog("unhandledRejection", String(reason?.message || reason), errorFields(reason)));
  const app = electron?.app;
  app?.on?.("render-process-gone", (_event, wc, details) => writeCrashLog("render-process-gone", details?.reason || "gone", { reason: details?.reason, exitCode: details?.exitCode, killed: details?.killed, url: (() => { try { return wc?.getURL?.() || null; } catch { return null; } })() }));
  app?.on?.("child-process-gone", (_event, details) => writeCrashLog("child-process-gone", details?.reason || "gone", { type: details?.type, reason: details?.reason, exitCode: details?.exitCode, name: details?.name }));
  for (const event of ["window-all-closed", "before-quit", "will-quit", "quit"]) app?.on?.(event, (_e, exitCode) => writeCrashLog("app", event, { exitCode }));
  return getCrashLogPath();
}
