const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("grokDesktop", {
  /** First React paint — main may now show the shell and drop the native splash. */
  windowReady: () => ipcRenderer.send("window:ready"),
  continuationResult: token => ipcRenderer.invoke("continuation:result",token),
  acknowledgeContinuationFlow: token => ipcRenderer.invoke("continuation:flow-applied",token),
  listContinuations: () => ipcRenderer.invoke("continuation:list"),
  selectContinuationMaterials: cwd => ipcRenderer.invoke("continuation:select-materials",cwd),
  exportContinuation: input => ipcRenderer.invoke("continuation:export",input),
  importContinuation: () => ipcRenderer.invoke("continuation:import"),
  pendingContinuations: () => ipcRenderer.invoke("continuation:pending"),
  previewContinuation: token => ipcRenderer.invoke("continuation:preview",token),
  acceptContinuation: input => ipcRenderer.invoke("continuation:accept",input),
  rollbackContinuation: token => ipcRenderer.invoke("continuation:rollback",token),
  exportApplicationCandidate: () => ipcRenderer.invoke("peer:export-candidate"),
  listWebProAssignments: () => ipcRenderer.invoke("web-pro:list"),
  createWebProAssignment: input => ipcRenderer.invoke("web-pro:create", input),
  readWebProAssignment: id => ipcRenderer.invoke("web-pro:read", id),
  recordWebProSnapshot: input => ipcRenderer.invoke("web-pro:snapshot", input),
  recordWebProResult: input => ipcRenderer.invoke("web-pro:result", input),
  getInfo: () => ipcRenderer.invoke("app:get-info"),
  pickProject: () => ipcRenderer.invoke("project:pick"),
  addRecentProject: (cwd) => ipcRenderer.invoke("project:add-recent", cwd),
  openProject: (cwd, opts) => ipcRenderer.invoke("project:open", cwd, opts || {}),
  listOpenCheckouts: () => ipcRenderer.invoke("project:list-open"),
  focusProjectWindow: (windowId) =>
    ipcRenderer.invoke("project:focus-window", windowId),
  takePendingOpen: () => ipcRenderer.invoke("project:take-pending-open"),
  openProjectInNewWindow: (cwd) =>
    ipcRenderer.invoke("window:open-project-in-new", cwd),
  inspectCheckout: (cwd) => ipcRenderer.invoke("git:inspect-checkout", cwd),
  createWorktree: (opts) => ipcRenderer.invoke("worktree:create", opts || {}),
  /** Drop agent on this window; title returns to empty shell. */
  closeProject: () => ipcRenderer.invoke("project:close"),
  /** Respawn grok agent on this window and resume the same chat. */
  restartAgent: () => ipcRenderer.invoke("agent:restart"),
  listSessions: (cwd) => ipcRenderer.invoke("sessions:list", cwd),
  listSessionsAll: (cwds) => ipcRenderer.invoke("sessions:list-all", cwds || []),
  moveSession: (opts) => ipcRenderer.invoke("sessions:move", opts),
  listSessionMoves: () => ipcRenderer.invoke("sessions:moves"),
  onSessionMoved: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("sessions:moved", listener);
    return () => ipcRenderer.removeListener("sessions:moved", listener);
  },
  listLiveTurns: () => ipcRenderer.invoke("sessions:live-turns"),
  renameSession: (opts) => ipcRenderer.invoke("sessions:rename", opts || {}),
  deleteSession: (opts) => ipcRenderer.invoke("sessions:delete", opts || {}),
  openSession: (opts) => ipcRenderer.invoke("sessions:open", opts || {}),
  submitDelivery: (input) => ipcRenderer.invoke("agent:submit-delivery", input),
  listOutbox: (sessionId) => ipcRenderer.invoke("agent:outbox", sessionId),
  mutateOutbox: (sessionId, action, data) => ipcRenderer.invoke("agent:outbox-mutate", { sessionId, action, data }),
  cancel: (sessionId) => ipcRenderer.invoke("agent:cancel", sessionId),
  compact: (hint, sessionId) => ipcRenderer.invoke("agent:compact", hint || "", sessionId),
  rewind: (targetPromptIndex, restoreFiles) =>
    ipcRenderer.invoke("agent:rewind", {
      targetPromptIndex,
      restoreFiles: Boolean(restoreFiles),
    }),
  forkSession: (opts) => ipcRenderer.invoke("agent:fork", opts || {}),
  respondPermission: (reqId, outcome) =>
    ipcRenderer.invoke("agent:permission-respond", { reqId, outcome }),
  setAllowWritesThisSession: (value) =>
    ipcRenderer.invoke("agent:set-allow-writes-session", value),
  listPendingPermissions: () =>
    ipcRenderer.invoke("agent:list-pending-permissions"),
  listPendingPlanApprovals: () => ipcRenderer.invoke("agent:list-pending-plan-approvals"),
  listPendingFolderTrust: () => ipcRenderer.invoke("agent:list-pending-folder-trust"),
  listPendingUserQuestions: () => ipcRenderer.invoke("agent:list-pending-user-questions"),
  listPendingMcpElicits: () => ipcRenderer.invoke("agent:list-pending-mcp-elicits"),
  setSessionMode: (modeId) => ipcRenderer.invoke("agent:set-session-mode", modeId),
  respondPlanApproval: (reqId, decision) =>
    ipcRenderer.invoke("agent:plan-approval-respond", { reqId, decision }),
  respondUserQuestion: (reqId, decision) =>
    ipcRenderer.invoke("agent:user-question-respond", { reqId, decision }),
  respondFolderTrust: (reqId, decision) =>
    ipcRenderer.invoke("agent:folder-trust-respond", { reqId, decision }),
  respondMcpElicit: (reqId, decision) =>
    ipcRenderer.invoke("agent:mcp-elicit-respond", { reqId, decision }),
  setAlwaysApprove: (value) =>
    ipcRenderer.invoke("agent:set-always-approve", value),
  setPermissionMode: (value) =>
    ipcRenderer.invoke("agent:set-permission-mode", value),
  setReasoningEffort: (value) =>
    ipcRenderer.invoke("agent:set-reasoning-effort", value),
  setModel: (modelId) => ipcRenderer.invoke("agent:set-model", modelId),
  setAllowOutsideProject: (value) =>
    ipcRenderer.invoke("agent:set-allow-outside-project", value),
  setSandboxTerminal: (value) =>
    ipcRenderer.invoke("agent:set-sandbox-terminal", value),
  setTheme: (value) => ipcRenderer.invoke("app:set-theme", value),
  setPrivacyMode: (value) => ipcRenderer.invoke("app:set-privacy-mode", value),
  setAutoCompactAt: (value) =>
    ipcRenderer.invoke("app:set-auto-compact-at", value),
  getCodingDataStatus: () => ipcRenderer.invoke("app:get-coding-data"),
  setCodingDataOptIn: (value) =>
    ipcRenderer.invoke("app:set-coding-data-opt-in", value),
  getMemoryStatus: () => ipcRenderer.invoke("memory:status"),
  setMemoryEnabled: (value) => ipcRenderer.invoke("memory:set-enabled", value),
  deleteMemoryEntry: (entryId) => ipcRenderer.invoke("memory:delete", entryId),
  createWorkingKnowledgeObject: title => ipcRenderer.invoke("working-knowledge:create", title),
  exportWorkingKnowledge: objectId => ipcRenderer.invoke("working-knowledge:export", objectId),
  importWorkingKnowledge: () => ipcRenderer.invoke("working-knowledge:import"),
  listWorkingKnowledgeTransfers: () => ipcRenderer.invoke("working-knowledge:transfers"),
  previewWorkingKnowledgeTransfer: token => ipcRenderer.invoke("working-knowledge:transfer-preview", token),
  acceptWorkingKnowledgeTransfer: input => ipcRenderer.invoke("working-knowledge:transfer-accept", input),
  workingKnowledgeStatus: (opts) =>
    ipcRenderer.invoke("working-knowledge:status", opts || {}),
  setWorkingKnowledgeEnabled: (value) =>
    ipcRenderer.invoke("working-knowledge:set-enabled", value),
  setWorkingKnowledgeObject: (payload) =>
    ipcRenderer.invoke("working-knowledge:set-object", payload || {}),
  correctWorkingKnowledge: (payload) =>
    ipcRenderer.invoke("working-knowledge:correct", payload || {}),
  withdrawWorkingKnowledge: (payload) =>
    ipcRenderer.invoke("working-knowledge:withdraw", payload || {}),
  armWorkingKnowledgeProbe: () =>
    ipcRenderer.invoke("working-knowledge:arm-probe"),
  getBilling: () => ipcRenderer.invoke("agent:billing"),
  deleteScheduledTask: (opts) =>
    ipcRenderer.invoke("agent:scheduler-delete", opts || {}),
  exportChat: (opts) => ipcRenderer.invoke("chat:export", opts || {}),
  peerStatus: () => ipcRenderer.invoke("peer:status"),
  peerPair: (password) => ipcRenderer.invoke("peer:pair", password),
  peerAlign: (opts) => ipcRenderer.invoke("peer:align", opts || {}),
  listAccounts: () => ipcRenderer.invoke("account:list"),
  activateAccount: (id) => ipcRenderer.invoke("account:activate", id),
  copyAuthToPeer: (direction) =>
    ipcRenderer.invoke("peer:copy-auth", direction || "push"),
  copyAppToPeer: () => ipcRenderer.invoke("peer:copy-app"),
  setAllowPrerelease: (value) =>
    ipcRenderer.invoke("app:set-allow-prerelease", value),
  setDebugLogging: (value) => ipcRenderer.invoke("app:set-debug-logging", value),
  openDebugLog: () => ipcRenderer.invoke("app:open-debug-log"),
  getGitBranch: (cwd) => ipcRenderer.invoke("git:branch", cwd),
  getGitStatus: (cwd) => ipcRenderer.invoke("git:status", cwd),
  getGitDiff: (path, opts) => ipcRenderer.invoke("git:diff", path, opts || {}),
  readFile: (path, sessionId) => ipcRenderer.invoke("fs:read-file", path, sessionId),
  writeFile: (path, content) =>
    ipcRenderer.invoke("fs:write-file", path, content),
  listDir: (path) => ipcRenderer.invoke("fs:list-dir", path),
  openPath: (path) => ipcRenderer.invoke("shell:open-editor", path),
  openInEditor: (path) => ipcRenderer.invoke("shell:open-editor", path),
  listEditors: () => ipcRenderer.invoke("editor:list"),
  setExternalEditor: (id) => ipcRenderer.invoke("app:set-external-editor", id),
  showItem: (path) => ipcRenderer.invoke("shell:show-item", path),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  pickFile: () => ipcRenderer.invoke("fs:pick-file"),
  pickFiles: () => ipcRenderer.invoke("fs:pick-files"),
  pickFolder: () => ipcRenderer.invoke("fs:pick-folder"),
  pathForFile: (file) => {
    try {
      if (!file || typeof webUtils?.getPathForFile !== "function") return "";
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  importAttachment: (path, sessionId) => ipcRenderer.invoke("attachments:import", path, sessionId),
  pingAgent: () => ipcRenderer.invoke("agent:ping"),
  artifactPreview: (path) => ipcRenderer.invoke("artifact:preview", path),
  openPreview: (url) =>
    ipcRenderer.invoke("preview:open", url ? { url } : {}),
  closePreview: () => ipcRenderer.invoke("preview:close"),
  previewState: () => ipcRenderer.invoke("preview:state"),
  previewSnapshot: () => ipcRenderer.invoke("preview:snapshot"),

  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
  login: (opts) => ipcRenderer.invoke("auth:login", opts || {}),
  cancelLogin: () => ipcRenderer.invoke("auth:cancel-login"),
  submitLoginInput: (text) =>
    ipcRenderer.invoke("auth:submit-login-input", text),
  logout: () => ipcRenderer.invoke("auth:logout"),
  setApiKey: (key) => ipcRenderer.invoke("auth:set-api-key", key),
  openInstallDocs: () => ipcRenderer.invoke("auth:open-install-docs"),
  inspectBackbone: (cwd) => ipcRenderer.invoke("backbone:inspect", cwd),
  getGrokEngine: () => ipcRenderer.invoke("grok:engine"),
  checkGrokUpdate: () => ipcRenderer.invoke("grok:update-check"),
  installGrokUpdate: () => ipcRenderer.invoke("grok:update-install"),
  listMcpServers: (opts) => ipcRenderer.invoke("mcp:list", opts || {}),
  addMcpServer: (spec) => ipcRenderer.invoke("mcp:add", spec || {}),
  enableMcpServer: (name) => ipcRenderer.invoke("mcp:enable", name),
  disableMcpServer: (name) => ipcRenderer.invoke("mcp:disable", name),
  removeMcpServer: (name, opts) =>
    ipcRenderer.invoke("mcp:remove", { name, scope: opts?.scope }),
  doctorMcp: (name) => ipcRenderer.invoke("mcp:doctor", name),
  authenticateMcpServer: (name) => ipcRenderer.invoke("mcp:auth", name),
  logoutMcpServer: (name) => ipcRenderer.invoke("mcp:logout", name),
  setSettingsOpen: (open) => ipcRenderer.invoke("settings:set-open", Boolean(open)),
  listPlugins: () => ipcRenderer.invoke("plugin:list"),
  enablePlugin: (name) => ipcRenderer.invoke("plugin:enable", name),
  disablePlugin: (name) => ipcRenderer.invoke("plugin:disable", name),
  installPlugin: (source) => ipcRenderer.invoke("plugin:install", source),
  writeClipboard: (payload) => ipcRenderer.invoke("clipboard:write", payload || {}),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload || {}),
  bundleStale: () => ipcRenderer.invoke("app:bundle-stale"),
  relaunchApp: () => ipcRenderer.invoke("app:relaunch"),
  openDefault: (path) => ipcRenderer.invoke("shell:open-default", path),

  on: (channel, handler) => {
    const valid = [
      "agent:session-update",
      "agent:delivery",
      "agent:working-knowledge-error",
      "agent:mcp-status",
      "agent:permission-request",
      "agent:session-interjection",
      "agent:permission-dismiss",
      "agent:plan-approval-request",
      "agent:plan-approval-dismiss",
      "agent:user-question-request",
      "agent:user-question-dismiss",
      "agent:folder-trust-request",
      "agent:folder-trust-dismiss",
      "agent:mcp-elicit-request",
      "agent:mcp-elicit-dismiss",
      "agent:permission-mode",
      "agent:permissions-cleared",
      "agent:writes-session",
      "agent:stderr",
      "agent:error",
      "agent:exit",
      "agent:ready",
      "app:open-settings",
      "app:close-settings",
      "app:open-checkouts",
      "app:new-worktree",
      "auth:login-progress",
      "auth:changed",
      "preview:changed",
      "preview:viewport-capture",
      "app:find",
      "app:notify-click",
      "agent:parked-update",
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
