import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useProjectSession } from "../../src/hooks/useProjectSession";
import { usePromptDelivery } from "../../src/hooks/usePromptDelivery";

const auth = {
  authenticated: true,
  expired: false,
  binary: "/synthetic/grok",
  binaryFound: true,
  grokHome: "/synthetic/home",
  authPath: "/synthetic/auth.json",
  method: "fixture",
  email: null,
  displayName: null,
  expiresAt: null,
  hasApiKey: false,
  loginInProgress: false,
};

const bridgeState = {
  mainSession: "A",
  cancelCalls: 0,
  draftFlushes: 0,
  submissions: [] as Array<{ requested: string; routed: string; text: string }>,
};

const emptyOutbox = (sessionId: string) => ({
  version: 1,
  sessionId,
  revision: 1,
  busy: sessionId === "A",
  paused: false,
  items:
    sessionId === "A"
      ? [{ id: "queued-A", text: "queued for A", images: [], origin: "composer", at: 1 }]
      : [],
});

(window as any).grokDesktop = {
  on: () => () => {},
  listOutbox: async (sessionId: string) => emptyOutbox(sessionId),
  mutateOutbox: async (sessionId: string) => emptyOutbox(sessionId),
  submitDelivery: async (payload: any) => {
    bridgeState.submissions.push({
      requested: payload.sessionId,
      routed: bridgeState.mainSession,
      text: payload.text,
    });
    return { accepted: true, state: emptyOutbox(payload.sessionId) };
  },
  cancel: async () => {
    bridgeState.cancelCalls += 1;
  },
  openSession: async ({ sessionId }: { sessionId?: string }) => {
    if (sessionId === "C") throw new Error("synthetic IPC open failure");
    bridgeState.mainSession = String(sessionId);
    return {
      cwd: "/fixture/project",
      sessionId,
      grokBinary: "/synthetic/grok",
      resumed: true,
      history: [{ id: "history-B", kind: "assistant", text: "real B transcript", at: 2 }],
      backgroundTasks: [],
      scheduledTasks: [],
      usage: null,
      historySeq: 4,
      sessions: [{ id: "A", cwd: "/fixture/project" }, { id: "B", cwd: "/fixture/project" }],
      warning: null,
      turnOpen: false,
      modelId: "fixture-model",
      modelName: "Fixture",
      availableModels: [],
    };
  },
  setAllowWritesThisSession: async () => ({ allowWritesThisSession: false }),
  getInfo: async () => ({ auth }),
};

window.addEventListener("grok-flush-draft", () => {
  bridgeState.draftFlushes += 1;
});
(window as any).sessionSwitchHarness = bridgeState;

function Harness() {
  const [project, setProject] = useState<string | null>("/fixture/project");
  const [sessionId, setSessionId] = useState<string | null>("A");
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const [conn, setConn] = useState<any>("busy");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([
    { id: "a-user", kind: "user", text: "real A transcript", at: 1 },
  ]);
  const [draft] = useState("unsent A draft");
  const [grant, setGrant] = useState(true);
  const busyRef = useRef(true);
  const openingRef = useRef(false);

  const delivery = usePromptDelivery({
    project,
    sessionIdRef,
    conn,
    busyRef,
    openingRef,
    onPromptSent: () => {},
    setConn,
    setError,
    setItems,
    refreshAuth: () => {},
  });

  const sessions = useProjectSession({
    auth: auth as any,
    project,
    sessionId,
    busyRef,
    openingRef,
    promptQueueRef: delivery.promptQueueRef,
    sendNowRef: delivery.sendNowRef,
    clearSessionScoped: () => setGrant(false),
    revokeWritesThisSession: async () => setGrant(false),
    hydrateBackgroundTasks: () => {},
    hydrateScheduledTasks: () => {},
    hydrateSessionUsage: () => {},
    hydrateSessionMode: () => {},
    syncParkedRequestsFromMain: () => {},
    syncPermissionsFromMain: () => {},
    hydrateFromInfo: () => {},
    refreshAuth: async () => auth as any,
    refreshBackbone: async () => {
      throw new Error("synthetic refresh after IPC");
    },
    setBackbone: () => {},
    setAuth: () => {},
    setInfo: () => {},
    setProject,
    setSessionId,
    setSessions: () => {},
    setModelId: () => {},
    setModelName: () => {},
    setAvailableModels: () => {},
    setConn,
    setOpeningLabel: () => {},
    setError,
    setItems,
    setAgentCommands: () => {},
    clearPromptQueue: delivery.clearPromptQueue,
    beginOpening: () => 1,
    bindOpeningSession: () => {},
    abortOpening: () => {},
    finishOpening: () => {},
    applyOpenTimeline: (banner, history) => {
      const next = [banner, ...history];
      setItems(next);
      return next;
    },
    stashLiveTimeline: () => {},
    takeCachedTimeline: (id) =>
      id === "A" ? [{ id: "a-user", kind: "user", text: "real A transcript", at: 1 }] : undefined,
  });

  return <main>
    <output aria-label="session">{sessionId}</output>
    <output aria-label="connection">{conn}</output>
    <output aria-label="draft">{draft}</output>
    <output aria-label="grant">{grant ? "granted" : "revoked"}</output>
    <output aria-label="queue">{delivery.promptQueue.map((row) => row.text).join("|") || "empty"}</output>
    <output aria-label="timeline">{items.map((item) => item.text).join("|")}</output>
    <output aria-label="error">{error || "none"}</output>
    <button onClick={() => void sessions.openSession({ sessionId: "C", mode: "resume" })}>Fail switch</button>
    <button onClick={() => void sessions.openSession({ sessionId: "B", mode: "resume" })}>Switch B</button>
    <button onClick={() => void delivery.submitFromComposer({ text: "send after switch", images: [], mode: "now" })}>Send</button>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
