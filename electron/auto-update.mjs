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
 * bundle. We install by unzipping the downloaded zip into the .app path
 * via a detached helper script, then relaunch.
 */
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, dialog, BrowserWindow } from "electron";
import {
  UPDATE_RELEASES_URL,
  formatUpdateCheckError,
  macBundleIdFromPlistXml,
  pickMacUpdateZip,
  updateReceiptFromDownload,
} from "../shared/update-identity.mjs";

const require = createRequire(import.meta.url);

/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;
let wired = false;
/** Prevent double-clicks while a check/download is in flight */
let busy = false;
/** True while we are forcing quit to install an update */
let quittingForUpdate = false;
/** @type {import('electron-updater').UpdateInfo | null} */
let lastDownloadedUpdate = null;
let suppressErrorDialog = false;
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
 * Locate the zip electron-updater already downloaded.
 * @param {import('electron-updater').AppUpdater | null} [autoUpdater]
 * @returns {string | null}
 */
function resolveMacUpdateZip(autoUpdater) {
  try {
    const file = autoUpdater?.downloadedUpdateHelper?.file;
    if (!file || !fs.existsSync(file)) return null;
    const receipt = updateReceiptFromDownload(lastDownloadedUpdate);
    return pickMacUpdateZip({
      downloadedFile: file,
      size: fs.statSync(file).size,
      updateVersion: receipt.version,
      sha512Receipt: receipt.sha512Receipt,
    });
  } catch {
    return null;
  }
}

function readPlistXml(appPath) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  try {
    return execFileSync("plutil", ["-convert", "xml1", "-o", "-", plistPath], {
      encoding: "utf8",
    });
  } catch {
    return fs.readFileSync(plistPath, "utf8");
  }
}

function currentMacBundleId(appPath) {
  try {
    return macBundleIdFromPlistXml(readPlistXml(appPath));
  } catch {
    return "";
  }
}

/**
 * macOS: Squirrel.Mac does not reliably install ad-hoc/unsigned builds.
 * Unzip the downloaded update over the running .app via a detached script
 * that waits for this process to exit, then relaunches.
 *
 * @param {import('electron-updater').AppUpdater} autoUpdater
 * @returns {boolean} true if helper was launched
 */
function startMacManualInstall(autoUpdater) {
  const zipPath = resolveMacUpdateZip(autoUpdater);
  const appPath = macAppBundlePath();
  const expectedBundleId = currentMacBundleId(appPath);
  const receipt = updateReceiptFromDownload(lastDownloadedUpdate);
  const expectedVersion = receipt.version;
  const expectedArch = receipt.arch || process.arch;
  if (!expectedBundleId || !expectedVersion || !expectedArch) {
    console.warn("[auto-update] mac manual install: missing identity", {
      expectedBundleId,
      expectedVersion,
      expectedArch,
    });
    return false;
  }

  if (!zipPath) {
    console.warn("[auto-update] mac manual install: no verified update.zip found");
    return false;
  }
  if (!appPath.endsWith(".app") || !fs.existsSync(appPath)) {
    console.warn("[auto-update] mac manual install: bad app path:", appPath);
    return false;
  }

  // Refuse to write outside a .app we own / can write (best-effort check)
  try {
    fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
  } catch (err) {
    console.warn(
      "[auto-update] mac manual install: app parent not writable:",
      err?.message || err,
    );
    return false;
  }

  const logPath = path.join(
    os.homedir(),
    "Library",
    "Logs",
    "grok-desktop-update.log",
  );
  const scriptPath = path.join(
    os.tmpdir(),
    `grok-desktop-update-${process.pid}-${Date.now()}.sh`,
  );

  // Bash helper: wait for PID, extract zip, replace .app, clear quarantine, open.
  // Paths are passed as argv so we do not interpolate untrusted content into the script body.
  const script = `#!/bin/bash
set -u
LOG="$1"
APP_PID="$2"
ZIP="$3"
DEST="$4"
APP_NAME="$(basename "$DEST")"
EXPECTED_BUNDLE_ID="$5"
EXPECTED_VERSION="$6"
EXPECTED_ARCH="$7"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
exec >>"$LOG" 2>&1
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) mac update helper ===="
echo "pid=$APP_PID zip=$ZIP dest=$DEST bundle=$EXPECTED_BUNDLE_ID version=$EXPECTED_VERSION arch=$EXPECTED_ARCH"

if [ -z "$EXPECTED_BUNDLE_ID" ] || [ -z "$EXPECTED_VERSION" ] || [ -z "$EXPECTED_ARCH" ]; then
  echo "ERROR: missing expected identity; not replacing"
  exit 1
fi

# Wait for the Electron process to exit (max ~90s). Timeout must not replace.
exited=0
for i in $(seq 1 180); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "app exited after \${i} polls"
    exited=1
    break
  fi
  sleep 0.5
done
if [ "$exited" -ne 1 ]; then
  echo "ERROR: app still running after wait; not replacing"
  exit 1
fi
sleep 1

if [ ! -f "$ZIP" ]; then
  echo "ERROR: zip missing: $ZIP"
  exit 1
fi

TMP="$(mktemp -d /tmp/grok-desktop-update.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "extracting…"
if command -v ditto >/dev/null 2>&1; then
  ditto -x -k "$ZIP" "$TMP" || { echo "ditto failed"; exit 1; }
else
  unzip -q "$ZIP" -d "$TMP" || { echo "unzip failed"; exit 1; }
fi

NEW_APP="$TMP/$APP_NAME"
if [ ! -d "$NEW_APP" ]; then
  NEW_APP="$(find "$TMP" -maxdepth 2 -name '*.app' -type d 2>/dev/null | head -1)"
fi
if [ -z "\${NEW_APP:-}" ] || [ ! -d "$NEW_APP" ]; then
  echo "ERROR: no .app inside zip"
  ls -la "$TMP" || true
  exit 1
fi
echo "new app: $NEW_APP"

ACTUAL_BUNDLE_ID="$(defaults read "$NEW_APP/Contents/Info" CFBundleIdentifier 2>/dev/null || true)"
ACTUAL_VERSION="$(defaults read "$NEW_APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
EXEC_BIN="$(/usr/bin/find "$NEW_APP/Contents/MacOS" -type f -perm +111 2>/dev/null | /usr/bin/head -1)"
ACTUAL_ARCH="$(lipo -archs "$EXEC_BIN" 2>/dev/null || uname -m)"
if [ -z "$ACTUAL_BUNDLE_ID" ] || [ -z "$ACTUAL_VERSION" ] || [ -z "$ACTUAL_ARCH" ]; then
  echo "ERROR: could not read new app identity; not replacing"
  exit 1
fi
if [ "$ACTUAL_BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]; then
  echo "ERROR: bundle id mismatch expected=$EXPECTED_BUNDLE_ID actual=$ACTUAL_BUNDLE_ID"
  exit 1
fi
if [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "ERROR: version mismatch expected=$EXPECTED_VERSION actual=$ACTUAL_VERSION"
  exit 1
fi
ARCH_OK=0
if [ "$EXPECTED_ARCH" = "arm64" ] || [ "$EXPECTED_ARCH" = "aarch64" ]; then
  case " $ACTUAL_ARCH " in *" arm64 "*) ARCH_OK=1 ;; esac
else
  case " $ACTUAL_ARCH " in *" x86_64 "*|*" x64 "*) ARCH_OK=1 ;; esac
fi
if [ "$ARCH_OK" -ne 1 ]; then
  echo "ERROR: arch mismatch expected=$EXPECTED_ARCH actual=$ACTUAL_ARCH"
  exit 1
fi

# Replace in place (rename old aside, then move new; restore on failure)
BACKUP="\${DEST}.pre-update"
rm -rf "$BACKUP" 2>/dev/null || true
if [ -d "$DEST" ]; then
  if ! mv "$DEST" "$BACKUP"; then
    echo "ERROR: could not move old app aside (permission?)"
    exit 1
  fi
fi

if command -v ditto >/dev/null 2>&1; then
  if ! ditto "$NEW_APP" "$DEST"; then
    echo "ERROR: ditto install failed — restoring backup"
    rm -rf "$DEST" 2>/dev/null || true
    [ -d "$BACKUP" ] && mv "$BACKUP" "$DEST"
    exit 1
  fi
else
  if ! mv "$NEW_APP" "$DEST"; then
    echo "ERROR: mv install failed — restoring backup"
    [ -d "$BACKUP" ] && mv "$BACKUP" "$DEST"
    exit 1
  fi
fi

# Keep the previous bundle until the new app actually launches.
xattr -cr "$DEST" 2>/dev/null || true

echo "launching $DEST"
if ! open "$DEST"; then
  echo "open failed — restoring backup"
  rm -rf "$DEST" 2>/dev/null || true
  [ -d "$BACKUP" ] && mv "$BACKUP" "$DEST"
  exit 1
fi
echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) launched; backup kept at $BACKUP ===="
`;

  try {
    fs.writeFileSync(scriptPath, script, { encoding: "utf8", mode: 0o755 });
  } catch (err) {
    console.warn(
      "[auto-update] could not write update helper:",
      err?.message || err,
    );
    return false;
  }

  console.log(
    "[auto-update] mac manual install:",
    "zip=",
    zipPath,
    "app=",
    appPath,
    "log=",
    logPath,
  );

  try {
    const child = spawn(
      "/bin/bash",
      [scriptPath, logPath, String(process.pid), zipPath, appPath, expectedBundleId, expectedVersion, expectedArch],
      {
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    child.unref();
  } catch (err) {
    console.warn(
      "[auto-update] failed to spawn update helper:",
      err?.message || err,
    );
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
    return false;
  }

  return true;
}

/**
 * Install the downloaded update and relaunch.
 * Must run after the "Restart now" dialog has fully closed — calling
 * quitAndInstall synchronously in the dialog callback often no-ops on macOS.
 *
 * @param {import('electron-updater').AppUpdater} autoUpdater
 * @param {{ disposeAgent?: () => void | Promise<void> }} [hooks]
 */
export function installUpdateAndRelaunch(autoUpdater, hooks = {}) {
  if (quittingForUpdate) return;
  quittingForUpdate = true;
  console.log("[auto-update] installUpdateAndRelaunch starting");

  disposeHooks(hooks);

  // After a tick so the message box fully dismisses
  setTimeout(() => {
    if (process.platform === "darwin") {
      const ok = startMacManualInstall(autoUpdater);
      destroyAllWindows();
      if (!ok) {
        console.warn(
          "[auto-update] mac manual install unavailable — trying native quitAndInstall",
        );
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (err) {
          console.warn(
            "[auto-update] quitAndInstall failed:",
            err?.message || err,
          );
        }
        // Last resort: quit; user can re-open (autoInstallOnAppQuit) or use DMG
        forceExitSoon(2000);
        return;
      }
      // Helper is waiting on our PID — exit so it can replace the bundle
      forceExitSoon(400);
      return;
    }

    // Windows / Linux: electron-updater NSIS / AppImage path
    destroyAllWindows();
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
        console.log("[auto-update] quitAndInstall called");
      } catch (err) {
        console.warn(
          "[auto-update] quitAndInstall failed:",
          err?.message || err,
        );
      }
      forceExitSoon(4000);
    }, 150);
  }, 250);
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
  autoUpdater.autoInstallOnAppQuit = true;
  // Public GitHub repo — no token required for download.
  autoUpdater.allowPrerelease = allowPrereleasePref;

  autoUpdater.on("error", (err) => {
    busy = false;
    console.warn("[auto-update]", err?.message || err);
    if (suppressErrorDialog) return;
    const formatted = formatUpdateCheckError(err);
    void box({
      type: "warning",
      buttons: formatted.offerReleases ? ["OK", "Open Releases"] : ["OK"],
      defaultId: 0,
      cancelId: 0,
      title: formatted.title,
      message: formatted.message,
      detail: formatted.detail,
    }).then(({ response }) => {
      if (response === 1 && formatted.offerReleases) {
        import("electron").then(({ shell }) =>
          shell.openExternal(formatted.releasesUrl || UPDATE_RELEASES_URL),
        );
      }
    });
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
      installUpdateAndRelaunch(autoUpdater, hooks);
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
  suppressErrorDialog = true;
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
    const formatted = formatUpdateCheckError(err);
    console.warn("[auto-update] check failed:", err?.message || err);
    const buttons = formatted.offerReleases ? ["OK", "Open Releases"] : ["OK"];
    const { response } = await box({
      type: "warning",
      buttons,
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
    return {
      ok: false,
      reason: "error",
      error: err?.message || String(err),
      transient: formatted.transient,
    };
  } finally {
    suppressErrorDialog = false;
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
