import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "./components/BrandMark";
import { MessageList } from "./components/MessageList";
import { SideWorkbench } from "./components/side-workbench/SideWorkbench";
import { SettingsDialog } from "./components/SettingsDialog";

import { PlanApprovalDialog } from "./components/PlanApprovalDialog";
import { AskUserDialog } from "./components/AskUserDialog";
import { WorkingKnowledgeSheet } from "./components/WorkingKnowledgeSheet";
import { FolderTrustDialog } from "./components/FolderTrustDialog";
import { McpElicitDialog } from "./components/McpElicitDialog";
import {
  WorktreeDialog,
  type WorktreeDialogState,
} from "./components/WorktreeDialog";
import { ApprovalsDock } from "./components/ApprovalsDock";
import { AppSidebar } from "./components/AppSidebar";
import { ChatTopbar } from "./components/ChatTopbar";
import { ColumnResizeHandle } from "./components/ColumnResizeHandle";
import { WelcomeView } from "./components/WelcomeView";
import { Composer } from "./components/Composer";
import { CommandPalette } from "./components/CommandPalette";
import { FindBar } from "./components/FindBar";
import { QuestionIndex } from "./components/QuestionIndex";
import { ScheduledLoopsBar } from "./components/ScheduledLoopsBar";
import { AppTooltipProvider } from "./components/ui/tooltip";
import { useColumnLayout } from "./hooks/useColumnLayout";
import {
  DESKTOP_COMMANDS,
  mergeCommands,
  skillsToCommands,
  type SlashCommand,
} from "./lib/commands";
import {
  nextAlwaysApproveMode,
  runDesktopCommand,
} from "./lib/desktop-commands";
import { isMissingBinaryError, type ConnState } from "./lib/conn";
import { classifyErrorAction } from "../shared/error-actions.mjs";
import { parkedUpdateNotice } from "../shared/parked-notice.mjs";
import { folderDisplayName } from "../shared/sidebar-chats.mjs";
import {
  ensureLiveSessionInList,
  mergeDraftSessions,
  shouldAbandonEmptySession,
  timelineHasUserSpeech,
} from "../shared/workspace-org.mjs";
import {
  clearUnread,
  markUnread,
  popSessionHistory,
  pushSessionHistory,
  readDraft,
  readReading,
  rememberProjectOrder,
  addProjectToOrder,
  saveReading,
  sessionOrgKey,
  setArchived,
  setProjectOrder,
  setShowArchived,
  togglePinned,
  togglePinnedProject,
  useFlowState,
} from "./lib/workspace-store";
import {
  normalizeAutoCompactAt,
  shouldAutoCompact,
  type AutoCompactAt,
} from "../shared/auto-compact.mjs";
import {
  COMPACT_PREP_PROMPT,
  COMPACT_PRESERVE_HINT,
  COMPACT_CATCH_UP_PROMPT,
  shouldCompactAfterPrep,
  shouldSendCatchUpAfterCompact,
  shouldSendCatchUpAfterUserInsert,
} from "../shared/compact-prep-flow.mjs";
import {
  cutIndexAfterUserId,
  cutIndexBeforeUserId,
  dropUserPromptExecIndex,
  lastUserPromptIndex,
  userPromptIndexAtOrBefore,
  userPromptIndexOf,
} from "../shared/edit-user-message.mjs";
import { PrivacyProvider } from "./lib/privacy-context";
import { redactSensitiveText } from "./lib/privacy";
import { samePathKey } from "./lib/path-utils";
import { hideBootSplash } from "./lib/boot-splash";
import { applyTheme, readStoredTheme, storeTheme } from "./lib/theme";
import { applySessionUpdate, uid } from "./lib/timeline";
import { planApproveCommentsText } from "../shared/plan-approval.mjs";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useAgentSafety } from "./hooks/useAgentSafety";
import { useProjectSession } from "./hooks/useProjectSession";
import { usePromptDelivery } from "./hooks/usePromptDelivery";
import { useRevealLatestTurn } from "./hooks/useRevealLatestTurn";
import { useStickToBottom } from "./hooks/useStickToBottom";
import { useUnsavedGuard } from "./hooks/useUnsavedGuard";
import type {
  AppInfo,
  AuthStatus,
  AvailableModel,
  BackboneSummary,
  LoginProgress,
  OpenCheckoutRow,
  SessionSummary,
  TimelineItem,
  WorkingKnowledgeSnapshot,
} from "./vite-env";

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [backbone, setBackbone] = useState<BackboneSummary | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [loginProgress, setLoginProgress] = useState<LoginProgress | null>(
    null,
  );
  const [project, setProject] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [catalog, setCatalog] = useState<SessionSummary[]>([]);
  const [liveTurnIds, setLiveTurnIds] = useState<string[]>([]);
  /** Live session model from ACP (session/new|load). */
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  /** Optimistic pick while session/set_model is in flight. */
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  /** Bumped on failed switch so the native <select> remounts onto the previous id. */
  const [modelSelectEpoch, setModelSelectEpoch] = useState(0);
  const [conn, setConn] = useState<ConnState>("idle");
  const [openingLabel, setOpeningLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">(readStoredTheme);
  const [privacyMode, setPrivacyMode] = useState(false);
  /** SpaceXAI coding-data share; default opt-in (matches CLI /privacy). */
  const [codingDataOptIn, setCodingDataOptIn] = useState(true);
  const [codingDataNote, setCodingDataNote] = useState<string | undefined>();
  const [debugLogging, setDebugLogging] = useState(false);
  const [debugLogPath, setDebugLogPath] = useState("");
  const [allowPrerelease, setAllowPrerelease] = useState(false);
  const [autoCompactAt, setAutoCompactAt] = useState<AutoCompactAt>("off");
  const autoCompactFiredRef = useRef({ sessionId: "", tokens: 0 });
  const autoCompactInFlightRef = useRef(false);
  const autoCompactFailedAtRef = useRef({ sessionId: "", tokens: 0 });
  const autoCompactUnsupportedRef = useRef(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitDetached, setGitDetached] = useState(false);
  const { setFilesDirty, confirmDiscardFiles } = useUnsavedGuard();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledge, setKnowledge] = useState<WorkingKnowledgeSnapshot | null>(
    null,
  );
  const [knowledgeNote, setKnowledgeNote] = useState<string | null>(null);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    "mcp" | "plugins" | "skills" | "memory" | "peer" | null
  >(null);
  const [offerAgentRestart, setOfferAgentRestart] = useState(false);
  const [agentCommands, setAgentCommands] = useState<SlashCommand[]>([]);
  const [openCheckouts, setOpenCheckouts] = useState<OpenCheckoutRow[]>([]);
  const [worktreeDialog, setWorktreeDialog] =
    useState<WorktreeDialogState | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const openingRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const timelineCacheRef = useRef(new Map<string, TimelineItem[]>());
  const stashLiveTimeline = useCallback(() => {
    const id = String(sessionIdRef.current || "");
    if (!id) return;
    const cur = itemsRef.current;
    if (cur.length) timelineCacheRef.current.set(id, cur);
  }, []);
  const takeCachedTimeline = useCallback((sid?: string | null) => {
    const id = String(sid || "");
    if (!id) return undefined;
    return timelineCacheRef.current.get(id);
  }, []);
  const modelApplyLock = useRef(false);
  const modelApplyGen = useRef(0);
  const loginGen = useRef(0);
  const [loginDeviceAuth, setLoginDeviceAuth] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findId, setFindId] = useState<string | null>(null);
  const [reviveNonce, setReviveNonce] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const [bundleStale, setBundleStale] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const flow = useFlowState();
  const hiddenAtRef = useRef(0);
  const notifiedTaskRef = useRef(new Set<string>());
  const notifiedNeedRef = useRef("");
  const prevSessionRef = useRef<{
    cwd: string;
    sessionId: string;
    hadUserSpeech: boolean;
    hasDraft: boolean;
  } | null>(null);

  const appendSystem = useCallback((text: string) => {
    setItems((prev) => [
      ...prev,
      { id: uid("sys"), kind: "system", text, at: Date.now() },
    ]);
  }, []);

  const clearOfferAgentRestart = useCallback(() => {
    setOfferAgentRestart(false);
  }, []);

  const {
    permissionMode,
    reasoningEffort,
    allowOutsideProject,
    sandboxTerminal,
    sandboxStatus,
    hydrateFromInfo,
    applyPermissionMode,
    applyReasoningEffort,
    toggleAllowOutside,
    applySandboxTerminal,
  } = useAgentSafety({ setError, appendSystem });

  const {
    permissions,
    backgroundTasks,
    scheduledTasks,
    sessionUsage,
    sessionMode,
    hydrateSessionMode,
    syncParkedRequestsFromMain,
    planApproval,
    userQuestion,
    folderTrust,
    mcpElicit,
    clearSessionScoped,
    revokeWritesThisSession,
    hydrateBackgroundTasks,
    hydrateScheduledTasks,
    dropScheduledTask,
    hydrateSessionUsage,
    syncPermissionsFromMain,
    onPermission,
    onAllowAllPermissions,
    allowWritesThisSession,
    onAllowWritesThisSession,
    onRevokeWritesThisSession,
    onPlanApproval,
    onUserQuestion,
    onFolderTrust,
    onMcpElicit,
    beginOpening,
    bindOpeningSession,
    abortOpening,
    finishOpening,
    applyOpenTimeline,
  } = useAgentEvents({
    openingRef,
    sessionIdRef,
    setConn,
    setError,
    setSessionId,
    setItems,
    setAgentCommands,
    setSettingsOpen,
  });

  const refreshAuth = useCallback(async () => {
    const status = await window.grokDesktop.getAuthStatus();
    setAuth(status);
    return status;
  }, []);

  const refreshBackbone = useCallback(async (cwd?: string) => {
    const summary = await window.grokDesktop.inspectBackbone(cwd);
    setBackbone(summary);
    return summary;
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const i = await window.grokDesktop.getInfo();
      setInfo(i);
      hydrateFromInfo(i);
      setPrivacyMode(Boolean(i.privacyMode));
      setCodingDataOptIn(i.codingDataOptIn !== false);
      setCodingDataNote(i.codingDataStatus?.note);
      setDebugLogging(Boolean(i.debugLogging));
      setDebugLogPath(i.debugLogPath || "");
      setAllowPrerelease(Boolean(i.allowPrerelease));
      setAutoCompactAt(normalizeAutoCompactAt(i.autoCompactAt));
      const nextTheme = i.theme === "light" ? "light" : "dark";
      setTheme(nextTheme);
      applyTheme(nextTheme);
      setAuth(i.auth);
      if (i.auth.authenticated && !i.auth.expired) {
        void refreshBackbone(i.lastProject || undefined);
      }
    } catch {
      /* WelcomeView still renders; native splash waits for first paint, not this. */
    }
  }, [refreshBackbone, hydrateFromInfo]);

  useEffect(() => {
    hideBootSplash();
    void bootstrap();
  }, [bootstrap]);

  const timelineScrollKey = useMemo(() => {
    const last = items[items.length - 1];
    if (!last) return "empty";
    const tail =
      last.kind === "assistant" ||
      last.kind === "thought" ||
      last.kind === "user"
        ? String((last as { text?: string }).text?.length ?? 0)
        : last.kind === "tool"
          ? `${last.status}:${String((last as { content?: unknown }).content ? 1 : 0)}`
          : last.kind;
    return `${items.length}:${last.id}:${last.kind}:${tail}`;
  }, [items]);

  const {
    pinToBottom,
    revealStart,
    hasNewContent,
    clearNewContent,
    stuckToBottom,
  } = useStickToBottom(
    timelineRef,
    timelineScrollKey,
    `${project ?? ""}:${sessionId ?? ""}`,
    {
      restoreTop:
        project && sessionId ? readReading(project, sessionId) : null,
      onScrollPosition: (top) => {
        if (openingRef.current) return;
        if (project && sessionId) saveReading(project, sessionId, top);
      },
    },
  );

  const { markPendingReveal, revealNow } = useRevealLatestTurn({
    items,
    scrollerRef: timelineRef,
    revealStart,
    resetKey: `${project ?? ""}:${sessionId ?? ""}`,
  });

  const {
    promptQueue,
    promptQueueRef,
    sendNowRef,
    afterTurnRef,
    clearPromptQueue,
    removeQueued,
    submitFromComposer,
    queueNextPrompt,
    sendQueuedNow,
    stopTurn,
    moveQueued,
    editQueued,
  } = usePromptDelivery({
    project,
    sessionIdRef,
    conn,
    busyRef,
    openingRef,
    onPromptSent: markPendingReveal,
    setConn,
    setError,
    setItems,
    refreshAuth: () => {
      void refreshAuth();
    },
    onDeliveryFailed: () => setReviveNonce((n) => n + 1),
  });

  const signedIn = Boolean(auth?.authenticated && !auth?.expired);

  const leaveProject = useCallback(async () => {
    try {
      await window.grokDesktop.closeProject();
    } catch {
      /* ignore — still clear local UI */
    }
    setProject(null);
    setSessionId(null);
    setSessions([]);
    setModelId(null);
    setModelName(null);
    setAvailableModels([]);
    setItems([]);
    setConn("idle");
    setError(null);
    setOfferAgentRestart(false);
  }, []);

  const onMissingBinary = useCallback(async () => {
    await leaveProject();
    await refreshAuth();
  }, [leaveProject, refreshAuth]);

  const { openProject, openSession, restartAgent, isAuthError } =
    useProjectSession({
      auth,
      project,
      busyRef,
      openingRef,
      promptQueueRef,
      sendNowRef,
      clearSessionScoped,
      revokeWritesThisSession,
      hydrateBackgroundTasks,
      hydrateScheduledTasks,
      hydrateSessionUsage,
      hydrateSessionMode,
      syncParkedRequestsFromMain,
      syncPermissionsFromMain,
      hydrateFromInfo,
      beginOpening,
      bindOpeningSession,
      abortOpening,
      finishOpening,
      applyOpenTimeline,
      stashLiveTimeline,
      takeCachedTimeline,
      refreshAuth,
      refreshBackbone,
      setBackbone,
      onOpenApplied: clearOfferAgentRestart,
      setAuth,
      setInfo,
      setProject,
      setSessionId,
      setSessions,
      setModelId,
      setModelName,
      setAvailableModels,
      setConn,
      setOpeningLabel,
      setError,
      setItems,
      setAgentCommands,
      clearPromptQueue,
      onMissingBinary,
      onCheckoutConflict: (conflict, cwd) => {
        setWorktreeError(null);
        setWorktreeDialog({ kind: "conflict", conflict, pendingCwd: cwd });
      },
    });

  const renameSession = useCallback(
    async (opts: { sessionId: string; title: string; cwd?: string }) => {
      if (!project) return;
      try {
        const res = await window.grokDesktop.renameSession({
          cwd: opts.cwd || project,
          sessionId: opts.sessionId,
          title: opts.title,
        });
        if (res?.sessions) setSessions(res.sessions);
        else setSessions(await window.grokDesktop.listSessions(project));
        setError(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [project],
  );

  const deleteSession = useCallback(
    async (opts: { sessionId: string; cwd?: string }) => {
      if (!project) return;
      const wasCurrent = opts.sessionId === sessionId;
      if (wasCurrent && conn === "busy") {
        throw new Error("Stop the current turn before deleting this chat.");
      }
      try {
        const res = await window.grokDesktop.deleteSession({
          cwd: opts.cwd || project,
          sessionId: opts.sessionId,
        });
        const nextList =
          res?.sessions || (await window.grokDesktop.listSessions(project));
        setSessions(nextList);
        setError(null);
        if (wasCurrent) {
          const next = nextList.find((s) => s.id !== opts.sessionId) || nextList[0];
          if (next) await openSession({ mode: "resume", sessionId: next.id });
          else await openSession({ mode: "new" });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [project, sessionId, conn, openSession],
  );

  useEffect(() => {
    if (!project) return;
    if (typeof window.grokDesktop.listSessionsAll !== "function") {
      setCatalog(sessions);
      return;
    }
    const cwds = [project, ...(info?.recentProjects || [])].filter(Boolean);
    let stop = false;
    void window.grokDesktop
      .listSessionsAll(cwds)
      .then((list) => {
        if (!stop) setCatalog(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!stop) setCatalog(sessions);
      });
    return () => {
      stop = true;
    };
  }, [project, sessionId, sessions, info?.recentProjects]);

  const sidebarSessions = useMemo(
    () =>
      ensureLiveSessionInList(
        mergeDraftSessions(
          catalog.length ? catalog : sessions,
          flow.drafts,
        ),
        { id: sessionId, cwd: project },
      ) as SessionSummary[],
    [catalog, sessions, flow.drafts, sessionId, project],
  );

  useEffect(() => {
    const known = [
      project,
      ...(info?.recentProjects || []),
      ...sidebarSessions.map((s) => s.cwd),
    ].filter(Boolean) as string[];
    rememberProjectOrder(known);
  }, [project, info?.recentProjects, sidebarSessions]);

  useEffect(() => {
    if (typeof window.grokDesktop.listLiveTurns !== "function") return;
    let stop = false;
    const pull = () => {
      void window.grokDesktop
        .listLiveTurns()
        .then((ids) => {
          if (!stop && Array.isArray(ids)) setLiveTurnIds(ids.map(String));
        })
        .catch(() => {});
    };
    pull();
    const t = window.setInterval(pull, conn === "busy" ? 700 : 2000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [sessionId, conn]);

  const liveSessionIds = useMemo(() => {
    const ids = new Set(liveTurnIds);
    if (conn === "busy" && sessionId) ids.add(sessionId);
    return [...ids];
  }, [liveTurnIds, conn, sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (meta && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return window.grokDesktop.on("app:find", () => setFindOpen(true));
  }, []);

  useEffect(() => {
    return window.grokDesktop.on("app:notify-click", (payload) => {
      const sid = String((payload as { sessionId?: string })?.sessionId || "");
      const cwd = String((payload as { cwd?: string })?.cwd || "");
      if (!sid) return;
      if (cwd && project && !samePathKey(cwd, project)) {
        void openProject(cwd, { mode: "resume", sessionId: sid });
      } else {
        void openSession({ mode: "resume", sessionId: sid });
      }
    });
  }, [project, openProject, openSession]);

  useEffect(() => {
    if (!info?.packaged) return;
    if (info.bundleStale) setBundleStale(true);
    const t = window.setInterval(() => {
      void window.grokDesktop.bundleStale?.().then((r) => {
        if (r?.stale) setBundleStale(true);
      });
    }, 20000);
    return () => window.clearInterval(t);
  }, [info?.packaged, info?.bundleStale]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") hiddenAtRef.current = Date.now();
      else {
        const hiddenFor = Date.now() - (hiddenAtRef.current || 0);
        if (hiddenFor > 30_000 && project) {
          setReconnecting(true);
          void (async () => {
            try {
              const ping = await window.grokDesktop.pingAgent?.();
              if (ping && ping.ok === false) {
                await restartAgent();
                return;
              }
              await window.grokDesktop.getInfo();
            } finally {
              setReconnecting(false);
            }
          })();
        }
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [project, restartAgent]);

  useEffect(() => {
    if (!project || !sessionId) return;
    const needsYou =
      permissions.length > 0 || Boolean(planApproval) || Boolean(userQuestion);
    if (!needsYou) {
      notifiedNeedRef.current = "";
      return;
    }
    markUnread(project, sessionId, { needsYou: true, unread: true });
    const key = `${planApproval?.reqId || ""}:${userQuestion?.reqId || ""}:${permissions[0]?.reqId || ""}`;
    if (notifiedNeedRef.current === key) return;
    notifiedNeedRef.current = key;
    if (!document.hasFocus() && window.grokDesktop.notify) {
      void window.grokDesktop.notify({
        title: "Grok Desktop",
        body: "有一步需要你决定",
        sessionId,
        cwd: project,
      });
    }
  }, [permissions, planApproval, userQuestion, project, sessionId]);

  useEffect(() => {
    if (!project || !sessionId) return;
    for (const task of backgroundTasks) {
      if (task.status !== "completed" && task.status !== "failed") continue;
      if (notifiedTaskRef.current.has(task.id)) continue;
      notifiedTaskRef.current.add(task.id);
      if (!document.hasFocus()) {
        markUnread(project, sessionId, {
          unread: true,
          failed: task.status === "failed",
        });
        void window.grokDesktop.notify?.({
          title: "Grok Desktop",
          body: task.status === "failed" ? "有任务失败了" : "后台任务做完了",
          sessionId,
          cwd: project,
        });
      }
    }
  }, [backgroundTasks, project, sessionId]);

  useEffect(() => {
    if (!project || !sessionId) return;
    if (!document.hasFocus()) return;
    if (!stuckToBottom) return;
    clearUnread(project, sessionId);
  }, [project, sessionId, stuckToBottom]);

  useEffect(() => {
    return window.grokDesktop.on("agent:parked-update", (payload) => {
      const row = payload as {
        sessionId?: string;
        cwd?: string;
        params?: unknown;
        needsYou?: boolean;
      };
      const sid = String(row.sessionId || "");
      const cwd = String(row.cwd || "");
      if (!sid || !cwd) return;
      if (row.params) {
        const prev = timelineCacheRef.current.get(sid) || [];
        timelineCacheRef.current.set(
          sid,
          applySessionUpdate(prev, row.params),
        );
      }
      let notice = row.needsYou
        ? { unread: true, failed: false, needsYou: true }
        : parkedUpdateNotice(row.params);
      if (!notice) return;
      markUnread(cwd, sid, notice);
      if (!document.hasFocus() || sid !== sessionIdRef.current) {
        void window.grokDesktop.notify?.({
          title: "Grok Desktop",
          body: notice.needsYou
            ? "有一步需要你决定"
            : notice.failed
              ? "有任务失败了"
              : "有新结果",
          sessionId: sid,
          cwd,
        });
      }
    });
  }, []);

  const closeWorktreeDialog = useCallback(() => {
    setWorktreeDialog(null);
    setWorktreeError(null);
    setWorktreeBusy(false);
  }, []);

  const openPathAfterWorktree = useCallback(
    async (cwd: string, newWindow: boolean) => {
      if (newWindow) {
        await window.grokDesktop.openProjectInNewWindow(cwd);
        closeWorktreeDialog();
        return;
      }
      closeWorktreeDialog();
      await openProject(cwd, { allowSameCheckout: true });
    },
    [closeWorktreeDialog, openProject],
  );

  const handleCreateWorktree = useCallback(
    async (opts: { cwd: string; newWindow: boolean }) => {
      setWorktreeBusy(true);
      setWorktreeError(null);
      try {
        const added = await window.grokDesktop.createWorktree({
          cwd: opts.cwd,
        });
        await openPathAfterWorktree(added.path, opts.newWindow);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (worktreeDialog) setWorktreeError(msg);
        else setError(msg);
      } finally {
        setWorktreeBusy(false);
      }
    },
    [openPathAfterWorktree, worktreeDialog],
  );

  const createWorktreeInNewWindow = useCallback(
    async (sourceCwd: string) => {
      await handleCreateWorktree({ cwd: sourceCwd, newWindow: true });
    },
    [handleCreateWorktree],
  );

  const pendingOpenTried = useRef(false);
  const autoHomeTried = useRef(false);
  useEffect(() => {
    if (!signedIn || pendingOpenTried.current) return;
    pendingOpenTried.current = true;
    void window.grokDesktop.takePendingOpen().then((pending) => {
      if (pending?.cwd) {
        autoHomeTried.current = true;
        void openProject(pending.cwd, {
          allowSameCheckout: pending.allowSameCheckout,
        });
      }
    });
  }, [signedIn, openProject]);

  useEffect(() => {
    if (!signedIn || project || autoHomeTried.current) return;
    const home = info?.home;
    if (!home) return;
    autoHomeTried.current = true;
    void openProject(home);
  }, [signedIn, project, info?.home, openProject]);

  const pickProject = async () => {
    if (!signedIn || conn === "connecting") {
      if (!signedIn) setError("Sign in to Grok first.");
      return;
    }
    if (!confirmDiscardFiles()) return;
    const cwd = await window.grokDesktop.pickProject();
    if (cwd) await openProject(cwd);
  };

  /** Catalog only: do not park, cancel, or switch the live agent. */
  const addProjectToSidebar = async () => {
    const cwd = await window.grokDesktop.pickProject();
    if (!cwd) return;
    try {
      if (typeof window.grokDesktop.addRecentProject === "function") {
        await window.grokDesktop.addRecentProject(cwd);
      }
      const i = await window.grokDesktop.getInfo();
      setInfo(i);
      addProjectToOrder(cwd);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isOpening = conn === "connecting";

  useEffect(() => {
    return window.grokDesktop.on("auth:login-progress", (payload) => {
      const next = (payload || {}) as LoginProgress;
      setLoginProgress(next);
      if (next.output) setAuthMessage(next.output);
    });
  }, []);

  useEffect(() => {
    return window.grokDesktop.on("auth:changed", (payload) => {
      if (payload && typeof payload === "object") {
        setAuth(payload as AuthStatus);
      }
    });
  }, []);

  useEffect(() => {
    void window.grokDesktop.setSettingsOpen(settingsOpen);
  }, [settingsOpen]);

  useEffect(() => {
    return window.grokDesktop.on("app:close-settings", () => {
      setSettingsOpen(false);
      setSettingsSection(null);
    });
  }, []);

  useEffect(() => {
    void window.grokDesktop.listOpenCheckouts().then(setOpenCheckouts);
    return window.grokDesktop.on("app:open-checkouts", (payload) => {
      setOpenCheckouts(Array.isArray(payload) ? payload : []);
    });
  }, []);

  useEffect(() => {
    return window.grokDesktop.on("app:new-worktree", () => {
      if (!project) {
        setError("Open a git project first, then create a worktree.");
        return;
      }
      void createWorktreeInNewWindow(project);
    });
  }, [project, createWorktreeInNewWindow]);

  const handleLogin = async (deviceAuth = false) => {
    const gen = ++loginGen.current;
    setAuthBusy(true);
    setLoginDeviceAuth(deviceAuth);
    setLoginProgress(null);
    setAuthMessage(
      deviceAuth
        ? "Starting device-code login…"
        : "Opening browser for Grok sign-in…",
    );
    setError(null);
    try {
      const result = await window.grokDesktop.login({ deviceAuth });
      if (gen !== loginGen.current) return;
      if (result.status) setAuth(result.status);
      if (result.output) setAuthMessage(result.output);
      if (result.ok || result.status?.authenticated) {
        setLoginProgress(null);
        setAuthMessage(result.output || "Signed in successfully.");
        await refreshBackbone();
        await bootstrap();
      } else if (result.error) {
        setAuthMessage(result.error);
        setError(result.error);
        if (isMissingBinaryError(result.error)) {
          await refreshAuth();
        }
      }
    } catch (e: unknown) {
      if (gen !== loginGen.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setAuthMessage(msg);
      setError(msg);
      if (isMissingBinaryError(msg)) {
        await refreshAuth();
      }
    } finally {
      if (gen === loginGen.current) {
        setAuthBusy(false);
        void refreshAuth();
      }
    }
  };

  const handleCancelLogin = async () => {
    loginGen.current += 1;
    await window.grokDesktop.cancelLogin();
    setAuthBusy(false);
    setLoginDeviceAuth(false);
    setLoginProgress(null);
    setAuthMessage("Login cancelled.");
    void refreshAuth();
  };

  const handleSubmitLoginCode = async (code: string) => {
    const result = await window.grokDesktop.submitLoginInput(code);
    if (result.ok) {
      setAuthMessage("Code sent. Waiting for Grok to finish sign-in…");
      return;
    }
    setAuthMessage(result.error || "Could not send the code.");
  };

  // Model is session-scoped; drop the label when the agent/session goes away.
  useEffect(() => {
    if (!sessionId) {
      setModelId(null);
      setModelName(null);
      setAvailableModels([]);
    }
    modelApplyGen.current += 1;
    modelApplyLock.current = false;
    setPendingModelId(null);
  }, [sessionId]);

  const applyModel = useCallback(
    async (nextId: string) => {
      if (!nextId || nextId === modelId || modelApplyLock.current) return;
      const sessionAtStart = sessionIdRef.current;
      const gen = modelApplyGen.current;
      modelApplyLock.current = true;
      setPendingModelId(nextId);
      try {
        const result = await window.grokDesktop.setModel(nextId);
        if (
          gen !== modelApplyGen.current ||
          sessionAtStart !== sessionIdRef.current
        ) {
          return;
        }
        if (result.agentSynced === false) {
          setPendingModelId(null);
          setModelSelectEpoch((n) => n + 1);
          setError(
            result.error
              ? `Could not switch model (${result.error}).`
              : "Could not switch model.",
          );
          return;
        }
        setModelId(result.modelId || nextId);
        setModelName(result.modelName || null);
        if (Array.isArray(result.availableModels)) {
          setAvailableModels(result.availableModels);
        }
        setPendingModelId(null);
        setError(null);
        const label = result.modelName
          ? result.modelId && result.modelName !== result.modelId
            ? `${result.modelName} (${result.modelId})`
            : result.modelName
          : result.modelId || nextId;
        appendSystem(`Model: ${label}`);
      } catch (e: unknown) {
        if (
          gen !== modelApplyGen.current ||
          sessionAtStart !== sessionIdRef.current
        ) {
          return;
        }
        setPendingModelId(null);
        setModelSelectEpoch((n) => n + 1);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Failed to set model: ${msg}`);
      } finally {
        if (gen === modelApplyGen.current) {
          modelApplyLock.current = false;
        }
      }
    },
    [modelId, appendSystem],
  );

  const handleLogout = async () => {
    if (!confirmDiscardFiles()) return;
    setAuthBusy(true);
    try {
      await leaveProject();
      const res = await window.grokDesktop.logout();
      if (res.status) setAuth(res.status);
      setAuthMessage(res.message || "Signed out");
      setBackbone(null);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSetApiKey = async (key: string) => {
    setAuthBusy(true);
    setError(null);
    try {
      const res = await window.grokDesktop.setApiKey(key);
      setAuth(res.status);
      if (res.ok) {
        setAuthMessage("API key set for this session.");
        await refreshBackbone();
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const allCommands = useMemo(
    () =>
      mergeCommands({
        desktop: DESKTOP_COMMANDS,
        skills: skillsToCommands(backbone?.skills || []),
        agent: agentCommands,
      }),
    [backbone?.skills, agentCommands],
  );

  const compactingRef = useRef(false);
  const [compacting, setCompacting] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => {
    setEditingUserId(null);
    setEditSubmitting(false);
  }, [sessionId]);

  const runCompress = useCallback(
    async (hint?: unknown, opts?: { fromPrep?: boolean }) => {
      if (!project || openingRef.current) return false;
      if (!opts?.fromPrep && conn !== "online") {
        appendSystem("Compress is available when the agent is idle.");
        return false;
      }
      if (compactingRef.current) return false;
      if (typeof window.grokDesktop.compact !== "function") {
        appendSystem(
          "Restart this Grok Desktop window to enable Compress (Electron preload does not hot-reload).",
        );
        return false;
      }
      const note = typeof hint === "string" ? hint.trim() : "";
      compactingRef.current = true;
      setCompacting(true);
      try {
        const result = (await window.grokDesktop.compact(note)) as {
          ok?: boolean;
          message?: string;
          tokens_before?: number;
          tokensBefore?: number;
          tokens_after?: number;
          tokensAfter?: number;
        } | null;
        if (result && result.ok === false) {
          throw new Error(result.message || "Compress failed");
        }
        const before = Number(result?.tokens_before ?? result?.tokensBefore);
        const after = Number(result?.tokens_after ?? result?.tokensAfter);
        // Empty CompactConversationResponse is success; counts come from
        // session_notification, not the RPC body.
        if (Number.isFinite(before) && Number.isFinite(after) && before > 0) {
          appendSystem(
            `Conversation compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens.`,
          );
        }
        const mark = Math.max(
          sessionUsage.lastContextTokens,
          Number.isFinite(after) && after > 0 ? after : 0,
        );
        autoCompactFiredRef.current = {
          sessionId: sessionIdRef.current || "",
          tokens: mark,
        };
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          /does not support Compress|not available on this Grok CLI|-32601|method not found/i.test(
            msg,
          )
        ) {
          autoCompactUnsupportedRef.current = true;
        }
        setError(msg || "Compress failed");
        appendSystem(`Compress failed: ${msg}`);
        return false;
      } finally {
        compactingRef.current = false;
        setCompacting(false);
      }
    },
    [project, conn, sessionUsage.lastContextTokens, appendSystem, setError],
  );

  const runCompressRef = useRef(runCompress);
  runCompressRef.current = runCompress;

  const submitEditedUser = useCallback(
    async (id: string, text: string) => {
      const trimmed = String(text || "").trim();
      if (!trimmed) return;
      if (!project || openingRef.current) return;
      if (conn !== "online" || busyRef.current) {
        appendSystem("空闲时才能改消息。");
        return;
      }
      const index = userPromptIndexOf(items, id);
      const exec = dropUserPromptExecIndex(index);
      if (exec == null) return;
      if (typeof window.grokDesktop.rewind !== "function") {
        appendSystem(
          "请重新打开 Grok Desktop 窗口后再改消息（当前窗口还没有这个能力）。",
        );
        return;
      }
      setEditSubmitting(true);
      try {
        await window.grokDesktop.rewind(exec);
        setItems((prev) => prev.slice(0, cutIndexBeforeUserId(prev, id)));
        setEditingUserId(null);
        const ok = await submitFromComposer({
          text: trimmed,
          images: [],
          mode: "auto",
        });
        if (!ok) appendSystem("改好的话没发出去。");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || "改消息失败");
        appendSystem(`没改成：${msg}`);
      } finally {
        setEditSubmitting(false);
      }
    },
    [
      project,
      conn,
      items,
      appendSystem,
      setError,
      submitFromComposer,
    ],
  );

  const branchFromAssistant = useCallback(
    async (id: string) => {
      if (!project || openingRef.current) return;
      if (conn !== "online" || busyRef.current) {
        appendSystem("空闲时才能从这里开一条新对话。");
        return;
      }
      if (typeof window.grokDesktop.forkSession !== "function") {
        appendSystem(
          "请重新打开 Grok Desktop 窗口后再分支（当前窗口还没有这个能力）。",
        );
        return;
      }
      const through = userPromptIndexAtOrBefore(items, id);
      const last = lastUserPromptIndex(items);
      if (through < 0) return;
      try {
        const result = await window.grokDesktop.forkSession({
          throughUserPromptIndex: through,
          lastUserPromptIndex: last,
        });
        const sid = String(result?.sessionId || "").trim();
        if (!sid) throw new Error("没有得到新对话");
        appendSystem("已从这里开出一条新对话。");
        await openSession({ mode: "resume", sessionId: sid });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || "分支失败");
        appendSystem(`没开成新对话：${msg}`);
      }
    },
    [
      project,
      conn,
      items,
      appendSystem,
      setError,
      openSession,
    ],
  );

  const runMeterCompact = useCallback(async () => {
    if (!project || openingRef.current) return;
    if (conn !== "online" || busyRef.current) {
      appendSystem("余量格子在空闲时才能点。");
      return;
    }
    if (compactingRef.current || afterTurnRef.current) return;
    afterTurnRef.current = async (result) => {
      if (!shouldCompactAfterPrep(result)) {
        appendSystem("胶囊没写成，所以没有压缩。");
        return;
      }
      const compacted = await runCompressRef.current(COMPACT_PRESERVE_HINT, {
        fromPrep: true,
      });
      if (!shouldSendCatchUpAfterCompact(compacted)) return;
      if (
        !shouldSendCatchUpAfterUserInsert({
          sendNow: sendNowRef.current,
          queued: promptQueueRef.current,
        })
      ) {
        return;
      }
      queueNextPrompt(COMPACT_CATCH_UP_PROMPT);
    };
    const accepted = await submitFromComposer({
      text: COMPACT_PREP_PROMPT,
      images: [],
      mode: "auto",
    });
    if (!accepted) {
      afterTurnRef.current = null;
      return;
    }
    appendSystem("先写一份继续施工胶囊，写好后再压缩，压缩完会强制读 Catch up。");
  }, [
    project,
    conn,
    appendSystem,
    submitFromComposer,
    afterTurnRef,
    queueNextPrompt,
    sendNowRef,
    promptQueueRef,
  ]);

  const expandPanelRef = useRef<() => void>(() => {});
  const collapsePanelIfOpenRef = useRef<() => void>(() => {});
  const [browserOpen, setBrowserOpen] = useState<{
    seq: number;
    url?: string;
  } | null>(null);

  const openSideBrowser = useCallback((url?: string) => {
    expandPanelRef.current();
    setBrowserOpen({
      seq: Date.now(),
      url: String(url || "").trim(),
    });
  }, []);

  const reloadKnowledge = useCallback(async () => {
    if (typeof window.grokDesktop.workingKnowledgeStatus !== "function") {
      return;
    }
    const snap = await window.grokDesktop.workingKnowledgeStatus({
      sessionId,
      cwd: project,
    });
    setKnowledge(snap);
  }, [sessionId, project]);

  useEffect(() => {
    void reloadKnowledge().catch(() => {});
  }, [reloadKnowledge, conn, knowledgeOpen]);

  const handleLocalCommand = useCallback(
    (name: string, args = "") => {
      runDesktopCommand(
        name,
        {
          newChat: () => void openSession({ mode: "new" }),
          toggleAlwaysApprove: () =>
            applyPermissionMode(nextAlwaysApproveMode(permissionMode)),
          compact: (hint) => {
            void runCompress(hint);
          },
          openKnowledge: () => setKnowledgeOpen(true),
          plan: async (planArgs) => {
            const text = String(planArgs || "").trim();
            const sid = sessionIdRef.current;
            try {
              if (sessionMode !== "plan") {
                const result = await window.grokDesktop.setSessionMode("plan");
                if (!result.agentSynced) throw new Error(result.error || "未能进入计划模式。");
                if (sid !== sessionIdRef.current || openingRef.current) return;
                hydrateSessionMode(result.currentModeId);
              } else if (!text) {
                appendSystem("已经在计划模式，可以继续补充要求或查看当前计划。");
              }
              if (text && sid === sessionIdRef.current && !openingRef.current) {
                await submitFromComposer({ text, images: [], mode: "auto" });
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          },
          preview: async (previewArgs) => {
            const a = String(previewArgs || "").trim();
            try {
              if (a.toLowerCase() === "close") {
                collapsePanelIfOpenRef.current();
                try {
                  await window.grokDesktop.closePreview();
                } catch {
                  /* detach window may already be gone */
                }
                return;
              }
              if (a.toLowerCase() === "snapshot") {
                const snap = await window.grokDesktop.previewSnapshot();
                const tokens = Math.ceil((snap.chars || snap.text.length) / 4);
                appendSystem(
                  `Preview snapshot (~${tokens} tokens):\n${snap.text}`,
                );
                return;
              }
              openSideBrowser(a);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              setError(msg || "Preview failed");
            }
          },
        },
        args,
      );
    },
    [
      openSession,
      applyPermissionMode,
      permissionMode,
      appendSystem,
      setError,
      runCompress,
      openSideBrowser,
      sessionMode,
      hydrateSessionMode,
      submitFromComposer,
    ],
  );

  useEffect(() => {
    autoCompactFiredRef.current = { sessionId: sessionId || "", tokens: 0 };
    autoCompactFailedAtRef.current = { sessionId: sessionId || "", tokens: 0 };
    autoCompactInFlightRef.current = false;
    autoCompactUnsupportedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    autoCompactUnsupportedRef.current = false;
    autoCompactFailedAtRef.current = { sessionId: "", tokens: 0 };
  }, [autoCompactAt]);

  useEffect(() => {
    if (!project || !sessionId) return;
    if (conn !== "online") return;
    if (openingRef.current) return;
    if (autoCompactInFlightRef.current) return;
    if (autoCompactUnsupportedRef.current) return;
    const ctx = sessionUsage.lastContextTokens;
    const fired = autoCompactFiredRef.current;
    const already =
      fired.sessionId === sessionId ? fired.tokens : 0;
    if (
      !shouldAutoCompact({
        at: autoCompactAt,
        lastContextTokens: ctx,
        alreadyFiredAt: already,
      })
    ) {
      return;
    }
    const failed = autoCompactFailedAtRef.current;
    if (failed.sessionId === sessionId && failed.tokens === ctx) {
      return;
    }
    appendSystem(
      `Auto-compress: context is ${ctx.toLocaleString()} tokens (threshold ${autoCompactAt}).`,
    );
    autoCompactInFlightRef.current = true;
    void runCompress().then((ok) => {
      autoCompactInFlightRef.current = false;
      if (ok) {
        autoCompactFailedAtRef.current = { sessionId: "", tokens: 0 };
      } else if (!autoCompactUnsupportedRef.current) {
        autoCompactFailedAtRef.current = { sessionId, tokens: ctx };
      }
    });
  }, [
    project,
    sessionId,
    conn,
    sessionUsage.lastContextTokens,
    autoCompactAt,
    runCompress,
    appendSystem,
  ]);

  const applyAutoCompactAt = async (next: AutoCompactAt) => {
    setAutoCompactAt(next);
    try {
      const value = await window.grokDesktop.setAutoCompactAt(next);
      setAutoCompactAt(normalizeAutoCompactAt(value));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to save auto-compress setting");
    }
  };

  const setAppTheme = async (next: "dark" | "light") => {
    if (next === theme) return;
    applyTheme(next);
    setTheme(next);
    storeTheme(next);
    await window.grokDesktop.setTheme(next);
  };

  const applyPrivacyMode = async (next: boolean) => {
    if (next === privacyMode) return;
    setPrivacyMode(next);
    try {
      const value = await window.grokDesktop.setPrivacyMode(next);
      setPrivacyMode(Boolean(value));
    } catch (e: unknown) {
      setPrivacyMode(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to set privacy mode");
    }
  };

  const applyCodingDataOptIn = async (next: boolean) => {
    if (next === codingDataOptIn) return;
    setCodingDataOptIn(next);
    try {
      const status = await window.grokDesktop.setCodingDataOptIn(next);
      setCodingDataOptIn(status.optedIn !== false);
      setCodingDataNote(status.note);
      if (status.note) {
        appendSystem(status.note);
      } else {
        appendSystem(
          next
            ? "Coding data: Opt in (stored in ~/.grok/auth.json). Restart the agent so the running process picks it up."
            : "Coding data: Opt out. Restart the agent so the running process picks it up.",
        );
      }
      setOfferAgentRestart(true);
    } catch (e: unknown) {
      setCodingDataOptIn(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to set coding data preference");
    }
  };

  const applyAllowPrerelease = async (next: boolean) => {
    if (next === allowPrerelease) return;
    if (
      next &&
      !window.confirm(
        "Preview updates can install untested prerelease builds.\n\nThe rest of the team stays on stable unless they turn this on too.\n\nAfter you turn this on, use Help → Check for updates.",
      )
    ) {
      return;
    }
    setAllowPrerelease(next);
    try {
      const stored = await window.grokDesktop.setAllowPrerelease(next);
      setAllowPrerelease(Boolean(stored));
    } catch (e: unknown) {
      setAllowPrerelease(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to set preview updates");
    }
  };

  const applyDebugLogging = async (next: boolean) => {
    if (next === debugLogging) return;
    setDebugLogging(next);
    try {
      const res = await window.grokDesktop.setDebugLogging(next);
      setDebugLogging(Boolean(res.debugLogging));
      setDebugLogPath(res.debugLogPath || "");
    } catch (e: unknown) {
      setDebugLogging(!next);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "Failed to set debug logging");
    }
  };

  useEffect(() => {
    if (!project) {
      setGitBranch(null);
      setGitDetached(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await window.grokDesktop.getGitBranch(project);
        if (cancelled) return;
        setGitBranch(res?.branch ?? null);
        setGitDetached(Boolean(res?.detached));
      } catch {
        if (!cancelled) {
          setGitBranch(null);
          setGitDetached(false);
        }
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [project]);

  const homeDir = info?.home || null;
  const redact = useCallback(
    (text: string | null | undefined) =>
      redactSensitiveText(
        text == null ? "" : String(text),
        homeDir,
        privacyMode,
      ),
    [homeDir, privacyMode],
  );

  const restarting = openingLabel === "Restarting agent…";
  const statusLabel = useMemo(() => {
    if (conn === "connecting") {
      return restarting ? "Restarting agent…" : "Starting agent…";
    }
    if (conn === "error") return "Error";
    if (permissions.length > 0) {
      return permissions.length === 1
        ? "Waiting for approval…"
        : `Waiting for approval… (${permissions.length})`;
    }
    if (conn === "busy") return "Working…";
    if (conn === "online") return "Connected";
    return "Idle";
  }, [conn, permissions.length, restarting]);

  const platform =
    info?.platform ||
    (/Mac/i.test(navigator.userAgent || "")
      ? "darwin"
      : /Win/i.test(navigator.userAgent || "")
        ? "win32"
        : "linux");
  const platformClass =
    platform === "darwin"
      ? "platform-darwin"
      : platform === "win32"
        ? "platform-win"
        : "platform-linux";

  const onOpenSettings = useCallback(
    (section?: "mcp" | "plugins" | "skills" | "memory" | "peer") => {
      setSettingsSection(section || null);
      setSettingsOpen(true);
    },
    [],
  );
  const onComposerError = useCallback((message: string) => {
    setError(message);
  }, []);

  const rewindToUser = useCallback(
    async (id: string) => {
      if (!project || openingRef.current) return;
      if (conn !== "online" || busyRef.current) {
        appendSystem("空闲时才能退回刚才那句。");
        return;
      }
      const index = userPromptIndexOf(items, id);
      if (index < 0) return;
      if (
        !window.confirm(
          "这句话之后的对话会从画面上拿掉。已经改过的文件不会还原。确定吗？",
        )
      ) {
        return;
      }
      if (typeof window.grokDesktop.rewind !== "function") {
        appendSystem(
          "请重新打开 Grok Desktop 窗口后再退回（当前窗口还没有这个能力）。",
        );
        return;
      }
      try {
        await window.grokDesktop.rewind(index);
        setItems((prev) => prev.slice(0, cutIndexAfterUserId(prev, id)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || "退回失败");
        appendSystem(`没退成：${msg}`);
      }
    },
    [project, conn, items, appendSystem, setError],
  );

  const stopScheduledTask = useCallback(
    async (taskId: string) => {
      try {
        await window.grokDesktop.deleteScheduledTask({
          taskId,
          sessionId: sessionId || undefined,
        });
        dropScheduledTask(taskId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || "没停成");
        appendSystem(`没停成：${msg}`);
      }
    },
    [sessionId, appendSystem, setError, dropScheduledTask],
  );

  const exportChat = useCallback(async () => {
    const title =
      sessions.find((s) => s.id === sessionId)?.title || "对话";
    try {
      const res = await window.grokDesktop.exportChat({
        items,
        title,
        project: project || undefined,
      });
      if (res?.ok && res.path) {
        appendSystem(`已导出到 ${res.path}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "导出失败");
    }
  }, [items, sessions, sessionId, project, appendSystem, setError]);

  const columns = useColumnLayout();
  expandPanelRef.current = columns.expandPanel;
  collapsePanelIfOpenRef.current = () => {
    if (!columns.panelCollapsed) columns.togglePanel();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        openSideBrowser();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSideBrowser]);

  const overlayOpen = Boolean(planApproval || userQuestion || mcpElicit);

  const settingsDialog = (
    <SettingsDialog
      open={settingsOpen}
      onClose={() => {
        setSettingsOpen(false);
        setSettingsSection(null);
      }}
      inert={overlayOpen}
      theme={theme}
      privacyMode={privacyMode}
      codingDataOptIn={codingDataOptIn}
      codingDataNote={codingDataNote}
      permissionMode={permissionMode}
      allowOutsideProject={allowOutsideProject}
      sandboxTerminal={sandboxTerminal}
      sandboxStatus={sandboxStatus}
      debugLogging={debugLogging}
      debugLogPath={debugLogPath}
      allowPrerelease={allowPrerelease}
      autoCompactAt={autoCompactAt}
      onSetTheme={(t) => void setAppTheme(t)}
      onSetPrivacyMode={(next) => void applyPrivacyMode(next)}
      onSetCodingDataOptIn={(next) => void applyCodingDataOptIn(next)}
      onSetPermissionMode={(m) => void applyPermissionMode(m)}
      onToggleAllowOutside={() => void toggleAllowOutside()}
      onSetSandboxTerminal={(next) => void applySandboxTerminal(next)}
      onSetDebugLogging={(next) => void applyDebugLogging(next)}
      onSetAllowPrerelease={(next) => void applyAllowPrerelease(next)}
      onSetAutoCompactAt={(next) => void applyAutoCompactAt(next)}
      onOpenDebugLog={() => void window.grokDesktop.openDebugLog()}
      onRestartAgent={() => {
        setSettingsOpen(false);
        setSettingsSection(null);
        void restartAgent();
      }}
      onRestartAfterWrite={async () => {
        if (project) await restartAgent();
        await refreshBackbone(project || undefined);
      }}
      restarting={isOpening}
      offerRestart={offerAgentRestart}
      grokBinary={info?.grokBinary || auth?.binary || ""}
      hasProject={Boolean(project)}
      skills={backbone?.skills || []}
      skillsError={backbone && !backbone.ok ? backbone.error : null}
      skillsLoading={signedIn && backbone == null}
      focusSection={settingsSection}
    />
  );

  const worktreeOverlay = (
    <WorktreeDialog
      state={worktreeDialog}
      busy={worktreeBusy}
      error={worktreeError}
      onCancel={closeWorktreeDialog}
      onFocusWindow={(windowId) => {
        void window.grokDesktop.focusProjectWindow(windowId).then((ok) => {
          if (ok) closeWorktreeDialog();
          else setWorktreeError("Could not find that window.");
        });
      }}
      onOpenAnyway={(cwd) => {
        void openPathAfterWorktree(cwd, false);
      }}
      onOpenPath={(cwd, newWindow) => {
        void openPathAfterWorktree(cwd, newWindow);
      }}
      onCreate={(opts) => {
        void handleCreateWorktree(opts);
      }}
    />
  );

  if (!project) {
    return (
      <PrivacyProvider privacyMode={privacyMode} home={homeDir}>
        <WelcomeView
          platformClass={platformClass}
          isOpening={isOpening}
          openingLabel={openingLabel}
          signedIn={signedIn}
          auth={auth}
          backbone={backbone}
          authBusy={authBusy}
          authMessage={authMessage}
          loginProgress={loginProgress}
          loginDeviceAuth={loginDeviceAuth}
          error={error ? redact(error) : null}
          recentProjects={info?.recentProjects || []}
          appVersion={info?.version}
          grokBinary={redact(info?.grokBinary || auth?.binary || "detecting…")}
          onRefreshAuth={() => {
            void refreshAuth().then((s) => {
              if (s.authenticated && !s.expired) void refreshBackbone();
            });
          }}
          onLogin={(device) => void handleLogin(device)}
          onCancelLogin={() => void handleCancelLogin()}
          onSubmitLoginCode={(code) => void handleSubmitLoginCode(code)}
          onLogout={() => void handleLogout()}
          onSetApiKey={(key) => void handleSetApiKey(key)}
          onPickProject={() => void pickProject()}
          onOpenProject={(cwd) => {
            if (!confirmDiscardFiles()) return;
            void openProject(cwd);
          }}
          openCheckouts={openCheckouts}
          onOpenSettingsSection={onOpenSettings}
          platform={platform}
          inert={settingsOpen}
        />
        {worktreeOverlay}
        {settingsDialog}
      </PrivacyProvider>
    );
  }

  return (
    <PrivacyProvider privacyMode={privacyMode} home={homeDir}>
      <div
        className={
          `app ${platformClass}` +
          (columns.sidebarCollapsed ? " app--sidebar-collapsed" : "") +
          (columns.panelCollapsed ? " app--panel-collapsed" : "") +
          (columns.resizing ? " app--resizing" : "")
        }
        style={columns.cssVars}
      >
        <div className="app-col app-col--sidebar">
          <AppSidebar
            infoVersion={info?.version}
            grokBinary={info?.grokBinary}
            auth={auth}
            backbone={backbone}
            project={project}
            sessionId={sessionId}
            sessions={sidebarSessions}
            projectOrder={flow.projectOrder}
            onProjectOrder={setProjectOrder}
            pinned={flow.pinned}
            archived={flow.archived}
            unread={flow.unread}
            showArchived={flow.showArchived}
            onTogglePinned={togglePinned}
            pinnedProjects={flow.pinnedProjects}
            onTogglePinnedProject={togglePinnedProject}
            onArchive={(cwd, id) => setArchived(cwd, id, true)}
            onUnarchive={(cwd, id) => setArchived(cwd, id, false)}
            onToggleShowArchived={() => setShowArchived(!flow.showArchived)}
            recentProjects={info?.recentProjects || []}
            liveSessionIds={liveSessionIds}
            conn={conn}
            isOpening={isOpening}
            authBusy={authBusy}
            collapsed={columns.sidebarCollapsed}
            onToggleCollapsed={columns.toggleSidebar}
            onPickProject={() => void pickProject()}
            onAddProject={() => void addProjectToSidebar()}
            onNewWorktree={() => {
              if (project) void createWorktreeInNewWindow(project);
            }}
            onOpenProject={(cwd) => {
              if (!confirmDiscardFiles()) return;
              void openProject(cwd, { mode: "continue" });
            }}
            openCheckouts={openCheckouts}
            onOpenSession={(opts) => {
              if (
                opts.mode === "resume" &&
                opts.sessionId &&
                opts.sessionId === sessionId &&
                (!opts.cwd || samePathKey(opts.cwd, project))
              ) {
                return;
              }
              window.dispatchEvent(new Event("grok-flush-draft"));
              if (project && sessionId) {
                prevSessionRef.current = {
                  cwd: project,
                  sessionId,
                  hadUserSpeech: timelineHasUserSpeech(items),
                  hasDraft: Boolean(readDraft(project, sessionId)),
                };
                pushSessionHistory(project, sessionId);
              }
              const go = async () => {
                if (opts.cwd && !samePathKey(opts.cwd, project)) {
                  if (!confirmDiscardFiles()) return;
                  await openProject(opts.cwd, {
                    mode: opts.mode === "new" ? "new" : "resume",
                    sessionId: opts.mode === "new" ? undefined : opts.sessionId,
                  });
                } else {
                  await openSession(opts);
                }
                const prev = prevSessionRef.current;
                const nextId = sessionIdRef.current;
                window.dispatchEvent(new Event("grok-flush-draft"));
                const hasDraft = Boolean(
                  prev && readDraft(prev.cwd, prev.sessionId),
                );
                if (
                  prev &&
                  shouldAbandonEmptySession({
                    sessionId: prev.sessionId,
                    nextSessionId: nextId || "",
                    hadUserSpeech: prev.hadUserSpeech,
                    hasDraft: hasDraft || prev.hasDraft,
                  })
                ) {
                  try {
                    await window.grokDesktop.deleteSession({
                      cwd: prev.cwd,
                      sessionId: prev.sessionId,
                    });
                  } catch {
                    /* empty shell may already be gone */
                  }
                }
                setFocusNonce((n) => n + 1);
              };
              void go();
            }}
            onRenameSession={(opts) => renameSession(opts)}
            onDeleteSession={(opts) => deleteSession(opts)}
            onLogout={() => void handleLogout()}
            onOpenSettingsSection={onOpenSettings}
            onExportChat={() => void exportChat()}
            inert={settingsOpen}
          />
          <ColumnResizeHandle
            side="sidebar"
            collapsed={columns.sidebarCollapsed}
            width={columns.sidebarPx}
            min={columns.sidebarMin}
            max={columns.sidebarMax}
            onPointerDown={columns.onSidebarResizeDown}
            onPointerMove={columns.onResizePointerMove}
            onPointerUp={columns.endResizeDrag}
            onDoubleClick={columns.resetSidebar}
          />
        </div>

        <main
          className={
            "main" +
            (items.length === 0 && permissions.length === 0
              ? " main--empty"
              : "")
          }
          inert={settingsOpen || undefined}
        >
          <ChatTopbar
            project={project}
            workspaceLabel={
              homeDir && samePathKey(project, homeDir)
                ? "Home"
                : sessions.find((s) => s.id === sessionId)?.title || undefined
            }
            conn={conn}
            statusLabel={statusLabel}
            isOpening={isOpening}
            backgroundTasks={backgroundTasks}
            onOpenPreview={() => openSideBrowser()}
            onStop={stopTurn}
            panelCollapsed={columns.panelCollapsed}
            onTogglePanel={columns.togglePanel}
            reconnecting={reconnecting}
            onBack={() => {
              const prev = popSessionHistory(project, sessionId || "");
              if (!prev) return;
              if (!samePathKey(prev.cwd, project)) {
                void openProject(prev.cwd, {
                  mode: "resume",
                  sessionId: prev.sessionId,
                });
              } else {
                void openSession({
                  mode: "resume",
                  sessionId: prev.sessionId,
                });
              }
            }}
          />

          {isOpening && (
            <div className="loading-banner loading-banner-inline" role="status">
              <Spinner size={16} />
              <div>
                <strong>
                  {restarting ? "Restarting agent…" : "Starting agent…"}
                </strong>
                <span>
                  {restarting
                    ? "Reconnecting to Grok backbone"
                    : openingLabel
                      ? `Opening ${openingLabel}`
                      : "Connecting to Grok backbone"}
                </span>
              </div>
            </div>
          )}

          {bundleStale ? (
            <div className="stale-banner" role="status">
              新版已安装，重启后生效
              <button
                type="button"
                className="btn primary btn-sm"
                onClick={() => {
                  if (conn === "busy") {
                    if (!window.confirm("正在回复。现在重启会打断当前工作，确定吗？")) {
                      return;
                    }
                  }
                  void window.grokDesktop.relaunchApp?.();
                }}
              >
                现在重启
              </button>
            </div>
          ) : null}
          {error && (
            <div className="error-banner">
              {redact(error)}
              {(() => {
                const action = classifyErrorAction(error);
                if (!action) return null;
                if (action.kind === "signin" || isAuthError(error)) {
                  return (
                    <button
                      className="btn"
                      type="button"
                      style={{ marginLeft: 12 }}
                      onClick={() => {
                        if (!confirmDiscardFiles()) return;
                        void leaveProject();
                      }}
                    >
                      {action.label}
                    </button>
                  );
                }
                if (action.kind === "retry") {
                  return (
                    <button
                      className="btn"
                      type="button"
                      style={{ marginLeft: 12 }}
                      onClick={() => {
                        setError(null);
                        setReviveNonce((n) => n + 1);
                        void (async () => {
                          const ping = await window.grokDesktop.pingAgent?.();
                          if (ping && ping.ok === false) await restartAgent();
                        })();
                      }}
                    >
                      {action.label}
                    </button>
                  );
                }
                if (action.kind === "reselect") {
                  return (
                    <button
                      className="btn"
                      type="button"
                      style={{ marginLeft: 12 }}
                      onClick={() => {
                        setError(null);
                        if (typeof window.grokDesktop.pickFiles === "function") {
                          void window.grokDesktop.pickFiles().then((paths) => {
                            if (paths?.length) {
                              window.dispatchEvent(
                                new CustomEvent("grok-import-attachments", {
                                  detail: { paths },
                                }),
                              );
                            }
                          });
                        }
                      }}
                    >
                      {action.label}
                    </button>
                  );
                }
                if (action.kind === "install") {
                  return (
                    <button
                      className="btn"
                      type="button"
                      style={{ marginLeft: 12 }}
                      onClick={() => {
                        setError(null);
                        void window.grokDesktop.openInstallDocs();
                      }}
                    >
                      {action.label}
                    </button>
                  );
                }
                return (
                  <button
                    className="btn ghost btn-sm"
                    type="button"
                    style={{ marginLeft: 12 }}
                    onClick={() => setError(null)}
                  >
                    {action.label}
                  </button>
                );
              })()}
            </div>
          )}

          <div className="timeline" ref={timelineRef}>
            <QuestionIndex
              items={items}
              onJump={(id) => {
                document.getElementById(`msg-${id}`)?.scrollIntoView({
                  block: "center",
                });
              }}
            />
            <MessageList
              items={items}
              highlightQuery={findOpen ? findQuery : ""}
              bottomRef={bottomRef}
              knownCommands={allCommands}
              pendingPermissions={permissions}
              onPermission={onPermission}
              onAllowAllPermissions={() => void onAllowAllPermissions()}
              turnActive={conn === "busy"}
              canEditUser={conn === "online"}
              editingUserId={editingUserId}
              editSubmitting={editSubmitting}
              onStartEditUser={setEditingUserId}
              onCancelEditUser={() => setEditingUserId(null)}
              onSubmitEditUser={(id, text) => void submitEditedUser(id, text)}
              onBranchAssistant={(id) => void branchFromAssistant(id)}
              onRewindUser={(id) => void rewindToUser(id)}
            />
          </div>
            {hasNewContent ? (
              <button
                type="button"
                className="new-content-banner"
                onClick={() => {
                  clearNewContent();
                  if (!revealNow()) pinToBottom();
                }}
              >
                有新回复
              </button>
            ) : null}

          <ApprovalsDock
            permissions={permissions}
            onPermission={(reqId, optionId) =>
              void onPermission(reqId, optionId)
            }
            onAllowAll={() => void onAllowAllPermissions()}
            onAllowWritesThisSession={() => void onAllowWritesThisSession()}
          />

          <ScheduledLoopsBar
            loops={scheduledTasks}
            busy={conn === "busy"}
            onStop={(id) => void stopScheduledTask(id)}
          />

          <Composer
            key={sessionId || "no-session"}
            conn={conn}
            projectOpen={Boolean(project)}
            commands={allCommands}
            promptQueue={promptQueue}
            onSubmit={submitFromComposer}
            onStop={stopTurn}
            onLocalCommand={handleLocalCommand}
            onSendQueuedNow={sendQueuedNow}
            onRemoveQueued={removeQueued}
            onQueueEdit={editQueued}
            onQueueMove={moveQueued}
            onError={onComposerError}
            sessionCwd={project}
            sessionId={sessionId}
            projectName={folderDisplayName(project)}
            reviveNonce={reviveNonce}
            focusNonce={focusNonce}
            modelId={modelId}
            modelName={modelName}
            pendingModelId={pendingModelId}
            modelSelectEpoch={modelSelectEpoch}
            availableModels={availableModels}
            onModel={(id) => void applyModel(id)}
            permissionMode={permissionMode}
            onPermissionMode={(m) => void applyPermissionMode(m)}
            reasoningEffort={reasoningEffort}
            onReasoningEffort={(e) => void applyReasoningEffort(e)}
            usedContextTokens={sessionUsage.lastContextTokens}
            contextWindow={
              (modelId && info?.contextWindows?.[modelId]) ||
              (/^grok-4/i.test(modelId || "") ? 500_000 : 0)
            }
            onCompress={runMeterCompact}
            knowledgeLabel={
              knowledge?.enabled === false
                ? "认识 · 已关"
                : knowledge?.activeObjectTitle
                  ? `认识 · ${knowledge.activeObjectTitle}`
                  : "工作认识"
            }
            onOpenKnowledge={() => setKnowledgeOpen(true)}
          />
        </main>

        <div className="app-col app-col--panel">
          <ColumnResizeHandle
            side="panel"
            collapsed={columns.panelCollapsed}
            width={columns.panelPx}
            min={columns.panelMin}
            max={columns.panelMax}
            onPointerDown={columns.onPanelResizeDown}
            onPointerMove={columns.onResizePointerMove}
            onPointerUp={columns.endResizeDrag}
            onDoubleClick={columns.resetPanel}
          />
          <SideWorkbench
            project={project}
            sessionId={sessionId}
            items={items}
            inert={settingsOpen}
            collapsed={columns.panelCollapsed}
            expanded={columns.panelPx >= 520}
            onToggleCollapsed={columns.togglePanel}
            onExpand={columns.expandPanel}
            browserOpen={browserOpen}
            onSidePrompt={(text) => {
              void submitFromComposer({
                text,
                images: [],
                mode: "now",
              });
            }}
          />
        </div>
      </div>

        <FindBar
          open={findOpen}
          query={findQuery}
          onQuery={setFindQuery}
          items={items}
          activeId={findId}
          onClose={() => {
            setFindOpen(false);
            setFindQuery("");
            setFindId(null);
          }}
          onJump={(hit) => {
            setFindId(hit.key);
            document.getElementById(`msg-${hit.id}`)?.scrollIntoView({
              block: "center",
            });
          }}
        />
        <CommandPalette
          open={paletteOpen}
          sessions={sidebarSessions}
          projects={(info?.recentProjects || []).map((cwd) => ({
            cwd,
            name: folderDisplayName(cwd),
          }))}
          onOpenProject={(cwd) => {
            if (!confirmDiscardFiles()) return;
            void openProject(cwd, { mode: "continue" });
          }}
          commands={[
            {
              id: "new",
              title: "新对话",
              subtitle: "在当前项目里开一场",
              run: () => void openSession({ mode: "new" }),
            },
            {
              id: "folder",
              title: "打开文件夹",
              run: () => void pickProject(),
            },
            {
              id: "settings",
              title: "设置",
              run: () => onOpenSettings(),
            },
            {
              id: "knowledge",
              title: "工作认识",
              subtitle: knowledge?.activeObjectTitle || "当前业务对象",
              run: () => setKnowledgeOpen(true),
            },
          ]}
          onClose={() => setPaletteOpen(false)}
          onOpenSession={(opts) => {
            if (opts.cwd && !samePathKey(opts.cwd, project)) {
              void openProject(opts.cwd, {
                mode: "resume",
                sessionId: opts.sessionId,
              });
            } else {
              void openSession({
                mode: "resume",
                sessionId: opts.sessionId,
              });
            }
          }}
        />
        {worktreeOverlay}
        {settingsDialog}

        <PlanApprovalDialog
          request={planApproval}
          onRespond={(reqId, decision) => {
            const sid = sessionIdRef.current;
            void (async () => {
              try {
                const comments = decision.type === "approved"
                  ? planApproveCommentsText(decision.feedback)
                  : "";
                await onPlanApproval(
                  reqId,
                  decision.type === "approved" ? { type: "approved" } : decision,
                );
                if (comments && sid === sessionIdRef.current && !openingRef.current) {
                  await submitFromComposer({ text: comments, images: [], mode: "steer", origin: "followup" });
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            })();
          }}
        />
        <AskUserDialog
          request={userQuestion}
          onRespond={(reqId, decision) => void onUserQuestion(reqId, decision)}
        />
        <WorkingKnowledgeSheet
          open={knowledgeOpen}
          snapshot={knowledge}
          saveNote={knowledgeNote}
          busy={knowledgeBusy}
          onClose={() => setKnowledgeOpen(false)}
          onReload={() => void reloadKnowledge()}
          onSetEnabled={(next) => {
            setKnowledgeBusy(true);
            setKnowledgeNote(null);
            void window.grokDesktop
              .setWorkingKnowledgeEnabled(next)
              .then(async () => {
                await reloadKnowledge();
                setKnowledgeNote(next ? "已打开工作认识" : "已关闭工作认识，记录仍保留");
              })
              .catch((e: unknown) => {
                setKnowledgeNote(e instanceof Error ? e.message : String(e));
              })
              .finally(() => setKnowledgeBusy(false));
          }}
          onSetObject={(objectId) => {
            setKnowledgeBusy(true);
            setKnowledgeNote(null);
            void window.grokDesktop
              .setWorkingKnowledgeObject({
                objectId,
                sessionId,
                cwd: project,
              })
              .then((snap) => {
                setKnowledge(snap);
                setKnowledgeNote(
                  objectId
                    ? `已切换到 ${snap.activeObjectTitle}，并已保存`
                    : "已改为未指定。本会话新消息不再写入其他对象的工作认识",
                );
              })
              .catch((e: unknown) => {
                setKnowledgeNote(e instanceof Error ? e.message : String(e));
              })
              .finally(() => setKnowledgeBusy(false));
          }}
          onCorrect={(item, text) => {
            if (!knowledge?.activeObjectId) return;
            setKnowledgeBusy(true);
            setKnowledgeNote(null);
            void window.grokDesktop
              .correctWorkingKnowledge({
                objectId: knowledge.activeObjectId,
                id: item.id,
                text,
                sessionId,
                cwd: project,
              })
              .then((res) => {
                if (res.snapshot) setKnowledge(res.snapshot);
                else void reloadKnowledge();
                setKnowledgeNote(
                  res.ok
                    ? `已保存纠正 · 版本 ${res.currentVersion ?? knowledge.version}`
                    : res.error || "纠正没有保存",
                );
              })
              .catch((e: unknown) => {
                setKnowledgeNote(e instanceof Error ? e.message : String(e));
              })
              .finally(() => setKnowledgeBusy(false));
          }}
          onWithdraw={(item) => {
            if (!knowledge?.activeObjectId) return;
            setKnowledgeBusy(true);
            setKnowledgeNote(null);
            void window.grokDesktop
              .withdrawWorkingKnowledge({
                objectId: knowledge.activeObjectId,
                id: item.id,
                sessionId,
                cwd: project,
              })
              .then((res) => {
                if (res.snapshot) setKnowledge(res.snapshot);
                else void reloadKnowledge();
                setKnowledgeNote(
                  res.ok
                    ? `已撤回 · 版本 ${res.currentVersion ?? knowledge.version}`
                    : res.error || "撤回没有保存",
                );
              })
              .catch((e: unknown) => {
                setKnowledgeNote(e instanceof Error ? e.message : String(e));
              })
              .finally(() => setKnowledgeBusy(false));
          }}
          onArmProbe={() => {
            setKnowledgeBusy(true);
            void window.grokDesktop
              .armWorkingKnowledgeProbe()
              .then((snap) => {
                setKnowledge(snap);
                setKnowledgeNote("下一句用户消息会带一次入口探针，不会写入正式工作认识");
              })
              .catch((e: unknown) => {
                setKnowledgeNote(e instanceof Error ? e.message : String(e));
              })
              .finally(() => setKnowledgeBusy(false));
          }}
        />
        <FolderTrustDialog
          request={folderTrust}
          onRespond={(reqId, decision) => void onFolderTrust(reqId, decision)}
        />
        <McpElicitDialog
          request={mcpElicit}
          onRespond={(reqId, decision) => void onMcpElicit(reqId, decision)}
        />
    </PrivacyProvider>
  );
}
