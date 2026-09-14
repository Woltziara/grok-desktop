/// <reference types="vite/client" />

export type PermissionOutcome = {
  outcome: {
    outcome: "selected" | "cancelled";
    optionId?: string;
  };
};

export type PromptImage = {
  data: string;
  mimeType: string;
};

export type TimelineImage = {
  mimeType: string;
  previewUrl: string;
};

export type TimelineItem =
  | {
      id: string;
      kind: "user";
      text: string;
      images?: TimelineImage[];
      /** Set when UI inserts the bubble before ACP echoes it */
      optimistic?: boolean;
      /** Mid-turn steer, or a follow-up after a cancelled turn. */
      marker?: "interjection" | "interrupt";
      interjectionId?: string;
      at: number;
    }
  | { id: string; kind: "assistant"; text: string; at: number }
  | { id: string; kind: "thought"; text: string; at: number }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      title: string;
      status: string;
      /** ACP tool kind: edit / read / execute / … (not the timeline discriminator). */
      toolKind?: string;
      raw?: unknown;
      content?: unknown;
      at: number;
    }
  | { id: string; kind: "plan"; entries: unknown[]; at: number }
  | { id: string; kind: "system"; text: string; at: number }
  | { id: string; kind: "recap"; text: string; auto?: boolean; at: number }
  | { id: string; kind: "worked"; elapsedMs: number; at: number };

export type PermissionRequest = {
  reqId: string;
  params: {
    sessionId?: string;
    toolCall?: {
      toolCallId?: string;
      title?: string;
      kind?: string;
      status?: string;
      rawInput?: unknown;
    };
    options?: Array<{ optionId: string; name: string; kind?: string }>;
  };
};

export type LoginProgress = {
  output?: string;
  url?: string | null;
  urls?: string[];
  userCode?: string | null;
  needsPaste?: boolean;
  deviceAuth?: boolean;
};

export type AuthStatus = {
  binary: string;
  binaryFound: boolean;
  grokHome: string;
  authPath: string;
  authenticated: boolean;
  method: string | null;
  email: string | null;
  displayName: string | null;
  expiresAt: string | null;
  expired: boolean;
  hasApiKey: boolean;
  loginInProgress: boolean;
};

export type AccountRow = {
  id: string;
  email: string | null;
  displayName: string | null;
  expired?: boolean;
  active?: boolean;
};

export type GrokEngineInfo = {
  binary: string;
  binaryFound: boolean;
  version: string | null;
  error?: string;
};

export type GrokUpdateCheck = {
  ok: boolean;
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  channel?: string | null;
  error?: string | null;
};

export type GrokUpdateInstall = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

/** Sanitized MCP row — env/header *values* never cross IPC. */
export type McpServerInfo = {
  name: string;
  displayName?: string | null;
  transport?: string | null;
  enabled?: boolean | null;
  scope?: string | null;
  command?: string | null;
  args?: string[];
  url?: string | null;
  envKeys?: string[];
  headerKeys?: string[];
  source?: string | null;
  /** True when ~/.grok/mcp_credentials.json has a token for this name. */
  signedIn?: boolean;
  /** Live TUI /mcps status: ready | initializing | unavailable | needs-auth | setup-required */
  liveStatus?:
    | "ready"
    | "initializing"
    | "unavailable"
    | "needs-auth"
    | "setup-required"
    | null;
  authRequired?: boolean;
  liveToolCount?: number | null;
};

export type McpAddSpec = {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Array<{ key: string; value: string }>;
  headers?: Array<{ name: string; value: string }>;
  scope?: "user" | "project";
};

export type McpListResult = {
  ok: boolean;
  servers: McpServerInfo[];
  source?: "list" | "inspect";
  error?: string | null;
  liveOk?: boolean;
};

export type McpWriteResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

export type McpDoctorCheck = {
  label: string;
  passed: boolean;
  detail: string | null;
};

export type McpDoctorServer = {
  name: string;
  transport: string | null;
  target: string | null;
  source: string | null;
  healthy: boolean;
  checks: McpDoctorCheck[];
  tools: string[];
  toolCount: number | null;
  needsAuth: boolean;
};

export type McpAuthResult = {
  ok: boolean;
  status?: string;
  serverName?: string;
  error?: string | null;
};

export type McpDoctorResult = {
  ok: boolean;
  healthyCount: number;
  failingCount: number;
  servers: McpDoctorServer[];
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

/** Sanitized plugin row from `grok plugin list --json` (no component inventory). */
export type PluginInfo = {
  name: string;
  enabled?: boolean | null;
  status?: string | null;
  version?: string | null;
  description?: string | null;
  marketplace?: string | null;
  source?: string | null;
  skillCount?: number | null;
  hasHooks?: boolean | null;
  hasAgents?: boolean | null;
  hasMcp?: boolean | null;
};

export type PluginListResult = {
  ok: boolean;
  plugins: PluginInfo[];
  source?: "list" | "inspect";
  error?: string | null;
};

export type PluginWriteResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
};

export type BackboneSummary = {
  ok: boolean;
  skills: Array<{ name: string; description?: string; source?: string }>;
  mcpServers: Array<{
    name: string;
    transport?: string;
    source?: string;
  }>;
  plugins: Array<{ name: string }>;
  grokVersion?: string;
  error?: string;
};

export type SlashCommand = {
  name: string;
  description: string;
  source: "agent" | "skill" | "desktop";
  inputHint?: string;
  local?: boolean;
};

export type GitStatusEntry = {
  path: string;
  origPath: string | null;
  index: string;
  worktree: string;
  status: string;
  untracked: boolean;
  ignored: boolean;
  staged: boolean;
  unstaged: boolean;
};

export type SessionSummary = {
  id: string;
  cwd: string;
  title: string;
  summary: string | null;
  /** True when the title was pinned with Rename / CLI `/rename`. */
  titleIsManual?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastActiveAt: string | null;
  /** Last user/assistant turn — opening the chat does not change this. */
  lastMessageAt?: string | null;
  numMessages: number;
  numChatMessages: number;
  modelId: string | null;
};

export type AvailableModel = {
  modelId: string;
  name: string;
};

export type OpenCheckoutRow = {
  windowId: number;
  cwd: string;
  title: string;
};

export type WorktreeInfo = {
  path: string;
  head: string | null;
  branch: string | null;
  open: boolean;
  label?: string | null;
};

export type CheckoutOccupancy = {
  windowId: number;
  cwd: string;
  title: string;
  branch: string | null;
  detached: boolean;
};

export type CheckoutInspect = {
  cwd: string;
  git: boolean;
  currentBranch: string | null;
  detached: boolean;
  worktrees: WorktreeInfo[];
  occupancy: CheckoutOccupancy | null;
};

export type CheckoutConflict = CheckoutInspect & {
  conflict: "checkout-open";
};

export type OpenProjectResult = {
  cwd: string;
  sessionId: string;
  grokBinary: string;
  resumed?: boolean;
  /** ACP model id for the live session (e.g. grok-4.6) */
  modelId?: string | null;
  /** Optional display name from the agent model list */
  modelName?: string | null;
  /** Models advertised on session/new|load — empty when the agent omits them */
  availableModels?: AvailableModel[];
  sessionMode?: string | null;
  history?: TimelineItem[];
  /** Agent update seq at history snapshot; replay only later events. */
  historySeq?: number;
  /** Background commands/subagents restored from updates.jsonl */
  backgroundTasks?: Array<{
    id: string;
    kind: "command" | "subagent" | "monitor";
    title: string;
    detail?: string;
    status: "running" | "completed" | "failed" | "unknown";
    command?: string;
    outputFile?: string;
    exitCode?: number | null;
    startedAt: number;
    endedAt?: number;
    outputSnippet?: string;
    toolCallId?: string;
  }>;
  /** Active `/loop` tasks restored from updates.jsonl */
  scheduledTasks?: Array<{
    id: string;
    prompt: string;
    schedule: string;
    nextFireAt?: string | null;
  }>;
  /** Summed turn_completed usage from updates.jsonl (status bar) */
  usage?: import("./lib/usage").SessionUsage | null;
  sessions?: SessionSummary[];
  /** Present when main already ran `grok inspect` (agent:restart). */
  backbone?: BackboneSummary;
  /** Live turn still running on a parked/focused agent process. */
  turnOpen?: boolean;
};

export type AppInfo = {
  version: string;
  pid: number;
  executable: string;
  appPath: string;
  sessionData: string;
  platform: string;
  grokBinary: string;
  grokHome: string;
  userData: string;
  alwaysApprove: boolean;
  /** ask | auto | always-approve */
  permissionMode: "ask" | "auto" | "always-approve";
  /** Reasoning effort (`/effort`): low | medium | high | xhigh */
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  /** When false (default), ACP fs + terminal cwd cannot leave project root */
  allowOutsideProject: boolean;
  /**
   * When true (default), ACP tool shells run in an OS FS jail
   * (Seatbelt / bwrap / WSL+bwrap / Docker).
   */
  sandboxTerminal: boolean;
  /** Human-readable backend probe for Settings */
  sandboxStatus: string;
  sandboxBackend: string;
  /** UI appearance */
  theme: "dark" | "light";
  /**
   * Display-only: redact $HOME → ~ in the UI (screenshots / demos).
   * Does not change agent paths or on-disk data.
   */
  privacyMode: boolean;
  /** modelId → context window tokens from ~/.grok/models_cache.json */
  contextWindows?: Record<string, number>;
  /**
   * SpaceXAI coding-data share (CLI `/privacy`). Default true (opt in).
   * Stored as coding_data_retention_opt_out on ~/.grok/auth.json.
   */
  codingDataOptIn: boolean;
  codingDataStatus?: {
    optedIn: boolean;
    source: "auth" | "default" | "none";
    managed: boolean;
    note?: string;
  };
  /** ~/.grok/config.toml [memory] enabled */
  memoryEnabled?: boolean;
  /** Diagnostic JSONL log for tools/hooks/terminals */
  debugLogging: boolean;
  debugLogPath: string;
  /**
   * When true, Check for updates includes GitHub prereleases
   * (vX.Y.Z-beta.N). Default off.
   */
  allowPrerelease: boolean;
  /**
   * External editor for Files / Changes.
   * auto | cursor | code | code-insiders | zed | windsurf | subl | codium
   * | textedit | notepad
   */
  externalEditor: string;
  /** Call the agent compact API when last context size passes this mark. */
  autoCompactAt: "off" | "64k" | "128k" | "192k";
  recentProjects: string[];
  lastProject: string | null;
  home: string;
  packaged?: boolean;
  launchedAt?: number;
  bundleStale?: boolean;
  auth: AuthStatus;
};

export type ExternalEditorInfo = {
  id: string;
  label: string;
  available: boolean;
  lastResort: boolean;
};

export type EditorListResult = {
  preferred: string;
  resolved: string | null;
  resolvedLabel: string | null;
  editors: ExternalEditorInfo[];
};

export type FileReadResult = {
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number;
};

export type WorkingKnowledgeItem = {
  id: string;
  kind: string;
  status?: string;
  epistemic?: string;
  text: string;
  analysis?: string;
  scope?: string;
  basis?: string;
  version?: number;
  source?: { type?: string; pointer?: string; quote?: string };
};

export type WorkingKnowledgeSnapshot = {
  enabled: boolean;
  root: string;
  currentObjectId: string;
  sessionObjectId: string | null;
  activeObjectId: string;
  activeObjectTitle: string;
  objects: Array<{ id: string; title: string; test?: boolean }>;
  version: number;
  items: WorkingKnowledgeItem[];
  inbox: Array<{
    id: string;
    text: string;
    sessionId?: string;
    cwd?: string;
    status?: string;
    recordedAt?: string;
    at?: string;
  }>;
  probeArmed: boolean;
  lastReceipt: Record<string, unknown> | null;
  cwd: string;
  sessionId: string;
};

export type WorkingKnowledgeMutation = {
  ok: boolean;
  error?: string;
  currentVersion?: number;
  written?: Array<{ id: string; kind: string }>;
  snapshot?: WorkingKnowledgeSnapshot;
  duplicate?: boolean;
};

declare global {
  interface Window {
    grokDesktop: {
      /** First painted frame — main shows the shell and closes the native splash. */
      windowReady: () => void;
      getInfo: () => Promise<AppInfo>;
      pickProject: () => Promise<string | null>;
      addRecentProject?: (
        cwd: string,
      ) => Promise<{ ok: boolean; cwd: string; recentProjects: string[] }>;
      openProject: (
        cwd: string,
        opts?: {
          mode?: "continue" | "new" | "resume";
          sessionId?: string;
          allowSameCheckout?: boolean;
        },
      ) => Promise<OpenProjectResult | CheckoutConflict>;
      listOpenCheckouts: () => Promise<OpenCheckoutRow[]>;
      focusProjectWindow: (windowId: number) => Promise<boolean>;
      takePendingOpen: () => Promise<{
        cwd: string;
        allowSameCheckout?: boolean;
      } | null>;
      openProjectInNewWindow: (cwd: string) => Promise<{ ok: boolean }>;
      inspectCheckout: (cwd?: string) => Promise<CheckoutInspect>;
      createWorktree: (opts?: {
        cwd?: string;
        label?: string;
      }) => Promise<{
        path: string;
        sessionId?: string;
        sourceGitRoot?: string | null;
      }>;
      /** Drop agent on this window; native title returns to empty shell. */
      closeProject: () => Promise<boolean>;
      /** Respawn grok agent and resume the same chat. */
      restartAgent: () => Promise<OpenProjectResult>;
      listSessions: (cwd: string) => Promise<SessionSummary[]>;
      listSessionsAll: (cwds: string[]) => Promise<SessionSummary[]>;
      listLiveTurns: () => Promise<string[]>;
      renameSession: (opts: {
        cwd: string;
        sessionId: string;
        title: string;
      }) => Promise<{
        ok: boolean;
        title?: string;
        sessions?: SessionSummary[];
        error?: string;
      }>;
      deleteSession: (opts: {
        cwd: string;
        sessionId: string;
      }) => Promise<{
        ok: boolean;
        sessions?: SessionSummary[];
        error?: string;
      }>;
      openSession: (opts: {
        cwd: string;
        sessionId?: string;
        mode?: "new" | "resume";
      }) => Promise<OpenProjectResult>;
      prompt: (
        text: string,
        opts?: {
          sessionId?: string;
          origin?: "user" | "followup";
          images?: PromptImage[];
          imageQuality?: "compact" | "high";
        },
      ) => Promise<unknown>;
      interject: (
        text: string,
        opts?: {
          images?: PromptImage[];
          imageQuality?: "compact" | "high";
          interjectionId?: string;
          sessionId?: string;
        },
      ) => Promise<
        | { ok: true; status?: string; interjectionId: string }
        | { ok: false; reason: "unsupported" | "turn-ended"; interjectionId: string }
      >;
      setSessionMode: (modeId: string) => Promise<{
        agentSynced: boolean;
        currentModeId: string | null;
        error?: string;
      }>;
      cancel: (sessionId?: string) => Promise<boolean>;
      compact: (hint?: string) => Promise<unknown>;
      rewind: (
        targetPromptIndex: number,
        restoreFiles?: boolean,
      ) => Promise<unknown>;
      forkSession: (opts?: {
        throughUserPromptIndex?: number;
        lastUserPromptIndex?: number;
      }) => Promise<{ sessionId?: string; ok?: boolean }>;
      respondPermission: (
        reqId: string,
        outcome: PermissionOutcome,
      ) => Promise<boolean>;
      setAllowWritesThisSession: (
        value: boolean,
      ) => Promise<{ allowWritesThisSession: boolean }>;
      /** Open Approvals still held in main (after HMR / reload) */
      listPendingPermissions: () => Promise<PermissionRequest[]>;
      listPendingPlanApprovals: () => Promise<Array<{ reqId: string; params: any }>>;
      listPendingFolderTrust: () => Promise<Array<{ reqId: string; params: any }>>;
      listPendingUserQuestions: () => Promise<Array<{ reqId: string; params: any }>>;
      listPendingMcpElicits: () => Promise<Array<{ reqId: string; params: any }>>;
      respondPlanApproval: (
        reqId: string,
        decision: {
          type: "approved" | "request_changes" | "abandoned";
          feedback?: string;
        },
      ) => Promise<boolean>;
      respondUserQuestion: (
        reqId: string,
        decision:
          | { type: "answered"; answers: Record<string, string> }
          | { type: "declined" },
      ) => Promise<boolean>;
      respondFolderTrust: (
        reqId: string,
        decision: { outcome: "trust" | "reject" },
      ) => Promise<boolean>;
      respondMcpElicit: (
        reqId: string,
        decision:
          | { outcome: "accept"; content?: Record<string, unknown> }
          | { outcome: "decline" }
          | { outcome: "cancel" },
      ) => Promise<boolean>;
      setAlwaysApprove: (value: boolean) => Promise<boolean>;
      setPermissionMode: (
        value: "ask" | "auto" | "always-approve",
      ) => Promise<{
        mode: "ask" | "auto" | "always-approve";
        agentSynced: boolean;
        error?: string;
      }>;
      setReasoningEffort: (
        value: "low" | "medium" | "high" | "xhigh",
      ) => Promise<{
        effort: "low" | "medium" | "high" | "xhigh";
        agentSynced: boolean;
        error?: string;
      }>;
      setModel: (modelId: string) => Promise<{
        modelId: string | null;
        modelName: string | null;
        availableModels: AvailableModel[];
        agentSynced: boolean;
        error?: string;
      }>;
      setAllowOutsideProject: (value: boolean) => Promise<boolean>;
      setSandboxTerminal: (value: boolean) => Promise<boolean>;
      setTheme: (value: "dark" | "light") => Promise<"dark" | "light">;
      setPrivacyMode: (value: boolean) => Promise<boolean>;
      setAutoCompactAt: (
        value: "off" | "64k" | "128k" | "192k",
      ) => Promise<"off" | "64k" | "128k" | "192k">;
      getCodingDataStatus: () => Promise<{
        optedIn: boolean;
        source: "auth" | "default" | "none";
        managed: boolean;
        note?: string;
      }>;
      setCodingDataOptIn: (value: boolean) => Promise<{
        optedIn: boolean;
        source: "auth" | "default" | "none";
        managed: boolean;
        note?: string;
      }>;
      getMemoryStatus: () => Promise<{
        enabled: boolean;
        entries: Array<{
          id: string;
          file: string;
          scope: string;
          heading: string;
          text: string;
          wholeFile?: boolean;
          label: string;
        }>;
      }>;
      setMemoryEnabled: (value: boolean) => Promise<{ enabled: boolean }>;
      deleteMemoryEntry: (entryId: string) => Promise<{ ok: boolean }>;
      workingKnowledgeStatus: (opts?: {
        sessionId?: string | null;
        cwd?: string | null;
      }) => Promise<WorkingKnowledgeSnapshot>;
      setWorkingKnowledgeEnabled: (
        value: boolean,
      ) => Promise<{ enabled: boolean }>;
      setWorkingKnowledgeObject: (payload: {
        objectId: string;
        sessionId?: string | null;
        cwd?: string | null;
      }) => Promise<WorkingKnowledgeSnapshot>;
      correctWorkingKnowledge: (payload: {
        objectId: string;
        id?: string;
        text: string;
        analysis?: string;
        scope?: string;
        sessionId?: string | null;
        cwd?: string | null;
      }) => Promise<WorkingKnowledgeMutation>;
      withdrawWorkingKnowledge: (payload: {
        objectId: string;
        id: string;
        sessionId?: string | null;
        cwd?: string | null;
      }) => Promise<WorkingKnowledgeMutation>;
      armWorkingKnowledgeProbe: () => Promise<WorkingKnowledgeSnapshot>;
      getBilling: () => Promise<{
        ok: boolean;
        line: string;
        remainingPct?: number | null;
        usedPct?: number | null;
        error?: string;
      }>;
      deleteScheduledTask: (opts: {
        taskId: string;
        sessionId?: string;
      }) => Promise<unknown>;
      exportChat: (opts: {
        items: TimelineItem[];
        title?: string;
        project?: string;
      }) => Promise<{ ok: boolean; cancelled?: boolean; path?: string }>;
      peerStatus: () => Promise<{
        role: string;
        label: string;
        host: string;
        online: boolean;
        paired: boolean;
        sshReady: boolean;
        projectsPath: string;
        grokHome: string;
        lastSyncAt?: string | null;
      }>;
      peerPair: (
        password: string,
      ) => Promise<{ ok: boolean; error?: string; host?: string }>;
      peerAlign: (opts?: { apply?: boolean }) => Promise<{
        ok: boolean;
        applied?: boolean;
        needPair?: boolean;
        error?: string;
        preview?: string;
        grok?: {
          pull: { count: number; shown: string[]; more: number };
          push: { count: number; shown: string[]; more: number };
        };
        projects?: {
          pull: { count: number; shown: string[]; more: number };
          push: { count: number; shown: string[]; more: number };
        };
      }>;
      listAccounts: () => Promise<{
        current: AccountRow | null;
        saved: AccountRow[];
        peer?: {
          ok?: boolean;
          online?: boolean;
          sshReady?: boolean;
          needPair?: boolean;
          account?: AccountRow | null;
          label?: string;
        };
      }>;
      activateAccount: (id: string) => Promise<{
        ok: boolean;
        error?: string;
        needsRestart?: boolean;
        current?: AccountRow | null;
        saved?: AccountRow[];
        status?: AuthStatus;
      }>;
      copyAuthToPeer: (direction?: "push" | "pull") => Promise<{
        ok: boolean;
        error?: string;
        needPair?: boolean;
        needsRestart?: boolean;
        direction?: "push" | "pull";
        label?: string;
        preview?: string;
        local?: AccountRow | null;
        peer?: AccountRow | null;
        status?: AuthStatus;
      }>;
      copyAppToPeer: () => Promise<{
        ok: boolean;
        error?: string;
        needPair?: boolean;
        preview?: string;
        label?: string;
        version?: string | null;
      }>;
      setAllowPrerelease: (value: boolean) => Promise<boolean>;
      setDebugLogging: (
        value: boolean,
      ) => Promise<{ debugLogging: boolean; debugLogPath: string }>;
      openDebugLog: () => Promise<string>;
      getGitBranch: (
        cwd?: string,
      ) => Promise<{ branch: string | null; detached: boolean }>;
      getGitStatus: (cwd?: string) => Promise<{ files: GitStatusEntry[] }>;
      getGitDiff: (
        path: string,
        opts?: { staged?: boolean },
      ) => Promise<{ path: string; staged: boolean; diff: string | null }>;
      readFile: (path: string) => Promise<FileReadResult>;
      writeFile: (
        path: string,
        content: string,
      ) => Promise<{ ok: true }>;
      listDir: (
        path: string,
      ) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;
      openPath: (
        path: string,
      ) => Promise<{ ok: boolean; editor?: string; label?: string }>;
      openInEditor: (
        path: string,
      ) => Promise<{ ok: boolean; editor?: string; label?: string }>;
      listEditors: () => Promise<EditorListResult>;
      setExternalEditor: (id: string) => Promise<EditorListResult>;
      showItem: (path: string) => Promise<void>;
      pickFile: () => Promise<string | null>;
      pickFiles?: () => Promise<string[]>;
      pickFolder?: () => Promise<string | null>;
      pathForFile?: (file: File) => string;
      importAttachment?: (path: string) => Promise<{
        kind: string;
        name: string;
        path: string;
        size: number;
        mimeType: string;
        text?: string;
        data?: string;
        staged?: boolean;
      }>;
      pingAgent?: () => Promise<{
        ok: boolean;
        rpc?: boolean;
        reason?: string;
        message?: string;
        sessionId?: string | null;
        cwd?: string | null;
      }>;
      artifactPreview: (
        path: string,
      ) => Promise<{ origin: string; href: string }>;
      openExternal: (url: string) => Promise<boolean>;
      openPreview: (url?: string) => Promise<{
        open: boolean;
        url: string;
        title: string;
        viewport: string;
        loading: boolean;
      }>;
      closePreview: () => Promise<boolean>;
      previewState: () => Promise<{
        open: boolean;
        url: string;
        title: string;
        viewport: string;
        loading: boolean;
      }>;
      previewSnapshot: () => Promise<{
        text: string;
        url: string;
        title: string;
        chars: number;
      }>;
      getAuthStatus: () => Promise<AuthStatus>;
      login: (opts?: {
        deviceAuth?: boolean;
      }) => Promise<{
        ok: boolean;
        status?: AuthStatus;
        error?: string;
        output?: string;
      }>;
      cancelLogin: () => Promise<AuthStatus>;
      submitLoginInput: (
        text: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      logout: () => Promise<{
        ok: boolean;
        status?: AuthStatus;
        message?: string;
      }>;
      setApiKey: (
        key: string,
      ) => Promise<{ ok: boolean; status: AuthStatus }>;
      openInstallDocs: () => Promise<boolean>;
      inspectBackbone: (cwd?: string) => Promise<BackboneSummary>;
      getGrokEngine: () => Promise<GrokEngineInfo>;
      checkGrokUpdate: () => Promise<GrokUpdateCheck>;
      installGrokUpdate: () => Promise<GrokUpdateInstall>;
      listMcpServers: (opts?: { cache?: boolean }) => Promise<McpListResult>;
      addMcpServer: (spec: McpAddSpec) => Promise<McpWriteResult>;
      enableMcpServer: (name: string) => Promise<McpWriteResult>;
      disableMcpServer: (name: string) => Promise<McpWriteResult>;
      removeMcpServer: (
        name: string,
        opts?: { scope?: "user" | "project" },
      ) => Promise<McpWriteResult>;
      doctorMcp: (name?: string) => Promise<McpDoctorResult>;
      authenticateMcpServer: (name: string) => Promise<McpAuthResult>;
      logoutMcpServer: (
        name: string,
      ) => Promise<{ ok: boolean; removed?: number; error?: string | null }>;
      setSettingsOpen: (open: boolean) => Promise<boolean>;
      listPlugins: () => Promise<PluginListResult>;
      enablePlugin: (name: string) => Promise<PluginWriteResult>;
      disablePlugin: (name: string) => Promise<PluginWriteResult>;
      installPlugin: (source: string) => Promise<PluginWriteResult>;
      writeClipboard: (payload: {
        text: string;
        html?: string;
      }) => Promise<boolean>;
      notify?: (payload: {
        title?: string;
        body?: string;
        sessionId?: string | null;
        cwd?: string | null;
      }) => Promise<{ ok: boolean }>;
      bundleStale?: () => Promise<{ stale: boolean; packaged: boolean }>;
      relaunchApp?: () => Promise<void>;
      openDefault?: (path: string) => Promise<{ ok: boolean }>;
      on: (channel: string, handler: (payload: any) => void) => () => void;
    };
    __grokCopySelectionMarkdown?: () => void;
  }

  interface File {
    readonly path?: string;
  }
}

export {};
