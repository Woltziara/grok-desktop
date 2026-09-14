import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  interjectFollowUp,
  promptDeliveryAction,
} from "../../shared/prompt-delivery.mjs";
import {
  dropQueuedItem,
  editQueuedItem,
  moveQueuedItem,
  restoreQueuedItem,
} from "../../shared/queue-order.mjs";
import type { ComposerSubmit, QueuedPrompt } from "../components/Composer";
import {
  previewCaptureRefuseError,
  previewCaptureToSubmit,
  type PendingImage,
} from "../lib/pending-images";
import { isAuthError, type ConnState } from "../lib/conn";
import { appendWorkedIfNeeded, finalizeOpenTools, uid } from "../lib/timeline";
import type { TimelineImage, TimelineItem } from "../vite-env";

type DeliverPayload = {
  text: string;
  images: PendingImage[];
  imageQuality?: "compact" | "high";
  timelineText?: string;
  restoreQueueItem?: QueuedPrompt;
  origin?: "user" | "followup";
};

function visiblePromptText(payload: Pick<DeliverPayload, "text" | "timelineText">) {
  return String(payload.timelineText || payload.text || "").trim();
}

/**
 * Prompt delivery. Mid-turn Enter steers the live turn (Codex-style).
 * ⌘Enter / Send now still cancels and sends next. Internal follow-ups
 * like Catch up stay queued without cancelling.
 */
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
  onDeliveryFailed?: (payload: {
    text: string;
    images: PendingImage[];
  }) => void;
}) {
  const {
    project,
    sessionIdRef,
    conn,
    busyRef,
    openingRef,
    onPromptSent,
    setConn,
    setError,
    setItems,
    refreshAuth,
    onDeliveryFailed,
  } = opts;

  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  const promptQueueRef = useRef<QueuedPrompt[]>([]);
  const sendNowRef = useRef<QueuedPrompt | null>(null);
  const deliveryGenRef = useRef(0);
  const afterTurnRef = useRef<
    | ((info: { ok: boolean; cancelled: boolean }) => void | Promise<void>)
    | null
  >(null);
  const deliverRef = useRef<(payload: DeliverPayload) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    promptQueueRef.current = promptQueue;
  }, [promptQueue]);

  const clearPromptQueue = useCallback(() => {
    deliveryGenRef.current += 1;
    afterTurnRef.current = null;
    setPromptQueue([]);
    promptQueueRef.current = [];
    sendNowRef.current = null;
  }, []);

  const enqueuePrompt = useCallback(
    (
      text: string,
      images: PendingImage[],
      imageQuality: "compact" | "high" = "compact",
      timelineText?: string,
      origin: "user" | "followup" = "user",
    ) => {
      const item: QueuedPrompt = {
        id: uid("q"),
        text,
        images: images.map((img) => ({ ...img })),
        imageQuality,
        timelineText,
        origin,
        at: Date.now(),
      };
      setPromptQueue((prev) => {
        const next = [...prev, item];
        promptQueueRef.current = next;
        return next;
      });
      return item;
    },
    [],
  );

  const removeQueued = useCallback((id: string) => {
    setPromptQueue((prev) => {
      const next = dropQueuedItem(prev, id);
      promptQueueRef.current = next;
      return next;
    });
    if (sendNowRef.current?.id === id) sendNowRef.current = null;
  }, []);

  const moveQueued = useCallback((id: string, dir: number) => {
    setPromptQueue((prev) => {
      const next = moveQueuedItem(prev, id, dir);
      promptQueueRef.current = next;
      return next;
    });
  }, []);

  const editQueued = useCallback((id: string, text: string) => {
    setPromptQueue((prev) => {
      const next = editQueuedItem(prev, id, text);
      promptQueueRef.current = next;
      return next;
    });
  }, []);

  const deliverPrompt = useCallback(
    async (payload: DeliverPayload) => {
      if (!project || busyRef.current || openingRef.current) return;
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && images.length === 0) return;

      const gen = deliveryGenRef.current;
      onPromptSent();
      busyRef.current = true;
      setConn("busy");
      let ok = false;
      let cancelled = false;
      const timelineImages: TimelineImage[] = images.map((img) => ({
        mimeType: img.mimeType,
        previewUrl: img.previewUrl,
      }));
      const sentAt = Date.now();
      setItems((prev) => [
        ...prev,
        {
          id: uid("user"),
          kind: "user",
          text:
            visiblePromptText(payload) || text ||
            (images.length
              ? `(${images.length} image${images.length > 1 ? "s" : ""})`
              : ""),
          images: timelineImages.length ? timelineImages : undefined,
          optimistic: true,
          at: sentAt,
        },
        // TUI pre-creates thinking at turn start so the clock starts immediately.
        {
          id: uid("thought"),
          kind: "thought",
          text: "",
          at: sentAt,
        },
      ]);
      const stale = () =>
        openingRef.current || deliveryGenRef.current !== gen;
      try {
        await window.grokDesktop.prompt(text, {
          images: images.map(({ data, mimeType }) => ({ data, mimeType })),
          imageQuality: payload.imageQuality || "compact",
          origin: payload.origin || "user",
        });
        if (stale()) return;
        setItems((prev) =>
          appendWorkedIfNeeded(finalizeOpenTools(prev, "completed"), Date.now()),
        );
        setConn("online");
        ok = true;
      } catch (e: unknown) {
        if (stale()) return;
        const msg = e instanceof Error ? e.message : String(e);
        cancelled = /cancel/i.test(msg);
        if (cancelled) {
          setItems((prev) =>
            appendWorkedIfNeeded(
              finalizeOpenTools(prev, "cancelled"),
              Date.now(),
            ),
          );
          setConn("online");
        } else {
          setConn("error");
          setError(msg);
          setItems((prev) => [
            ...finalizeOpenTools(prev, "failed"),
            {
              id: uid("sys"),
              kind: "system",
              text: `Error: ${msg}`,
              at: Date.now(),
            },
          ]);
          if (isAuthError(msg)) refreshAuth();
          if (payload.restoreQueueItem) {
            const item = payload.restoreQueueItem;
            setPromptQueue((prev) => {
              const next = restoreQueuedItem(prev, item);
              promptQueueRef.current = next;
              return next;
            });
          } else {
            onDeliveryFailed?.({ text, images });
          }
        }
      } finally {
        if (stale()) {
          busyRef.current = false;
          return;
        }
        const after = afterTurnRef.current;
        afterTurnRef.current = null;
        if (after) {
          try {
            await after({ ok, cancelled });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg || "Follow-up after this turn failed");
          }
        }
        busyRef.current = false;
        // Keep a failed FIFO head parked for an explicit retry. Immediately
        // draining the restored item here would loop and reorder later work.
        if (payload.restoreQueueItem && !ok && !cancelled) return;
        const nextNow = sendNowRef.current;
        if (nextNow) {
          sendNowRef.current = null;
          setPromptQueue((prev) => {
            const next = prev.filter((q) => q.id !== nextNow.id);
            promptQueueRef.current = next;
            return next;
          });
          void deliverRef.current({
            text: nextNow.text,
            images: nextNow.images,
            imageQuality: nextNow.imageQuality,
            timelineText: nextNow.timelineText,
            restoreQueueItem: nextNow,
            origin: nextNow.origin,
          });
          return;
        }
        const queued = promptQueueRef.current[0];
        if (queued) {
          setPromptQueue((prev) => {
            const next = prev.slice(1);
            promptQueueRef.current = next;
            return next;
          });
          void deliverRef.current({
            text: queued.text,
            images: queued.images,
            imageQuality: queued.imageQuality,
            timelineText: queued.timelineText,
            restoreQueueItem: queued,
            origin: queued.origin,
          });
        }
      }
    },
    [
      project,
      busyRef,
      openingRef,
      onPromptSent,
      setConn,
      setError,
      setItems,
      refreshAuth,
      onDeliveryFailed,
    ],
  );

  deliverRef.current = deliverPrompt;

  /**
   * Accept composer submit. Returns true when the draft should clear
   * (queued, interject, or delivered). False when refused (opening / no project).
   */
  const submitFromComposer = useCallback(
    async ({
      text,
      images,
      imageQuality = "compact",
      timelineText,
      origin = "user",
      mode = "auto",
    }: ComposerSubmit): Promise<boolean> => {
      if (!project || openingRef.current || conn === "connecting") {
        return false;
      }
      if (!text && images.length === 0) return false;

      const action = promptDeliveryAction(
        mode,
        busyRef.current || conn === "busy",
      );
      if (action !== "prompt") {
        if (action === "send-now") {
          const item = enqueuePrompt(
            text,
            images,
            imageQuality,
            timelineText,
            origin,
          );
          sendNowRef.current = item;
          setItems((prev) => finalizeOpenTools(prev, "cancelled"));
          void window.grokDesktop.cancel();
          return true;
        }
        if (action === "queue") {
          enqueuePrompt(text, images, imageQuality, timelineText, origin);
          return true;
        }
        const canInterject =
          typeof window.grokDesktop.interject === "function";
        if (!canInterject) {
          enqueuePrompt(text, images, imageQuality, timelineText, origin);
          return true;
        }
        const interjectionId = uid("ij");
        const timelineImages: TimelineImage[] = images.map((img) => ({
          mimeType: img.mimeType,
          previewUrl: img.previewUrl,
        }));
        const bubble = {
          id: interjectionId,
          kind: "user" as const,
          text:
            visiblePromptText({ text, timelineText }) || text ||
            (images.length
              ? `(${images.length} image${images.length > 1 ? "s" : ""})`
              : ""),
          images: timelineImages.length ? timelineImages : undefined,
          optimistic: true,
          marker: "interjection" as const,
          interjectionId,
          at: Date.now(),
        };
        // Paint first so the broadcast echo can dedupe on interjectionId.
        onPromptSent();
        setItems((prev) => [...prev, bubble]);
        try {
          const result = await window.grokDesktop.interject(text, {
            images: images.map(({ data, mimeType }) => ({ data, mimeType })),
            imageQuality,
            interjectionId,
          });
          const follow = interjectFollowUp(result);
          if (follow === "ok") return true;
          setItems((prev) =>
            prev.filter(
              (item) =>
                !(item.kind === "user" && item.interjectionId === interjectionId),
            ),
          );
          if (follow === "queue") {
            if (!busyRef.current) {
              void deliverPrompt({
                text,
                images,
                imageQuality,
                timelineText,
                origin,
              });
            } else {
              enqueuePrompt(text, images, imageQuality, timelineText, origin);
            }
            return true;
          }
          const reason =
            result && typeof result === "object"
              ? String((result as { error?: unknown; reason?: unknown }).error ||
                  (result as { reason?: unknown }).reason ||
                  "没能插进正在做的事")
              : "没能插进正在做的事";
          setError(reason);
          return false;
        } catch (e: unknown) {
          setItems((prev) =>
            prev.filter(
              (item) =>
                !(
                  item.kind === "user" &&
                  item.interjectionId === interjectionId
                ),
            ),
          );
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg || "没能插进正在做的事");
          return false;
        }
        return true;
      }

      // Do not await the full turn — Composer clears the draft on this true.
      // deliverPrompt owns busy/queue drain for the rest of the turn.
      void deliverPrompt({ text, images, imageQuality, timelineText, origin });
      return true;
    },
    [
      project,
      openingRef,
      conn,
      busyRef,
      enqueuePrompt,
      setItems,
      setError,
      onPromptSent,
      deliverPrompt,
    ],
  );

  const submitPreviewCapture = useCallback(
    (payload: {
      sessionId?: unknown;
      data?: unknown;
      mimeType?: unknown;
      text?: unknown;
    }) => {
      if (!payload.sessionId || payload.sessionId !== sessionIdRef.current || openingRef.current) {
        setError("截图属于另一段对话，未发送。请返回打开网页的原对话重试。");
        return;
      }
      const parsed = previewCaptureToSubmit(payload);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      void submitFromComposer(parsed.submit).then((ok) => {
        if (!ok) setError(previewCaptureRefuseError(project));
      });
    },
    [project, submitFromComposer, setError, sessionIdRef, openingRef],
  );

  useEffect(() => {
    return window.grokDesktop.on("preview:viewport-capture", (payload) => {
      submitPreviewCapture(payload);
    });
  }, [submitPreviewCapture]);

  /** Next turn after the current one settles, without cancelling it. */
  const queueNextPrompt = useCallback((text: string) => {
    const item = enqueuePrompt(
      text,
      [],
      "compact",
      undefined,
      "followup",
    );
    sendNowRef.current = item;
    return item;
  }, [enqueuePrompt]);

  /** Stop the live turn immediately — do not wait for the agent to finish. */
  const stopTurn = useCallback(() => {
    deliveryGenRef.current += 1;
    afterTurnRef.current = null;
    sendNowRef.current = null;
    setPromptQueue([]);
    promptQueueRef.current = [];
    busyRef.current = false;
    setItems((prev) => finalizeOpenTools(prev, "cancelled"));
    setConn("online");
    void window.grokDesktop.cancel().catch(() => {});
  }, [busyRef, setConn, setItems]);

  const sendQueuedNow = useCallback(
    (id?: string) => {
      if (openingRef.current) return;
      const list = promptQueueRef.current;
      const item = id ? list.find((q) => q.id === id) : list[0];
      if (!item) return;
      sendNowRef.current = item;
      if (busyRef.current) {
        setItems((prev) => finalizeOpenTools(prev, "cancelled"));
        void window.grokDesktop.cancel();
      } else {
        setPromptQueue((prev) => {
          const next = prev.filter((q) => q.id !== item.id);
          promptQueueRef.current = next;
          return next;
        });
        void deliverPrompt({
          text: item.text,
          images: item.images,
          imageQuality: item.imageQuality,
          timelineText: item.timelineText,
          restoreQueueItem: item,
          origin: item.origin,
        });
      }
    },
    [busyRef, openingRef, setItems, deliverPrompt],
  );

  return {
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
  };
}
