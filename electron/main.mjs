import { assertContinuationSettled } from './continuation-pack.mjs';
import { registerKnowledgeTransferIpc } from "./knowledge-transfer-ipc.mjs";
import { createSessionDelivery, notifySessionDelivery } from "./session-delivery.mjs";
import { registerDeliveryIpc } from "./delivery-ipc.mjs";
import { captureBrowserReference, validateBrowserReference } from "./browser-reference.mjs";
import { resolveMovedSessionCwd } from "./session-move.mjs";
import { moveSessionFiles, withSessionMove, movableSessionClients, readSessionMoves, recoverSessionMoves } from "./session-move.mjs";
import { applyWindowAgentAccess } from "./agent-access.mjs";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  dialog,
  shell,
  Menu,
  Notification,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { attachContextMenu } from "./context-menu.mjs";
import {
  cancelLogin,
  getAuthStatus,
  isRemoteLoginUrl,
  setSessionApiKey,
  startLogin,
  startLogout,
  submitLoginInput,
} from "./auth.mjs";
import { mergeRestartResult } from "./agent-restart.mjs";
import { inspectBackbone } from "./backbone.mjs";
import { resolveGrokBinary, grokHomeDir } from "./grok-home.mjs";
import { readModelContextWindows } from "./models-cache.mjs";
import {
  addMcpServer,
  checkGrokUpdate,
  disableMcpServer,
  disablePlugin,
  doctorMcp,
  enableMcpServer,
  enablePlugin,
  getGrokEngine,
  installGrokUpdate,
  installPlugin,
  listMcpServers,
  listPlugins,
  logoutMcpServer,
  removeMcpServer,
} from "./grok-cli.mjs";
import {
  setupAutoUpdater,
  checkForUpdatesInteractive,
  isQuittingForUpdate,
  setAllowPrerelease,
} from "./auto-update.mjs";
import {
  asarPathFromExec,
  bundlePathFromExec,
  isPackNewerThanLaunch,
} from "../shared/stale-bundle.mjs";
import {
  listSessionsForCwd,
  listSessionsForCwds,
  loadSessionOpenState,
  mostRecentSession,
  renameSessionOnDisk,
  deleteSessionOnDisk,
  sanitizeSessionTitle,
  MAX_SESSION_TITLE_LENGTH,
} from "./sessions.mjs";
import {
  ATTACH_DIALOG_FILTERS,
  importAttachmentFile,
} from "./attachments.mjs";
import { nextRecentProjects } from "../shared/recent-projects.mjs";
import {
  listPendingPermissionRequests,
  setOnEnableAlwaysApprove,
  settlePendingAllowOnce,
  settlePermission,
} from "./pending-permissions.mjs";
import {
  ensureCodingDataDefaultOptIn,
  getCodingDataStatus,
  setCodingDataOptIn,
} from "./coding-data.mjs";
import {
  deleteMemoryEntry,
  getMemoryEnabled,
  listMemoryEntries,
  setMemoryEnabled,
} from "./memory.mjs";
import {
  armWorkingKnowledgeProbe,
  correctWorkingKnowledge,
  setWorkingKnowledgeEnabled,
  setWorkingKnowledgeObject,
  snapshotWorkingKnowledge,
  withdrawWorkingKnowledge,
} from "./working-knowledge.mjs";
import {
  activateAccount,
  listAccountSnapshots,
  saveCurrentSnapshot,
} from "./account-auth.mjs";
import { exportApplicationCandidate } from "./peer-sync.mjs";
import { readBuildIdentity } from "./build-identity.mjs";
import { registerContinuationIpc } from "./continuation-ipc.mjs";
import { remainingFromBilling } from "../shared/billing-display.mjs";
import {
  exportFilename,
  timelineToMarkdown,
} from "../shared/export-transcript.mjs";
import { assertPathInProject, isPathInProject } from "./path-safety.mjs";
import { readFileForEdit, writeFileForEdit } from "./fs-content.mjs";
import {
  listEditors,
  normalizeExternalEditor,
  openInEditor,
} from "./open-editor.mjs";
import {
  APP_WINDOW_TITLE,
  applyPermissionModeToAllWindows,
  broadcastOpenCheckouts,
  broadcastPermissionMode,
  syncPermissionModeLiveToAllWindows,
  clearPendingPermissions,
  clearProjectOnWindow,
  collectOpenCheckouts,
  createWindowSession,
  disposeAgentQuick,
  focusedSession,
  openSessionOnWindow,
  ownerIdFor,
  restartAgentOnWindow,
  send,
  sessionFromEvent,
  agentForSession,
  anyAgent,
  setDesktopStateLoader,
  setWindowChromeListener,
  windowSessions,
  listLiveTurnSessionIds,
} from "./window-session.mjs";
import {
  menuListsOpenWindows,
  windowCycleKind,
  windowListMenuItems,
} from "./window-menu.mjs";
import {
  agentForWorktreeRpc,
  commitFamilyAfterOpen,
  configureDesktopInstance,
  createAcpWorktree,
  inspectProjectCheckout,
  isPrimaryDesktopInstance,
  planProjectOpen,
  resolveWorktreeCreateCwd,
  wireSecondInstance,
  wireWorktreePathGate,
} from "./desktop-worktrees.mjs";
import {
  maybeWarmDockerSandbox,
  probeSandbox,
  sandboxStatusLabel,
} from "./terminal-sandbox.mjs";
import { normalizePermissionMode } from "./permission-mode.mjs";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
} from "./reasoning-effort.mjs";
import { getGitBranch, getGitDiff, getGitStatus } from "./git-info.mjs";
import {
  debugLog,
  getDebugLogPath,
  isDebugLogging,
  setDebugLogging,
} from "./debug-log.mjs";
import {
  applyPreviewTheme,
  getPreviewWindow,
  openPreviewWindow,
  previewPublicState,
  requestPreviewOpen,
  registerPreviewIpc,
  snapshotPreview,
} from "./preview-window.mjs";
import { snapshotStage, WEB_PRO_URL } from "./web-pro-page.mjs";
import { previewApiAddress, startPreviewApi } from "./preview-api.mjs";
import { installDesktopPreviewSkill } from "./preview-mcp.mjs";
import { enablePreviewRemoteDebugging } from "./preview-cdp.mjs";
import { installCrashLogging } from "./crash-log.mjs";
import { listParked, settleParked } from "./parked-request.mjs";
import {
  artifactHref,
  ensureArtifactServer,
  stopArtifactServer,
} from "./artifact-preview.mjs";
import { normalizeAutoCompactAt } from "../shared/auto-compact.mjs";
import { mergeMcpLiveStatus } from "../shared/mcp-status.mjs";
import {
  bootBackground,
  closeSplash,
  createSplashWindow,
} from "./splash.mjs";

// An explicit profile is a separate instance, including its browser storage and
// working knowledge. Apply it before stores, logging, or the instance lock.
const launchProject = app.commandLine.getSwitchValue("project");
const launchPreviewUrl = app.commandLine.getSwitchValue("open-preview");
const launchHandoffPrompt = app.commandLine.getSwitchValue("handoff-prompt");
let launchPreviewStarted = false;
const explicitUserData = app.commandLine.getSwitchValue("user-data-dir");
if (explicitUserData) {
  if (!path.isAbsolute(explicitUserData)) {
    throw new Error("--user-data-dir must be an absolute path");
  }
  fs.mkdirSync(explicitUserData, { recursive: true });
  app.setPath("userData", explicitUserData);
  app.setPath("sessionData", explicitUserData);
  process.env.GROK_DESKTOP_WK_ROOT ||= path.join(explicitUserData, "working-knowledge");
}
installCrashLogging();
enablePreviewRemoteDebugging();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const launchedAt = Date.now();
let launchedBundleMtime = 0;
let launchedAsarMtime = 0;
try {
  launchedBundleMtime = fs.statSync(
    bundlePathFromExec(process.execPath, process.platform),
  ).mtimeMs;
} catch {
  launchedBundleMtime = 0;
}
try {
  const asar = asarPathFromExec(process.execPath, process.platform);
  if (asar) launchedAsarMtime = fs.statSync(asar).mtimeMs;
} catch {
  launchedAsarMtime = 0;
}

function currentMtimes() {
  const bundle = bundlePathFromExec(process.execPath, process.platform);
  const asar = asarPathFromExec(process.execPath, process.platform);
  const now = [];
  const then = [];
  try {
    now.push(fs.statSync(bundle).mtimeMs);
    then.push(launchedBundleMtime);
  } catch {
    /* ignore */
  }
  if (asar) {
    try {
      now.push(fs.statSync(asar).mtimeMs);
      then.push(launchedAsarMtime);
    } catch {
      /* ignore */
    }
  }
  return { now, then };
}

function currentBundleStale() {
  if (isDev) return false;
  const { now, then } = currentMtimes();
  return isPackNewerThanLaunch(now, then);
}

/** File → Quit / Cmd+Q. Window X does not set this (Settings can swallow that). */
let appQuitting = false;

const storePath = path.join(app.getPath("userData"), "desktop-state.json");

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const merged = {
      recentProjects: [],
      /** @deprecated migrated into permissionMode */
      alwaysApprove: false,
      /** ask | auto | always-approve */
      permissionMode: "ask",
      /**
       * Reasoning effort for models that support it (`/effort`).
       * low | medium | high | xhigh — default high (matches grok-4.5 menu).
       */
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      /** When false (default), agent FS + terminal cwd cannot leave project root */
      allowOutsideProject: false,
      /**
       * When true (default), ACP tool shells run in an OS FS jail
       * (Seatbelt / bwrap / WSL+bwrap / Docker). Independent of allowOutside.
       */
      sandboxTerminal: true,
      /** UI theme: "dark" | "light" */
      theme: "light",
      /**
       * When true, display-only: hide $HOME prefixes (→ ~) in the UI for
       * screenshots / demos. Does not change agent paths or disk.
       */
      privacyMode: false,
      /** Write diagnostic JSONL to userData/desktop-debug.log */
      debugLogging: false,
      /**
       * When true, Help → Check for updates includes GitHub prereleases
       * (vX.Y.Z-beta.N). Default off — team installers stay on stable.
       */
      allowPrerelease: false,
      /**
       * External editor for Files / Changes.
       * auto | cursor | code | code-insiders | zed | windsurf | subl | codium
       * | textedit | notepad
       */
      externalEditor: "auto",
      /**
       * Call the agent compact API when last context size passes this mark.
       * off | 64k | 128k | 192k
       */
      autoCompactAt: "off",
      lastPeerSyncAt: null,
      lastProject: null,
      ...raw,
    };
    // One-time migrate legacy alwaysApprove bool → permissionMode
    merged.permissionMode = normalizePermissionMode(
      merged.permissionMode,
      Boolean(merged.alwaysApprove),
    );
    delete merged.alwaysApprove;
    merged.privacyMode = Boolean(merged.privacyMode);
    merged.reasoningEffort = normalizeReasoningEffort(merged.reasoningEffort);
    merged.debugLogging = Boolean(merged.debugLogging);
    merged.allowPrerelease = Boolean(merged.allowPrerelease);
    merged.externalEditor = normalizeExternalEditor(merged.externalEditor);
    merged.autoCompactAt = normalizeAutoCompactAt(merged.autoCompactAt);
    delete merged.worktreeSources;
    return merged;
  } catch {
    return {
      permissionMode: "ask",
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      allowOutsideProject: false,
      sandboxTerminal: true,
      theme: "light",
      privacyMode: false,
      debugLogging: false,
      allowPrerelease: false,
      externalEditor: "auto",
      autoCompactAt: "off",
      lastPeerSyncAt: null,
      lastProject: null,
      recentProjects: [],
    };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(state, null, 2));
}

function rememberRecentProject(cwd) {
  if (!cwd) return loadState().recentProjects || [];
  const state = loadState();
  state.recentProjects = nextRecentProjects(state.recentProjects, cwd);
  saveState(state);
  return state.recentProjects;
}

function rememberProjectSession(cwd, sessionId) {
  if (!cwd || !sessionId) return;
  const state = loadState();
  state.lastProject = cwd;
  state.recentProjects = nextRecentProjects(state.recentProjects, cwd);
  state.sessionsByProject = state.sessionsByProject || {};
  state.sessionsByProject[cwd] = sessionId;
  saveState(state);
}

function openPreviewFromMenu() {
  const ws = focusedSession();
  const owner = ws?.win && !ws.win.isDestroyed() ? ws.win : null;
  return requestPreviewOpen(owner, ws?.agent?.sessionId);
}

function openSettingsFromMenu() {
  const ws = focusedSession();
  if (ws?.win && !ws.win.isDestroyed()) {
    ws.win.show();
    ws.win.focus();
    send(ws, "app:open-settings");
  }
}

/** Project cwd for grok mcp --scope project (user scope still works without). */
function mcpCwdFromEvent(e) {
  const ws = sessionFromEvent(e);
  if (!ws) return undefined;
  const cwd = ws.agent?.cwd || ws.lastCwd;
  return cwd || undefined;
}

/** @param {unknown} err */
function mcpIpcError(err) {
  const message =
    err && typeof err === "object" && "message" in err
      ? String(/** @type {{ message?: unknown }} */ (err).message || err)
      : String(err || "CLI command failed");
  return {
    ok: false,
    data: null,
    stdout: "",
    stderr: message,
    code: null,
    error: message,
  };
}

/**
 * Show a window; take key focus only while this app is still frontmost
 * (macOS menu tracking restores the previous key window after the click).
 * @param {import('electron').BrowserWindow} win
 */
function focusWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    if (process.platform === "darwin" && !app.isActive()) return;
    if (win.isFocused()) return;
    win.moveTop();
    win.focus();
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }
  } catch {
    /* window may have closed mid-focus */
  }
}

function newWindowFromMenu() {
  // Keep the shell hidden until the renderer paints — do not show a blank frame.
  createWindow();
}

/**
 * App shell windows only (not detached DevTools).
 * @returns {import('electron').BrowserWindow[]}
 */
function appShellWindows() {
  const shells = [...windowSessions.values()]
    .map((ws) => ws.win)
    .filter((w) => w && !w.isDestroyed());
  const preview = getPreviewWindow();
  if (preview && !preview.isDestroyed()) shells.push(preview);
  return shells;
}

/**
 * Cycle focus among Grok Desktop windows.
 * macOS: Cmd+Tab is *apps*; same-app windows are Cmd+` (standard) —
 * Electron does not always wire that, so we handle it ourselves.
 * @param {1 | -1} [dir]
 */
function cycleAppWindows(dir = 1) {
  const wins = appShellWindows().sort((a, b) => a.id - b.id);
  if (wins.length < 2) return;
  const focused = BrowserWindow.getFocusedWindow();
  let idx = wins.findIndex((w) => w === focused);
  if (idx < 0) idx = 0;
  const next = wins[(idx + dir + wins.length) % wins.length];
  focusWindow(next);
}

/**
 * Standard app menu with Edit roles.
 * Without role-based Cut/Copy/Paste/Select All, Cmd/Ctrl+V often does nothing
 * in packaged Electron apps (macOS especially).
 * Win/Linux rebuild the Window menu when shells open/close/title/focus.
 */
let menuRebuildTimer = null;
function scheduleApplicationMenu() {
  if (!menuListsOpenWindows()) return;
  if (menuRebuildTimer != null) return;
  menuRebuildTimer = setTimeout(() => {
    menuRebuildTimer = null;
    installApplicationMenu();
  }, 40);
}

function wireWindowMenuRefresh() {
  if (!menuListsOpenWindows()) return;
  setWindowChromeListener(scheduleApplicationMenu);
  app.on("browser-window-created", (_e, win) => {
    scheduleApplicationMenu();
    win.on("closed", () => scheduleApplicationMenu());
    win.on("focus", () => scheduleApplicationMenu());
    win.on("page-title-updated", () => scheduleApplicationMenu());
  });
}

function installApplicationMenu() {
  const isMac = process.platform === "darwin";
  const cycleKind = windowCycleKind();
  /** @type {import('electron').MenuItemConstructorOptions} */
  const settingsItem = {
    label: "Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => openSettingsFromMenu(),
  };
  /**
   * Fresh object each time — do not reuse one MenuItem options object in
   * multiple menus (Electron can mis-wire accelerators / click handlers).
   * Accelerator only once so Cmd/Ctrl+N does not fire createWindow thrice.
   * @param {{ accelerator?: string }} [opts]
   * @returns {import('electron').MenuItemConstructorOptions}
   */
  const newWindowItem = (opts = {}) => ({
    label: "New Window",
    ...(opts.accelerator ? { accelerator: opts.accelerator } : {}),
    click: () => newWindowFromMenu(),
  });
  const newWorktreeItem = () => ({
    label: "New Worktree Window…",
    click: () => {
      const ws = focusedSession();
      if (!ws) return;
      send(ws, "app:new-worktree");
    },
  });
  const listedWindows = menuListsOpenWindows()
    ? windowListMenuItems(
        appShellWindows()
          .sort((a, b) => a.id - b.id)
          .map((w) => ({
            id: w.id,
            title: w.getTitle() || APP_WINDOW_TITLE,
            focused: w.isFocused(),
          })),
        (id) => {
          const target = BrowserWindow.fromId(id);
          if (target) focusWindow(target);
        },
      )
    : [];
  /** @type {import('electron').MenuItemConstructorOptions[]} */
  // macOS menu bar (left → right): App name | File | Edit | View | Window | Help
  // Packaged builds only pick this up after rebuild — Dock/Applications is NOT live source.
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              // Most discoverable place on Mac (same row as Settings)
              newWindowItem(),
              newWorktreeItem(),
              settingsItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        newWindowItem({ accelerator: "CmdOrCtrl+N" }),
        newWorktreeItem(),
        { type: "separator" },
        ...(isMac ? [] : [settingsItem, { type: "separator" }]),
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find…",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            const ws = focusedSession();
            if (ws) send(ws, "app:find");
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Preview Window",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => {
            void openPreviewFromMenu();
          },
        },
      ],
    },
    {
      // role: "window" marks this as the macOS Window menu so the OS appends
      // the open-window list (by title). Nested role:"window" was a leaf item
      // literally labeled "Window" and is not needed.
      // Windows / Linux: Electron does not append that list — we add radio
      // items from appShellWindows() and rebuild when shells change.
      label: "Window",
      role: "window",
      submenu: [
        newWindowItem(),
        newWorktreeItem(),
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
        ...(cycleKind === "cmd-backtick"
          ? [
              { type: "separator" },
              // Cmd+Tab = apps. Same-app windows = Cmd+` (Mac standard).
              {
                label: "Cycle Through Windows",
                accelerator: "Cmd+`",
                click: () => cycleAppWindows(1),
              },
              {
                label: "Cycle Through Windows (Reverse)",
                accelerator: "Cmd+Shift+`",
                click: () => cycleAppWindows(-1),
              },
              { type: "separator" },
              { role: "front" },
            ]
          : cycleKind === "ctrl-tab"
            ? [
                {
                  label: "Next Window",
                  accelerator: "Ctrl+Tab",
                  click: () => cycleAppWindows(1),
                },
                {
                  label: "Previous Window",
                  accelerator: "Ctrl+Shift+Tab",
                  click: () => cycleAppWindows(-1),
                },
                { role: "close" },
              ]
            : [{ role: "close" }]),
        ...(listedWindows.length
          ? [{ type: "separator" }, ...listedWindows]
          : []),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for updates…",
          click: () => {
            void checkForUpdatesInteractive({ disposeAgent: disposeAgentQuick });
          },
        },
        {
          label: "Open Releases page",
          click: () => {
            void shell.openExternal(
              "https://github.com/liaan/grok-desktop/releases",
            );
          },
        },
        { type: "separator" },
        {
          label: "Install guide (Mac “damaged” fix)",
          click: () => {
            shell.openExternal(
              "https://github.com/liaan/grok-desktop#mac-damaged-and-cant-be-opened",
            );
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * webContents → reveal() so `window:ready` from the renderer can show
 * that specific shell (not a splash, not another window).
 * @type {WeakMap<import('electron').WebContents, () => void>}
 */
const revealByWebContents = new WeakMap();

/**
 * @param {{ splash?: boolean, cwd?: string }} [opts]
 * @returns {import('electron').BrowserWindow}
 */
function createWindow(opts = {}) {
  const theme = loadState().theme;
  const useSplash = Boolean(opts.splash);
  if (useSplash) createSplashWindow(theme);

  /** @type {import('electron').BrowserWindowConstructorOptions} */
  const winOpts = {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: APP_WINDOW_TITLE,
    // Hidden until the renderer has painted real UI. Showing earlier is a
    // blank native chrome — HTML inside this window cannot paint yet.
    show: false,
    backgroundColor: bootBackground(theme),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  // Sit traffic lights in the brand top band (matches .platform-darwin sidebar padding)
  if (process.platform === "darwin") {
    winOpts.trafficLightPosition = { x: 14, y: 16 };
  }

  const win = new BrowserWindow(winOpts);
  // Session owns page-title guard + empty-shell title.
  const created = createWindowSession(win);
  if (opts.cwd) created.pendingOpenCwd = String(opts.cwd);
  attachContextMenu(win);

  win.on("close", (e) => {
    if (appQuitting || isQuittingForUpdate()) return;
    const ws = windowSessions.get(win.id);
    if (!ws?.settingsOpen) return;
    e.preventDefault();
    send(ws, "app:close-settings");
  });

  // Cycle shells even if the menu accelerator is swallowed.
  // Windows: no Ctrl+Tab intercept — Alt+Tab already switches OS windows.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key;
    const isBacktick = key === "`" || key === "~";
    const cycleKind = windowCycleKind();
    if (cycleKind === "cmd-backtick") {
      if (input.meta && !input.alt && !input.control && isBacktick) {
        event.preventDefault();
        cycleAppWindows(input.shift ? -1 : 1);
      }
      return;
    }
    if (
      cycleKind === "ctrl-tab" &&
      input.control &&
      !input.meta &&
      !input.alt &&
      key === "Tab"
    ) {
      event.preventDefault();
      cycleAppWindows(input.shift ? -1 : 1);
    }
  });

  let revealed = false;
  let revealFallback = null;
  const reveal = () => {
    if (win.isDestroyed() || revealed) return;
    revealed = true;
    if (revealFallback) clearTimeout(revealFallback);
    focusWindow(win);
    closeSplash();
  };
  revealByWebContents.set(win.webContents, reveal);
  win.webContents.once("did-fail-load", reveal);
  win.on("show", () => closeSplash());
  revealFallback = setTimeout(reveal, 8000);
  win.on("closed", () => {
    if (revealFallback) clearTimeout(revealFallback);
    closeSplash();
  });

  if (isDev) {
    void win.loadURL("http://127.0.0.1:5173");
    win.webContents.once("dom-ready", () => {
      setTimeout(() => {
        if (windowSessions.size <= 1 && !win.isDestroyed()) {
          win.webContents.openDevTools({ mode: "detach" });
        }
      }, 500);
    });
  } else {
    void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Never open data:/blob: via openExternal
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Keep navigation inside the app shell; open http(s) externally
  win.webContents.on("will-navigate", (event, url) => {
    const allowed =
      url.startsWith("http://127.0.0.1:") ||
      url.startsWith("http://localhost:") ||
      url.startsWith("file://");
    if (allowed) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  return win;
}

let sessionDelivery;
function delivery() {
  return sessionDelivery ||= createSessionDelivery(path.join(app.getPath("userData"), "outbox"), {
    notify: event => notifySessionDelivery(event, windowSessions.values(), (ws, payload) => send(ws, "agent:delivery", payload)),
    beforeCancel: client => {
      for (const ws of windowSessions.values()) {
        if (ws.agent === client || ws.parkedAgents?.get(client.sessionId) === client) clearPendingPermissions(ws, client.sessionId);
      }
    },
    canRelocate: (from, to, sid) => resolveMovedSessionCwd(from, sid) === to,
    validateBrowserReference: (reference, client) => validateBrowserReference(reference, previewPublicState(), client.sessionId),
  });
}

async function afterLaunchSession(ws, result) {
  if (launchPreviewStarted) return;
  const url = launchPreviewUrl || (launchHandoffPrompt ? WEB_PRO_URL : "");
  if (!url && !launchHandoffPrompt) return;
  if (!ws?.win || ws.win.isDestroyed() || !result?.sessionId || !ws.agent) return;
  if (launchProject && path.resolve(result.cwd) !== path.resolve(launchProject)) return;
  launchPreviewStarted = true;
  const evidence = {
    at: new Date().toISOString(),
    pid: process.pid,
    executable: process.execPath,
    appPath: app.getAppPath(),
    userData: app.getPath("userData"),
    grokHome: grokHomeDir(),
    sessionId: result.sessionId,
    cwd: result.cwd,
    previewUrl: url || null,
    stage: null,
    complete: false,
    snapshotExcerpt: "",
  };
  try {
    if (url) {
      await openPreviewWindow({ owner: ws.win, sessionId: result.sessionId, url });
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const snap = await snapshotPreview();
        const text = String(snap?.text || "");
        evidence.stage = snapshotStage(text);
        evidence.snapshotExcerpt = text.slice(0, 2000);
        if (evidence.stage !== "unknown") break;
      }
    }
    if (launchHandoffPrompt) {
      const prompt = fs.readFileSync(launchHandoffPrompt, "utf8");
      if (!String(prompt).trim()) throw new Error("handoff prompt is empty");
      delivery().submit(ws.agent, {
        id: "launch-handoff",
        sessionId: result.sessionId,
        cwd: result.cwd,
        text: prompt,
        images: [],
        mode: "auto",
      });
      evidence.handoff = path.resolve(launchHandoffPrompt);
    }
  } catch (error) {
    evidence.error = String(error?.message || error);
    evidence.stage = evidence.stage || "error";
  }
  evidence.complete = false;
  fs.writeFileSync(path.join(app.getPath("userData"), "preview-launch.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}

function registerIpc() {
  registerKnowledgeTransferIpc(ipcMain, {dialog, windowFromEvent: e => BrowserWindow.fromWebContents(e.sender)});
  registerDeliveryIpc(ipcMain, {
    sessionFromEvent,
    agentForSession,
    delivery,
    captureBrowserReference: sessionId => captureBrowserReference(previewPublicState(), sessionId),
  });
  registerContinuationIpc(ipcMain, {
    home:grokHomeDir, userData:()=>app.getPath("userData"), dialog,
    windowFromEvent:e=>BrowserWindow.fromWebContents(e.sender),
    identity:()=>readBuildIdentity(app.getAppPath(),app.getVersion()),
    remember:rememberProjectSession,
    assertIdle:async (id,replacing)=>{
      if (sessionDelivery?.isActive(id)) throw new Error("该对话仍在发送，请先等本轮完成或停止。");
      for (const ws of windowSessions.values()) {
        if (replacing && (ws.agent?.sessionId===id || (!ws.agent&&ws.lastSessionId===id))) throw new Error("请先离开正在显示的同一段对话，再接入资料；避免覆盖正在编辑的草稿。");
        for (const client of new Set([ws.agent,...ws.parkedAgents.values()])) if (client?.sessionId===id) {
          if(client.turnOpen||client._activeTurn||client._openPermissionGates?.size||client._restartPromise) throw new Error("该对话仍在工作或等待答复，请先完成本轮。");
          if (replacing) { await client.dispose(); ws.parkedAgents.delete(id); }
        }
      }
      if (!replacing && sessionDelivery) sessionDelivery.mutate(id,"pause");
    },
  });
  ipcMain.on("window:ready", (e) => {
    const reveal = revealByWebContents.get(e.sender);
    if (typeof reveal === "function") reveal();
  });

  ipcMain.handle("app:get-info", async () => {
    const state = loadState();
    const auth = getAuthStatus();
    // CLI /privacy default for Desktop: opt in when field missing so coding
    // data can appear in the SpaceXAI console (same auth.json field as TUI).
    const codingData = ensureCodingDataDefaultOptIn();
    return {
      version: app.getVersion(),
      buildIdentity: readBuildIdentity(app.getAppPath(), app.getVersion()),
      pid: process.pid,
      executable: process.execPath,
      appPath: app.getAppPath(),
      sessionData: app.getPath("sessionData"),
      platform: process.platform,
      grokBinary: resolveGrokBinary(),
      grokHome: grokHomeDir(),
      userData: app.getPath("userData"),
      /** @deprecated use permissionMode === 'always-approve' */
      alwaysApprove: state.permissionMode === "always-approve",
      permissionMode: normalizePermissionMode(state.permissionMode),
      reasoningEffort: normalizeReasoningEffort(state.reasoningEffort),
      allowOutsideProject: Boolean(state.allowOutsideProject),
      sandboxTerminal: state.sandboxTerminal !== false,
      sandboxStatus: sandboxStatusLabel({ lazy: true }),
      sandboxBackend: probeSandbox({ lazy: true }).backend,
      theme: state.theme === "light" ? "light" : "dark",
      privacyMode: Boolean(state.privacyMode),
      /** SpaceXAI coding-data share (auth.json); default opt-in */
      codingDataOptIn: codingData.optedIn,
      codingDataStatus: codingData,
      debugLogging: isDebugLogging() || Boolean(state.debugLogging),
      debugLogPath: getDebugLogPath(),
      allowPrerelease: Boolean(state.allowPrerelease),
      externalEditor: normalizeExternalEditor(state.externalEditor),
      autoCompactAt: normalizeAutoCompactAt(state.autoCompactAt),
      lastPeerSyncAt: state.lastPeerSyncAt || null,
      memoryEnabled: getMemoryEnabled(),
      recentProjects: state.recentProjects || [],
      lastProject: state.lastProject,
      home: os.homedir(),
      packaged: app.isPackaged,
      launchedAt,
      bundleStale: currentBundleStale(),
      auth,
      previewApi: Boolean(previewApiAddress()),
      contextWindows: readModelContextWindows(),
    };
  });

  ipcMain.handle("auth:status", async () => getAuthStatus());

  ipcMain.handle("auth:login", async (e, opts = {}) => {
    const ws = sessionFromEvent(e);
    let pendingUrl = null;
    let openTimer = null;
    const opened = new Set();
    const scheduleOpen = (url) => {
      if (!isRemoteLoginUrl(url) || opened.has(url)) return;
      pendingUrl = url;
      if (openTimer) clearTimeout(openTimer);
      openTimer = setTimeout(() => {
        openTimer = null;
        const toOpen = pendingUrl;
        if (!toOpen || opened.has(toOpen) || !isRemoteLoginUrl(toOpen)) return;
        opened.add(toOpen);
        void shell.openExternal(toOpen).catch((err) => {
          debugLog("auth", "open-login-url-failed", {
            error: err?.message || String(err),
          });
        });
      }, 800);
    };
    try {
      const result = await startLogin({
        deviceAuth: Boolean(opts?.deviceAuth),
        onProgress: (progress) => {
          send(ws, "auth:login-progress", progress);
          if (typeof progress?.url === "string") scheduleOpen(progress.url);
        },
      });
      return result;
    } catch (err) {
      return {
        ok: false,
        status: getAuthStatus(),
        error: err?.message || String(err),
      };
    } finally {
      if (openTimer) clearTimeout(openTimer);
    }
  });

  ipcMain.handle("auth:cancel-login", async () => {
    cancelLogin();
    return getAuthStatus();
  });

  ipcMain.handle("auth:submit-login-input", async (_e, text) => {
    return submitLoginInput(text);
  });

  ipcMain.handle("auth:logout", async (e) => {
    // Drop this window's agent so title/session state follow auth leave.
    clearProjectOnWindow(sessionFromEvent(e));
    try {
      return await startLogout();
    } catch (err) {
      return {
        ok: false,
        status: getAuthStatus(),
        message: err?.message || String(err),
      };
    }
  });

  ipcMain.handle("auth:set-api-key", async (_e, key) => {
    const ok = setSessionApiKey(key);
    return { ok, status: getAuthStatus() };
  });

  ipcMain.handle("auth:open-install-docs", async () => {
    await shell.openExternal("https://docs.x.ai/build/overview");
    return true;
  });

  ipcMain.handle("backbone:inspect", async (_e, cwd) => {
    return inspectBackbone(cwd || process.cwd());
  });

  ipcMain.handle("grok:engine", async () => getGrokEngine());

  ipcMain.handle("grok:update-check", async () => checkGrokUpdate());

  ipcMain.handle("grok:update-install", async () => installGrokUpdate());

  ipcMain.handle("mcp:list", async (e, opts = {}) => {
    const listed = await listMcpServers({ cwd: mcpCwdFromEvent(e) });
    const agent = sessionFromEvent(e)?.agent;
    if (!listed?.servers || !agent?.ready || !agent.sessionId) {
      return { ...listed, liveOk: false };
    }
    try {
      const live = await agent.listMcpSessionCatalog({
        cache: opts?.cache !== false,
      });
      return {
        ...listed,
        liveOk: true,
        servers: mergeMcpLiveStatus(listed.servers, live, {
          assumeInitializing: true,
        }),
      };
    } catch (err) {
      debugLog("mcp", "live-list-failed", {
        error: err?.message || String(err),
      });
      return {
        ...listed,
        liveOk: false,
        servers: mergeMcpLiveStatus(listed.servers, [], {
          assumeInitializing: true,
        }),
      };
    }
  });

  ipcMain.handle("mcp:add", async (e, spec = {}) => {
    const cwd = mcpCwdFromEvent(e);
    if (spec?.scope === "project" && !cwd) {
      return mcpIpcError("Open a project to add a project-scoped MCP server.");
    }
    try {
      return await addMcpServer(spec || {}, { cwd });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("mcp:enable", async (e, name) => {
    try {
      return await enableMcpServer(name, { cwd: mcpCwdFromEvent(e) });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("mcp:disable", async (e, name) => {
    try {
      return await disableMcpServer(name, { cwd: mcpCwdFromEvent(e) });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("mcp:remove", async (e, payload) => {
    const name = typeof payload === "string" ? payload : payload?.name;
    const scope = typeof payload === "object" && payload ? payload.scope : undefined;
    try {
      return await removeMcpServer(name, { cwd: mcpCwdFromEvent(e), scope });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("mcp:doctor", async (e, name) => {
    try {
      return await doctorMcp(name, { cwd: mcpCwdFromEvent(e) });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("settings:set-open", (e, open) => {
    const ws = sessionFromEvent(e);
    if (ws) ws.settingsOpen = Boolean(open);
    return true;
  });

  ipcMain.handle("mcp:logout", async (_e, name) => {
    try {
      return logoutMcpServer(name);
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("mcp:auth", async (e, name) => {
    const ws = sessionFromEvent(e);
    const agent = ws?.agent;
    if (!agent?.ready || !agent.sessionId) {
      return {
        ok: false,
        status: "failed",
        serverName: String(name || ""),
        error:
          "Open a project first. Sign-in uses the live agent so Grok can open the browser.",
      };
    }
    try {
      return await agent.authenticateMcpServer(name);
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        serverName: String(name || ""),
        error: err?.message || String(err),
      };
    }
  });

  ipcMain.handle("plugin:list", async (e) => {
    return listPlugins({ cwd: mcpCwdFromEvent(e) });
  });

  ipcMain.handle("plugin:enable", async (e, name) => {
    try {
      return await enablePlugin(name, { cwd: mcpCwdFromEvent(e) });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("plugin:disable", async (e, name) => {
    try {
      return await disablePlugin(name, { cwd: mcpCwdFromEvent(e) });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("plugin:install", async (e, source) => {
    try {
      return await installPlugin(source, { cwd: mcpCwdFromEvent(e) });
    } catch (err) {
      return mcpIpcError(err);
    }
  });

  ipcMain.handle("project:pick", async (e) => {
    const ws = sessionFromEvent(e);
    const parent =
      ws?.win && !ws.win.isDestroyed()
        ? ws.win
        : BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showOpenDialog(parent, {
      properties: ["openDirectory", "createDirectory"],
      title: "Open project folder",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("project:add-recent", async (_e, cwd) => {
    const folder = String(cwd || "").trim();
    if (!folder || !fs.existsSync(folder)) {
      throw new Error("找不到这个文件夹");
    }
    if (!fs.statSync(folder).isDirectory()) {
      throw new Error("这不是文件夹");
    }
    const recentProjects = rememberRecentProject(folder);
    return { ok: true, cwd: folder, recentProjects };
  });

  /**
   * Open a project and attach an ACP session on the calling window.
   * @param {string} cwd
   * @param {{
   *   mode?: 'continue' | 'new' | 'resume',
   *   sessionId?: string,
   *   allowSameCheckout?: boolean,
   * }} [opts]
   *   - continue (default): resume most recent session for cwd (CLI `-c`)
   *   - new: brand-new session (CLI `/new`)
   *   - resume: load opts.sessionId (CLI `--resume id`)
   *   - allowSameCheckout: skip the “already open in another window” prompt
   */
  ipcMain.handle("project:open", async (e, cwd, opts = {}) => {
    const ws = sessionFromEvent(e);
    if (!ws) throw new Error("No window for project:open");
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Project path not found: ${cwd}`);
    }
    const agent = agentForWorktreeRpc(cwd, ws, windowSessions.values());
    ws.openingCwd = cwd;
    broadcastOpenCheckouts();
    try {
      const plan = await planProjectOpen(cwd, {
        agent,
        openRows: collectOpenCheckouts(),
        excludeWindowId: ws.win.id,
        allowSameCheckout: Boolean(opts?.allowSameCheckout),
      });
      if (plan.conflict) return plan.conflict;
      const result = await openSessionOnWindow(ws, {
        cwd,
        mode: opts?.mode || "continue",
        sessionId: opts?.sessionId,
        mostRecent: mostRecentSession,
        loadState: loadSessionOpenState,
        listSessions: listSessionsForCwd,
        remember: rememberProjectSession,
      });
      await commitFamilyAfterOpen(cwd, ws.agent, plan.acpWorktrees);
      void afterLaunchSession(ws, result);
      return result;
    } finally {
      if (ws.openingCwd === cwd) ws.openingCwd = null;
      broadcastOpenCheckouts();
    }
  });

  ipcMain.handle("project:list-open", async () => collectOpenCheckouts());

  ipcMain.handle("project:focus-window", async (_e, windowId) => {
    const id = Number(windowId);
    const other = windowSessions.get(id);
    if (!other?.win || other.win.isDestroyed()) return false;
    focusWindow(other.win);
    return true;
  });

  ipcMain.handle("project:take-pending-open", async (e) => {
    const ws = sessionFromEvent(e);
    if (!ws?.pendingOpenCwd) return null;
    const pending = ws.pendingOpenCwd;
    ws.pendingOpenCwd = null;
    return { cwd: pending, allowSameCheckout: true };
  });

  ipcMain.handle("window:open-project-in-new", async (_e, cwd) => {
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Project path not found: ${cwd}`);
    }
    createWindow({ cwd });
    return { ok: true };
  });

  ipcMain.handle("git:inspect-checkout", async (e, cwd) => {
    const ws = sessionFromEvent(e);
    const root =
      typeof cwd === "string" && cwd
        ? cwd
        : ws?.agent?.cwd || ws?.lastCwd;
    if (!root) return inspectProjectCheckout("");
    const agent = agentForWorktreeRpc(root, ws, windowSessions.values());
    return inspectProjectCheckout(root, {
      agent,
      openRows: collectOpenCheckouts(),
      excludeWindowId: ws?.win?.id ?? null,
    });
  });

  /** Same as TUI `/new` worktree — ACP create, Grok chooses the path. */
  ipcMain.handle("worktree:create", async (e, opts = {}) => {
    const ws = sessionFromEvent(e);
    const sessionCwd = ws?.agent?.cwd || ws?.lastCwd;
    const targetCwd = resolveWorktreeCreateCwd(
      opts.cwd,
      sessionCwd,
      collectOpenCheckouts(),
    );
    if (!targetCwd) {
      throw new Error(
        sessionCwd
          ? "Worktree create is limited to the open project."
          : "Open a project first — worktrees need a live Grok session.",
      );
    }
    const agent = agentForWorktreeRpc(targetCwd, ws, windowSessions.values());
    return createAcpWorktree(agent, {
      sourceCwd: targetCwd,
      label: opts.label,
    });
  });

  /** Drop agent + empty-shell title on this window (logout / leave project). */
  ipcMain.handle("project:close", async (e) => {
    const ws = sessionFromEvent(e);
    if (!ws) return false;
    return clearProjectOnWindow(ws);
  });

  /** Respawn this window's grok agent and resume the current session. */
  ipcMain.handle("agent:restart", async (e) => {
    const ws = sessionFromEvent(e);
    if (!ws) throw new Error("No window for agent:restart");
    const result = await restartAgentOnWindow(ws, {
      loadState: loadSessionOpenState,
      listSessions: listSessionsForCwd,
      remember: rememberProjectSession,
    });
    const backbone = await inspectBackbone(result.cwd);
    return mergeRestartResult(result, backbone);
  });

  ipcMain.handle("sessions:list", async (_e, cwd) => {
    if (!cwd) return [];
    return listSessionsForCwd(cwd);
  });

  ipcMain.handle("sessions:list-all", async (_e, cwds) => {
    return listSessionsForCwds(Array.isArray(cwds) ? cwds : []);
  });

  ipcMain.handle("sessions:live-turns", async () => {
    return listLiveTurnSessionIds();
  });

  ipcMain.handle("sessions:moves", async () => {
    recoverSessionMoves();
    return readSessionMoves().filter(row => row.phase === "committed");
  });
  ipcMain.handle("sessions:move", async (e, payload) => {
    const caller = sessionFromEvent(e);
    if (!caller || caller.disposed) throw new Error("窗口已关闭");
    return withSessionMove(payload?.sessionId, async () => {
      // Existing queued opens finish before inspection; new ones see the lock.
      await Promise.all([...windowSessions.values()].map(ws => ws.agentChain.catch(() => {})));
      const clients = movableSessionClients(windowSessions.values(), caller, payload.sessionId);
      if (sessionDelivery?.isActive(payload.sessionId)) throw new Error("这段对话还有正在发送的内容，请先停止或等它完成。");
      const plan = moveSessionFiles(payload, { dryRun: true });
      if (plan.unchanged) return plan;
      if (sessionDelivery) sessionDelivery.mutate(payload.sessionId, "pause");
      for (const {ws,client} of clients) {
        clearPendingPermissions(ws, payload.sessionId);
        if (ws.agent === client) { ws.agent = null; ws.stopBackgroundTaskTail?.(); ws.stopBackgroundTaskTail = null; }
        ws.parkedAgents?.delete(payload.sessionId);
        await client.dispose();
      }
      const result = moveSessionFiles(payload);
      sessionDelivery?.relocate(payload.sessionId, result.targetCwd);
      if (caller.lastSessionId === payload.sessionId) caller.lastCwd = result.targetCwd;
      rememberProjectSession(result.targetCwd, payload.sessionId);
      for (const ws of windowSessions.values()) send(ws, "sessions:moved", result);
      return result;
    }).finally(() => sessionDelivery?.wake(payload.sessionId));
  });

  ipcMain.handle("sessions:rename", async (e, { cwd, sessionId, title } = {}) => {
    const ws = sessionFromEvent(e);
    const project = cwd || ws?.agent?.cwd || ws?.lastCwd;
    if (!project) throw new Error("No project open");
    const cleaned = sanitizeSessionTitle(title);
    if (!cleaned) throw new Error("Title must not be blank");
    if ([...cleaned].length > MAX_SESSION_TITLE_LENGTH) {
      throw new Error(
        `Title too long (max ${MAX_SESSION_TITLE_LENGTH} characters)`,
      );
    }
    const agent = ws?.agent;
    if (agent?.ready) {
      try {
        await agent.renameSession({
          sessionId,
          title: cleaned,
          cwd: project,
        });
        return {
          ok: true,
          title: cleaned,
          sessions: listSessionsForCwd(project),
        };
      } catch (err) {
        const missing =
          err?.code === -32601 ||
          /method not found|-32601|not available on this Grok CLI/i.test(
            String(err?.message || err),
          );
        if (!missing) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
    const written = renameSessionOnDisk(project, sessionId, cleaned);
    return {
      ok: true,
      title: written.title,
      sessions: listSessionsForCwd(project),
    };
  });

  ipcMain.handle("sessions:delete", async (e, { cwd, sessionId } = {}) => {
    const ws = sessionFromEvent(e);
    const project = cwd || ws?.agent?.cwd || ws?.lastCwd;
    if (!project) throw new Error("No project open");
    const agent = ws?.agent;
    if (agent?.ready) {
      try {
        await agent.deleteSession({ sessionId, cwd: project });
        return { ok: true, sessions: listSessionsForCwd(project) };
      } catch (err) {
        const missing =
          err?.code === -32601 ||
          /method not found|-32601|not available on this Grok CLI/i.test(
            String(err?.message || err),
          );
        if (!missing) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
    deleteSessionOnDisk(project, sessionId);
    return { ok: true, sessions: listSessionsForCwd(project) };
  });

  ipcMain.handle("sessions:open", async (e, { cwd, sessionId, mode }) => {
    assertContinuationSettled(app.getPath("userData"),sessionId);
    const ws = sessionFromEvent(e);
    if (!ws) throw new Error("No window for sessions:open");
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Project path not found: ${cwd}`);
    }
    return openSessionOnWindow(ws, {
      cwd,
      mode: mode === "new" ? "new" : "resume",
      sessionId,
      mostRecent: mostRecentSession,
      loadState: loadSessionOpenState,
      listSessions: listSessionsForCwd,
      remember: rememberProjectSession,
    });
  });

  ipcMain.handle("agent:set-session-mode", async (e, modeId) => {
    const agent = sessionFromEvent(e)?.agent;
    if (!agent?.ready || !agent.setSessionMode) {
      return { agentSynced: false, currentModeId: null, error: "Agent not connected." };
    }
    const result = await agent.setSessionMode(modeId);
    if (sessionFromEvent(e)?.agent !== agent) {
      return { agentSynced: false, currentModeId: null, error: "Session changed." };
    }
    return result;
  });

  ipcMain.handle("agent:fork", async (e, opts = {}) => {
    const agent = sessionFromEvent(e)?.agent;
    if (!agent?.ready)
      throw new Error("Agent not connected. Open a project first.");
    try {
      const forked = await agent.forkSession();
      const through = Number(opts?.throughUserPromptIndex);
      const last = Number(opts?.lastUserPromptIndex);
      if (
        Number.isInteger(through) &&
        through >= 0 &&
        Number.isInteger(last) &&
        through < last
      ) {
        await agent.rewindConversation(through, false, forked.sessionId);
      }
      return JSON.parse(
        JSON.stringify({ sessionId: forked.sessionId, ok: true }),
      );
    } catch (err) {
      throw new Error(err?.message || String(err));
    }
  });

  ipcMain.handle("agent:rewind", async (e, opts = {}) => {
    const agent = sessionFromEvent(e)?.agent;
    if (!agent?.ready)
      throw new Error("Agent not connected. Open a project first.");
    try {
      const index = Number(opts?.targetPromptIndex);
      const result = await agent.rewindConversation(
        Number.isFinite(index) ? index : 0,
        Boolean(opts?.restoreFiles),
      );
      return JSON.parse(JSON.stringify(result ?? { ok: true }));
    } catch (err) {
      throw new Error(err?.message || String(err));
    }
  });

  ipcMain.handle("agent:compact", async (e, hint = "", sessionId) => {
    const agent = agentForSession(sessionFromEvent(e), sessionId);
    if (!agent?.ready)
      throw new Error("Agent not connected. Open a project first.");
    try {
      const result = await agent.compactConversation(
        typeof hint === "string" ? hint : "",
      );
      // IPC can only clone plain JSON — drop class instances / cycles.
      return JSON.parse(JSON.stringify(result ?? { ok: true }));
    } catch (err) {
      throw new Error(err?.message || String(err));
    }
  });

  ipcMain.handle("agent:cancel", async (e, sessionId) => {
    // ACP turn cancel: answer every open agent→client request (tool
    // permissions + plan approval + ask-user), dismiss renderer modals,
    // then notify the agent and tear down tool terminals.
    const ws = sessionFromEvent(e);
    const agent = agentForSession(ws, sessionId);
    if (!agent) return false;
    delivery().bind(agent);
    return delivery().stop(agent.sessionId);
  });

  ipcMain.handle("agent:set-allow-writes-session", async (e, value) => {
    const ws = sessionFromEvent(e);
    if (!ws?.agent) return { allowWritesThisSession: false };
    const agent = ws.agent;
    const run = () => {
      if (ws.agent !== agent) throw new Error("对话已切换，请在原对话中修改权限。 ");
      const on = agent.setAllowWritesThisSession(Boolean(value));
      if (on) settlePendingAllowOnce(ownerIdFor(ws), agent.sessionId);
      return { allowWritesThisSession: on };
    };
    const p = Promise.resolve(ws.writesChain).then(run, run);
    ws.writesChain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  });

  ipcMain.handle("agent:permission-respond", async (e, { reqId, outcome }) => {
    const ws = sessionFromEvent(e);
    if (!ws) return false;
    return settlePermission(reqId, outcome, ownerIdFor(ws), ws.agent?.sessionId || "");
  });

  setOnEnableAlwaysApprove(() => {
    const prev = normalizePermissionMode(loadState().permissionMode);
    const state = loadState();
    state.permissionMode = "always-approve";
    delete state.alwaysApprove;
    saveState(state);
    broadcastPermissionMode("always-approve");
    if (prev === "always-approve") return;
    // Live notify only — do not respawn mid-turn (Settings still restarts).
    void syncPermissionModeLiveToAllWindows("always-approve");
  });

  /** Mirror open gates after renderer reload / HMR (main is source of truth). */
  ipcMain.handle("agent:list-pending-permissions", async (e) => {
    const ws = sessionFromEvent(e);
    // No window → empty list (do not leak other windows' gates)
    if (!ws) return [];
    const all = listPendingPermissionRequests(ownerIdFor(ws));
    const sid = ws.agent?.sessionId;
    if (!sid) return [];
    return all.filter(
      (p) => String(p?.params?.sessionId || "") === String(sid),
    );
  });

  for (const [channel, field] of [
    ["agent:list-pending-plan-approvals", "pendingPlanApprovals"],
    ["agent:list-pending-folder-trust", "pendingFolderTrust"],
    ["agent:list-pending-user-questions", "pendingUserQuestions"],
    ["agent:list-pending-mcp-elicits", "pendingMcpElicits"],
  ]) {
    ipcMain.handle(channel, async (e) => {
      const ws = sessionFromEvent(e);
      if (!ws) return [];
      const sid = ws.agent?.sessionId;
      return listParked(ws[field]).filter(
        (entry) => Boolean(sid) && String(entry.params?.sessionId || "") === String(sid),
      );
    });
  }

  /**
   * @param {Map<string, any> | undefined} map
   * @param {string} reqId
   * @param {any} fallback
   */
  const settleParkedIpc = (map, reqId, fallback, sessionId) => {
    const entry = map?.get(reqId);
    if (!sessionId || String(entry?.params?.sessionId || "") !== String(sessionId)) return false;
    return settleParked(entry, fallback);
  };

  ipcMain.handle("agent:plan-approval-respond", async (e, { reqId, decision }) => {
    const ws = sessionFromEvent(e);
    return settleParkedIpc(
      ws?.pendingPlanApprovals,
      reqId,
      decision || { type: "abandoned" },
      ws?.agent?.sessionId,
    );
  });

  ipcMain.handle("agent:user-question-respond", async (e, { reqId, decision }) => {
    const ws = sessionFromEvent(e);
    return settleParkedIpc(
      ws?.pendingUserQuestions,
      reqId,
      decision || { type: "declined" },
      ws?.agent?.sessionId,
    );
  });

  ipcMain.handle("agent:folder-trust-respond", async (e, { reqId, decision }) => {
    const ws = sessionFromEvent(e);
    return settleParkedIpc(
      ws?.pendingFolderTrust,
      reqId,
      decision || { outcome: "reject" },
      ws?.agent?.sessionId,
    );
  });

  ipcMain.handle("agent:mcp-elicit-respond", async (e, { reqId, decision }) => {
    const ws = sessionFromEvent(e);
    return settleParkedIpc(
      ws?.pendingMcpElicits,
      reqId,
      decision || { outcome: "cancel" },
      ws?.agent?.sessionId,
    );
  });

  /** @deprecated prefer agent:set-permission-mode */
  ipcMain.handle("agent:set-always-approve", async (_e, value) => {
    const prev = normalizePermissionMode(loadState().permissionMode);
    const mode = value ? "always-approve" : "ask";
    const state = loadState();
    state.permissionMode = mode;
    delete state.alwaysApprove;
    saveState(state);
    broadcastPermissionMode(mode);
    await applyPermissionModeToAllWindows(mode, prev);
    return mode === "always-approve";
  });

  ipcMain.handle("agent:set-permission-mode", async (_e, value) => {
    const prev = normalizePermissionMode(loadState().permissionMode);
    const mode = normalizePermissionMode(value);
    const state = loadState();
    state.permissionMode = mode;
    delete state.alwaysApprove;
    saveState(state);
    broadcastPermissionMode(mode);
    return applyPermissionModeToAllWindows(mode, prev);
  });

  ipcMain.handle("agent:set-reasoning-effort", async (e, value) => {
    const effort = normalizeReasoningEffort(value);
    const state = loadState();
    state.reasoningEffort = effort;
    saveState(state);
    /** @type {{ effort: string, agentSynced: boolean, error?: string }} */
    let result = { effort, agentSynced: false };
    const agent = sessionFromEvent(e)?.agent;
    if (agent?.setReasoningEffort) {
      result = await agent.setReasoningEffort(effort);
    }
    for (const other of windowSessions.values()) {
      if (other.agent === agent || !other.agent?.setReasoningEffort) continue;
      try {
        await other.agent.setReasoningEffort(effort);
      } catch {
        /* ignore */
      }
    }
    return result;
  });

  ipcMain.handle("agent:set-model", async (e, modelId) => {
    const ws = sessionFromEvent(e);
    const agent = ws?.agent;
    if (!agent?.setModel) {
      return {
        modelId: null,
        modelName: null,
        availableModels: [],
        agentSynced: false,
        error: "No live agent",
      };
    }
    const sessionId = agent.sessionId;
    const result = await agent.setModel(modelId);
    const live = sessionFromEvent(e)?.agent;
    if (live !== agent || live?.sessionId !== sessionId) {
      return {
        ...(typeof live?._modelsPublic === "function"
          ? live._modelsPublic()
          : result),
        agentSynced: false,
        error: "Session changed",
      };
    }
    return result;
  });

  ipcMain.handle("agent:set-allow-outside-project", async (_e, value) => {
    const state = loadState();
    state.allowOutsideProject = Boolean(value);
    saveState(state);
    applyWindowAgentAccess(windowSessions, { allowOutsideProject: state.allowOutsideProject });
    return state.allowOutsideProject;
  });

  ipcMain.handle("agent:set-sandbox-terminal", async (_e, value) => {
    const state = loadState();
    // Explicit boolean from UI — do not use `!== false` here (undefined would stick ON)
    state.sandboxTerminal = Boolean(value);
    saveState(state);
    applyWindowAgentAccess(windowSessions, { sandboxTerminal: state.sandboxTerminal });
    // Start Docker image pull/build off the UI thread when sandbox is (re)enabled
    if (state.sandboxTerminal) {
      maybeWarmDockerSandbox();
    }
    return state.sandboxTerminal;
  });

  ipcMain.handle("app:set-theme", async (_e, value) => {
    const theme = value === "light" ? "light" : "dark";
    const state = loadState();
    state.theme = theme;
    saveState(state);
    applyPreviewTheme(theme);
    return theme;
  });

  ipcMain.handle("app:set-privacy-mode", async (_e, value) => {
    const state = loadState();
    state.privacyMode = Boolean(value);
    saveState(state);
    return state.privacyMode;
  });

  ipcMain.handle("app:set-auto-compact-at", async (_e, value) => {
    const state = loadState();
    state.autoCompactAt = normalizeAutoCompactAt(value);
    saveState(state);
    return state.autoCompactAt;
  });

  /** CLI `/privacy` — coding data retention & training (auth.json). */
  ipcMain.handle("app:get-coding-data", async () => getCodingDataStatus());

  ipcMain.handle("app:set-coding-data-opt-in", async (_e, value) => {
    return setCodingDataOptIn(Boolean(value));
  });

  ipcMain.handle("memory:status", async (e) => {
    const ws = sessionFromEvent(e);
    const cwd = ws?.agent?.cwd || ws?.lastCwd || null;
    return listMemoryEntries(cwd);
  });

  ipcMain.handle("memory:set-enabled", async (_e, value) => {
    return { enabled: setMemoryEnabled(Boolean(value)) };
  });

  ipcMain.handle("memory:delete", async (_e, entryId) => {
    return deleteMemoryEntry(String(entryId || ""));
  });

  ipcMain.handle("working-knowledge:status", async (e, opts = {}) => {
    const ws = sessionFromEvent(e);
    return snapshotWorkingKnowledge({
      sessionId: opts.sessionId || ws?.agent?.sessionId || ws?.lastSessionId || "",
      cwd: opts.cwd || ws?.agent?.cwd || ws?.lastCwd || "",
    });
  });

  ipcMain.handle("working-knowledge:set-enabled", async (_e, value) => {
    return setWorkingKnowledgeEnabled(Boolean(value));
  });

  ipcMain.handle("working-knowledge:set-object", async (e, payload = {}) => {
    const ws = sessionFromEvent(e);
    return setWorkingKnowledgeObject({
      objectId: payload.objectId,
      sessionId:
        payload.sessionId || ws?.agent?.sessionId || ws?.lastSessionId || "",
      cwd: payload.cwd || ws?.agent?.cwd || ws?.lastCwd || "",
    });
  });

  ipcMain.handle("working-knowledge:correct", async (e, payload = {}) => {
    const ws = sessionFromEvent(e);
    return correctWorkingKnowledge({
      ...payload,
      sessionId:
        payload.sessionId || ws?.agent?.sessionId || ws?.lastSessionId || "",
      cwd: payload.cwd || ws?.agent?.cwd || ws?.lastCwd || "",
    });
  });

  ipcMain.handle("working-knowledge:withdraw", async (e, payload = {}) => {
    const ws = sessionFromEvent(e);
    return withdrawWorkingKnowledge({
      ...payload,
      sessionId:
        payload.sessionId || ws?.agent?.sessionId || ws?.lastSessionId || "",
      cwd: payload.cwd || ws?.agent?.cwd || ws?.lastCwd || "",
    });
  });

  ipcMain.handle("working-knowledge:arm-probe", async () => {
    return armWorkingKnowledgeProbe();
  });

  // Old callers fail visibly without touching remote credentials or applying mtime copies.
  for (const channel of ["peer:status", "peer:pair", "peer:align", "peer:copy-auth", "peer:copy-app"]) {
    ipcMain.handle(channel, () => ({ok:false,error:"旧的整机覆盖/登录搬运已停用，请使用会话和工作认识的显式接续入口。"}));
  }
  ipcMain.handle("peer:export-candidate", async e => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showSaveDialog(win, {title:"导出当前候选版本到新目录",defaultPath:`Grok-Desktop-${app.getVersion()}-candidate`});
    if (picked.canceled) return {cancelled:true};
    return exportApplicationCandidate({appPath:app.getAppPath(),execPath:process.execPath,version:app.getVersion(),isPackaged:app.isPackaged,destination:picked.filePath});
  });

  function broadcastAuthChanged() {
    const status = getAuthStatus();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send("auth:changed", status);
      } catch {
        /* ignore */
      }
    }
    return status;
  }

  ipcMain.handle("account:list", async () => {
    saveCurrentSnapshot();
    const local = listAccountSnapshots();
    return local;
  });

  ipcMain.handle("account:activate", async (_e, id) => {
    const result = activateAccount(String(id || ""));
    if (result.ok) {
      result.status = broadcastAuthChanged();
    }
    return result;
  });

  ipcMain.handle("agent:billing", async (e) => {
    const ws = sessionFromEvent(e);
    const agent = anyAgent(ws);
    if (!agent?.ready) {
      return { ok: false, line: "打开一个项目后可以看到额度" };
    }
    try {
      const raw = await agent.fetchBilling();
      return { ok: true, ...remainingFromBilling(raw) };
    } catch (err) {
      return {
        ok: false,
        line: "暂时查不到额度",
        error: err?.message || String(err),
      };
    }
  });

  ipcMain.handle("agent:scheduler-delete", async (e, opts = {}) => {
    const ws = sessionFromEvent(e);
    const sid = String(opts.sessionId || ws?.agent?.sessionId || "");
    const agent = agentForSession(ws, sid);
    if (!agent?.ready) throw new Error("Agent not connected. Open a project first.");
    try {
      return await agent.deleteScheduledTask(opts.taskId, sid);
    } catch (err) {
      throw new Error(err?.message || String(err));
    }
  });

  ipcMain.handle("chat:export", async (e, opts = {}) => {
    const ws = sessionFromEvent(e);
    const win = ws?.win && !ws.win.isDestroyed() ? ws.win : undefined;
    const title = String(opts.title || "对话");
    const markdown = timelineToMarkdown(opts.items || [], {
      title,
      project: opts.project || ws?.agent?.cwd || ws?.lastCwd || "",
    });
    const picked = await dialog.showSaveDialog(win, {
      title: "导出这场对话",
      defaultPath: exportFilename(title),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (picked.canceled || !picked.filePath) {
      return { ok: false, cancelled: true };
    }
    fs.writeFileSync(picked.filePath, markdown, "utf8");
    return { ok: true, path: picked.filePath };
  });

  ipcMain.handle("app:set-allow-prerelease", async (_e, value) => {
    const state = loadState();
    state.allowPrerelease = Boolean(value);
    saveState(state);
    setAllowPrerelease(state.allowPrerelease);
    return state.allowPrerelease;
  });

  ipcMain.handle("app:set-debug-logging", async (_e, value) => {
    const state = loadState();
    state.debugLogging = Boolean(value);
    saveState(state);
    setDebugLogging(state.debugLogging);
    debugLog("settings", state.debugLogging ? "debug on" : "debug off", {
      path: getDebugLogPath(),
    });
    return {
      debugLogging: isDebugLogging(),
      debugLogPath: getDebugLogPath(),
    };
  });

  ipcMain.handle("app:open-debug-log", async () => {
    const p = getDebugLogPath();
    try {
      if (!fs.existsSync(p)) {
        fs.writeFileSync(
          p,
          `${JSON.stringify({ t: new Date().toISOString(), scope: "debug", msg: "log created" })}\n`,
          "utf8",
        );
      }
    } catch {
      /* ignore */
    }
    const err = await shell.openPath(p);
    if (err) {
      // openPath returns error string on failure
      shell.showItemInFolder(p);
    }
    return p;
  });

  ipcMain.handle("git:branch", async (e, cwd) => {
    const root =
      typeof cwd === "string" && cwd
        ? cwd
        : sessionFromEvent(e)?.agent?.cwd;
    if (!root) return { branch: null, detached: false };
    return getGitBranch(root);
  });

  ipcMain.handle("git:status", async (e, cwd) => {
    const sessionCwd = sessionFromEvent(e)?.agent?.cwd;
    if (!sessionCwd) return { files: [] };
    try {
      const root =
        typeof cwd === "string" && cwd
          ? assertPathInProject(sessionCwd, cwd)
          : sessionCwd;
      return getGitStatus(root);
    } catch {
      return { files: [] };
    }
  });

  ipcMain.handle("git:diff", async (e, filePath, opts) => {
    const staged = Boolean(opts && opts.staged);
    const rel = filePath == null ? "" : String(filePath);
    const sessionCwd = sessionFromEvent(e)?.agent?.cwd;
    if (!sessionCwd || !rel) {
      return { path: rel, staged, diff: null };
    }
    try {
      const safe = assertPathInProject(sessionCwd, rel);
      return getGitDiff(sessionCwd, safe, { staged });
    } catch {
      return { path: rel, staged, diff: null };
    }
  });

  ipcMain.handle("fs:read-file", async (e, filePath, sessionId) => {
    const root = agentForSession(sessionFromEvent(e), sessionId)?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, filePath);
    return readFileForEdit(safe);
  });

  ipcMain.handle("fs:write-file", async (e, filePath, content) => {
    const root = sessionFromEvent(e)?.agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, filePath);
    await writeFileForEdit(safe, content);
    return { ok: true };
  });

  ipcMain.handle("fs:pick-files", async (e) => {
    const ws = sessionFromEvent(e);
    const parent =
      ws?.win && !ws.win.isDestroyed()
        ? ws.win
        : BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showOpenDialog(parent, {
      properties: ["openFile", "multiSelections"],
      defaultPath: ws?.agent?.cwd || undefined,
      title: "附上文件",
      filters: ATTACH_DIALOG_FILTERS,
    });
    if (result.canceled || !result.filePaths?.length) return [];
    return result.filePaths;
  });

  ipcMain.handle("fs:pick-folder", async (e) => {
    const ws = sessionFromEvent(e);
    const parent =
      ws?.win && !ws.win.isDestroyed()
        ? ws.win
        : BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showOpenDialog(parent, {
      properties: ["openDirectory"],
      defaultPath: ws?.agent?.cwd || undefined,
      title: "附上文件夹",
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("attachments:import", async (e, sourcePath, sessionId) => {
    if (!sessionId) throw new Error("附件没有明确的对话归属，未导入。");
    const agent = agentForSession(sessionFromEvent(e), sessionId);
    if (!agent) throw new Error("原对话已关闭，附件未导入其他对话。");
    return importAttachmentFile(sourcePath, { cwd: agent.cwd, sessionId: agent.sessionId });
  });

  ipcMain.handle("agent:ping", async (e) => {
    const ws = sessionFromEvent(e);
    const agent = ws?.agent;
    const proc = agent?.proc;
    const alive = Boolean(proc && !proc.killed && proc.exitCode == null);
    if (!alive || typeof agent?.ping !== "function") {
      return {
        ok: false,
        rpc: false,
        reason: alive ? "no-rpc" : "process",
        sessionId: agent?.sessionId || null,
        cwd: agent?.cwd || null,
      };
    }
    const rpc = await agent.ping(4000);
    return {
      ...rpc,
      sessionId: agent.sessionId || null,
      cwd: agent.cwd || null,
    };
  });

  ipcMain.handle("fs:pick-file", async (e) => {
    const ws = sessionFromEvent(e);
    const parent =
      ws?.win && !ws.win.isDestroyed()
        ? ws.win
        : BrowserWindow.getFocusedWindow() || undefined;
    const root = ws?.agent?.cwd;
    const result = await dialog.showOpenDialog(parent, {
      properties: ["openFile"],
      defaultPath: root || undefined,
      title: "打开文件",
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("artifact:preview", async (e, filePath) => {
    const root = sessionFromEvent(e)?.agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, filePath);
    const { origin } = await ensureArtifactServer(root);
    const href = artifactHref(root, safe);
    if (!href) throw new Error("Could not preview this file");
    return { origin, href };
  });

  ipcMain.handle("fs:list-dir", async (e, dirPath) => {
    const root = sessionFromEvent(e)?.agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, dirPath);
    const entries = await fs.promises.readdir(safe, { withFileTypes: true });
    return entries
      .filter((ent) => !ent.name.startsWith("."))
      .slice(0, 200)
      .map((ent) => {
        // Symlink-to-dir is enterable only when the realpath stays in-project.
        let isDirectory = ent.isDirectory();
        if (!isDirectory && ent.isSymbolicLink()) {
          const child = path.join(safe, ent.name);
          try {
            isDirectory =
              fs.statSync(child).isDirectory() && isPathInProject(root, child);
          } catch {
            isDirectory = false;
          }
        }
        return {
          name: ent.name,
          isDirectory,
          path: path.join(safe, ent.name),
        };
      });
  });

  ipcMain.handle("editor:list", async () => {
    const preferred = normalizeExternalEditor(loadState().externalEditor);
    const editors = listEditors();
    const resolved =
      editors.find((ed) => ed.id === preferred && ed.available) ||
      editors.find((ed) => ed.available && !ed.lastResort) ||
      editors.find((ed) => ed.available) ||
      null;
    return {
      preferred,
      resolved: resolved ? resolved.id : null,
      resolvedLabel: resolved ? resolved.label : null,
      editors,
    };
  });

  ipcMain.handle("app:set-external-editor", async (_e, value) => {
    const state = loadState();
    state.externalEditor = normalizeExternalEditor(value);
    saveState(state);
    const editors = listEditors();
    const resolved =
      editors.find((ed) => ed.id === state.externalEditor && ed.available) ||
      editors.find((ed) => ed.available && !ed.lastResort) ||
      editors.find((ed) => ed.available) ||
      null;
    return {
      preferred: state.externalEditor,
      resolved: resolved ? resolved.id : null,
      resolvedLabel: resolved ? resolved.label : null,
      editors,
    };
  });

  // Renderer shell helpers are always project-scoped (ignore allowOutsideProject).
  // Open in a real editor — never Launch Services / the default browser.
  ipcMain.handle("shell:open-path", async (e, target) => {
    const root = sessionFromEvent(e)?.agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, target);
    const preference = normalizeExternalEditor(loadState().externalEditor);
    return openInEditor(safe, { preference });
  });

  ipcMain.handle("shell:open-editor", async (e, target) => {
    const root = sessionFromEvent(e)?.agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, target);
    const preference = normalizeExternalEditor(loadState().externalEditor);
    return openInEditor(safe, { preference });
  });

  ipcMain.handle("shell:show-item", async (e, target) => {
    const root = sessionFromEvent(e)?.agent?.cwd;
    if (!root) throw new Error("No project open");
    shell.showItemInFolder(assertPathInProject(root, target));
  });

  registerPreviewIpc({
    loadState,
    savePatch: (patch) => {
      const state = loadState();
      Object.assign(state, patch || {});
      saveState(state);
    },
    getOwner: (e) => {
      const ws = sessionFromEvent(e);
      return ws?.win && !ws.win.isDestroyed() ? ws.win : null;
    },
    getOwnerSessionId: (win) => windowSessions.get(win?.id)?.agent?.sessionId || null,
    ownerHasProject: (win) => {
      const ws = windowSessions.get(win.id);
      return Boolean(ws?.agent?.cwd || ws?.lastCwd);
    },
    broadcast: (payload) => {
      for (const ws of windowSessions.values()) {
        send(ws, "preview:changed", payload.ownerSessionId === ws.agent?.sessionId
          ? payload : { open: false, url: "", title: "", viewport: payload.viewport, loading: false, ownedElsewhere: payload.open });
      }
    },
  });

  ipcMain.handle("shell:open-external", async (_e, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw new Error("Only http(s) URLs are allowed");
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("app:notify", (e, payload = {}) => {
    const title = String(payload.title || "Grok Desktop");
    const body = String(payload.body || "");
    if (!Notification.isSupported()) return { ok: false };
    const n = new Notification({ title, body, silent: false });
    n.on("click", () => {
      const ws = sessionFromEvent(e);
      if (ws?.win && !ws.win.isDestroyed()) {
        if (ws.win.isMinimized()) ws.win.restore();
        ws.win.show();
        ws.win.focus();
        send(ws, "app:notify-click", {
          sessionId: payload.sessionId || null,
          cwd: payload.cwd || null,
        });
      }
    });
    n.show();
    return { ok: true };
  });

  ipcMain.handle("app:bundle-stale", async () => ({
    stale: currentBundleStale(),
    packaged: app.isPackaged,
  }));

  ipcMain.handle("app:relaunch", () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle("shell:open-default", async (e, target) => {
    const root = sessionFromEvent(e)?.agent?.cwd;
    if (!root) throw new Error("No project open");
    const safe = assertPathInProject(root, target);
    const err = await shell.openPath(safe);
    if (err) throw new Error(err);
    return { ok: true };
  });

  ipcMain.handle("clipboard:write", (_e, payload = {}) => {
    const text = typeof payload.text === "string" ? payload.text : "";
    const html = typeof payload.html === "string" ? payload.html : "";
    const max = 8 * 1024 * 1024;
    if (text.length > max || html.length > max) {
      throw new Error("Clipboard payload too large");
    }
    if (html) clipboard.write({ text, html });
    else clipboard.writeText(text);
    return true;
  });
}

// One process, many windows. Packaged Start Menu / second launch must not
// start a fresh occupancy map (that skipped the “already open” prompt).
// Unpackaged (npm run dev) skips the lock so it does not join an install.
wireWorktreePathGate();
configureDesktopInstance(app);
const printInfo = app.commandLine.hasSwitch("print-info");
const isPrimaryInstance = printInfo || isPrimaryDesktopInstance(app);
if (!isPrimaryInstance) {
  app.quit();
} else if (!printInfo) {
  wireSecondInstance(app, () => newWindowFromMenu());
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return;
  if (printInfo) {
    process.stdout.write(JSON.stringify({
      version: app.getVersion(),
      buildIdentity: readBuildIdentity(app.getAppPath(), app.getVersion()),
      pid: process.pid,
      executable: process.execPath,
      appPath: app.getAppPath(),
      userData: app.getPath("userData"),
      sessionData: app.getPath("sessionData"),
      platform: process.platform,
      grokBinary: resolveGrokBinary(),
      grokHome: grokHomeDir(),
    }) + "\n");
    app.quit();
    return;
  }
  setDesktopStateLoader(loadState);
  setAllowPrerelease(Boolean(loadState().allowPrerelease));
  registerIpc();
  wireWindowMenuRefresh();
  // Native splash first; main window stays hidden until the renderer paints.
  createWindow({ splash: true, cwd: launchProject || undefined });
  installApplicationMenu();
  setupAutoUpdater({ disposeAgent: disposeAgentQuick });

  void startPreviewApi({
    windowById: (id) => {
      const win = BrowserWindow.fromId(Number(id));
      return win && !win.isDestroyed() ? win : null;
    },
    getOwner: () => {
      const ws = focusedSession();
      return ws?.win && !ws.win.isDestroyed() ? ws.win : null;
    },
  })
    .then((preview) => {
      debugLog("preview", "api-ready", {
        port: preview?.port || null,
        ready: Boolean(preview),
      });
      installDesktopPreviewSkill();
    })
    .catch((err) => {
      debugLog("preview", "api-failed", {
        error: err?.message || String(err),
      });
      installDesktopPreviewSkill();
    });

  // Warm Docker sandbox image in the background when sandbox is on (default).
  // Pull/build must never run on the terminal/create hot path (freezes UI).
  // Delay the WSL/bwrap spawnSync probe so first paint is not stalled.
  try {
    const state = loadState();
    setDebugLogging(Boolean(state.debugLogging));
    debugLog("app", "ready", {
      version: app.getVersion(),
      debug: isDebugLogging(),
      logPath: getDebugLogPath(),
    });
    if (state.sandboxTerminal !== false) {
      setTimeout(() => {
        try {
          maybeWarmDockerSandbox();
        } catch {
          /* ignore */
        }
      }, 1500);
    }
  } catch {
    /* ignore */
  }

  app.on("activate", () => {
    // Do not recreate a window mid update-install
    if (isQuittingForUpdate()) return;
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ splash: true });
    }
  });
});

app.on("window-all-closed", () => {
  if (isQuittingForUpdate()) return;
  if (process.platform !== "darwin") app.quit();
});

// Do not `await` dispose here — async before-quit handlers can stall
// electron-updater quitAndInstall so "Restart now" appears to do nothing.
app.on("before-quit", () => {
  appQuitting = true;
  closeSplash();
  disposeAgentQuick();
  void stopArtifactServer();
});
