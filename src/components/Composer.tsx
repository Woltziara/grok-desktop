import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { composerEnterAction } from "../../shared/composer-ime.mjs";
import {
  collectDroppedPaths,
  resolveDroppedFilePath,
} from "../../shared/dropped-paths.mjs";
import {
  addComposerQuote,
  isQuotesOnlySend,
  normalizeComposerQuotes,
  serializeQuotesForAgent,
} from "../../shared/composer-quotes.mjs";
import {
  attachAcceptAttr,
  mergeComposerTextWithFiles,
} from "../../shared/pending-attach.mjs";
import {
  DESKTOP_COMMANDS,
  filterCommands,
  formatCommandInsert,
  isSlashMenuOpen,
  slashQuery,
  type SlashCommand,
} from "../lib/commands";
import type { ConnState } from "../lib/conn";
import {
  attachKindLabel,
  filesToPendingFiles,
  formatBytes,
  importedToPendingFile,
  revokePendingFile,
  type PendingFile,
} from "../lib/pending-files";
import {
  blobToDataUrl,
  dataUrlToPendingImage,
  encodePendingImages,
  filesToPendingImages,
  revokePendingImagePreview,
  type PendingImage,
} from "../lib/pending-images";
import {
  getDraftBlob,
  putDraftBlob,
} from "../lib/draft-blobs";
import {
  formatInlinedFilePrompt,
  parseSoloLocalPath,
} from "../lib/local-file-prompt";
import type { PermissionMode } from "../lib/permission-mode";
import type { ReasoningEffort } from "../lib/reasoning-effort";
import {
  readDraft,
  saveDraft,
  type DraftFile,
  type SessionDraft,
} from "../lib/workspace-store";
import type { AvailableModel } from "../vite-env";
import { CommandMenu } from "./CommandMenu";
import { ContextMeter } from "./ContextMeter";

export type QueuedPrompt = {
  id: string;
  text: string;
  images: PendingImage[];
  imageQuality?: "compact" | "high";
  /** Text shown in history when the agent receives a transformed prompt. */
  timelineText?: string;
  origin?: "user" | "followup";
  at: number;
};

export type ComposerSubmit = {
  text: string;
  images: PendingImage[];
  mode: "auto" | "steer" | "queue" | "now";
  imageQuality?: "compact" | "high";
  timelineText?: string;
  origin?: "user" | "followup";
};

const COMPOSER_HEIGHT_KEY = "grok-desktop-composer-height";
/** Default textarea height (matches previous CSS min-height). */
const COMPOSER_HEIGHT_DEFAULT = 72;
/** Floor so the field stays usable. */
const COMPOSER_HEIGHT_MIN = 72;
/**
 * Leave room for topbar, status bar, chrome, and a sliver of timeline.
 * Users can still pull nearly full-screen (~90vh of the window).
 */
function composerHeightMax(): number {
  if (typeof window === "undefined") return 720;
  return Math.max(
    COMPOSER_HEIGHT_MIN,
    Math.round(window.innerHeight * 0.9) - 120,
  );
}

function readStoredComposerHeight(): number {
  try {
    const raw = localStorage.getItem(COMPOSER_HEIGHT_KEY);
    if (!raw) return COMPOSER_HEIGHT_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return COMPOSER_HEIGHT_DEFAULT;
    return Math.min(composerHeightMax(), Math.max(COMPOSER_HEIGHT_MIN, Math.round(n)));
  } catch {
    return COMPOSER_HEIGHT_DEFAULT;
  }
}

function persistComposerHeight(px: number) {
  try {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(Math.round(px)));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Draft composer: owns input, attachments, and slash menu so keystrokes do not
 * re-render the chat shell. Parent owns queue + agent delivery.
 */
export const Composer = memo(function Composer({
  conn,
  projectOpen,
  commands,
  promptQueue,
  onSubmit,
  onStop,
  onLocalCommand,
  onSendQueuedNow,
  onRemoveQueued,
  onError,
  modelId = null,
  modelName = null,
  pendingModelId = null,
  modelSelectEpoch = 0,
  availableModels = [],
  onModel,
  permissionMode,
  onPermissionMode,
  reasoningEffort,
  onReasoningEffort,
  usedContextTokens = 0,
  contextWindow = 0,
  onCompress,
  sessionKey = null,
  sessionCwd = "",
  sessionId = null,
  projectName = null,
  reviveNonce = 0,
  focusNonce = 0,
  onQueueEdit,
  onQueueMove,
  knowledgeLabel = null,
  onOpenKnowledge,
}: {
  conn: ConnState;
  projectOpen: boolean;
  commands: SlashCommand[];
  promptQueue: QueuedPrompt[];
  /** Return true when the draft should clear (accepted queue/delivery). */
  onSubmit: (payload: ComposerSubmit) => boolean | Promise<boolean>;
  onStop?: () => void;
  /** Desktop-only slash (e.g. /new, /always-approve) — never reaches the agent. */
  onLocalCommand: (name: string, args?: string) => void;
  onSendQueuedNow: (id?: string) => void;
  onRemoveQueued: (id: string) => void;
  onError: (message: string) => void;
  modelId?: string | null;
  modelName?: string | null;
  pendingModelId?: string | null;
  modelSelectEpoch?: number;
  availableModels?: AvailableModel[];
  onModel?: (modelId: string) => void;
  permissionMode?: PermissionMode;
  onPermissionMode?: (m: PermissionMode) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffort?: (e: ReasoningEffort) => void;
  usedContextTokens?: number;
  contextWindow?: number;
  onCompress?: () => void;
  sessionKey?: string | null;
  sessionCwd?: string;
  sessionId?: string | null;
  projectName?: string | null;
  reviveNonce?: number;
  focusNonce?: number;
  onQueueEdit?: (id: string, text: string) => void;
  onQueueMove?: (id: string, dir: number) => void;
  knowledgeLabel?: string | null;
  onOpenKnowledge?: () => void;
}) {
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [quotes, setQuotes] = useState<
    Array<{ id: string; text: string; sourceMessageId?: string }>
  >([]);
  const [highDetail, setHighDetail] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [queueDraft, setQueueDraft] = useState("");
  const submittingRef = useRef(false);
  const hydratedRef = useRef(false);
  const persistFailRef = useRef("");
  const imageDataUrlRef = useRef<Record<string, string>>({});
  const snapshotRef = useRef<{
    input: string;
    images: PendingImage[];
    files: PendingFile[];
    highDetail: boolean;
    cursor: number;
  } | null>(null);
  const [cmdIndex, setCmdIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [composerHeight, setComposerHeight] = useState(readStoredComposerHeight);
  const [resizing, setResizing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const imagesRef = useRef(pendingImages);
  imagesRef.current = pendingImages;
  const filesRef = useRef(pendingFiles);
  filesRef.current = pendingFiles;
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const highDetailRef = useRef(highDetail);
  highDetailRef.current = highDetail;
  const promptQueueRef = useRef(promptQueue);
  promptQueueRef.current = promptQueue;
  const heightRef = useRef(composerHeight);
  heightRef.current = composerHeight;
  const resizeDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  const menuOpen = isSlashMenuOpen(input) && !slashDismissed;
  const filteredCommands = useMemo(
    () => (menuOpen ? filterCommands(commands, slashQuery(input)) : []),
    [menuOpen, commands, input],
  );

  useEffect(() => {
    setCmdIndex(0);
    setSlashDismissed(false);
  }, [input]);

  useEffect(() => {
    if (cmdIndex >= filteredCommands.length) {
      setCmdIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, cmdIndex]);

  // Keep height in range when the window is resized (e.g. maximize / dock).
  useEffect(() => {
    const onResize = () => {
      const max = composerHeightMax();
      setComposerHeight((h) => {
        const next = Math.min(max, Math.max(COMPOSER_HEIGHT_MIN, h));
        if (next !== h) persistComposerHeight(next);
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const clampComposerHeight = useCallback((px: number) => {
    return Math.min(
      composerHeightMax(),
      Math.max(COMPOSER_HEIGHT_MIN, Math.round(px)),
    );
  }, []);

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeDragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startHeight: heightRef.current,
      };
      setResizing(true);
    },
    [],
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      // Drag up grows the input (handle sits on the top edge).
      const next = clampComposerHeight(
        drag.startHeight + (drag.startY - e.clientY),
      );
      setComposerHeight(next);
    },
    [clampComposerHeight],
  );

  const endResizeDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      resizeDragRef.current = null;
      setResizing(false);
      persistComposerHeight(heightRef.current);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [],
  );

  const onResizeDoubleClick = useCallback(() => {
    setComposerHeight(COMPOSER_HEIGHT_DEFAULT);
    persistComposerHeight(COMPOSER_HEIGHT_DEFAULT);
  }, []);

  const persistCurrentDraft = useCallback(() => {
    if (!sessionCwd || !sessionId) return;
    const hasLive =
      Boolean(String(inputRef.current || "").trim()) ||
      imagesRef.current.length > 0 ||
      filesRef.current.length > 0 ||
      Boolean(quotesRef.current?.length);
    if (!hydratedRef.current && !hasLive) return;
    const files: DraftFile[] = [
      ...imagesRef.current.map((img) => ({
        id: img.id,
        name: img.name || "图片",
        mimeType: img.mimeType,
        size: img.source?.size || 0,
        kind: "image",
        path: (img as PendingImage & { path?: string }).path,
        blobId: img.id,
        dataUrl: imageDataUrlRef.current[img.id] || undefined,
      })),
      ...filesRef.current.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        kind: f.kind,
        path: f.path,
        status: f.status,
        text: f.text,
      })),
    ];
    const draft: SessionDraft = {
      text: inputRef.current,
      cursor: textareaRef.current?.selectionStart ?? inputRef.current.length,
      highDetail: highDetailRef.current,
      files,
      quotes: quotesRef.current,
      savedAt: Date.now(),
      cwd: sessionCwd,
    };
    const result = saveDraft(sessionCwd, sessionId, draft);
    if (result && result.ok === false) {
      const msg = `草稿没保存成功。${result.error || "这台电脑的存储空间可能不够。"}`;
      if (persistFailRef.current !== msg) {
        persistFailRef.current = msg;
        onError(msg);
      }
    } else {
      persistFailRef.current = "";
    }
  }, [sessionCwd, sessionId, onError]);

  useEffect(() => {
    const t = window.setTimeout(() => persistCurrentDraft(), 280);
    return () => {
      window.clearTimeout(t);
      persistCurrentDraft();
    };
  }, [input, pendingImages, pendingFiles, quotes, highDetail, persistCurrentDraft]);

  useEffect(() => {
    return () => persistCurrentDraft();
  }, [persistCurrentDraft]);

  useEffect(() => {
    const onFlush = () => persistCurrentDraft();
    window.addEventListener("grok-flush-draft", onFlush);
    return () => window.removeEventListener("grok-flush-draft", onFlush);
  }, [persistCurrentDraft]);

  useEffect(() => {
    if (!sessionCwd || !sessionId) return;
    let cancelled = false;
    const draft = readDraft(sessionCwd, sessionId);
    hydratedRef.current = true;
    if (!draft) return;
    setInput(draft.text || "");
    setHighDetail(Boolean(draft.highDetail));
    setQuotes(normalizeComposerQuotes(draft.quotes));
    void (async () => {
      const images: PendingImage[] = [];
      const files: PendingFile[] = [];
      let missingImage = false;
      for (const f of draft.files || []) {
        if (f.kind === "image") {
          let blob: Blob | null = null;
          try {
            blob = await getDraftBlob(f.blobId || f.id);
          } catch {
            blob = null;
          }
          if (cancelled) return;
          if (blob) {
            images.push({
              id: f.id,
              data: "",
              mimeType: f.mimeType || blob.type || "image/png",
              previewUrl: URL.createObjectURL(blob),
              name: f.name,
              source: blob,
            });
            continue;
          }
          const restored = f.dataUrl
            ? dataUrlToPendingImage(f.dataUrl, {
                id: f.id,
                name: f.name,
                mimeType: f.mimeType,
              })
            : null;
          if (restored) {
            images.push(restored);
            imageDataUrlRef.current[restored.id] = f.dataUrl || "";
          } else if (f.previewUrl?.startsWith("data:")) {
            images.push({
              id: f.id,
              data: "",
              mimeType: f.mimeType || "image/png",
              previewUrl: f.previewUrl,
              name: f.name,
            });
          } else {
            missingImage = true;
          }
        } else {
          files.push({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
            kind: (f.kind as PendingFile["kind"]) || "other",
            status: f.status === "error" ? "error" : "ready",
            path: f.path,
            text: f.text,
          });
        }
      }
      if (cancelled) return;
      setPendingImages(images);
      setPendingFiles(files);
      if (missingImage) {
        onError("有附过的图片找不到完整内容了，需要重新附上。");
      }
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cur = Math.min(draft.cursor || 0, el.value.length);
        el.setSelectionRange(cur, cur);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionCwd, sessionId, onError]);

  useEffect(() => {
    if (!reviveNonce) return;
    const snap = snapshotRef.current;
    if (!snap) return;
    setInput(snap.input);
    setPendingImages(snap.images);
    setPendingFiles(snap.files);
    setHighDetail(snap.highDetail);
    void (async () => {
      for (const img of snap.images || []) {
        if (img.source) {
          try {
            await putDraftBlob(img.id, img.source);
          } catch {
            /* quota — persist below still records the draft */
          }
        }
      }
      if (!sessionCwd || !sessionId) return;
      const files: DraftFile[] = [
        ...(snap.images || []).map((img) => ({
          id: img.id,
          name: img.name || "图片",
          mimeType: img.mimeType,
          size: img.source?.size || 0,
          kind: "image",
          blobId: img.id,
        })),
        ...(snap.files || []).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
          kind: f.kind,
          path: f.path,
          status: f.status,
          text: f.text,
        })),
      ];
      saveDraft(sessionCwd, sessionId, {
        text: snap.input,
        cursor: snap.cursor,
        highDetail: snap.highDetail,
        files,
        savedAt: Date.now(),
        cwd: sessionCwd,
      });
    })();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const cur = Math.min(snap.cursor, el.value.length);
      el.setSelectionRange(cur, cur);
    });
  }, [reviveNonce, sessionCwd, sessionId]);

  useEffect(() => {
    if (!focusNonce) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [focusNonce]);

  const clearDraft = useCallback(() => {
    setPendingImages((prev) => {
      for (const img of prev) revokePendingImagePreview(img);
      return [];
    });
    setPendingFiles((prev) => {
      for (const file of prev) revokePendingFile(file);
      return [];
    });
    setInput("");
    setQuotes([]);
    setHighDetail(false);
    if (sessionCwd && sessionId) {
      saveDraft(sessionCwd, sessionId, null);
    }
  }, [sessionCwd, sessionId]);

  const addImages = useCallback(
    async (files: ArrayLike<Blob | File>) => {
      const { images, error, duplicates } = await filesToPendingImages(
        files,
        imagesRef.current,
      );
      if (duplicates.length) {
        onError(`已经附过：${duplicates.join("、")}`);
      }
      for (const img of images) {
        const src = img.source;
        if (src) {
          try {
            await putDraftBlob(img.id, src);
          } catch {
            if (src.size < 1.5 * 1024 * 1024) {
              try {
                imageDataUrlRef.current[img.id] = await blobToDataUrl(src);
              } catch {
                onError(
                  "这张图没能完整写入草稿。当前还能发送，但关掉窗口后可能丢失。",
                );
              }
            } else {
              onError(
                "这张图比较大，草稿没能完整保存。当前还能发送，但关掉窗口后可能丢失。",
              );
            }
          }
        } else if (img.data) {
          imageDataUrlRef.current[img.id] =
            `data:${img.mimeType};base64,${img.data}`;
        }
      }
      if (images.length) {
        setPendingImages((prev) => [...prev, ...images]);
      }
      if (error) onError(error);
    },
    [onError],
  );

  const importNativePaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      const api = window.grokDesktop.importAttachment;
      if (typeof api !== "function") {
        onError("这个版本还不能从对话框附上 PDF，请更新后重试");
        return;
      }
      for (const p of paths) {
        try {
          const row = await api(p);
          if (row.kind === "image" && row.data) {
            const img = dataUrlToPendingImage(
              `data:${row.mimeType};base64,${row.data}`,
              { name: row.name, mimeType: row.mimeType },
            );
            if (img) {
              if (img.source) {
                try {
                  await putDraftBlob(img.id, img.source);
                } catch {
                  imageDataUrlRef.current[img.id] =
                    `data:${row.mimeType};base64,${row.data}`;
                }
              } else {
                imageDataUrlRef.current[img.id] =
                  `data:${row.mimeType};base64,${row.data}`;
              }
              setPendingImages((prev) => {
                const dup = prev.some(
                  (x) => x.name === img.name && x.source?.size === img.source?.size,
                );
                if (dup) {
                  onError(`已经附过：${img.name}`);
                  return prev;
                }
                return [...prev, img];
              });
            }
            continue;
          }
          const file = importedToPendingFile(row);
          setPendingFiles((prev) => {
            const dup = prev.some(
              (x) => x.path && file.path && x.path === file.path,
            );
            if (dup) {
              onError(`已经附过：${file.name}`);
              return prev;
            }
            return [...prev, file];
          });
        } catch (e: unknown) {
          onError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    [onError],
  );

  const retryPendingFile = useCallback(
    async (file: PendingFile) => {
      if (file.path) {
        await importNativePaths([file.path]);
        setPendingFiles((prev) => prev.filter((f) => f.id !== file.id));
        return;
      }
      if (file.source instanceof File) {
        const { files, error } = await filesToPendingFiles([file.source], []);
        if (error) onError(error);
        setPendingFiles((prev) =>
          prev.map((f: PendingFile) =>
            f.id === file.id ? files[0] || f : f,
          ),
        );
      }
    },
    [importNativePaths, onError],
  );

  const osPathForFile = useCallback((file: File) => {
    return resolveDroppedFilePath(file, (f: File) => {
      try {
        return window.grokDesktop.pathForFile?.(f as File) || "";
      } catch {
        return "";
      }
    });
  }, []);

  const addDroppedFiles = useCallback(
    async (list: File[]) => {
      const withPath = list.filter((f) => Boolean(osPathForFile(f)));
      const nativePaths = withPath
        .map((f) => osPathForFile(f))
        .filter(Boolean);
      if (nativePaths.length) {
        await importNativePaths(nativePaths);
        const leftover = list.filter((f) => !nativePaths.includes(osPathForFile(f)));
        if (!leftover.length) return;
        list = leftover;
      }
      const images = list.filter((f) => f.type.startsWith("image/"));
      const others = list.filter((f) => !f.type.startsWith("image/"));
      if (images.length) await addImages(images);
      if (!others.length) return;
      const { files, error, duplicates } = await filesToPendingFiles(
        others,
        filesRef.current,
      );
      if (duplicates.length) {
        onError(`已经附过：${duplicates.join("、")}`);
      }
      if (files.length) {
        setPendingFiles((prev) => [...prev, ...files]);
      }
      if (error) onError(error);
    },
    [addImages, importNativePaths, onError, osPathForFile],
  );

  useEffect(() => {
    const onImport = (event: Event) => {
      const paths = (event as CustomEvent<{ paths?: string[] }>).detail?.paths;
      if (paths?.length) void importNativePaths(paths);
    };
    window.addEventListener("grok-import-attachments", onImport as EventListener);
    return () =>
      window.removeEventListener(
        "grok-import-attachments",
        onImport as EventListener,
      );
  }, [importNativePaths]);

  useEffect(() => {
    const onQuote = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; sourceMessageId?: string }>)
        .detail;
      const text = String(detail?.text || "").trim();
      if (!text) return;
      setQuotes((prev) =>
        addComposerQuote(prev, {
          text,
          sourceMessageId: detail?.sourceMessageId,
        }),
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("grok-add-quote", onQuote as EventListener);
    return () =>
      window.removeEventListener("grok-add-quote", onQuote as EventListener);
  }, []);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const next = prev.filter((img) => {
        if (img.id === id) revokePendingImagePreview(img);
        return img.id !== id;
      });
      if (next.length === 0) setHighDetail(false);
      return next;
    });
  }, []);

  const removePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => {
      return prev.filter((file) => {
        if (file.id === id) revokePendingFile(file);
        return file.id !== id;
      });
    });
  }, []);

  const submit = useCallback(
    async (overrideText?: string, mode: ComposerSubmit["mode"] = "auto") => {
      if (submittingRef.current) return;
      let text = (overrideText !== undefined ? overrideText : input).trim();
      const draftImages = overrideText !== undefined ? [] : pendingImages;
      const draftFiles = overrideText !== undefined ? [] : pendingFiles;
      if (draftFiles.some((f) => f.status === "loading")) {
        onError("附件还没准备好");
        return;
      }
      if (!text) text = mergeComposerTextWithFiles("", draftFiles);
      else text = mergeComposerTextWithFiles(text, draftFiles);
      const draftQuotes =
        overrideText !== undefined ? [] : quotesRef.current;
      text = serializeQuotesForAgent(draftQuotes, text);
      if (!text && draftImages.length === 0) return;
      if (conn === "connecting" || !projectOpen) return;
      submittingRef.current = true;
      snapshotRef.current = {
        input,
        images: pendingImages.map((img) => ({ ...img })),
        files: pendingFiles.map((f) => ({ ...f })),
        highDetail,
        cursor: textareaRef.current?.selectionStart ?? input.length,
      };
      try {
        const localPath = parseSoloLocalPath(text);
        if (localPath) {
          try {
            const file = await window.grokDesktop.readFile(localPath);
            if (file.binary) {
              onError("That path is a binary file, not a text prompt.");
              return;
            }
            if (!file.text.trim()) {
              onError("That file is empty.");
              return;
            }
            text = formatInlinedFilePrompt(localPath, file.text);
          } catch (e: unknown) {
            onError(e instanceof Error ? e.message : String(e));
            return;
          }
        }

        // Desktop-local slash commands (do not send to agent)
        const localMatch = text.match(/^\/([^\s]+)(?:\s+(.*))?$/s);
        if (localMatch) {
          const name = localMatch[1].toLowerCase();
          const local = DESKTOP_COMMANDS.find(
            (c) => c.local && c.name.toLowerCase() === name,
          );
          if (local) {
            clearDraft();
            onLocalCommand(name, (localMatch[2] || "").trim());
            return;
          }
        }

        const imageQuality = highDetail ? "high" : "compact";
        let images = draftImages;
        if (draftImages.length) {
          try {
            images = await encodePendingImages(draftImages, imageQuality);
          } catch (e: unknown) {
            onError(e instanceof Error ? e.message : String(e));
            return;
          }
        }

        // Only wipe the draft after the parent accepts (queue / deliver / interject).
        const accepted = await onSubmit({
          text,
          images: images.map((img) => ({ ...img })),
          mode,
          imageQuality,
          origin: "user",
        });
        if (accepted) clearDraft();
      } finally {
        submittingRef.current = false;
      }
    },
    [
      input,
      pendingImages,
      pendingFiles,
      quotes,
      highDetail,
      conn,
      projectOpen,
      clearDraft,
      onLocalCommand,
      onError,
      onSubmit,
    ],
  );

  const applySlashCommand = useCallback(
    (cmd: SlashCommand, mode: "insert" | "run" = "run") => {
      if (cmd.local && !cmd.inputHint) {
        clearDraft();
        onLocalCommand(cmd.name);
        return;
      }
      if (mode === "insert" || cmd.inputHint) {
        setInput(formatCommandInsert(cmd));
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        });
        return;
      }
      void submit(`/${cmd.name}`, "auto");
    },
    [clearDraft, onLocalCommand, submit],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdIndex(
          (i) =>
            (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cmd = filteredCommands[cmdIndex] || filteredCommands[0];
        if (cmd) applySlashCommand(cmd, "insert");
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredCommands[cmdIndex] || filteredCommands[0];
        if (cmd) applySlashCommand(cmd, "run");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    const enter = composerEnterAction(e);
    if (enter === "ignore") return;
    if (enter === "newline") return;
    if (enter === "now") {
      e.preventDefault();
      void submit(undefined, "now");
      return;
    }
    if (enter === "submit") {
      e.preventDefault();
      if (
        !input.trim() &&
        pendingImages.length === 0 &&
        pendingFiles.length === 0 &&
        quotes.length === 0 &&
        promptQueueRef.current.length > 0
      ) {
        onSendQueuedNow();
        return;
      }
      void submit(undefined, conn === "busy" ? "auto" : "auto");
    }
  };

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles: File[] = [];
    const items = e.clipboardData?.items;
    if (items?.length) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length === 0 && e.clipboardData?.files?.length) {
      for (const file of Array.from(e.clipboardData.files)) {
        if (file.type.startsWith("image/")) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    const hasText = Boolean(e.clipboardData?.getData("text/plain")?.trim());
    if (!hasText) e.preventDefault();
    await addImages(imageFiles);
  };

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const paths = collectDroppedPaths(e.dataTransfer, (file) =>
        osPathForFile(file as File),
      );
      if (paths.length) {
        await importNativePaths(paths);
        return;
      }
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) await addDroppedFiles(files);
      else onError("没能读到这个文件夹的路径，请点「文件夹」按钮再选一次");
    },
    [addDroppedFiles, importNativePaths, onError, osPathForFile],
  );

  useEffect(() => {
    const hasFiles = (dt: DataTransfer | null) => {
      if (!dt?.types) return false;
      return Array.from(dt.types as unknown as string[]).includes("Files");
    };
    const onDragOver = (e: globalThis.DragEvent) => {
      const dataTransfer = e.dataTransfer;
      if (!hasFiles(dataTransfer) || !dataTransfer) return;
      e.preventDefault();
      dataTransfer.dropEffect = "copy";
    };
    const onWindowDrop = (e: globalThis.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      void onDrop(e as unknown as DragEvent);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [onDrop]);

  const tall =
    expanded ||
    composerHeight >= Math.min(composerHeightMax() * 0.45, 280);
  const boxHeight = expanded ? composerHeightMax() : composerHeight;

  const modelOptions = useMemo(() => {
    const list = availableModels.slice();
    const ensure = (id: string | null | undefined, name?: string | null) => {
      if (id && !list.some((m) => m.modelId === id)) {
        list.unshift({ modelId: id, name: name || id });
      }
    };
    ensure(modelId, modelName);
    ensure(pendingModelId);
    return list;
  }, [availableModels, modelId, modelName, pendingModelId]);
  const selectModelId = pendingModelId || modelId || "";
  const canPickModel = Boolean(onModel) && modelOptions.length > 1;
  const modelLabel = modelName || modelId || null;

  return (
    <div
      className={
        "composer" +
        (resizing ? " composer--resizing" : "") +
        (tall ? " composer--tall" : "")
      }
    >
      <div
        className="composer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize input"
        aria-valuemin={COMPOSER_HEIGHT_MIN}
        aria-valuemax={composerHeightMax()}
        aria-valuenow={composerHeight}
        title="Drag to resize input · double-click to reset"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResizeDrag}
        onPointerCancel={endResizeDrag}
        onDoubleClick={onResizeDoubleClick}
      >
        <span className="composer-resize-grip" aria-hidden />
      </div>
      <div
        className="composer-box"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => void onDrop(e)}
      >
        {menuOpen && (
          <CommandMenu
            items={filteredCommands}
            activeIndex={cmdIndex}
            onHover={setCmdIndex}
            onSelect={applySlashCommand}
          />
        )}
        {quotes.length > 0 && (
          <div className="composer-quotes" aria-label="引用">
            {quotes.map((q) => (
              <div key={q.id} className="composer-quote-chip" title={q.text}>
                <span className="composer-quote-chip__text">{q.text}</span>
                <button
                  type="button"
                  className="composer-quote-chip__x"
                  title="去掉这段引用"
                  aria-label="去掉这段引用"
                  onClick={() =>
                    setQuotes((prev) => prev.filter((row) => row.id !== q.id))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {pendingFiles.length > 0 && (
          <div className="composer-files" aria-label="附件">
            {pendingFiles.map((file) => (
              <div
                key={file.id}
                className={
                  "composer-file" +
                  (file.status === "error" ? " is-error" : "") +
                  (file.status === "loading" ? " is-loading" : "")
                }
              >
                <div className="composer-file-meta">
                  <span className="composer-file-name" title={file.path || file.name}>
                    {file.name}
                  </span>
                  <span className="composer-file-kind">
                    {file.kind === "folder"
                      ? attachKindLabel(file.kind)
                      : `${attachKindLabel(file.kind)} · ${formatBytes(file.size)}`}
                    {file.status === "ready" ? " · 已准备好" : ""}
                    {file.status === "loading" ? " · 正在读" : ""}
                    {file.status === "error" ? ` · ${file.error || "失败"}` : ""}
                  </span>
                </div>
                {file.status === "error" ? (
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="重新选择或再读一次"
                    onClick={() => void retryPendingFile(file)}
                  >
                    重试
                  </button>
                ) : null}
                <button
                  type="button"
                  className="composer-image-remove"
                  title="去掉这个文件"
                  onClick={() => removePendingFile(file.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="composer-attach">
            <div className="composer-images">
              {pendingImages.map((img) => (
                <div key={img.id} className="composer-image">
                  <img src={img.previewUrl} alt={img.name || "Attached"} />
                  <button
                    type="button"
                    className="composer-image-remove"
                    title="Remove image"
                    onClick={() => removePendingImage(img.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <label className="composer-image-quality">
              <input
                type="checkbox"
                checked={highDetail}
                onChange={(e) => setHighDetail(e.target.checked)}
              />
              <span>
                <span className="composer-image-quality-label">
                  Higher detail
                </span>
                <span className="composer-image-quality-hint">
                  This send only · uses more tokens
                </span>
              </span>
            </label>
          </div>
        )}
        {promptQueue.length > 0 && (
          <div className="prompt-queue" aria-label="Queued follow-ups">
            <div className="prompt-queue-head">
              <span>稍后接着做 · {promptQueue.length} 条</span>
              <span className="prompt-queue-hint">
                回车马上插入 · ⌘回车停下再听
              </span>
            </div>
            <ul className="prompt-queue-list">
              {promptQueue.map((q, i) => (
                <li key={q.id} className="prompt-queue-item">
                  <span className="prompt-queue-idx">{i + 1}</span>
                  {editingQueueId === q.id ? (
                    <input
                      className="prompt-queue-edit"
                      value={queueDraft}
                      onChange={(e) => setQueueDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onQueueEdit?.(q.id, queueDraft);
                          setEditingQueueId(null);
                        } else if (e.key === "Escape") {
                          setEditingQueueId(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="prompt-queue-text" title={q.text}>
                      {q.text ||
                        `(${q.images.length} 张图)`}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="上移"
                    disabled={i === 0}
                    onClick={() => onQueueMove?.(q.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="下移"
                    disabled={i === promptQueue.length - 1}
                    onClick={() => onQueueMove?.(q.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="修改这条稍后的话"
                    onClick={() => {
                      setEditingQueueId(q.id);
                      setQueueDraft(q.text);
                    }}
                  >
                    改
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="现在改方向（停下当前回复）"
                    disabled={conn === "connecting"}
                    onClick={() => onSendQueuedNow(q.id)}
                  >
                    现在
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="去掉"
                    onClick={() => onRemoveQueued(q.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          style={{ height: boxHeight }}
          placeholder={
            conn === "busy"
              ? "正在想。要补充就接着打，回车会马上插入…"
              : "先说这件事…"
          }
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => void onPaste(e)}
          onKeyDown={onKeyDown}
          disabled={conn === "connecting"}
        />
        <div className="composer-actions composer-chrome">
          <div className="composer-chips">
            <input
              ref={fileInputRef}
              type="file"
              accept={attachAcceptAttr()}
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void addDroppedFiles(Array.from(files));
                e.target.value = "";
              }}
            />
            {projectName ? (
              <span className="composer-project" title={sessionCwd || projectName}>
                {projectName}
              </span>
            ) : null}
            {onOpenKnowledge ? (
              <button
                type="button"
                className="btn ghost btn-sm wk-chip"
                title="查看、纠正或切换当前工作认识"
                onClick={onOpenKnowledge}
              >
                {knowledgeLabel || "工作认识"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={conn === "connecting"}
              onClick={() => {
                if (typeof window.grokDesktop.pickFiles === "function") {
                  void window.grokDesktop.pickFiles().then((paths) => {
                    if (paths?.length) void importNativePaths(paths);
                  });
                  return;
                }
                fileInputRef.current?.click();
              }}
              title="附上图片、PDF、Word 或 Markdown"
            >
              +
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              disabled={conn === "connecting"}
              onClick={() => {
                if (typeof window.grokDesktop.pickFolder !== "function") {
                  onError("这个版本还不能附上文件夹，请更新后重试");
                  return;
                }
                void window.grokDesktop.pickFolder()
                  .then((folder) => {
                    if (folder) void importNativePaths([folder]);
                  })
                  .catch((e: unknown) => {
                    onError(e instanceof Error ? e.message : String(e));
                  });
              }}
              title="附上整个文件夹，发给 Agent 阅读"
            >
              文件夹
            </button>
            <button
              type="button"
              className="btn ghost btn-sm"
              title={expanded ? "收回输入框" : "把输入框展开来写"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收回" : "展开"}
            </button>
            {canPickModel ? (
              <label className="perm-mode-topbar" title="这一次用的模型">
                <select
                  className="perm-mode-select"
                  key={`${modelId || "none"}:${modelSelectEpoch}`}
                  value={selectModelId}
                  disabled={Boolean(pendingModelId)}
                  aria-label="模型"
                  onChange={(e) => onModel?.(e.target.value)}
                >
                  {modelOptions.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.name || m.modelId}
                    </option>
                  ))}
                </select>
              </label>
            ) : modelLabel ? (
              <span className="model-topbar" title={modelLabel}>
                <span className="model-topbar-value">{modelLabel}</span>
              </span>
            ) : null}
            {permissionMode && onPermissionMode ? (
              <label
                className="perm-mode-topbar"
                title="AI 现在能做什么：每一步问你 / 能读、改还要问 / 这次都让它做"
              >
                <select
                  className="perm-mode-select"
                  value={permissionMode}
                  aria-label="权限"
                  onChange={(e) =>
                    onPermissionMode(e.target.value as PermissionMode)
                  }
                >
                  <option value="ask">每一步问你</option>
                  <option value="auto">能读，改还要问</option>
                  <option value="always-approve">这次都让它做</option>
                </select>
              </label>
            ) : null}
            {reasoningEffort && onReasoningEffort ? (
              <label className="perm-mode-topbar" title="想得有多用力">
                <select
                  className="perm-mode-select"
                  value={reasoningEffort}
                  aria-label="推理力度"
                  onChange={(e) =>
                    onReasoningEffort(e.target.value as ReasoningEffort)
                  }
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="xhigh">极高</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <ContextMeter
              used={usedContextTokens}
              windowSize={contextWindow}
              onCompress={onCompress}
            />
            {conn === "busy" ? (
              <>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => onStop?.()}
                >
                  停下
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  title="等这轮说完再听"
                  onClick={() => void submit(undefined, "queue")}
                  disabled={
                    (!input.trim() &&
                      pendingImages.length === 0 &&
                      pendingFiles.length === 0 &&
                      !isQuotesOnlySend(input, quotes)) ||
                    !projectOpen
                  }
                >
                  稍后
                </button>
                <button
                  type="button"
                  className="btn primary"
                  title="插进正在做的事，不用先停"
                  onClick={() => void submit(undefined, "auto")}
                  disabled={
                    (!input.trim() &&
                      pendingImages.length === 0 &&
                      pendingFiles.length === 0 &&
                      !isQuotesOnlySend(input, quotes)) ||
                    !projectOpen
                  }
                >
                  插入
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => void submit(undefined, "auto")}
                disabled={
                  (!input.trim() &&
                    pendingImages.length === 0 &&
                    pendingFiles.length === 0 &&
                    !isQuotesOnlySend(input, quotes)) ||
                  conn === "connecting" ||
                  !projectOpen
                }
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
