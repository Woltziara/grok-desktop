import { createPreviewOwnership } from "./preview-ownership.mjs";
/**
 * Detachable Preview window (separate BrowserWindow + WebContentsView).
 * Lives on its own screen; not a column in the main GUI.
 *
 * Isolated session (no host-browser cookies). http(s) only.
 * persist:grok-preview keeps *this window's* logins across app restarts.
 * Do not point this partition at another browser's profile.
 */
import {
  dialog,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  screen,
  session,
  shell,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimateImageTokens,
  formatPreviewCapturePrompt,
  normalizePreviewUrl,
} from "./preview-url.mjs";
import { persistablePreviewUrl } from "../shared/preview-url.mjs";
import {
  formatPreviewSnapshot,
  PAGE_SNAPSHOT_SCRIPT,
} from "./preview-snapshot.mjs";
import { previewActionScript } from "./preview-interact.mjs";
import {
  PreviewNetworkLog,
  formatNetworkDump,
  ingestWebRequest,
} from "./preview-network.mjs";
import {
  bindPlaywrightNetwork,
  ensureGuestPage,
  bindGuestWebContents,
  getGuestPage,
  isPlaywrightGuestLive,
  pinGuestPage,
  runGuestAction,
  snapshotGuestPage,
  snapshotPlaywrightPages,
  unpinGuestPage,
} from "./preview-playwright.mjs";
import { debugLog } from "./debug-log.mjs";
import { errorFields, writeCrashLog } from "./crash-log.mjs";
import { shouldApplyDeviceEmulation } from "./preview-lifecycle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const VIEWPORTS = {
  fluid: { id: "fluid", label: "Fluid", width: 0, height: 0 },
  desktop: { id: "desktop", label: "1280×800", width: 1280, height: 800 },
  tablet: { id: "tablet", label: "768×1024", width: 768, height: 1024 },
  mobile: { id: "mobile", label: "390×844", width: 390, height: 844 },
};

const TOOLBAR_FALLBACK = 52;

/** Persistent Preview-only cookie jar. Not Edge, not the chat window. */
export const PREVIEW_PARTITION = "persist:grok-preview";

/** @type {import('electron').BrowserWindow | null} */
let previewWin = null;
/** @type {import('electron').WebContentsView | null} */
let guestView = null;
/** @type {((state: Record<string, unknown>) => void) | null} */
let persist = null;
/** @type {(() => Record<string, unknown>) | null} */
let readState = null;
/** @type {((payload: Record<string, unknown>) => void) | null} */
let broadcast = null;
/** Chat window that opened Preview — user screenshots go here, not MCP. */
/** @type {import('electron').BrowserWindow | null} */
let ownerWin = null;
const ownership = createPreviewOwnership();
let ownerSessionIdForWindow = () => null;
let openingPreview = null;
/** @type {((win: import('electron').BrowserWindow) => boolean) | null} */
let ownerHasProject = null;

let toolbarHeight = TOOLBAR_FALLBACK;
let sideWidth = 0;
let bottomHeight = 0;
let viewportId = "fluid";
let lastUrl = "about:blank";
let lastTitle = "";
let loading = false;
let ipcReady = false;

/** @type {PreviewNetworkLog} */
let networkLog = new PreviewNetworkLog();
let detachNetwork = () => {};
let networkHint = "";
/** @type {ReturnType<typeof setTimeout> | null} */
let netTimer = null;

function themeFromState() {
  const t = readState?.()?.theme;
  return t === "light" ? "light" : "dark";
}

function isLive() {
  return Boolean(previewWin && !previewWin.isDestroyed());
}

function guestWc() {
  if (!guestView) return null;
  const wc = guestView.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

function chromeWc() {
  if (!isLive()) return null;
  const wc = previewWin.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

export function getPreviewWindow() {
  return isLive() ? previewWin : null;
}

export function isPreviewOpen() {
  return isLive();
}

/**
 * Prefer a display that is not the owner window — that is the point.
 * @param {import('electron').BrowserWindow | null | undefined} owner
 * @param {unknown} saved
 */
export function preferredPreviewBounds(owner, saved) {
  const displays = screen.getAllDisplays();
  const savedBounds =
    saved &&
    typeof saved === "object" &&
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    Number(saved.width) >= 480 &&
    Number(saved.height) >= 360
      ? {
          x: Number(saved.x),
          y: Number(saved.y),
          width: Number(saved.width),
          height: Number(saved.height),
        }
      : null;

  if (savedBounds) {
    const hits = displays.some((d) => {
      const a = d.workArea;
      return (
        savedBounds.x + 40 < a.x + a.width &&
        savedBounds.x + savedBounds.width - 40 > a.x &&
        savedBounds.y + 40 < a.y + a.height &&
        savedBounds.y + savedBounds.height - 40 > a.y
      );
    });
    if (hits) return savedBounds;
  }

  const ownerBounds = owner && !owner.isDestroyed() ? owner.getBounds() : null;
  const ownerDisplay = ownerBounds
    ? screen.getDisplayMatching(ownerBounds)
    : screen.getPrimaryDisplay();
  const other = displays.find((d) => d.id !== ownerDisplay.id);
  const target = other || ownerDisplay;
  const wa = target.workArea;
  const width = Math.min(1180, Math.max(720, wa.width - 48));
  const height = Math.min(860, Math.max(520, wa.height - 48));
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height,
  };
}

function persistNow() {
  if (!persist || !isLive()) return;
  persist({
    previewBounds: previewWin.getBounds(),
    previewLastUrl: persistablePreviewUrl(lastUrl),
    previewViewport: viewportId,
  });
}

function emitChrome() {
  const payload = previewPublicState();
  try {
    chromeWc()?.send("preview:state", payload);
  } catch {
    /* chrome may be gone */
  }
  try {
    broadcast?.(payload);
  } catch {
    /* ignore */
  }
}

export function previewPublicState() {
  return {
    leaseId: ownership.get()?.leaseId || null,
    ownerSessionId: ownership.get()?.sessionId || null,
    open: isLive(),
    url: persistablePreviewUrl(lastUrl) || (lastUrl === "about:blank" ? "about:blank" : ""),
    title: lastTitle,
    viewport: viewportId,
    loading,
    aim: isPlaywrightGuestLive() ? "playwright" : "dom",
    canGoBack: Boolean(guestWc()?.navigationHistory?.canGoBack?.()),
    canGoForward: Boolean(guestWc()?.navigationHistory?.canGoForward?.()),
  };
}

function emitNetwork() {
  const payload = {
    ...networkLog.snapshot(),
    error: networkHint || "",
  };
  try {
    chromeWc()?.send("preview:network", payload);
  } catch {
    /* chrome may be gone */
  }
}

function emitNetworkSoon() {
  if (netTimer) return;
  netTimer = setTimeout(() => {
    netTimer = null;
    emitNetwork();
  }, 100);
}

function attachGuestLifecycle(wc) {
  const onDomReady = () => {
    if (networkLog.dclTs == null) networkLog.markDomContentLoaded();
    emitNetworkSoon();
  };
  const onFinish = () => {
    if (networkLog.loadTs == null) networkLog.markLoad();
    emitNetworkSoon();
  };
  wc.on("dom-ready", onDomReady);
  wc.on("did-finish-load", onFinish);
  return () => {
    wc.removeListener("dom-ready", onDomReady);
    wc.removeListener("did-finish-load", onFinish);
  };
}

/**
 * Prefer Playwright page events. Remote debugging occupies the Electron
 * debugger slot, so CDP attach here is best-effort; webRequest is the fallback.
 * @param {import('electron').WebContents} wc
 * @param {import('playwright-core').Page | null} [page]
 */
function attachGuestNetwork(wc, page = null) {
  detachNetwork();
  networkLog = new PreviewNetworkLog();
  networkHint = "";
  const detachLife = attachGuestLifecycle(wc);

  if (page && !page.isClosed()) {
    const detachPw = bindPlaywrightNetwork(page, networkLog, emitNetworkSoon);
    detachNetwork = () => {
      detachPw();
      detachLife();
      detachNetwork = () => {};
    };
    return;
  }

  const dbg = wc.debugger;
  const onMessage = (_event, method, params) => {
    networkLog.handleCdp(method, params);
    emitNetworkSoon();
  };
  const onDetach = (_event, reason) => {
    if (reason && reason !== "target closed" && reason !== "canceled") {
      attachWebRequestFallback(wc.session);
    }
    emitNetworkSoon();
  };
  try {
    if (!dbg.isAttached()) dbg.attach("1.3");
    dbg.on("message", onMessage);
    dbg.on("detach", onDetach);
    void dbg
      .sendCommand("Network.enable", { maxPostDataSize: 0 })
      .then(async () => {
        try {
          await dbg.sendCommand("Page.enable");
          await dbg.sendCommand("Page.setLifecycleEventsEnabled", {
            enabled: true,
          });
        } catch {
          /* Page events optional — did-finish-load is the fallback */
        }
      })
      .catch(() => {
        try {
          if (dbg.isAttached()) dbg.detach();
        } catch {
          /* ignore */
        }
        attachWebRequestFallback(wc.session);
        emitNetworkSoon();
      });
  } catch {
    attachWebRequestFallback(wc.session);
  }

  detachNetwork = () => {
    detachLife();
    detachWebRequest(wc.session);
    try {
      dbg.removeListener("message", onMessage);
    } catch {
      /* ignore */
    }
    try {
      dbg.removeListener("detach", onDetach);
    } catch {
      /* ignore */
    }
    try {
      if (dbg.isAttached()) dbg.detach();
    } catch {
      /* ignore */
    }
    detachNetwork = () => {};
  };
}

function attachWebRequestFallback(ses) {
  if (!ses?.webRequest) return;
  detachWebRequest(ses);
  ses.webRequest.onBeforeRequest((details, callback) => {
    try {
      ingestWebRequest(networkLog, "start", details);
      emitNetworkSoon();
    } finally {
      callback?.({});
    }
  });
  ses.webRequest.onCompleted((details) => {
    ingestWebRequest(networkLog, "done", details);
    emitNetworkSoon();
  });
  ses.webRequest.onErrorOccurred((details) => {
    ingestWebRequest(networkLog, "error", details);
    emitNetworkSoon();
  });
}

function detachWebRequest(ses) {
  try {
    ses?.webRequest.onBeforeRequest(null);
    ses?.webRequest.onCompleted(null);
    ses?.webRequest.onErrorOccurred(null);
  } catch {
    /* ignore */
  }
}

export function snapshotPreviewNetwork(opts = {}) {
  if (!guestWc()) throw new Error("Preview is not open");
  const snap = networkLog.snapshot();
  return {
    ...snap,
    text: formatNetworkDump(snap, opts),
    error: networkHint || "",
  };
}

function layoutGuest() {
  if (!isLive() || !guestView) return;
  const [cw, ch] = previewWin.getContentSize();
  const top = Math.max(36, toolbarHeight);
  const side = Math.max(0, Math.min(sideWidth, Math.floor(cw * 0.5)));
  const bottom = Math.max(0, Math.min(bottomHeight, Math.floor(ch * 0.72)));
  const availW = Math.max(0, cw - side);
  const availH = Math.max(0, ch - top - bottom);
  const spec = VIEWPORTS[viewportId] || VIEWPORTS.fluid;
  let x = 0;
  let y = top;
  let width = availW;
  let height = availH;
  if (spec.width && spec.height) {
    width = Math.min(spec.width, availW);
    height = Math.min(spec.height, availH);
    x = Math.max(0, Math.floor((availW - width) / 2));
    y = top + Math.max(0, Math.floor((availH - height) / 2));
  }
  if (width < 1 || height < 1) return;
  try {
    guestView.setBounds({ x, y, width, height });
  } catch {
    /* guest not attached yet */
  }
}

function applyViewport() {
  const wc = guestWc();
  const spec = VIEWPORTS[viewportId] || VIEWPORTS.fluid;
  const url = wc?.getURL?.() || lastUrl;
  // Chromium can crash when emulation is applied to the blank guest target.
  // Layout is still safe and lets chrome show immediately.
  if (wc && shouldApplyDeviceEmulation(url, spec)) {
    try {
      if (spec.width) {
        wc.enableDeviceEmulation({
          screenPosition: spec.id === "mobile" ? "mobile" : "desktop",
          screenSize: { width: spec.width, height: spec.height },
          viewSize: { width: spec.width, height: spec.height },
          deviceScaleFactor: spec.id === "mobile" ? 2 : 1,
          scale: 1,
        });
      }
    } catch {
      /* older Electron / empty guest */
    }
  }
  layoutGuest();
  emitChrome();
}

/**
 * @param {string} href
 */
async function loadGuest(href) {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const parsed = normalizePreviewUrl(href);
  if (!parsed.ok) throw new Error(parsed.error);
  const guard = lifetimeGuard();
  lastUrl = parsed.href;
  loading = true;
  emitChrome();
  await wc.loadURL(parsed.href);
  guard();
  // A first real navigation is the earliest safe point for device emulation.
  applyViewport();
}

function attachGuestHandlers(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    const parsed = normalizePreviewUrl(url);
    if (parsed.ok && parsed.href !== "about:blank") {
      void wc.loadURL(parsed.href);
    }
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    const parsed = normalizePreviewUrl(url);
    if (!parsed.ok) {
      event.preventDefault();
    }
  });
  wc.on("page-title-updated", (_e, title) => {
    if (guestWc() !== wc) return;
    lastTitle = title || "";
    if (isLive()) previewWin.setTitle(lastTitle ? `${lastTitle} · Preview` : "Preview · Grok");
    emitChrome();
  });
  wc.on("did-start-loading", () => {
    if (guestWc() !== wc) return;
    loading = true;
    emitChrome();
  });
  wc.on("did-stop-loading", () => {
    if (guestWc() !== wc) return;
    loading = false;
    lastUrl = wc.getURL() || lastUrl;
    lastTitle = wc.getTitle() || lastTitle;
    emitChrome();
  });
  wc.on("did-navigate", (_e, url) => {
    if (guestWc() !== wc) return;
    lastUrl = url || lastUrl;
    emitChrome();
  });
  wc.on("did-navigate-in-page", (_e, url) => {
    if (guestWc() !== wc) return;
    lastUrl = url || lastUrl;
    emitChrome();
  });
  wc.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    loading = false;
    lastUrl = url || lastUrl;
    emitChrome();
    void desc;
  });
}

function createGuest() {
  const ses = session.fromPartition(PREVIEW_PARTITION);
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
    },
  });
  view.setBackgroundColor("#111113");
  attachGuestHandlers(view.webContents);
  return view;
}

/**
 * @param {object} opts
 * @param {import('electron').BrowserWindow | null} [opts.owner]
 * @param {string} [opts.url]
 */
function ownerWindow() {
  if (ownerWin && !ownerWin.isDestroyed()) return ownerWin;
  return null;
}

export function assertPreviewOwner(win, sessionId, leaseId) {
  return ownership.assert(win, sessionId, leaseId);
}

function lifetimeGuard() {
  const lease = ownership.get();
  const win = previewWin;
  const wc = guestWc();
  return () => {
    if (!lease || ownership.get() !== lease || previewWin !== win || !isLive() || (wc && guestWc() !== wc)) {
      throw new Error("Preview closed or changed while the operation was running");
    }
  };
}

/** Only an explicit native user action may transfer an already owned Preview. */
export async function requestPreviewOpen(owner, sessionId, url = "") {
  if (!sessionId || ownerSessionIdForWindow(owner) !== sessionId) throw new Error("请先开始一段对话，再打开预览。");
  const previous = ownership.get();
  if (previous && (previous.windowId !== owner?.id || previous.sessionId !== sessionId)) {
    const choice = await dialog.showMessageBox(owner, { type: "question", title: "转交网页预览", message: "网页目前属于另一段对话。关闭当前预览并转交给这段对话？本站登录会保留。", buttons: ["保留原归属", "转交"], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return previewPublicState();
    if (ownerSessionIdForWindow(owner) !== sessionId) throw new Error("对话已切换，请重新打开预览。");
    if (ownership.get() !== previous) throw new Error("预览已变化，请重新打开。");
    closePreviewWindow();
  }
  return openPreviewWindow({ owner, sessionId, url });
}

export async function openPreviewWindow(opts = {}) {
  const owner = opts.owner || null;
  const sessionId = opts.sessionId || ownerSessionIdForWindow(owner);
  if (openingPreview) await openingPreview.catch(() => {});
  ownership.claim(owner, sessionId);
  ownerWin = owner;
  const opening = openOwnedPreview(opts);
  openingPreview = opening;
  try { return await opening; }
  catch (err) { if (ownerWin === owner && ownership.get()?.sessionId === sessionId) closePreviewWindow(); throw err; }
  finally { if (openingPreview === opening) openingPreview = null; }
}

async function openOwnedPreview(opts) {
  const owner = opts.owner;
  const state = readState?.() || {};
  viewportId = VIEWPORTS[state.previewViewport] ? state.previewViewport : "fluid";

  if (!isLive()) {
    const bounds = preferredPreviewBounds(owner, state.previewBounds);
    writeCrashLog("preview", "window-create", bounds);
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 520,
      minHeight: 400,
      title: "Preview · Grok",
      show: false,
      autoHideMenuBar: true,
      backgroundColor: themeFromState() === "light" ? "#faf7f2" : "#0c0c0f",
      webPreferences: {
        preload: path.join(__dirname, "preview", "preview-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    previewWin = win;
    const guard = lifetimeGuard();

    const persistSoon = debounce(persistNow, 250);
    win.on("resize", () => {
      layoutGuest();
      persistSoon();
    });
    win.on("move", persistSoon);
    win.on("closed", () => {
      if (previewWin !== win) return;
      writeCrashLog("preview", "window-closed");
      persistNow();
      detachNetwork();
      unpinGuestPage();
      if (netTimer) {
        clearTimeout(netTimer);
        netTimer = null;
      }
      if (previewWin !== win) return;
      ownership.release();
      const retiredGuest = guestView?.webContents;
      if (retiredGuest && !retiredGuest.isDestroyed()) retiredGuest.close({ waitForBeforeUnload: false });
      previewWin = null;
      guestView = null;
      ownerWin = null;
      lastTitle = "";
      lastUrl = "about:blank";
      loading = false;
      networkLog = new PreviewNetworkLog();
      networkHint = "";
      bottomHeight = 0;
      emitChrome();
      try {
        broadcast?.(previewPublicState());
      } catch {
        /* ignore */
      }
    });

    const chromeFile = path.join(__dirname, "preview", "index.html");
    try {
      writeCrashLog("preview", "chrome-load");
      await win.loadFile(chromeFile, { query: { theme: themeFromState() } });
      guard();
      // HWND must exist before WebContentsView attach — add-then-show can AV.
      win.show();
      win.focus();
      writeCrashLog("preview", "chrome-shown");
    } catch (err) {
      writeCrashLog("preview", "chrome-load-failed", errorFields(err));
      throw err;
    }
    /** @type {import('playwright-core').Page[] | null} */
    let knownPages = null;
    try {
      knownPages = await snapshotPlaywrightPages();
    } catch (err) {
      networkHint = `Playwright attach failed (${err?.message || err}). Using DOM fallback.`;
      debugLog("preview", "playwright-connect-failed", {
        error: err?.message || String(err),
      });
    }
    guard();
    guestView = createGuest();
    writeCrashLog("preview", "guest-created");
    win.contentView.addChildView(guestView);
    layoutGuest();
    writeCrashLog("preview", "guest-attached");
    const currentGuest = guestView.webContents;
    // Establish a real blank document before executeJavaScript can wait on it.
    await currentGuest.loadURL("about:blank");
    guard();
    const guestToken = `gp-${Date.now().toString(36)}`;
    const stampGuest = () => {
      const wc = currentGuest;
      if (!wc || wc.isDestroyed()) return Promise.resolve();
      return wc
        .executeJavaScript(
          `window.__GROK_PREVIEW_GUEST=${JSON.stringify(guestToken)}`,
        )
        .catch(() => {});
    };
    await stampGuest();
    guard();
    guestView.webContents.on("dom-ready", () => {
      void stampGuest();
    });
    let guestPage = null;
    if (knownPages) {
      try {
        guestPage = await pinGuestPage(knownPages, async (page) => {
          const mark = await page.evaluate(
            () => window.__GROK_PREVIEW_GUEST,
          );
          return mark === guestToken;
        });
        debugLog("preview", "playwright-pinned", { url: guestPage.url() });
      } catch (err) {
        networkHint =
          networkHint ||
          `Playwright pin failed (${err?.message || err}). Using DOM fallback.`;
        debugLog("preview", "playwright-pin-failed", {
          error: err?.message || String(err),
        });
      }
    }
    guard();
    if (guestPage) bindGuestWebContents(currentGuest, guestPage);
    const guestWcRef = guestView.webContents;
    // Network/debugger attaches after the native window and guest target exist.
    setImmediate(() => {
      try {
        if (!isLive() || guestWc() !== guestWcRef || guestWcRef.isDestroyed()) return;
        attachGuestNetwork(guestWcRef, guestPage);
        writeCrashLog("preview", "guest-network-attached");
      } catch (err) {
        writeCrashLog("preview", "guest-network-failed", errorFields(err));
      }
    });
  } else {
    if (previewWin.isMinimized()) previewWin.restore();
    previewWin.show();
    previewWin.focus();
  }

  // applyViewport lays out the guest but deliberately skips emulation at blank.
  applyViewport();

  const wanted =
    opts.url ||
    (lastUrl && lastUrl !== "about:blank" ? lastUrl : "") ||
    state.previewLastUrl ||
    "";
  if (wanted) {
    const parsed = normalizePreviewUrl(wanted);
    if (parsed.ok && parsed.href !== "about:blank") {
      try {
        writeCrashLog("preview", "guest-load", { url: parsed.href });
        await loadGuest(parsed.href);
      } catch (err) {
        writeCrashLog("preview", "guest-load-failed", errorFields(err));
        throw err;
      }
    }
  } else {
    emitChrome();
  }

  return previewPublicState();
}

export function closePreviewWindow() {
  ownership.release();
  if (!isLive()) return false;
  persistNow();
  previewWin.close();
  return true;
}

export function applyPreviewTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  try {
    chromeWc()?.send("preview:theme", t);
  } catch {
    /* ignore */
  }
  if (isLive()) {
    previewWin.setBackgroundColor(t === "light" ? "#f3f3f7" : "#0c0c0f");
  }
}

export function setPreviewViewport(id) {
  viewportId = VIEWPORTS[id] ? id : "fluid";
  applyViewport();
  persistNow();
  return previewPublicState();
}

export async function navigatePreview(rawUrl) {
  if (!isLive()) {
    throw new Error("Preview is not open");
  }
  const guard = lifetimeGuard();
  await loadGuest(rawUrl);
  guard();
  return previewPublicState();
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until the guest stops loading. No extra delay when already idle. */
export async function waitForPreviewSettled(timeoutMs = 8000) {
  if (!loading) return;
  const start = Date.now();
  while (loading && Date.now() - start < timeoutMs) {
    await waitMs(50);
  }
}

export async function snapshotPreview() {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const guard = lifetimeGuard();
  await waitForPreviewSettled();
  guard();
  await ensureGuestPage(wc);
  guard();
  if (getGuestPage()) {
    try {
      const raw = await snapshotGuestPage();
      guard();
      const text = formatPreviewSnapshot({
        url: raw.url || lastUrl,
        title: raw.title || lastTitle,
        yaml: raw.yaml,
        engine: "playwright",
      });
      return {
        text,
        url: raw.url || lastUrl,
        title: raw.title || lastTitle,
        chars: text.length,
        engine: "playwright",
      };
    } catch (err) {
      debugLog("preview", "playwright-snapshot-failed", {
        error: err?.message || String(err),
      });
    }
  }
  const raw = await wc.executeJavaScript(PAGE_SNAPSHOT_SCRIPT, true);
  guard();
  const text = formatPreviewSnapshot(raw || {});
  return {
    text,
    url: raw?.url || lastUrl,
    title: raw?.title || lastTitle,
    chars: text.length,
    engine: "dom",
  };
}

/**
 * @param {{ action?: string, ref?: string, selector?: string, name?: string, text?: string, value?: string, key?: string, x?: number, y?: number }} action
 */
export async function runPreviewAction(action) {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const act = action && typeof action === "object" ? action : {};
  const guard = lifetimeGuard();
  await ensureGuestPage(wc);
  guard();
  if (getGuestPage()) {
    try {
      const result = await runGuestAction(act, getGuestPage());
      guard();
      if (result && result.ok === false) {
        const err = new Error(result.error || "Preview action failed");
        err.detail = result;
        throw err;
      }
      return result || { ok: true, engine: "playwright" };
    } catch (err) {
      if (getGuestPage()) throw err;
    }
  }
  guard();
  const result = await wc.executeJavaScript(previewActionScript(act), true);
  guard();
  if (String(act.action || "") === "press") {
    const key = String(act.key || "Enter");
    const keyCode = key === "Enter" ? "Return" : key;
    try {
      wc.sendInputEvent({ type: "keyDown", keyCode });
      wc.sendInputEvent({ type: "char", keyCode: key === "Enter" ? "\u000d" : key });
      wc.sendInputEvent({ type: "keyUp", keyCode });
    } catch {
      /* guest may not accept synthetic keys */
    }
  }
  if (result && result.ok === false) {
    const err = new Error(result.error || "Preview action failed");
    err.detail = result;
    throw err;
  }
  return result || { ok: true };
}

/**
 * Capture the viewport and deliver it to the owning chat window.
 * The agent cannot do this itself — the human presses Send screenshot.
 */
export async function sendPreviewCaptureToChat() {
  const owner = ownerWindow();
  if (!owner?.webContents || owner.webContents.isDestroyed()) {
    throw new Error("Open a project chat first, then send the screenshot.");
  }
  if (ownerHasProject && !ownerHasProject(owner)) {
    throw new Error("Open a project chat first, then send the screenshot.");
  }
  const lease = ownership.get();
  const guard = lifetimeGuard();
  if (ownerSessionIdForWindow(owner) !== lease?.sessionId) throw new Error("请返回打开此网页的原对话，再发送截图。网页仍为原对话保留。");
  const shot = await screenshotPreview();
  guard();
  if (ownerSessionIdForWindow(owner) !== lease.sessionId) throw new Error("对话已切换，截图没有发送。请回到原对话重试。");
  const payload = {
    sessionId: lease.sessionId,
    leaseId: lease.leaseId,
    data: shot.data,
    mimeType: shot.mimeType,
    width: shot.width,
    height: shot.height,
    bytes: shot.bytes,
    tokens: shot.tokens,
    url: persistablePreviewUrl(lastUrl) || lastUrl,
    title: lastTitle,
    text: formatPreviewCapturePrompt({ url: persistablePreviewUrl(lastUrl) || lastUrl, title: lastTitle }),
  };
  owner.webContents.send("preview:viewport-capture", payload);
  return {
    sent: true,
    width: shot.width,
    height: shot.height,
    bytes: shot.bytes,
    tokens: shot.tokens,
  };
}

export async function screenshotPreview() {
  const wc = guestWc();
  if (!wc) throw new Error("Preview is not open");
  const guard = lifetimeGuard();
  const image = await wc.capturePage();
  guard();
  const size = image.getSize();
  const maxW = 1280;
  const resized =
    size.width > maxW
      ? image.resize({ width: maxW, quality: "good" })
      : image;
  const jpeg = resized.toJPEG(62);
  const out = resized.getSize();
  return {
    mimeType: "image/jpeg",
    data: jpeg.toString("base64"),
    bytes: jpeg.length,
    width: out.width,
    height: out.height,
    tokens: estimateImageTokens(out.width, out.height),
  };
}

function fromChrome(event) {
  const wc = event?.sender;
  return Boolean(isLive() && wc && wc === previewWin.webContents);
}

function debounce(fn, ms) {
  let t = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

/**
 * @param {object} hooks
 * @param {() => Record<string, unknown>} hooks.loadState
 * @param {(patch: Record<string, unknown>) => void} hooks.savePatch
 * @param {() => import('electron').BrowserWindow | null} hooks.getOwner
 * @param {(state: Record<string, unknown>) => void} hooks.broadcast
 * @param {(win: import('electron').BrowserWindow) => boolean} [hooks.ownerHasProject]
 */
export function registerPreviewIpc(hooks) {
  if (ipcReady) return;
  ipcReady = true;
  readState = hooks.loadState;
  ownerSessionIdForWindow = hooks.getOwnerSessionId || (() => null);
  persist = (patch) => hooks.savePatch(patch);
  broadcast = hooks.broadcast;
  ownerHasProject =
    typeof hooks.ownerHasProject === "function" ? hooks.ownerHasProject : null;

  ipcMain.handle("preview:open", async (e, opts = {}) => {
    const owner =
      hooks.getOwner(e) ||
      BrowserWindow.fromWebContents(e.sender) ||
      null;
    return requestPreviewOpen(owner, ownerSessionIdForWindow(owner), typeof opts?.url === "string" ? opts.url : "");
  });

  const checkSender = e => { const owner = hooks.getOwner(e); return assertPreviewOwner(owner, ownerSessionIdForWindow(owner)); };
  ipcMain.handle("preview:close", async e => { checkSender(e); return closePreviewWindow(); });

  ipcMain.handle("preview:state", async e => {
    const state = previewPublicState();
    try { checkSender(e); return state; }
    catch { return { open: false, url: "", title: "", viewport: state.viewport, loading: false, ownedElsewhere: state.open }; }
  });

  ipcMain.handle("preview:navigate", async (e, url) => { checkSender(e); return navigatePreview(url); });

  ipcMain.handle("preview:snapshot", async e => { checkSender(e); return snapshotPreview(); });

  ipcMain.handle("preview:set-viewport", async (e, id) => {
    checkSender(e);
    viewportId = VIEWPORTS[id] ? id : "fluid";
    applyViewport();
    persistNow();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-ready", async (e, payload) => {
    if (!fromChrome(e)) return previewPublicState();
    const height =
      typeof payload === "number" ? payload : Number(payload?.height);
    const side =
      typeof payload === "object" && payload
        ? Number(payload.side)
        : 0;
    if (Number.isFinite(height) && height > 24) toolbarHeight = height;
    sideWidth = Number.isFinite(side) && side > 0 ? side : 0;
    const bottom =
      typeof payload === "object" && payload ? Number(payload.bottom) : 0;
    bottomHeight = Number.isFinite(bottom) && bottom > 0 ? bottom : 0;
    layoutGuest();
    emitChrome();
    emitNetwork();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-navigate", async (e, url) => {
    if (!fromChrome(e)) throw new Error("Preview chrome only");
    return navigatePreview(url);
  });

  ipcMain.handle("preview:chrome-back", async (e) => {
    if (!fromChrome(e)) return previewPublicState();
    const wc = guestWc();
    if (wc?.navigationHistory?.canGoBack?.()) wc.navigationHistory.goBack();
    else if (wc?.canGoBack?.()) wc.goBack();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-forward", async (e) => {
    if (!fromChrome(e)) return previewPublicState();
    const wc = guestWc();
    if (wc?.navigationHistory?.canGoForward?.()) wc.navigationHistory.goForward();
    else if (wc?.canGoForward?.()) wc.goForward();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-reload", async (e) => {
    if (!fromChrome(e)) return previewPublicState();
    guestWc()?.reload();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-viewport", async (e, id) => {
    if (!fromChrome(e)) return previewPublicState();
    viewportId = VIEWPORTS[id] ? id : "fluid";
    applyViewport();
    persistNow();
    return previewPublicState();
  });

  ipcMain.handle("preview:chrome-snapshot", async (e) => {
    if (!fromChrome(e)) throw new Error("Preview chrome only");
    return snapshotPreview();
  });

  ipcMain.handle("preview:chrome-screenshot", async (e) => {
    if (!fromChrome(e)) throw new Error("Preview chrome only");
    return sendPreviewCaptureToChat();
  });

  ipcMain.handle("preview:chrome-open-external", async (e) => {
    if (!fromChrome(e)) return false;
    const href = lastUrl;
    const parsed = normalizePreviewUrl(href);
    if (!parsed.ok || parsed.href === "about:blank") return false;
    await shell.openExternal(parsed.href);
    return true;
  });

  ipcMain.handle("preview:chrome-network", async (e) => {
    if (!fromChrome(e)) return { rows: [], error: "Preview chrome only" };
    return { ...networkLog.snapshot(), error: networkHint || "" };
  });

  ipcMain.handle("preview:chrome-network-entry", async (e, id) => {
    if (!fromChrome(e)) return null;
    return networkLog.detail(String(id || ""));
  });

  ipcMain.handle("preview:chrome-network-clear", async (e) => {
    if (!fromChrome(e)) return { rows: [], error: "Preview chrome only" };
    networkLog.clear();
    const payload = { ...networkLog.snapshot(), error: networkHint || "" };
    emitNetwork();
    return payload;
  });

  ipcMain.handle("preview:chrome-network-preserve", async (e, on) => {
    if (!fromChrome(e)) return false;
    networkLog.setPreserveLog(Boolean(on));
    return networkLog.preserveLog;
  });
}
