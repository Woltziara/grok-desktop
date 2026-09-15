/**
 * GitHub Releases auto-update via electron-updater.
 *
 * Requires Release assets: latest.yml / latest-mac.yml, installers, and
 * macOS .zip (updater cannot install from .dmg alone). See release.yml.
 *
 * Only runs in packaged apps. Dev (`npm run dev`) shows a clear dialog.
 *
 * macOS: builds are ad-hoc signed (unsigned for distribution). Electron’s
 * Squirrel.Mac / ShipIt path often quits the app without replacing the
 * bundle. We verify and stage the downloaded zip while the app remains open;
 * a detached helper replaces the bundle only after this process exits.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { app, dialog, BrowserWindow } from "electron";
import {
  prepareMacUpdateInstall,
  runMacInstallTransaction,
} from "./mac-update-install.mjs";
import {
  UPDATE_RELEASES_URL,
  formatUpdateCheckError,
} from "../shared/update-identity.mjs";
import {
  createInteractiveUpdateOperation,
  shouldShowUpdaterError,
  watchInteractiveDownload,
} from "../shared/update-error-state.mjs";

const require = createRequire(import.meta.url);

/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;
let wired = false;
/** Prevent double-clicks while a check/download is in flight */
let busy = false;
/** True while we are forcing quit to install an update */
let quittingForUpdate = false;
let installStarting = false;
/** @type {import('electron-updater').UpdateDownloadedEvent | null} */
let lastDownloadedUpdate = null;
/** @type {{ phase: "check" | "download" | "done", dialogShown: boolean } | null} */
let interactiveUpdate = null;
/** Settings → Preview updates. Default off so team installers stay on stable. */
let allowPrereleasePref = false;

/**
 * Opt into GitHub prerelease installers (tags like v0.1.41-beta.1).
 * Stable apps ignore those until this is on.
 * @param {boolean} value
 */
export function setAllowPrerelease(value) {
  allowPrereleasePref = Boolean(value);
  if (!wired) return;
  try {
    getAutoUpdater().allowPrerelease = allowPrereleasePref;
  } catch {
    /* updater not loaded */
  }
}

/** @returns {boolean} */
export function getAllowPrerelease() {
  return allowPrereleasePref;
}

export function isQuittingForUpdate() {
  return quittingForUpdate;
}

function getAutoUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require("electron-updater");
  updater = autoUpdater;
  return updater;
}

function parentWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const all = BrowserWindow.getAllWindows();
  return all.find((w) => !w.isDestroyed()) || null;
}

/**
 * @param {import('electron').MessageBoxOptions} opts
 */
async function box(opts) {
  const win = parentWindow();
  if (win) return dialog.showMessageBox(win, opts);
  return dialog.showMessageBox(opts);
}

/**
 * Close every BrowserWindow so quit is not blocked by open windows
 * (especially macOS, where windows can keep the app alive).
 */
function destroyAllWindows() {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.removeAllListeners("close");
      if (!w.isDestroyed()) w.destroy();
    } catch {
      /* ignore */
    }
  }
}

function disposeHooks(hooks = {}) {
  const dispose = hooks.disposeAgent;
  if (typeof dispose !== "function") return;
  try {
    const p = dispose();
    if (p && typeof p.then === "function") {
      p.catch((err) =>
        console.warn("[auto-update] dispose during update:", err?.message || err),
      );
    }
  } catch (err) {
    console.warn("[auto-update] dispose during update:", err?.message || err);
  }
}

function forceExitSoon(ms = 1500) {
  setTimeout(() => {
    console.warn("[auto-update] force app.exit(0)");
    try {
      app.exit(0);
    } catch {
      process.exit(0);
    }
  }, ms);
}

/** Path to the running .app bundle (…/Grok Desktop.app). */
function macAppBundlePath() {
  // process.execPath = …/Grok Desktop.app/Contents/MacOS/Grok Desktop
  return path.resolve(path.dirname(process.execPath), "..", "..");
}


/**
 * Install the downloaded update and relaunch.
 * Starts after the "Restart now" dialog has fully closed so the Mac preflight
 * can report refusal without disrupting the current window.
 *
 * @param {import('electron-updater').AppUpdater} autoUpdater
 * @param {{ disposeAgent?: () => void | Promise<void> }} [hooks]
 */
export async function installUpdateAndRelaunch(autoUpdater, hooks = {}) {
  if (quittingForUpdate || installStarting) return { ok: false, reason: "busy" };
  installStarting = true;
  console.log("[auto-update] installUpdateAndRelaunch starting");
  await new Promise((resolve) => setTimeout(resolve, 250));

  try {
    if (process.platform === "darwin") {
      const result = await runMacInstallTransaction({
        prepare: () =>
          prepareMacUpdateInstall({
            autoUpdater,
            downloadInfo: lastDownloadedUpdate,
            appPath: macAppBundlePath(),
            currentPid: process.pid,
          }),
        dispose: () => {
          quittingForUpdate = true;
          disposeHooks(hooks);
        },
        destroyWindows: destroyAllWindows,
        exitSoon: () => forceExitSoon(400),
      });
      if (!result.ok) {
        console.warn("[auto-update] mac install preflight refused:", result.reason, result.detail);
        await box({
          type: "error",
          buttons: ["OK", "Open Releases"],
          defaultId: 0,
          cancelId: 0,
          title: "Update was not installed",
          message: result.message,
          detail: result.detail,
        }).then(({ response }) => {
          if (response === 1) {
            import("electron").then(({ shell }) => shell.openExternal(UPDATE_RELEASES_URL));
          }
        });
      }
      return result;
    }

    quittingForUpdate = true;
    disposeHooks(hooks);
    destroyAllWindows();
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
        console.log("[auto-update] quitAndInstall called");
      } catch (err) {
        console.warn("[auto-update] quitAndInstall failed:", err?.message || err);
      }
      forceExitSoon(4000);
    }, 150);
    return { ok: true };
  } finally {
    installStarting = false;
  }
}

async function showUpdateError(err) {
  const formatted = formatUpdateCheckError(err);
  const { response } = await box({
    type: "warning",
    buttons: formatted.offerReleases ? ["OK", "Open Releases"] : ["OK"],
    defaultId: 0,
    cancelId: 0,
    title: formatted.title,
    message: formatted.message,
    detail: formatted.detail,
  });
  if (response === 1 && formatted.offerReleases) {
    const { shell } = await import("electron");
    await shell.openExternal(formatted.releasesUrl || UPDATE_RELEASES_URL);
  }
  return formatted;
}

/**
 * Wire updater events once. Safe to call from setup + interactive check.
 * @param {{ disposeAgent?: () => void | Promise<void> }} [hooks]
 */
function ensureWired(hooks = {}) {
  if (wired) return getAutoUpdater();
  let autoUpdater;
  try {
    autoUpdater = getAutoUpdater();
  } catch (err) {
    console.warn("[auto-update] unavailable:", err?.message || err);
    return null;
  }

  autoUpdater.autoDownload = true;
  // Mac installation is gated by our receipt + bundle preflight. Do not let
  // Squirrel install the same download later when a refused app eventually quits.
  autoUpdater.autoInstallOnAppQuit = process.platform !== "darwin";
  // Public GitHub repo — no token required for download.
  autoUpdater.allowPrerelease = allowPrereleasePref;

  autoUpdater.on("error", (err) => {
    busy = false;
    console.warn("[auto-update]", err?.message || err);
    if (!shouldShowUpdaterError(interactiveUpdate)) return;
    void showUpdateError(err);
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[auto-update] available:", info?.version);
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[auto-update] up to date:", info?.version || app.getVersion());
  });

  autoUpdater.on("download-progress", (p) => {
    const pct = typeof p?.percent === "number" ? p.percent.toFixed(0) : "?";
    console.log(`[auto-update] download ${pct}%`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    busy = false;
    lastDownloadedUpdate = info;
    const version = info?.version || "a new version";
    const { response } = await box({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Grok Desktop ${version} is ready to install.`,
      detail:
        "The update was downloaded in the background. Restart to apply it, or keep working and restart later.",
    });
    if (response === 0) {
      void installUpdateAndRelaunch(autoUpdater, hooks);
    }
  });

  wired = true;
  return autoUpdater;
}

/**
 * Transient Chromium / network failures that often succeed on retry
 * (VPN flip, Wi‑Fi roam, sleep/wake, DNS blip).
 * @param {unknown} err
 */
function isTransientNetworkError(err) {
  const msg = String(err?.message || err || "");
  return /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ERR_FAILED|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network changed|temporarily unavailable/i.test(
    msg,
  );
}

/**
 * checkForUpdates with a few retries on transient network errors.
 * @param {import('electron-updater').AppUpdater} autoUpdater
 * @param {{ attempts?: number, delayMs?: number }} [opts]
 */
async function checkForUpdatesWithRetry(autoUpdater, opts = {}) {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = opts.delayMs ?? 1200;
  /** @type {unknown} */
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      lastErr = err;
      const retry =
        i < attempts - 1 && isTransientNetworkError(err);
      console.warn(
        `[auto-update] check attempt ${i + 1}/${attempts} failed:`,
        err?.message || err,
        retry ? "(retrying)" : "",
      );
      if (!retry) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Background check a few seconds after launch (packaged only).
 * @param {{ disposeAgent?: () => void | Promise<void> }} [hooks]
 */
export function setupAutoUpdater(hooks = {}) {
  if (!app.isPackaged) return;
  const autoUpdater = ensureWired(hooks);
  if (!autoUpdater) return;
  autoUpdater.allowPrerelease = allowPrereleasePref;

  setTimeout(() => {
    checkForUpdatesWithRetry(autoUpdater, { attempts: 3, delayMs: 2000 }).catch(
      (err) => {
        console.warn(
          "[auto-update] silent check failed:",
          err?.message || err,
        );
      },
    );
  }, 5000);
}

/**
 * Menu / UI: “Check for updates…” with user-visible status dialogs.
 * Does not open the browser unless the user asks for the Releases page.
 * @param {{ disposeAgent?: () => void | Promise<void> }} [hooks]
 */
export async function checkForUpdatesInteractive(hooks = {}) {
  if (!app.isPackaged) {
    await box({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      title: "Updates",
      message: "Updates only work in an installed build.",
      detail: `You are running a development copy (v${app.getVersion()}). Install a Release build to use auto-update.`,
    });
    return { ok: false, reason: "dev" };
  }

  if (busy) {
    await box({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      title: "Updates",
      message: "An update check is already in progress.",
    });
    return { ok: false, reason: "busy" };
  }

  const autoUpdater = ensureWired(hooks);
  if (autoUpdater) autoUpdater.allowPrerelease = allowPrereleasePref;
  if (!autoUpdater) {
    await box({
      type: "error",
      buttons: ["OK", "Open Releases"],
      defaultId: 0,
      cancelId: 0,
      title: "Updates",
      message: "The auto-updater could not start.",
      detail: "You can download the latest installer from this edition's GitHub Releases.",
    }).then(({ response }) => {
      if (response === 1) {
        import("electron").then(({ shell }) =>
          shell.openExternal(UPDATE_RELEASES_URL),
        );
      }
    });
    return { ok: false, reason: "unavailable" };
  }

  busy = true;
  const operation = createInteractiveUpdateOperation();
  interactiveUpdate = operation;
  try {
    // Checking dialog is non-blocking; result dialogs come after resolve.
    // Retry transient net::ERR_NETWORK_CHANGED etc. (common on Mac Wi‑Fi/VPN).
    const result = await checkForUpdatesWithRetry(autoUpdater, {
      attempts: 3,
      delayMs: 1500,
    });
    const updateInfo = result?.updateInfo;
    const latest = updateInfo?.version;
    const current = app.getVersion();
    watchInteractiveDownload(result?.downloadPromise, operation, {
      onError: async (err) => {
        busy = false;
        await showUpdateError(err);
      },
      onSettled: () => {
        if (interactiveUpdate === operation) interactiveUpdate = null;
      },
    });

    // If download already started (update-available + autoDownload),
    // update-downloaded will prompt to restart. Avoid a second "found" dialog
    // when we're already past available — but tell the user we found something.
    if (latest && latest !== current) {
      // electron-updater may report available even when equal on some channels;
      // compare semver-ish strings loosely.
      const newer = isVersionNewer(latest, current);
      if (newer) {
        await box({
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          title: "Update found",
          message: `Version ${latest} is available (you have ${current}).`,
          detail:
            "Downloading in the background. You will be asked to restart when it is ready.",
        });
        // Keep busy until download finishes or errors; clear on a short timeout fallback
        setTimeout(() => {
          busy = false;
        }, 30 * 60_000);
        return { ok: true, latest, current };
      }
    }

    busy = false;
    await box({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      title: "You’re up to date",
      message: `Grok Desktop ${current} is the latest version.`,
    });
    return { ok: true, latest: current, current };
  } catch (err) {
    busy = false;
    console.warn("[auto-update] check failed:", err?.message || err);
    operation.dialogShown = true;
    operation.phase = "done";
    const formatted = await showUpdateError(err);
    return {
      ok: false,
      reason: "error",
      error: err?.message || String(err),
      transient: formatted.transient,
    };
  } finally {
    if (operation.phase !== "download" && interactiveUpdate === operation) {
      interactiveUpdate = null;
    }
  }
}

/**
 * Loose semver compare: true if a is greater than b.
 * @param {string} a
 * @param {string} b
 */
function isVersionNewer(a, b) {
  const pa = String(a)
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b)
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return false;
}
