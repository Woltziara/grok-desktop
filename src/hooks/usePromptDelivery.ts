import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ComposerSubmit, QueuedPrompt } from "../components/Composer";
import { previewCaptureRefuseError, previewCaptureToSubmit, type PendingImage } from "../lib/pending-images";
import { isAuthError, type ConnState } from "../lib/conn";
import { appendWorkedIfNeeded, finalizeOpenTools, uid } from "../lib/timeline";
import type { DeliveryEvent, DeliveryRow, DeliveryState, TimelineItem } from "../vite-env";

function queuedRow(row: DeliveryRow): QueuedPrompt {
  return { ...row, text: row.text || "", images: (row.images || []).map((image, index) => ({ ...image, id: image.id || `${row.id}-${index}`, previewUrl: `data:${image.mimeType};base64,${image.data}` })) };
}

/** The renderer is a view of main's durable send box, never another send queue. */
export function usePromptDelivery(opts: {
  project: string | null;
  sessionIdRef: MutableRefObject<string | null>;
  conn: ConnState;
  busyRef: MutableRefObject<boolean>;
  openingRef: MutableRefObject<boolean>;
  onPromptSent: () => void;
  setConn: Dispatch<SetStateAction<ConnState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setItems: Dispatch<SetStateAction<TimelineItem[]>>;
  refreshAuth: () => void;
  onDeliveryFailed?: (payload: {text: string; images: PendingImage[]}) => void;
}) {
  const view = useRef(opts); view.current = opts;
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  const [outboxPaused, setOutboxPaused] = useState(false);
  const promptQueueRef = useRef<QueuedPrompt[]>([]);
  // Kept for session-transition consumers. These refs no longer own delivery.
  const sendNowRef = useRef<QueuedPrompt | null>(null);
  const afterTurnRef = useRef<((info: {ok: boolean; cancelled: boolean}) => void | Promise<void>) | null>(null);
  const generation = useRef(0), revisions = useRef(new Map<string, number>()), seen = useRef(new Set<string>());
  const visible = useCallback((sessionId: string) => {
    const v = view.current;
    return sessionId === v.sessionIdRef.current && !v.openingRef.current;
  }, []);
  const applyState = useCallback((state?: DeliveryState) => {
    if (!state || !visible(state.sessionId)) return;
    if (state.revision < (revisions.current.get(state.sessionId) ?? -1)) return;
    revisions.current.set(state.sessionId, state.revision);
    // Sent-but-unsettled rows stay visible after a reload, along with failures.
    const next = state.items.map(queuedRow);
    promptQueueRef.current = next; setPromptQueue(next); setOutboxPaused(state.paused);
  }, [visible]);
  const clearPromptQueue = useCallback(() => {
    generation.current++;
    afterTurnRef.current = null; sendNowRef.current = null;
    promptQueueRef.current = []; setPromptQueue([]); setOutboxPaused(false);
    // Only clear this view. The old conversation's queue and work continue.
  }, []);

  const currentId = opts.sessionIdRef.current;
  useEffect(() => {
    const id = currentId, gen = generation.current;
    if (!id || opts.conn === "connecting" || opts.openingRef.current) return;
    let live = true;
    void window.grokDesktop.listOutbox(id).then(state => {
      if (!live || gen !== generation.current || !visible(id)) return;
      applyState(state);
      if (state.busy) { view.current.busyRef.current = true; view.current.setConn("busy"); }
    }).catch(error => { if (live && visible(id)) view.current.setError(String(error?.message || error)); });
    return () => { live = false; };
  }, [currentId, opts.project, opts.conn, opts.openingRef, applyState, visible]);

  useEffect(() => window.grokDesktop.on("agent:delivery", (raw) => {
    const event = raw as DeliveryEvent;
    if (!visible(event.sessionId)) return;
    const v = view.current;
    const sessionId = event.sessionId;
    void window.grokDesktop.listOutbox(sessionId).then(state => {
      if (visible(sessionId)) applyState(state);
    }).catch(error => { if (visible(sessionId)) v.setError(String(error?.message || error)); });
    const row = event.row, key = row ? `${event.sessionId}:${row.attemptId}:${event.method}` : "";
    if (event.type === "started" && row && !seen.current.has(key)) {
      seen.current.add(key);
      const item: TimelineItem = {
        id: `delivery-${row.attemptId}`, kind: "user", text: row.timelineText || row.text || `(${row.images?.length || 0} 张图)`,
        images: row.images?.map(image => ({ mimeType: image.mimeType, previewUrl: `data:${image.mimeType};base64,${image.data}` })),
        optimistic: true, at: row.startedAt || row.at,
        ...(event.method === "interject" ? { marker: "interjection" as const, interjectionId: row.attemptId } : {}),
      };
      v.onPromptSent();
      v.setItems(prev => prev.some(i => i.id === item.id || (i.kind === "user" && row.attemptId && i.interjectionId === row.attemptId)) ? prev : [...prev, item, ...(event.method === "prompt" ? [{ id: uid("thought"), kind: "thought" as const, text: "", at: Date.now() }] : [])]);
      if (event.method === "prompt") { v.busyRef.current = true; v.setConn("busy"); v.setError(null); }
    }
    if ((event.type === "fallback" || (event.type === "settled" && event.method === "interject" && !event.ok)) && row) {
      v.setItems(prev => prev.filter(i => !(i.kind === "user" && i.optimistic && i.interjectionId === row.attemptId)));
    }
    if (event.type === "settled" && event.method === "prompt") {
      const status = event.ok ? "completed" : event.cancelled ? "cancelled" : "failed";
      if (!event.state?.busy) v.setItems(prev => appendWorkedIfNeeded(finalizeOpenTools(prev, status), Date.now()));
      v.busyRef.current = Boolean(event.state?.busy);
      v.setConn(event.state?.busy ? "busy" : event.ok || event.cancelled ? "online" : "error");
    }
    if (event.error && !event.cancelled) {
      v.setError(`${event.error} 内容仍在本对话的发送记录中。`);
      if (isAuthError(event.error)) v.refreshAuth();
    }
  }), [applyState, visible]);

  const submitFromComposer = useCallback(async (payload: ComposerSubmit): Promise<boolean> => {
    const v = view.current, sessionId = payload.sessionId || v.sessionIdRef.current, cwd = payload.cwd || v.project;
    if (!sessionId || !cwd || !visible(sessionId) || cwd !== v.project || v.conn === "connecting") return false;
    if (!payload.text && !payload.images.length) return false;
    try {
      const receipt = await window.grokDesktop.submitDelivery({
        ...payload, id: payload.deliveryId || uid("send"), sessionId, cwd,
        images: payload.images.map(({ data, mimeType, id, name }) => ({ data, mimeType, id, name })),
      });
      applyState(receipt.state);
      return receipt.accepted === true;
    } catch (error) {
      if (visible(sessionId)) v.setError(String((error as Error)?.message || error));
      return false; // A draft is only cleared after main durably accepts it.
    }
  }, [applyState, visible]);

  const mutate = useCallback(async (action: string, data?: Record<string, unknown>) => {
    const id = view.current.sessionIdRef.current;
    if (!id || !visible(id)) return;
    try { applyState(await window.grokDesktop.mutateOutbox(id, action, data)); }
    catch (error) { if (visible(id)) view.current.setError(String((error as Error)?.message || error)); }
  }, [applyState, visible]);
  const removeQueued = useCallback((id: string) => { void mutate("remove", { id }); }, [mutate]);
  const moveQueued = useCallback((id: string, direction: number) => { void mutate("move", { id, direction }); }, [mutate]);
  const editQueued = useCallback((id: string, text: string) => { void mutate("edit", { id, text }); }, [mutate]);
  const resumeQueue = useCallback(() => { void mutate("resume"); }, [mutate]);
  const sendQueuedNow = useCallback((id?: string) => {
    const item = id ? promptQueueRef.current.find(i => i.id === id) : promptQueueRef.current[0];
    if (!item) return;
    const uncertain = item.status === "uncertain" || item.status === "cancelled";
    if (uncertain && !window.confirm("这条可能已经部分执行。请先查看历史；确认仍要再次发送吗？")) return;
    void mutate("now", { id: item.id, confirmed: uncertain });
  }, [mutate]);
  const stopTurn = useCallback(() => {
    const v = view.current, id = v.sessionIdRef.current;
    if (!id) return;
    afterTurnRef.current = null; sendNowRef.current = null;
    void window.grokDesktop.cancel(id).catch(error => { if (visible(id)) v.setError(String(error?.message || error)); });
  }, [visible]);
  const queueNextPrompt = useCallback((text: string) => {
    const item: QueuedPrompt = { id: uid("followup"), text, images: [], origin: "followup", at: Date.now() };
    void submitFromComposer({ ...item, mode: "queue", deliveryId: item.id }); return item;
  }, [submitFromComposer]);

  useEffect(() => window.grokDesktop.on("preview:viewport-capture", (payload) => {
    const v = view.current;
    if (!payload.sessionId || !visible(payload.sessionId)) { v.setError("截图属于另一段对话，未发送。请返回打开网页的原对话重试。"); return; }
    const parsed = previewCaptureToSubmit(payload);
    if (!parsed.ok) { v.setError(parsed.error); return; }
    void submitFromComposer({ ...parsed.submit, sessionId: payload.sessionId }).then(ok => { if (!ok && visible(payload.sessionId)) v.setError(previewCaptureRefuseError(v.project)); });
  }), [submitFromComposer, visible]);

  return { promptQueue, promptQueueRef, sendNowRef, afterTurnRef, outboxPaused, resumeQueue, clearPromptQueue, removeQueued, submitFromComposer, queueNextPrompt, sendQueuedNow, stopTurn, moveQueued, editQueued };
}
