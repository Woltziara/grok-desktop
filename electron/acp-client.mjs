import { continuationRules } from './continuation-rules.mjs';
import { assertSessionNotMoving } from "./session-move.mjs";
/**
 * Minimal ACP (Agent Client Protocol) client over `grok agent stdio`.
 * Backbone: Grok Build agent runtime via ACP (same path as other embeds).
 *
 * Skills, MCP servers, plugins, and auth all come from the installed Grok CLI
 * (`~/.grok`). session/new `mcpServers` is *merged* with user config — we
 * only add the Desktop Preview MCP so the agent can drive the Preview window.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { agentEnv } from "./auth.mjs";
import { resolveGrokBinary } from "./grok-home.mjs";
import {
  isMissingGrokBinaryError,
  missingGrokBinaryMessage,
} from "./grok-cli.mjs";
import { AcpTerminalManager } from "./acp-terminals.mjs";
import { expandUserPath, resolveProjectPath } from "./path-safety.mjs";
import { readFileForAcp } from "./fs-content.mjs";
import { sessionsRootForCwd } from "./sessions.mjs";
import { extractChunkText } from "../shared/session-timeline.mjs";
import { issuePreviewScope, revokePreviewScope } from "./preview-ownership.mjs";
import { desktopPreviewMcpServers } from "./preview-mcp.mjs";
import { PREVIEW_SESSION_RULE } from "./preview-mcp-protocol.mjs";
import { browserReferenceMachineText, browserReferenceMeta } from "./browser-reference.mjs";
import {

  initializeClientMeta,
  normalizePermissionMode,
  sessionPermissionMeta,
  YOLO_MODE_CHANGED_METHOD,
  yoloModeChangedParams,
} from "./permission-mode.mjs";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffort,
} from "./reasoning-effort.mjs";
import { cancelledPermissionResult } from "../shared/permission-options.mjs";
import { rejectPendingByMethod } from "../shared/cancel-pending.mjs";
import { interpretAcpPing } from "../shared/agent-ping.mjs";
import { compressPromptImage } from "./image-compress.mjs";
import {
  consumeCompletedAcpPrompt,
  prepareAcpPrompt,
} from "./acp-prompt-lifecycle.mjs";
import {
  classifyInboundMessage,
  compactConversationAttempts,
  billingAttempts,
  schedulerDeleteAttempts,
  rewindExecuteAttempts,
  sessionForkAttempts,
  parseForkSessionId,
  worktreeCreateFromSyncAttempts,
  worktreeListAttempts,
  parseWorktreeCreateResponse,
  parseWorktreeListResponse,
  sessionRenameAttempts,
  sessionDeleteAttempts,
  isMcpLiveEventMethod,
  isMcpElicitCompleteMethod,
  isMcpElicitMethod,
  mcpAuthTriggerAttempts,
  mcpSessionListAttempts,
  unwrapExtMethodResult,
  unwrapMcpExtNotification,
  createOnceResponder,
  isFsReadMethod,
  isFsWriteMethod,
  isFolderTrustMethod,
  isPermissionMethod,
  isTerminalMethod,
  jsonRpcErrorCode,
  formatAcpError,
  acpClientCapabilities,
} from "../shared/acp-rpc.mjs";
import {
  interjectAcceptedResult,
  interjectAttempts,
  interjectFromAttemptErrors,
  isInterjectMethodMissing,
  unwrapSessionInterjection,
} from "../shared/acp-interject.mjs";
import {
  currentModeIdFromUpdate,
  rememberSessionMode,
  setSessionModeParams,
} from "../shared/session-mode.mjs";
import { handleAcpPermissionRequest } from "./acp-protocol.mjs";
import { mapMcpSessionCatalog } from "../shared/mcp-status.mjs";
import {
  handleAskUserQuestion,
  handleExitPlanMode,
  handleFolderTrustRequest,
  handleMcpElicit,
} from "./acp-ext-methods.mjs";
import { shouldAutoTrustFolder } from "./desktop-worktrees.mjs";
import { debugLog } from "./debug-log.mjs";
import { captureWorkingKnowledgeInterjection } from "./working-knowledge.mjs";
import { errorFields, writeCrashLog } from "./crash-log.mjs";
import {
  scheduledInjectFromInbound,
  scheduledTaskUpdateFromInbound,
} from "../shared/scheduled-tasks.mjs";
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 60_000;
const LOAD_TIMEOUT_MS = 90_000;
/** Client extension methods used by Grok for plan UI / questions (not plain tools). */
const EXT_EXIT_PLAN = "x.ai/exit_plan_mode";
const EXT_ASK_USER = "x.ai/ask_user_question";

/** @param {any} entry */
function modelEntryName(entry) {
  const name =
    entry?.name ||
    entry?.title ||
    entry?.displayName ||
    entry?._meta?.name ||
    null;
  return name ? String(name) : null;
}

/**
 * @param {any} raw
 */
function summarizeCompactResult(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const nested = r.result && typeof r.result === "object" ? r.result : r;
  const before = Number(
    nested.tokens_before ??
      nested.tokensBefore ??
      nested.pre_tokens ??
      nested.preTokens,
  );
  const after = Number(
    nested.tokens_after ??
      nested.tokensAfter ??
      nested.post_tokens ??
      nested.postTokens,
  );
  let message = "Compress finished.";
  if (Number.isFinite(before) && before > 0 && Number.isFinite(after)) {
    message = `Conversation compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens.`;
  } else if (nested.message) {
    message = String(nested.message);
  } else if (nested.error) {
    message = String(nested.error);
  }
  return {
    ok: true,
    tokens_before: Number.isFinite(before) ? before : undefined,
    tokens_after: Number.isFinite(after) ? after : undefined,
    message,
  };
}

/**
 * grok-build `McpAuthTriggerResponse` — status is authenticated / failed /
 * setup_required. Do not forward `setup` field schemas (may include labels).
 * @param {any} raw
 * @param {string} serverName
 */
function summarizeMcpAuthResult(raw, serverName) {
  const r = raw && typeof raw === "object" ? raw : {};
  const nested = r.result && typeof r.result === "object" ? r.result : r;
  const status = String(nested.status || "").toLowerCase();
  const error =
    nested.error == null || nested.error === ""
      ? null
      : String(nested.error);
  if (status === "authenticated") {
    return { ok: true, status: "authenticated", serverName, error: null };
  }
  if (status === "setup_required") {
    return {
      ok: false,
      status: "setup_required",
      serverName,
      error:
        error ||
        "This server needs extra setup values before sign-in. Add them in the TUI /mcps modal, or set headers when adding the server.",
    };
  }
  return {
    ok: false,
    status: status || "failed",
    serverName,
    error:
      error || `Authentication failed for MCP server “${serverName}”.`,
  };
}

/**
 * Deduped `{ modelId, name }` list for IPC / open-session results.
 * @param {any[]} list
 * @returns {{ modelId: string, name: string }[]}
 */
function snapshotAvailableModels(list) {
  const seen = new Set();
  /** @type {{ modelId: string, name: string }[]} */
  const out = [];
  for (const m of list || []) {
    const modelId = String(m?.modelId || "").trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    out.push({ modelId, name: modelEntryName(m) || modelId });
  }
  return out;
}

export class GrokAcpClient extends EventEmitter {
  constructor({
    cwd,
    grokPath,
    /** @deprecated use permissionMode */
    alwaysApprove = false,
    /** ask | auto | always-approve — see permission-mode.mjs */
    permissionMode,
    /** When false (default), ACP fs/* and terminal cwd stay inside project */
    allowOutsideProject = false,
    /** When true (default), wrap ACP tool shells in an OS FS jail */
    sandboxTerminal = true,
    /**
     * Reasoning effort for models that support it (`/effort`, `--reasoning-effort`).
     * low | medium | high | xhigh
     */
    reasoningEffort = DEFAULT_REASONING_EFFORT,
    clientVersion = "0.1.2",
    windowId = null,
    /** Internal ACP prompt boundary injection for deterministic client tests. */
    promptLifecycle = null,
  } = {}) {
    super();
    this.cwd = cwd || process.cwd();
    this.grokPath = grokPath || resolveGrokBinary();
    this.permissionMode = normalizePermissionMode(
      permissionMode,
      alwaysApprove,
    );
    this.allowOutsideProject = Boolean(allowOutsideProject);
    this.sandboxTerminal = sandboxTerminal !== false;
    this.reasoningEffort = normalizeReasoningEffort(reasoningEffort);
    this.clientVersion = clientVersion;
    this.windowId = windowId;
    this._promptLifecycle =
      promptLifecycle &&
      typeof promptLifecycle.prepare === "function" &&
      typeof promptLifecycle.consume === "function"
        ? promptLifecycle
        : {
            prepare: prepareAcpPrompt,
            consume: consumeCompletedAcpPrompt,
          };
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function, timer?: NodeJS.Timeout }>} */
    this.pending = new Map();
    /** @type {string[]} */
    this._cronQueue = [];
    /**
     * Open agent→client permission oneshots (ACP request id → gate).
     * Cancel MUST settle each with outcome cancelled (spec).
     * @type {Map<any, { settle: (outcome: any) => boolean, wait: () => Promise<any> }>}
     */
    this._openPermissionGates = new Map();
    /** @type {ReturnType<typeof createOnceResponder> | null} */
    this._once = null;
    this.sessionId = null;
    /** Monotonic id for session/update events this process has emitted. */
    this.updateSeq = 0;
    this.ready = false;
    this.stderrBuf = "";
    /** @type {Record<string, any>} */
    this.agentCapabilities = {};
    /** Last known ACP model id (from session/new|load models.currentModelId). */
    this.currentModelId = null;
    /** Human-readable name for the current model when the agent provides one. */
    this.currentModelName = null;
    /** Last known ACP session mode (`plan`, `default`, ...). */
    this.currentModeId = null;
    /** Serialize mode changes so an older response cannot win the same session. */
    this._modeSyncTail = Promise.resolve();
    this._modeSyncVersion = 0;
    this._modeSyncPending = 0;
    /**
     * Models advertised on session/new|load (`models.availableModels`).
     * @type {{ modelId: string, name: string }[]}
     */
    this.availableModels = [];
    /**
     * Effort levels advertised by the current model (ids). Empty when unknown.
     * @type {string[]}
     */
    this.availableReasoningEfforts = [];
    /** Session-scoped: auto-allow remaining write/edit/post prompts. */
    this.allowWritesThisSession = false;
    /** True while session/prompt is in flight. */
    this.turnOpen = false;
    /** Stop was hit for the in-flight prompt — do not drain cron after it. */
    this._turnCancelled = false;
    /** Assistant text for the open turn (working-knowledge consume). */
    this._turnAssistantBuf = "";
    this._turnInboxId = null;
    this._turnObjectId = "";
    this._activeTurn = null;
    this._needsPromptRestart = false;
    this._discardUpdates = false;
    this._restartPromise = null;
    this._suppressReplay = false;
    this._cancelRevision = 0;
    this._resumeSessionId = null;
    this._interjectionCalls = new Map();
    this.terminals = new AcpTerminalManager({
      defaultCwd: this.cwd,
      allowOutsideProject: this.allowOutsideProject,
      sandboxTerminal: this.sandboxTerminal,
    });
    // Forward terminal lifecycle for optional UI live-output later
    for (const ev of ["created", "output", "exit", "released"]) {
      this.terminals.on(ev, (payload) => this.emit(`terminal:${ev}`, payload));
    }
  }

  /**
   * Session store dir for this project + session (where plan.md lives).
   * @returns {string | null}
   */
  sessionDir() {
    if (!this.cwd || !this.sessionId) return null;
    return path.join(sessionsRootForCwd(this.cwd), this.sessionId);
  }

  /**
   * True if absolute path is inside the current CLI session folder.
   * Plan mode writes plan.md there (outside the open project tree).
   * @param {string} abs
   */
  _isUnderSessionDir(abs) {
    const root = this.sessionDir();
    if (!root) return false;
    let realRoot = root;
    let realAbs = abs;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      /* session dir may not exist yet */
    }
    try {
      realAbs = fs.realpathSync(abs);
    } catch {
      /* write targets may not exist */
    }
    const rel = path.relative(realRoot, realAbs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  /**
   * Resolve ACP fs path (relative → project cwd) and optionally sandbox.
   * Always allows the current session directory so plan.md can be written,
   * and GROK_HOME (~/.grok) so skills / agents / personas stay readable when
   * “Allow outside project” is off.
   * @param {string} filePath
   */
  _resolveFsPath(filePath) {
    const empty = filePath == null || String(filePath).trim() === "";
    if (empty) {
      throw Object.assign(new Error("Path is required"), { code: -32602 });
    }
    // Agents often pass ~/… — Node does not expand tilde.
    const asStr = expandUserPath(String(filePath).trim());
    const abs = path.isAbsolute(asStr)
      ? path.resolve(asStr)
      : path.resolve(this.cwd || process.cwd(), asStr);

    if (this._isUnderSessionDir(abs)) {
      return abs;
    }

    try {
      return resolveProjectPath(this.cwd, filePath, {
        allowOutside: this.allowOutsideProject,
        // Skills, agents, personas, sessions, MCP config live under GROK_HOME.
        allowGrokHome: true,
      });
    } catch (err) {
      throw Object.assign(new Error(err?.message || String(err)), {
        code: err?.code ?? -32000,
      });
    }
  }

  /**
   * Spawn agent + initialize. Optionally resume a persisted session (ACP session/load).
   * @param {{ resumeSessionId?: string | null }} [opts]
   */
  async start(opts = {}) {
    if (this.proc) return this;

    // Agent flags go after `agent` and before the transport (`stdio`).
    // Top-level `grok --flag … agent stdio` is ignored by the CLI.
    const args = ["agent"];
    if (this.permissionMode === "always-approve") {
      // Match TUI/CLI always-approve so the agent sets yoloMode for the process
      // (session/_meta alone is not enough on resume / late UI toggles).
      args.push("--always-approve");
    }
    if (this.reasoningEffort) {
      args.push("--reasoning-effort", this.reasoningEffort);
    }
    // Optional agent debug file (same folder as desktop-debug when env set)
    if (/^(1|true|yes|on)$/i.test(String(process.env.GROK_DESKTOP_DEBUG || ""))) {
      args.push("--debug");
    }
    args.push("stdio");
    debugLog("agent", "spawn", {
      bin: this.grokPath,
      args,
      cwd: this.cwd,
      effort: this.reasoningEffort,
      sandbox: this.sandboxTerminal,
      allowOutside: this.allowOutsideProject,
    });
    this.proc = spawn(this.grokPath, args, {
      cwd: this.cwd,
      env: agentEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const spawned = this.proc;
    // Quarantine belongs to the retired transport, not to this new connection.
    // In particular session/load may need trust/elicitation before it can finish.
    this._discardUpdates = false;
    this.proc.on("error", (err) => {
      if (this.proc !== spawned) return;
      const wrapped = isMissingGrokBinaryError(err)
        ? Object.assign(new Error(missingGrokBinaryMessage(this.grokPath)), {
            code: "ENOENT",
          })
        : err;
      debugLog("agent", "spawn error", {
        message: wrapped?.message || String(wrapped),
      });
      // Unblock initialize / session RPCs — do not wait for the 60s timeout.
      this._rejectAllPending(wrapped);
      this.emit("error", wrapped);
    });

    this.proc.on("exit", (code, signal) => {
      if (this.proc !== spawned) return;
      this.ready = false;
      try {
        this.terminals.disposeAll();
      } catch {
        /* ignore */
      }
      this._rejectAllPending(
        new Error(`Agent exited (code=${code}, signal=${signal})`),
      );
      this.emit("exit", { code, signal });
    });

    this.proc.stderr.on("data", (chunk) => {
      if (this.proc !== spawned) return;
      const text = chunk.toString();
      this.stderrBuf += text;
      this.emit("stderr", text);
    });

    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => { if (this.proc === spawned) this._onLine(line); });

    const init = await this.request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: {
          name: "grok-desktop",
          version: this.clientVersion,
        },
        clientCapabilities: acpClientCapabilities(),
        _meta: initializeClientMeta(),
      },
      { timeoutMs: INIT_TIMEOUT_MS },
    );
    this.agentCapabilities = init?.agentCapabilities || {};

    if (opts.resumeSessionId) {
      await this.loadSession(opts.resumeSessionId);
    } else {
      await this.newSession();
    }
    return this;
  }

  /**
   * Meta passed on session/new and session/load so the agent starts in the
   * same permission mode the Desktop UI shows (grok-build yoloMode + autoMode).
   */
  _sessionPermissionMeta(sessionId = this.sessionId) {
    return {
      ...sessionPermissionMeta(this.permissionMode || "ask"),
      rules: PREVIEW_SESSION_RULE + continuationRules(this.cwd, sessionId),
    };
  }

  _previewMcpPayload() {
    revokePreviewScope(this._previewScopeId);
    const connection = this.proc;
    this._previewSessionReady = false;
    this._previewScopeId = issuePreviewScope({
      windowId: this.windowId,
      getSessionId: () => this._previewSessionReady ? this.sessionId : null,
      isLive: () => Boolean(connection && this.proc === connection && !this._discardUpdates),
    });
    const servers = desktopPreviewMcpServers(this.windowId, this._previewScopeId);
    debugLog("preview", "session-mcp", {
      count: servers.length,
      names: servers.map((s) => s.name),
      types: servers.map((s) => s.type || "stdio"),
    });
    return servers;
  }

  /**
   * Remember model id + advertised effort menu from session/new|load result.
   * @param {any} session
   */
  _rememberModels(session) {
    const models = session?.models;
    const current =
      models?.currentModelId ||
      session?._meta?.["x.ai/sessionDetail"]?.currentModelId ||
      null;
    if (current) this.currentModelId = String(current);

    const list = Array.isArray(models?.availableModels)
      ? models.availableModels
      : [];
    this.availableModels = snapshotAvailableModels(list);
    const entry =
      list.find((m) => String(m?.modelId || "") === this.currentModelId) ||
      list[0];
    const name = modelEntryName(entry);
    this.currentModelName = name || null;
    const efforts = entry?._meta?.reasoningEfforts;
    if (Array.isArray(efforts)) {
      this.availableReasoningEfforts = efforts
        .map((e) => String(e?.id || e?.value || "").toLowerCase())
        .filter(Boolean);
    } else {
      this.availableReasoningEfforts = [];
    }

    // Prefer live session value when present and we have no stronger client pref
    // (spawn flag already applied; keep client preference as source of truth).
    const live = entry?._meta?.reasoningEffort;
    if (live && !this.reasoningEffort) {
      this.reasoningEffort = normalizeReasoningEffort(live);
    }
  }

  /** Snapshot of session model state for IPC / open-session results. */
  _modelsPublic() {
    return {
      modelId: this.currentModelId || null,
      modelName: this.currentModelName || null,
      availableModels: this.availableModels.slice(),
    };
  }

  _rememberSessionMode(session) {
    this.currentModeId = rememberSessionMode(session);
  }

  /**
   * Align live session effort with Desktop preference after session/new|load.
   * Spawn flag usually already matches; this covers load + mid-process /new.
   */
  async _syncReasoningEffortToSession() {
    if (!this.sessionId || !this.ready || !this.reasoningEffort) return;
    if (!this.currentModelId) return;
    try {
      await this.request(
        "session/set_model",
        {
          sessionId: this.sessionId,
          modelId: this.currentModelId,
          _meta: { reasoningEffort: this.reasoningEffort },
        },
        { timeoutMs: 15_000 },
      );
    } catch {
      /* Best-effort — spawn flag / next agent start still apply. */
    }
  }

  async newSession() {
    // Drop prior chat's processes so /new and session switch don't leak shells
    try {
      this.terminals.disposeAll();
    } catch {
      /* ignore */
    }
    const session = await this.request(
      "session/new",
      {
        cwd: this.cwd,
        mcpServers: this._previewMcpPayload(),
        _meta: this._sessionPermissionMeta(),
      },
      { timeoutMs: LOAD_TIMEOUT_MS },
    );
    this.sessionId = session.sessionId;
    this._previewSessionReady = true;
    this.allowWritesThisSession = false;
    this.emit("writes-session", false);
    this._rememberModels(session);
    this._rememberSessionMode(session);
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    await this._syncReasoningEffortToSession();
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
      resumed: false,
      sessionMode: this.currentModeId,
      ...this._modelsPublic(),
    });
    return this.sessionId;
  }

  /**
   * @param {string} sessionId
   */
  async loadSession(sessionId) {
    if (!sessionId) throw new Error("sessionId required");
    const caps = this.agentCapabilities || {};
    if (caps.loadSession === false) {
      throw new Error("This Grok agent does not support session/load");
    }

    try {
      this.terminals.disposeAll();
    } catch {
      /* ignore */
    }

    const result = await this.request(
      "session/load",
      {
        sessionId,
        cwd: this.cwd,
        mcpServers: this._previewMcpPayload(),
        _meta: { ...this._sessionPermissionMeta(sessionId), "x.ai/restore_code": false },
      },
      { timeoutMs: LOAD_TIMEOUT_MS },
    );

    this.sessionId =
      result?.sessionId || result?._meta?.sessionId || sessionId;
    this._previewSessionReady = true;
    this.allowWritesThisSession = false;
    this.emit("writes-session", false);
    this._rememberModels(result);
    this._rememberSessionMode(result);
    this.terminals.setDefaultCwd(this.cwd);
    this.ready = true;
    await this._syncReasoningEffortToSession();
    this.emit("ready", {
      sessionId: this.sessionId,
      cwd: this.cwd,
      grokBinary: this.grokPath,
      resumed: true,
      sessionMode: this.currentModeId,
      ...this._modelsPublic(),
    });
    return this.sessionId;
  }

  _rejectAllPending(err) {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    // Unblock any parked session/request_permission oneshots
    this._cancelOpenPermissionGates();
  }

  /**
   * ACP: Client MUST respond to all pending request_permission with cancelled
   * when the prompt turn is cancelled. Only settle the oneshot here — the
   * parked handler awaits wait() then issues the single JSON-RPC response.
   */
  _cancelOpenPermissionGates() {
    const cancelled = cancelledPermissionResult();
    for (const [, gate] of this._openPermissionGates) {
      gate.settle(cancelled);
    }
    // Do not clear the map here: finally blocks on the handlers remove entries
    // after they _respond once.
  }

  _ensureOnce() {
    if (!this._once) {
      this._once = createOnceResponder((msg) => this._write(msg));
    }
    return this._once;
  }

  _onLine(line) {
    try {
      this._dispatchLine(line);
    } catch (err) {
      debugLog("acp", "on-line-error", {
        error: err?.message || String(err),
      });
      writeCrashLog("acp", "on-line-error", errorFields(err));
    }
  }

  _dispatchLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.emit("parse-error", trimmed);
      return;
    }

    const c = classifyInboundMessage(msg);
    // Once cancelled, untagged events from this transport have no trustworthy
    // turn identity. Ignore them until a fresh transport resumes the same session.
    if ((this._discardUpdates || this._suppressReplay) && c.kind === "session-update") {
      if (c.expectsEmptyAck) { this._ensureOnce().beginRequest(c.id); this._respond(c.id, {}); }
      return;
    }
    const interjection = unwrapSessionInterjection(msg.method, msg.params);
    if (interjection) {
      if (!this._discardUpdates && !this._suppressReplay) this.emit("session-interjection", interjection);
      if (msg.id !== undefined) {
        this._ensureOnce().beginRequest(msg.id);
        this._respond(msg.id, {});
      }
      return;
    }
    const mcpEvent = unwrapMcpExtNotification(msg.method, msg.params);
    if (mcpEvent && isMcpElicitCompleteMethod(mcpEvent.method)) {
      if (msg.id !== undefined) {
        this._ensureOnce().beginRequest(msg.id);
        this._respond(msg.id, {});
      }
      return;
    }

    if (mcpEvent && isMcpLiveEventMethod(mcpEvent.method)) {
      if (!this._discardUpdates) this.emit("mcp-status", mcpEvent);
      if (msg.id !== undefined) {
        this._ensureOnce().beginRequest(msg.id);
        this._respond(msg.id, {});
      }
      return;
    }

    if (c.kind === "session-update") {
      // Progress only — does not complete tools; agent still needs client RPCs.
      if (this.turnOpen && (!c.params?.sessionId || c.params.sessionId === this.sessionId)) {
        const update = c.params?.update || c.params;
        const kind = update?.sessionUpdate || update?.session_update;
        if (kind === "agent_message_chunk") {
          const piece = extractChunkText(update?.content);
          if (piece) this._turnAssistantBuf += piece;
        }
      }
      const modeId = currentModeIdFromUpdate(c.params);
      if (modeId !== undefined) this.currentModeId = modeId;
      this.emit("session-update", this._stampOutboundUpdate(c.params));
      if (c.expectsEmptyAck) {
        this._ensureOnce().beginRequest(c.id);
        this._respond(c.id, {});
      }
      return;
    }

    if (c.kind === "server-request") {
      if (this._discardUpdates) {
        this._ensureOnce().beginRequest(c.id);
        this._respond(c.id, null, { code: -32800, message: "Turn cancelled" });
        return;
      }
      // Fresh response slot for this id (JSON-RPC may reuse ids after completion).
      this._ensureOnce().beginRequest(c.id);
      // Concurrent handlers (grok-build gateway spawn): one long permission
      // wait must not block later fs/* / terminal/* lines.
      const transport = this.proc;
      this._handleServerRequest({
        method: c.method,
        id: c.id,
        params: c.params,
      }).catch((err) => {
        if (this.proc !== transport) return;
        debugLog("acp", "server-request-error", {
          id: c.id,
          method: c.method,
          error: err?.message || String(err),
          code: err?.code,
        });
        this._respond(c.id, null, {
          code: jsonRpcErrorCode(err?.code),
          message: err?.message || String(err),
        });
      });
      return;
    }

    if (c.kind === "notification") {
      if (this._discardUpdates) return;
      const scheduled = scheduledTaskUpdateFromInbound(c.method, c.params);
      if (scheduled) {
        this.emit("session-update", this._stampOutboundUpdate(scheduled));
      }
      const inject = scheduledInjectFromInbound(c.method, c.params);
      if (inject) {
        this.emit("scheduled-inject", inject);
      }
      this.emit("notification", { method: c.method, params: c.params });
      return;
    }

    if (c.kind === "client-response" && this.pending.has(c.id)) {
      const p = this.pending.get(c.id);
      this.pending.delete(c.id);
      if (p.timer) clearTimeout(p.timer);
      if (c.error) {
        const err = new Error(formatAcpError(c.error));
        if (typeof c.error.code === "number") err.code = c.error.code;
        debugLog("acp", "rpc-error", {
          id: c.id,
          code: c.error.code,
          message: err.message,
        });
        p.reject(err);
      } else {
        p.resolve(c.result);
      }
    }
  }

  async _handleServerRequest(msg) {
    const transport = this.proc;
    const respond = (...args) => { if (this.proc === transport) this._respond(...args); };
    const { method, params, id } = msg;
    const started = Date.now();
    debugLog("acp", "server-request", {
      id,
      method: String(method || ""),
      path: params?.path,
      tool:
        params?.toolCall?.title ||
        params?.toolCall?._meta?.["x.ai/tool"]?.name ||
        null,
    });

    const extCtx = {
      emitter: this,
      respond: (rid, result, error) => respond(rid, result, error),
      sessionDir: () => this.sessionDir(),
    };

    try {
      // Grok extension: plan approval popup (must not auto-approve / no-op)
      if (
        method === EXT_EXIT_PLAN ||
        method === "exit_plan_mode" ||
        method?.endsWith("/exit_plan_mode")
      ) {
        await handleExitPlanMode(extCtx, id, params);
        return;
      }

      // Grok extension: multi-choice questions
      if (
        method === EXT_ASK_USER ||
        method === "ask_user_question" ||
        method?.endsWith("/ask_user_question")
      ) {
        await handleAskUserQuestion(extCtx, id, params);
        return;
      }

      // MCP elicitation (form fields or URL consent). Must not -32601 —
      // the MCP server waits on this reverse-request.
      if (isMcpElicitMethod(method) || isMcpElicitMethod(params?.method)) {
        await handleMcpElicit(
          {
            ...extCtx,
            listenerCount: this.listenerCount("mcp-elicit-request"),
          },
          id,
          params,
          method,
        );
        return;
      }

      // Grok worktrees under ~/.grok are a new git root — project MCP is gated
      // until this reverse-request is answered (TUI /hooks-trust).
      if (isFolderTrustMethod(method) || isFolderTrustMethod(params?.method)) {
        await handleFolderTrustRequest(
          {
            ...extCtx,
            listenerCount: this.listenerCount("folder-trust-request"),
            shouldAutoTrust: shouldAutoTrustFolder,
          },
          id,
          params,
          method,
        );
        return;
      }

      if (isPermissionMethod(method)) {
        await handleAcpPermissionRequest({
          id,
          params,
          permissionMode: this.permissionMode,
          allowWritesThisSession: this.allowWritesThisSession,
          listenerCount: this.listenerCount("permission-request"),
          gates: this._openPermissionGates,
          respond: (rid, result, error) => respond(rid, result, error),
          onPark: ({ params: p, oneshot, requestId }) => {
            this.emit("permission-request", {
              params: p,
              requestId,
              respond: (outcome) => {
                oneshot.settle(outcome || cancelledPermissionResult());
              },
            });
          },
          onNoListener: (toolName) => {
            console.error(
              "[acp] session/request_permission with no listener — cancelling",
              { id, toolName },
            );
            debugLog("acp", "permission-no-listener", { id, toolName });
          },
        });
        return;
      }

      if (isFsReadMethod(method)) {
        // Grok write/edit: when clientCapabilities.fs.writeTextFile is true the
        // agent often fs/read_text_file's the path first, then write_text_file.
        // ENOENT must NOT be a hard JSON-RPC error — that stalls the tool forever
        // (create-new-file write hangs on "pending" / Working…).
        //
        // Images / binaries: metadata-only text (see fs-content.mjs). No base64
        // smuggling through ACP read_text_file — attach in composer for vision.
        const filePath = this._resolveFsPath(params?.path);
        try {
          const line = Number(params?.line);
          const limit = Number(params?.limit);
          const result = await readFileForAcp(filePath, {
            line: Number.isFinite(line) ? line : undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
          });
          if (result.kind !== "text") {
            debugLog("acp", "fs-read-nontext", {
              path: filePath,
              kind: result.kind,
              mime: result.mime,
              chars: result.content?.length,
            });
          }
          respond(id, { content: result.content });
        } catch (err) {
          if (err?.code === "ENOENT") {
            debugLog("acp", "fs-read-missing", { path: filePath });
            respond(id, { content: "" });
            return;
          }
          throw err;
        }
        return;
      }

      if (isFsWriteMethod(method)) {
        const filePath = this._resolveFsPath(params?.path);
        const content =
          params?.content != null
            ? String(params.content)
            : params?.text != null
              ? String(params.text)
              : "";
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        if (this.proc !== transport || this._discardUpdates) throw new Error("Turn cancelled");
        await fs.promises.writeFile(filePath, content, "utf8");
        debugLog("acp", "fs-write-ok", {
          path: filePath,
          bytes: content.length,
        });
        // ACP: empty result on success (null or {})
        respond(id, {});
        return;
      }

      if (isTerminalMethod(method)) {
        await this._handleTerminal(method, params, id);
        return;
      }

      console.error("[acp] unhandled client method (agent may hang):", method, {
        id,
      });
      debugLog("acp", "unhandled-method", { id, method: String(method || "") });
      respond(id, null, {
        code: -32601,
        message: `Unhandled client method: ${method}`,
      });
    } finally {
      debugLog("acp", "server-request-done", {
        id,
        method: String(method || ""),
        ms: Date.now() - started,
      });
    }
  }

  /**
   * ACP terminal/* — agent runs commands in the desktop client's environment.
   * @param {string} method
   * @param {any} params
   * @param {number|string} id
   */
  async _handleTerminal(method, params, id) {
    const transport = this.proc;
    const respond = (...args) => { if (this.proc === transport) this._respond(...args); };
    try {
      switch (method) {
        case "terminal/create": {
          const result = this.terminals.create(params || {});
          respond(id, result);
          return;
        }
        case "terminal/output": {
          respond(id, this.terminals.output(params || {}));
          return;
        }
        case "terminal/wait_for_exit": {
          const status = await this.terminals.waitForExit(params || {});
          respond(id, status);
          return;
        }
        case "terminal/kill": {
          respond(id, this.terminals.kill(params || {}));
          return;
        }
        case "terminal/release": {
          respond(id, this.terminals.release(params || {}));
          return;
        }
        default:
          respond(id, null, {
            code: -32601,
            message: `Unhandled terminal method: ${method}`,
          });
      }
    } catch (err) {
      respond(id, null, {
        code: jsonRpcErrorCode(err?.code),
        message: err?.message || String(err),
      });
    }
  }

  /**
   * Exactly one JSON-RPC response per agent request id.
   * @param {string|number} id
   * @param {any} [result]
   * @param {{ code?: number, message?: string } | null} [error]
   */
  _respond(id, result, error = null) {
    try {
      this._ensureOnce().respond(id, result, error);
    } catch (err) {
      // Agent already gone (HMR / restart / crash). Do not reject the
      // inbound-line handler — that surfaces as an unhandled rejection.
      debugLog("acp", "respond-failed", {
        id,
        error: err?.message || String(err),
      });
    }
  }

  /**
   * Stamp session ownership and a per-agent seq so history replay can drop
   * events already covered by the disk snapshot without comparing text.
   * @param {any} params
   */
  _stampOutboundUpdate(params) {
    this.updateSeq = (Number(this.updateSeq) || 0) + 1;
    const base =
      params && typeof params === "object" ? { ...params } : { update: params };
    if (base.sessionId == null && base.session_id == null) {
      base.sessionId = this.sessionId || null;
    }
    base._desktopSeq = this.updateSeq;
    return base;
  }

  _write(obj) {
    if (!this.proc?.stdin?.writable) throw new Error("Agent stdin not writable");
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {{ timeoutMs?: number }} [opts]
   */
  request(method, params = {}, opts = {}) {
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(
          Object.assign(new Error(
            `ACP request timed out after ${timeoutMs}ms: ${method}`,
          ), { code: "ACP_REQUEST_TIMEOUT", method }),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  notify(method, params = {}) {
    try {
      this._write({ jsonrpc: "2.0", method, params });
    } catch (err) {
      debugLog("acp", "notify-failed", {
        method,
        error: err?.message || String(err),
      });
    }
  }

  /**
   * Round-trip health check. Process-alive is not sufficient: a hung
   * agent still has a pid. Any JSON-RPC response (including method-not-found)
   * proves the ACP pipe still answers; timeout means it does not.
   * @param {number} [timeoutMs]
   */
  async ping(timeoutMs = 4000) {
    const proc = this.proc;
    const processAlive = Boolean(proc && !proc.killed && proc.exitCode == null);
    const ready = Boolean(this.ready);
    if (!processAlive || !ready) {
      return interpretAcpPing({ processAlive, ready, rpcErrorMessage: null });
    }
    try {
      await this.request(
        "session/list",
        this.sessionId ? { sessionId: this.sessionId } : {},
        { timeoutMs },
      );
      return interpretAcpPing({
        processAlive: true,
        ready: true,
        rpcErrorMessage: null,
      });
    } catch (err) {
      return interpretAcpPing({
        processAlive: true,
        ready: true,
        rpcErrorMessage: err?.message || String(err),
      });
    }
  }

  /**
   * Compact via grok-build `ext_method` → `x.ai/compact_conversation`.
   * Never send `/compact` as session/prompt. Response body may be `{}`;
   * token counts arrive on `x.ai/session_notification`.
   * @param {string} [hint]
   */
  async compactConversation(hint = "") {
    if (!this.sessionId) throw new Error("No ACP session");
    const longMs = 3 * 60_000;
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };

    const attempts = compactConversationAttempts(this.sessionId, hint);
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        debugLog("acp", "compact-ok", { path: attempt.method });
        return summarizeCompactResult(raw);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "compact-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Compress is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Branch this chat into a new session id. Does not switch the live session.
   */
  async forkSession() {
    if (!this.sessionId) throw new Error("No ACP session");
    const longMs = 3 * 60_000;
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const attempts = sessionForkAttempts({
      sessionId: this.sessionId,
      cwd: this.cwd,
      // A fork receives its own Preview descriptor when it is loaded.
      mcpServers: [],
    });
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        const sid = parseForkSessionId(raw, this.sessionId);
        if (!sid) {
          throw new Error("Fork did not return a new session");
        }
        debugLog("acp", "fork-ok", { path: attempt.method, sessionId: sid });
        return { sessionId: sid, raw: raw ?? {} };
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "fork-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Fork is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Truncate conversation via grok-build `x.ai/rewind/execute`.
   * Keeps the selected user prompt and drops everything after it.
   * @param {number} targetPromptIndex
   * @param {boolean} [restoreFiles]
   * @param {string} [sessionId]
   */
  async rewindConversation(
    targetPromptIndex,
    restoreFiles = false,
    sessionId = "",
  ) {
    const sid = String(sessionId || this.sessionId || "").trim();
    if (!sid) throw new Error("No ACP session");
    const longMs = 3 * 60_000;
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };

    const attempts = rewindExecuteAttempts(
      sid,
      targetPromptIndex,
      restoreFiles,
    );
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        debugLog("acp", "rewind-ok", { path: attempt.method });
        return raw ?? { ok: true };
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "rewind-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Rewind is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * TUI `/usage` credits snapshot.
   */
  async fetchBilling() {
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const misses = [];
    for (const attempt of billingAttempts()) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        return raw ?? {};
      } catch (err) {
        const message = err?.message || String(err);
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Billing is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Cancel a scheduled `/loop` on this or a forked session id.
   * @param {string} taskId
   * @param {string} [sessionId]
   */
  async deleteScheduledTask(taskId, sessionId = "") {
    const sid = String(sessionId || this.sessionId || "").trim();
    if (!sid) throw new Error("No ACP session");
    const id = String(taskId || "").trim();
    if (!id) throw new Error("No scheduled task");
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const misses = [];
    for (const attempt of schedulerDeleteAttempts(sid, id)) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        return raw ?? { ok: true, taskId: id };
      } catch (err) {
        const message = err?.message || String(err);
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Stopping a timed task is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Same as TUI `/new` worktree: ACP `x.ai/git/worktree/create_from_worktree_sync`.
   * Grok picks the path under ~/.grok/worktrees — no git CLI in Desktop.
   * @param {{ sourceCwd?: string, label?: string }} [opts]
   */
  async createWorktreeFromCurrent(opts = {}) {
    if (!this.ready) throw new Error("Agent not connected");
    const source =
      String(opts.sourceCwd || this.cwd || "").trim() || this.cwd;
    if (!source) throw new Error("No project path for worktree create");
    const newSessionId = `desktop-${
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 12)
        : Date.now().toString(36)
    }`;
    const attempts = worktreeCreateFromSyncAttempts({
      sourceWorktreePath: source,
      newSessionId,
      copyMode: "dirty",
      label: opts.label,
    });
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const misses = [];
    const longMs = 5 * 60_000;
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        debugLog("acp", "worktree-create-ok", { path: attempt.method });
        return parseWorktreeCreateResponse(raw);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "worktree-create-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `Worktree create is not available on this Grok CLI (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * ACP `x.ai/git/worktree/list` (Grok-managed worktrees).
   * @param {{ repo?: string, includeAll?: boolean }} [opts]
   */
  async listWorktrees(opts = {}) {
    if (!this.ready) return [];
    const repo =
      opts.repo == null || String(opts.repo).trim() === ""
        ? undefined
        : String(opts.repo).trim();
    const attempts = worktreeListAttempts({
      repo,
      includeAll: Boolean(opts.includeAll),
    });
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        return parseWorktreeListResponse(raw);
      } catch (err) {
        if (methodMissing(err)) continue;
        debugLog("acp", "worktree-list-failed", {
          error: err?.message || String(err),
        });
        return [];
      }
    }
    return [];
  }

  /**
   * Same as TUI `/rename`: ACP `x.ai/session/rename` pins generated_title.
   * Works for the live session or a dormant chat under the same cwd.
   * @param {{ sessionId: string, title: string, cwd?: string }} opts
   */
  async renameSession(opts) {
    if (!this.ready) throw new Error("Agent not connected");
    const sessionId = String(opts?.sessionId || "").trim();
    const title = String(opts?.title || "");
    const cwd = String(opts?.cwd || this.cwd || "").trim();
    if (!sessionId) throw new Error("Session id is required");
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const attempts = sessionRenameAttempts({ sessionId, title, cwd });
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        debugLog("acp", "session-rename-ok", {
          path: attempt.method,
          sessionId,
        });
        return raw ?? { ok: true };
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "session-rename-try", {
          path: attempt.method,
          sessionId,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    const miss = new Error(
      `Rename is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
    miss.code = -32601;
    throw miss;
  }

  /**
   * Same as TUI / CLI `grok sessions delete`: ACP `x.ai/session/delete`.
   * @param {{ sessionId: string, cwd?: string }} opts
   */
  async deleteSession(opts) {
    if (!this.ready) throw new Error("Agent not connected");
    const sessionId = String(opts?.sessionId || "").trim();
    const cwd = String(opts?.cwd || this.cwd || "").trim();
    if (!sessionId) throw new Error("Session id is required");
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const attempts = sessionDeleteAttempts({ sessionId, cwd });
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 20_000,
        });
        debugLog("acp", "session-delete-ok", {
          path: attempt.method,
          sessionId,
        });
        return raw ?? { ok: true };
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "session-delete-try", {
          path: attempt.method,
          sessionId,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    const miss = new Error(
      `Delete is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
    miss.code = -32601;
    throw miss;
  }

  /**
   * Same as TUI `/mcps` + `i`: ACP `x.ai/mcp/auth_trigger` opens the MCP
   * OAuth browser flow and writes `~/.grok/mcp_credentials.json`.
   * @param {string} serverName
   */
  async authenticateMcpServer(serverName) {
    if (!this.sessionId) throw new Error("No ACP session");
    const name = String(serverName || "").trim();
    if (!name) throw new Error("MCP server name is required");
    const longMs = 5 * 60_000;
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };

    const attempts = mcpAuthTriggerAttempts(this.sessionId, name);
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: longMs,
        });
        debugLog("acp", "mcp-auth-ok", { path: attempt.method, server: name });
        return summarizeMcpAuthResult(raw, name);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "mcp-auth-try", {
          path: attempt.method,
          server: name,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `MCP sign-in is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Live `/mcps` catalog: `x.ai/mcp/list` annotated with session status.
   * @param {{ cache?: boolean }} [opts]
   */
  async listMcpSessionCatalog(opts = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const methodMissing = (err) => {
      if (err?.code === -32601) return true;
      return /method not found|-32601|unknown method/i.test(
        String(err?.message || err),
      );
    };
    const attempts = mcpSessionListAttempts(this.sessionId, opts);
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 30_000,
        });
        const payload =
          raw && typeof raw === "object" && raw.result && !raw.servers
            ? raw.result
            : raw;
        return mapMcpSessionCatalog(payload);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "mcp-list-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (methodMissing(err)) {
          misses.push(`${attempt.method}: ${message}`);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    throw new Error(
      `MCP live status is not available on this Grok CLI connection (${misses.join(" · ") || "no methods accepted"}).`,
    );
  }

  /**
   * Inject a follow-up into the running turn without cancelling it.
   * Agent drains at the next tool/model safe gap (Codex-style steer).
   * @param {string} text
   * @param {{
   *   images?: { data: string, mimeType?: string }[],
   *   imageQuality?: "compact" | "high",
   *   interjectionId?: string,
   * }} [opts]
   */
  async interject(text, { images = [], imageQuality = "compact", interjectionId, browserReference } = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const turn = this._activeTurn;
    if (!this.turnOpen || !turn || turn.cancelled || turn.finishing) {
      return { ok: false, reason: "turn-ended", interjectionId: String(interjectionId || "") };
    }
    const id = String(interjectionId || "").trim() || crypto.randomUUID();
    const signature = crypto.createHash("sha256").update(JSON.stringify({ text, images })).digest("hex");
    this._interjectionCalls ||= new Map();
    const previous = this._interjectionCalls.get(id);
    if (previous) {
      if (previous.signature !== signature) throw new Error("Interjection id reused with different input");
      return previous.promise;
    }
    // Durably record before calling ACP. Failure/cancel leaves the original pending.
    const capture = this._promptLifecycle.captureInterjection || captureWorkingKnowledgeInterjection;
    const row = capture({ text: String(text || ""), interjectionId: id, turn });
    const promise = this._sendInterjection(text, { images, imageQuality, interjectionId: id, browserReference }).then((result) => {
      if (result?.ok && !turn.cancelled && row?.id && !turn.inboxIds.includes(row.id)) turn.inboxIds.push(row.id);
      return result;
    });
    turn.interjections ||= [];
    turn.interjections.push(promise);
    this._interjectionCalls.set(id, { signature, promise });
    try { return await promise; }
    catch (err) { this._interjectionCalls.delete(id); throw err; }
  }

  async _sendInterjection(text, { images = [], imageQuality = "compact", interjectionId, browserReference } = {}) {
    if (!this.sessionId) throw new Error("No ACP session");
    const trimmed = String(text || "").trim();
    const list = Array.isArray(images) ? images : [];
    if (!trimmed && list.length === 0) {
      throw new Error("empty interjection");
    }
    const compressed = [];
    for (const img of list) {
      const next = compressPromptImage(img, imageQuality);
      if (next?.data) compressed.push(next);
    }
    const id =
      String(interjectionId || "").trim() || crypto.randomUUID();
    const machine = browserReferenceMachineText(browserReference);
    const attempts = interjectAttempts({
      sessionId: this.sessionId,
      text: machine ? `${trimmed}\n\n${machine}` : trimmed,
      interjectionId: id,
      images: compressed,
    });
    for (const attempt of attempts) if (browserReference) {
      attempt.params._meta = { ...(attempt.params._meta || {}), "grok-desktop/browser-reference": browserReferenceMeta(browserReference) };
    }
    const misses = [];
    for (const attempt of attempts) {
      try {
        const raw = await this.request(attempt.method, attempt.params, {
          timeoutMs: 15_000,
        });
        debugLog("acp", "interject-ok", { path: attempt.method, id });
        const result = unwrapExtMethodResult(raw);
        const status =
          result &&
          typeof result === "object" &&
          typeof result.status === "string"
            ? result.status
            : "queued";
        return interjectAcceptedResult(id, status);
      } catch (err) {
        const message = err?.message || String(err);
        debugLog("acp", "interject-try", {
          path: attempt.method,
          error: message,
          code: err?.code,
        });
        if (isInterjectMethodMissing(err)) {
          misses.push(err);
          continue;
        }
        throw err instanceof Error ? err : new Error(message);
      }
    }
    debugLog("acp", "interject-unsupported", { attempts: misses.length });
    return interjectFromAttemptErrors(misses, id);
  }

  /** Resume on a fresh transport after cancel: ACP updates have no per-turn id. */
  async _resumeAfterCancellation() {
    if (!this._needsPromptRestart) return;
    if (!this._restartPromise) {
      const sessionId = this._resumeSessionId || this.sessionId;
      if (!sessionId) throw new Error("Cannot recover a cancelled turn without its session id");
      const mode = this.currentModeId;
      const revision = this._cancelRevision;
      this._resumeSessionId = sessionId;
      this._restartPromise = (async () => {
        await this.dispose();
        this._suppressReplay = true; // presentation only; never reject new reverse requests
        try {
          await this.start({ resumeSessionId: sessionId });
          if (revision !== this._cancelRevision) throw new Error("cancelled during session recovery");
          if (mode && mode !== this.currentModeId) {
            const restored = await this.setSessionMode(mode);
            if (!restored.agentSynced) throw new Error(restored.error || "Session mode recovery failed");
          }
          if (revision !== this._cancelRevision) throw new Error("cancelled during session recovery");
          this._needsPromptRestart = false;
          this._resumeSessionId = null;
        } catch (err) {
          // A failed load must not leave a live half-initialized connection or
          // lose the original resume target. The next user retry can reload it.
          await this.dispose();
          this.sessionId = sessionId;
          this._needsPromptRestart = true;
          if (revision !== this._cancelRevision) throw new Error("cancelled during session recovery");
          throw err;
        } finally {
          this._suppressReplay = false;
        }
      })().finally(() => { this._restartPromise = null; });
    }
    return this._restartPromise;
  }

  async prompt(text, { images = [], imageQuality = "compact", origin = "user", browserReference } = {}) {
    if (this._needsPromptRestart) await this._resumeAfterCancellation();
    if (!this.sessionId) throw new Error("No ACP session");
    assertSessionNotMoving(this.sessionId);
    if (this.turnOpen) throw new Error("A turn is already running; use interject or queue");
    const sessionId = this.sessionId;
    const cwd = this.cwd;
    const prepared = this._promptLifecycle.prepare({ text, sessionId, cwd, origin });
    const { wrapped, prompt } = prepared;
    const machine = browserReferenceMachineText(browserReference);
    if (machine) prompt.push({ type: "text", text: machine });
    for (const img of images) {
      const compressed = compressPromptImage(img, imageQuality);
      prompt.push({ type: "image", data: compressed.data, mimeType: compressed.mimeType || "image/png" });
    }
    const turn = {
      id: crypto.randomUUID(), sessionId, cwd, inboxId: wrapped.inboxId,
      objectId: wrapped.objectId || "", cancelled: false,
      inboxIds: [...(wrapped.inboxIds || (wrapped.inboxId ? [wrapped.inboxId] : []))],
      bindingRevision: wrapped.bindingRevision, enableRevision: wrapped.enableRevision, objectEpoch: wrapped.objectEpoch,
    };
    this._activeTurn = turn;
    this.turnOpen = true;
    this._turnCancelled = false;
    this._turnAssistantBuf = "";
    this._turnInboxId = turn.inboxId;
    this._turnObjectId = turn.objectId;
    let completed = false;
    try {
      const result = await this.request("session/prompt", {
        sessionId,
        prompt,
        ...(browserReference ? { _meta: { "grok-desktop/browser-reference": browserReferenceMeta(browserReference) } } : {}),
      }, { timeoutMs: 30 * 60_000 });
      if (this._activeTurn !== turn || turn.cancelled) throw new Error("cancelled");
      turn.finishing = true;
      await Promise.allSettled(turn.interjections || []);
      if (this._activeTurn !== turn || turn.cancelled) throw new Error("cancelled");
      const cancelled = result?.stopReason === "cancelled" || result?.stop_reason === "cancelled";
      if (cancelled) {
        turn.cancelled = true;
        this._needsPromptRestart = true;
        this._discardUpdates = true;
      }
      try {
        const receipt = this._promptLifecycle.consume({
          ...turn, assistantText: this._turnAssistantBuf, cancelled,
        });
        if (receipt?.ok === false) this.emit("working-knowledge-error", { sessionId, error: receipt.error });
      } catch (err) {
        this.emit("working-knowledge-error", { sessionId, error: err?.message || String(err) });
        debugLog("acp", "working-knowledge-consume-failed", { error: err?.message || String(err) });
      }
      completed = !cancelled;
      return result;
    } catch (err) {
      // An explicit RPC error (rate limit, auth, invalid input, etc.) is a
      // completed request, not a cancelled connection. Keep that connection
      // usable. Only cancellation or a timeout with an unknown remote outcome
      // requires a new transport before the next prompt.
      if (this._activeTurn === turn && (turn.cancelled || err?.code === -32800 || err?.code === "ACP_REQUEST_TIMEOUT")) {
        this._needsPromptRestart = true;
        this._discardUpdates = true;
      }
      throw err;
    } finally {
      // An older finally must never clear the next turn's state.
      if (this._activeTurn === turn) {
        this._activeTurn = null;
        this.turnOpen = false;
        this._turnCancelled = false;
        this._turnAssistantBuf = "";
        this._turnInboxId = null;
        this._turnObjectId = "";
        this.emit("turn-settled", { sessionId: turn.sessionId, turnId: turn.id, ok: completed, cancelled: Boolean(turn.cancelled) });
        if (completed && !turn.cancelled) {
          const next = this._cronQueue.shift();
          if (next) void this.prompt(next, { origin: "scheduled" }).catch((err) => {
            debugLog("acp", "scheduled-inject-failed", { error: err?.message || String(err) });
          });
        }
      }
    }
  }

  /**
   * ACP client must drive `/loop` fires (`x.ai/scheduled_task_inject_prompt`).
   * @param {{ prompt: string }} inject
   */
  enqueueScheduledPrompt(inject) {
    const text = String(inject?.prompt || "").trim();
    if (!text) return;
    if (this.turnOpen) {
      this._cronQueue.push(text);
      return;
    }
    void this.prompt(text, { origin: "scheduled" }).catch((err) => {
      debugLog("acp", "scheduled-inject-failed", {
        error: err?.message || String(err),
      });
    });
  }

  /**
   * Drop in-flight session/prompt RPCs so Stop does not wait on the agent.
   * @param {Error} err
   */
  _rejectPendingPrompts(err) {
    rejectPendingByMethod(this.pending, "session/prompt", err);
  }

  cancel() {
    this._cancelRevision = (this._cancelRevision || 0) + 1;
    // ACP: Client MUST respond to pending request_permission with cancelled.
    // Also settle extension gates via main (plan/ask) — caller should use
    // clearPendingPermissions. Kill tool shells so terminal/wait_for_exit
    // cannot park the turn after cancel.
    this._turnCancelled = true;
    if (this._activeTurn) this._activeTurn.cancelled = true;
    this._needsPromptRestart = true;
    this._discardUpdates = true;
    this._cronQueue = [];
    this._cancelOpenPermissionGates();
    this.turnOpen = false;
    try {
      this.terminals.killAllImmediate();
    } catch {
      /* ignore */
    }
    const cancelled = new Error("cancelled");
    this._rejectPendingPrompts(cancelled);
    // Do not clear once-responder here — in-flight fs may still need to answer.
    if (!this.sessionId) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  /**
   * Remember write/edit/post approvals for the rest of this agent session.
   * @param {boolean} value
   */
  setAllowWritesThisSession(value) {
    this.allowWritesThisSession = Boolean(value);
    this.emit("writes-session", this.allowWritesThisSession);
    return this.allowWritesThisSession;
  }

  /** Switch the live ACP session mode (`plan`, `default`, ...). */
  async setSessionMode(modeId) {
    const nextId = String(modeId || "").trim();
    if (!nextId) {
      return {
        currentModeId: this.currentModeId || null,
        agentSynced: false,
        error: "modeId required",
      };
    }
    const sessionAtStart = this.sessionId;
    if (!sessionAtStart || !this.ready || !this.proc) {
      return {
        currentModeId: this.currentModeId || null,
        agentSynced: false,
        error: "Agent is not ready",
      };
    }
    const version = ++this._modeSyncVersion;
    // If another mode RPC is pending, even a request for the current local
    // value must reach ACP: that earlier RPC may already have changed it.
    const forceSync = this._modeSyncPending > 0;
    this._modeSyncPending += 1;
    const run = async () => {
      try {
        if (this.sessionId !== sessionAtStart) {
          return {
            currentModeId: this.currentModeId || null,
            agentSynced: false,
            error: "Session changed",
          };
        }
        // A later request arrived before this one reached ACP. It owns intent.
        if (version !== this._modeSyncVersion) {
          return {
            currentModeId: this.currentModeId || null,
            agentSynced: false,
            error: "Mode request superseded",
          };
        }
        if (!forceSync && nextId === this.currentModeId) {
          return { currentModeId: nextId, agentSynced: true };
        }
        await this.request(
          "session/set_mode",
          setSessionModeParams(sessionAtStart, nextId),
          { timeoutMs: 15_000 },
        );
        if (this.sessionId !== sessionAtStart) {
          return {
            currentModeId: this.currentModeId || null,
            agentSynced: false,
            error: "Session changed",
          };
        }
        if (version !== this._modeSyncVersion) {
          return {
            currentModeId: this.currentModeId || null,
            agentSynced: false,
            error: "Mode request superseded",
          };
        }
        this.currentModeId = nextId;
        return { currentModeId: nextId, agentSynced: true };
      } catch (err) {
        const raw = err?.message || String(err);
        const error = /-32601|method not found/i.test(raw)
          ? "This Grok CLI does not support plan mode (session/set_mode)."
          : raw;
        return {
          currentModeId: this.currentModeId || null,
          agentSynced: false,
          error,
        };
      } finally {
        this._modeSyncPending = Math.max(0, this._modeSyncPending - 1);
      }
    };
    this._modeSyncTail = this._modeSyncTail.catch(() => {}).then(run);
    return this._modeSyncTail;
  }

  /**
   * Apply permission mode on the client and notify the live session via
   * `_x.ai/yolo_mode_changed` (`_` prefix = extension notification).
   *
   * @param {string} mode
   * @returns {Promise<{
   *   mode: 'ask'|'auto'|'always-approve',
   *   agentSynced: boolean,
   *   error?: string,
   * }>}
   */
  async setPermissionMode(mode) {
    this.permissionMode = normalizePermissionMode(mode);

    // No live session yet — client gate is set; agent gets _meta on next session/new|load
    if (!this.sessionId || !this.ready || !this.proc) {
      return { mode: this.permissionMode, agentSynced: false };
    }

    try {
      // Fire-and-forget notification (same as pager stdio); no response expected.
      this.notify(
        YOLO_MODE_CHANGED_METHOD,
        yoloModeChangedParams(this.permissionMode),
      );
      return { mode: this.permissionMode, agentSynced: true };
    } catch (err) {
      const error = err?.message || String(err);
      return {
        mode: this.permissionMode,
        agentSynced: false,
        error,
      };
    }
  }

  /**
   * Set reasoning effort (same as CLI `/effort <level>`).
   * Live path: `session/set_model` with `_meta.reasoningEffort` (Grok 0.2.101+).
   * Spawn also passes `--reasoning-effort` so new agent processes match.
   *
   * @param {string} level
   * @returns {Promise<{
   *   effort: string,
   *   agentSynced: boolean,
   *   error?: string,
   * }>}
   */
  async setReasoningEffort(level) {
    this.reasoningEffort = normalizeReasoningEffort(level);

    if (!this.sessionId || !this.ready || !this.proc) {
      return { effort: this.reasoningEffort, agentSynced: false };
    }

    const modelId = this.currentModelId;
    if (!modelId) {
      return {
        effort: this.reasoningEffort,
        agentSynced: false,
        error: "No current model id from the agent yet",
      };
    }

    try {
      await this.request(
        "session/set_model",
        {
          sessionId: this.sessionId,
          modelId,
          _meta: { reasoningEffort: this.reasoningEffort },
        },
        { timeoutMs: 15_000 },
      );
      return { effort: this.reasoningEffort, agentSynced: true };
    } catch (err) {
      const error = err?.message || String(err);
      return {
        effort: this.reasoningEffort,
        agentSynced: false,
        error,
      };
    }
  }

  /**
   * Switch the live session model without respawning.
   * Passes current reasoning effort so Effort is not reset.
   *
   * @param {string} modelId
   * @returns {Promise<{
   *   modelId: string | null,
   *   modelName: string | null,
   *   availableModels: { modelId: string, name: string }[],
   *   agentSynced: boolean,
   *   error?: string,
   * }>}
   */
  async setModel(modelId) {
    const nextId = String(modelId || "").trim();

    if (!nextId) {
      return {
        ...this._modelsPublic(),
        agentSynced: false,
        error: "modelId required",
      };
    }
    if (nextId === this.currentModelId) {
      return { ...this._modelsPublic(), agentSynced: true };
    }
    const sessionAtStart = this.sessionId;
    if (!sessionAtStart || !this.ready || !this.proc) {
      return {
        ...this._modelsPublic(),
        agentSynced: false,
        error: "Agent is not ready",
      };
    }

    try {
      await this.request(
        "session/set_model",
        {
          sessionId: sessionAtStart,
          modelId: nextId,
          _meta: { reasoningEffort: this.reasoningEffort },
        },
        { timeoutMs: 15_000 },
      );
      // /new or load replaced the live session while this RPC was in flight.
      if (this.sessionId !== sessionAtStart) {
        return {
          ...this._modelsPublic(),
          agentSynced: false,
          error: "Session changed",
        };
      }
      this.currentModelId = nextId;
      const entry = this.availableModels.find((m) => m.modelId === nextId);
      this.currentModelName = entry?.name || nextId;
      return { ...this._modelsPublic(), agentSynced: true };
    } catch (err) {
      return {
        ...this._modelsPublic(),
        agentSynced: false,
        error: err?.message || String(err),
      };
    }
  }

  setAllowOutsideProject(value) {
    this.allowOutsideProject = Boolean(value);
    this.terminals.setAllowOutsideProject(this.allowOutsideProject);
  }

  setSandboxTerminal(value) {
    this.sandboxTerminal = Boolean(value);
    this.terminals.setSandboxTerminal(this.sandboxTerminal);
  }

  async setCwd(cwd) {
    this.cwd = cwd;
    this.terminals.setDefaultCwd(cwd);
    this.terminals.disposeAll();
    return this.newSession();
  }

  async dispose() {
    revokePreviewScope(this._previewScopeId);
    this._previewScopeId = "";
    if (this._activeTurn) this._activeTurn.cancelled = true;
    this._discardUpdates = true;
    this._rejectAllPending(new Error("Agent disposed"));
    try {
      this._once?.clear();
    } catch {
      /* ignore */
    }
    this._once = null;
    try {
      this.terminals.disposeAll();
    } catch {
      /* ignore */
    }
    try {
      this.rl?.close();
    } catch {
      /* ignore */
    }
    const proc = this.proc;
    this.proc = null; // fence exit/line callbacks before terminating the old process
    if (proc && !proc.killed) proc.kill();
    this.ready = false;
    this.sessionId = null;
  }
}

export { resolveGrokBinary } from "./grok-home.mjs";
