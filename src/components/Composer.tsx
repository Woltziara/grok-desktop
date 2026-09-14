import { appendDraftFiles, subtractSubmittedDraft, draftFingerprint } from "../../shared/draft-snapshot.mjs";
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
  getFlowState,
  type DraftFile,
  type SessionDraft,
} from "../lib/workspace-store";
import type { AvailableModel } from "../vite-env";
import { CommandMenu } from "./CommandMenu";
import { ContextMeter } from "./ContextMeter";

export type QueuedPrompt = {
  status?: import("../vite-env").DeliveryRow["status"];
  error?: string;
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
  sessionId?: string;
  cwd?: string;
  deliveryId?: string;
  purpose?: "compact";
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
  outboxPaused = false,
  onResumeQueue,
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
  outboxPaused?: boolean;
  onResumeQueue?: () => void;
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
  const mountedRef = useRef(true);
  const textTokenRef = useRef("");
  const submissionRef = useRef<SessionDraft["submission"]>(undefined);
  const hydratingFilesRef = useRef<DraftFile[]>([]);
  const removedAttachmentIds = useRef(new Set<string>());
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
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

  const draftLocation = useCallback(() => sessionId ? getFlowState().sessionLocations?.[sessionId]?.cwd || sessionCwd : sessionCwd, [sessionCwd, sessionId]);
  const imageRecord = useCallback((img: PendingImage): DraftFile => ({
    id: img.id, name: img.name || "图片", mimeType: img.mimeType, size: img.source?.size || 0,
    kind: "image", path: (img as PendingImage & {path?: string}).path,
    blobId: img.id, dataUrl: imageDataUrlRef.current[img.id] || undefined,
  }), []);
  const fileRecord = useCallback((file: PendingFile): DraftFile => ({
    id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, kind: file.kind,
    path: file.path, status: file.status, text: file.text,
  }), []);
  const captureDraft = useCallback((): SessionDraft => ({
    text: inputRef.current, textToken: textTokenRef.current, submission: submissionRef.current,
    cursor: textareaRef.current?.selectionStart ?? inputRef.current.length,
    highDetail: highDetailRef.current, quotes: quotesRef.current, savedAt: Date.now(), cwd: draftLocation() || "",
    files: [...new Map([
      ...hydratingFilesRef.current.filter(f => !removedAttachmentIds.current.has(f.id)),
      ...imagesRef.current.map(imageRecord), ...filesRef.current.map(fileRecord),
    ].map(file => [file.id, file])).values()],
  }), [draftLocation, imageRecord, fileRecord]);
  const writeDraft = useCallback((draft: SessionDraft | null) => {
    const cwd = draftLocation();
    if (!cwd || !sessionId) return false;
    const result = saveDraft(cwd, sessionId, draft);
    if (!result.ok && mountedRef.current) onError(`草稿没保存成功：${result.error || "请检查磁盘空间"}`);
    return result.ok;
  }, [draftLocation, sessionId, onError]);
  const persistCurrentDraft = useCallback(() => {
    if (!hydratedRef.current) return;
    writeDraft(captureDraft());
  }, [captureDraft, writeDraft]);
  useEffect(() => {
    const timer = window.setTimeout(persistCurrentDraft, 280);
    return () => { window.clearTimeout(timer); persistCurrentDraft(); };
  }, [input, pendingImages, pendingFiles, quotes, highDetail, persistCurrentDraft]);
  useEffect(() => {
    window.addEventListener("grok-flush-draft", persistCurrentDraft);
    return () => { window.removeEventListener("grok-flush-draft", persistCurrentDraft); persistCurrentDraft(); };
  }, [persistCurrentDraft]);

  const appendPrepared = useCallback((images: PendingImage[], files: PendingFile[]) => {
    if (!mountedRef.current) {
      const cwd = draftLocation();
      if (!cwd || !sessionId) return;
      const prior = readDraft(cwd, sessionId) || {text:"", files:[], cursor:0, savedAt:Date.now(), cwd};
      const additions = [...images.map(imageRecord), ...files.map(fileRecord)];
      const saved = saveDraft(cwd, sessionId, appendDraftFiles(prior, additions));
      window.dispatchEvent(new CustomEvent("grok-draft-handoff", {detail:{sessionId, files:additions, error:saved.ok ? undefined : saved.error}}));
      for (const image of images) revokePendingImagePreview(image);
      return;
    }
    const imageMap = new Map(imagesRef.current.map(i => [i.id, i]));
    for (const image of images) if (!removedAttachmentIds.current.has(image.id) && !imageMap.has(image.id)) imageMap.set(image.id, image);
    const fileMap = new Map(filesRef.current.map(i => [i.id, i]));
    for (const file of files) if (!removedAttachmentIds.current.has(file.id)) fileMap.set(file.id, file);
    imagesRef.current = [...imageMap.values()]; filesRef.current = [...fileMap.values()];
    setPendingImages(imagesRef.current); setPendingFiles(filesRef.current);
    persistCurrentDraft();
  }, [draftLocation, sessionId, imageRecord, fileRecord, persistCurrentDraft]);

  const restoreFiles = useCallback(async (records: DraftFile[]) => {
    const images: PendingImage[] = [], files: PendingFile[] = [];
    for (const file of records) {
      if (removedAttachmentIds.current.has(file.id)) continue;
      if (file.kind === "image") {
        let blob: Blob | null = null;
        try { blob = await getDraftBlob(file.blobId || file.id); } catch { /* data URL fallback */ }
        if (!mountedRef.current) { for (const image of images) revokePendingImagePreview(image); return; }
        if (removedAttachmentIds.current.has(file.id)) continue;
        if (blob) images.push({id:file.id, data:"", mimeType:file.mimeType || blob.type || "image/png", name:file.name, source:blob, previewUrl:URL.createObjectURL(blob)});
        else {
          const dataUrl = file.dataUrl || (file.previewUrl?.startsWith("data:") ? file.previewUrl : "");
          const restored = dataUrl ? dataUrlToPendingImage(dataUrl, {id:file.id, name:file.name, mimeType:file.mimeType}) : null;
          if (restored) { images.push(restored); imageDataUrlRef.current[file.id] = dataUrl; }
          else files.push({id:file.id, name:file.name, mimeType:file.mimeType, size:file.size, kind:"other", status:"error", path:file.path, error:"原图内容暂时找不到，请重新附上；没有把它当作已准备好。"});
        }
      } else files.push({id:file.id, name:file.name, mimeType:file.mimeType, size:file.size, kind:(file.kind as PendingFile["kind"]) || "other", status:file.status === "ready" ? "ready" : "error", path:file.path, text:file.text});
    }
    if (!mountedRef.current) return;
    hydratingFilesRef.current = hydratingFilesRef.current.filter(file => !records.some(r => r.id === file.id));
    appendPrepared(images, files);
  }, [appendPrepared]);

  useEffect(() => {
    const cwd = draftLocation();
    if (!cwd || !sessionId) return;
    const draft = readDraft(cwd, sessionId);
    hydratedRef.current = true;
    if (!draft) return;
    textTokenRef.current = draft.textToken || `legacy-${draft.savedAt}`;
    submissionRef.current = draft.submission;
    inputRef.current = draft.text || ""; setInput(inputRef.current);
    highDetailRef.current = Boolean(draft.highDetail); setHighDetail(highDetailRef.current);
    quotesRef.current = normalizeComposerQuotes(draft.quotes); setQuotes(quotesRef.current);
    hydratingFilesRef.current = draft.files || [];
    const token = textTokenRef.current;
    void restoreFiles(draft.files || []).then(() => {
      if (!mountedRef.current || textTokenRef.current !== token) return;
      const el = textareaRef.current;
      if (el && (!document.activeElement || document.activeElement === document.body || document.activeElement === el)) {
        const cursor = Math.min(draft.cursor || 0, el.value.length); el.setSelectionRange(cursor, cursor);
      }
    });
    // Composer is keyed by session identity; hydration runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const consumeSubmittedDraft = useCallback((submitted: SessionDraft) => {
    if (!mountedRef.current) {
      const cwd = draftLocation();
      if (!cwd || !sessionId) return;
      const current = readDraft(cwd, sessionId);
      if (current) saveDraft(cwd, sessionId, subtractSubmittedDraft(current, submitted));
      window.dispatchEvent(new CustomEvent("grok-draft-handoff", {detail:{sessionId, submitted}}));
      return;
    }
    const next: SessionDraft = subtractSubmittedDraft(captureDraft(), submitted);
    const retained = new Set(next.files.map(file => file.id));
    for (const file of submitted.files) if (!retained.has(file.id)) removedAttachmentIds.current.add(file.id);
    imagesRef.current = imagesRef.current.filter(image => { if (retained.has(image.id)) return true; revokePendingImagePreview(image); return false; });
    filesRef.current = filesRef.current.filter(file => retained.has(file.id));
    hydratingFilesRef.current = hydratingFilesRef.current.filter(file => retained.has(file.id));
    inputRef.current = next.text; quotesRef.current = next.quotes || []; highDetailRef.current = Boolean(next.highDetail); submissionRef.current = next.submission;
    setInput(next.text); setPendingImages(imagesRef.current); setPendingFiles(filesRef.current); setQuotes(quotesRef.current); setHighDetail(highDetailRef.current);
    writeDraft(next);
  }, [captureDraft, draftLocation, sessionId, writeDraft]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{sessionId:string; files?:DraftFile[]; submitted?:SessionDraft; error?:string}>).detail;
      if (detail?.sessionId !== sessionId || !mountedRef.current) return;
      if (detail.error) onError(`原对话附件保存失败：${detail.error}`);
      if (detail.files) { hydratingFilesRef.current = [...hydratingFilesRef.current, ...detail.files]; void restoreFiles(detail.files); }
      if (detail.submitted) consumeSubmittedDraft(detail.submitted);
    };
    window.addEventListener("grok-draft-handoff", receive);
    return () => window.removeEventListener("grok-draft-handoff", receive);
  }, [sessionId, restoreFiles, consumeSubmittedDraft, onError]);
  useEffect(() => {
    if (focusNonce) requestAnimationFrame(() => textareaRef.current?.focus());
  }, [focusNonce]);
  const clearDraft = useCallback(() => consumeSubmittedDraft(captureDraft()), [consumeSubmittedDraft, captureDraft]);

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
        appendPrepared(images, []);
      }
      if (error) onError(error);
    },
    [onError, appendPrepared],
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
          const row = await api(p, sessionId || undefined);
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
              appendPrepared([img], []);
            }
            continue;
          }
          const file = importedToPendingFile(row);
          appendPrepared([], [file]);
        } catch (e: unknown) {
          const error = e instanceof Error ? e.message : String(e);
          appendPrepared([], [{id:crypto.randomUUID(),name:p.split(/[\\/]/).pop() || p,path:p,mimeType:"",size:0,kind:"other",status:"error",error}]);
          if (mountedRef.current) onError(error);
        }
      }
    },
    [onError, sessionId, appendPrepared],
  );

  const retryPendingFile = useCallback(
    async (file: PendingFile) => {
      if (file.path) {
        await importNativePaths([file.path]);
        if (filesRef.current.some(f => f.id !== file.id && f.path === file.path && f.status === "ready")) {
          removedAttachmentIds.current.add(file.id);
          filesRef.current = filesRef.current.filter(f => f.id !== file.id); setPendingFiles(filesRef.current);
        }
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
        appendPrepared([], files);
      }
      if (error) onError(error);
    },
    [addImages, importNativePaths, onError, osPathForFile, appendPrepared],
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
    removedAttachmentIds.current.add(id);
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
    removedAttachmentIds.current.add(id);
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
      if (hydratingFilesRef.current.length || draftFiles.some((f) => f.status !== "ready")) {
        onError("附件还没准备完整，请等它完成或移除出错的附件后再发送。");
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
      const submitted = captureDraft();
      const fingerprint = draftFingerprint(submitted);
      if (submissionRef.current?.fingerprint !== fingerprint) submissionRef.current = {id:crypto.randomUUID(), fingerprint};
      submitted.submission = submissionRef.current;
      if (!writeDraft(submitted)) { submittingRef.current = false; return; }
      try {
        const localPath = parseSoloLocalPath(text);
        if (localPath) {
          try {
            const file = await window.grokDesktop.readFile(localPath, sessionId || undefined);
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

        if (!mountedRef.current) return;
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

        if (!mountedRef.current) return; // The original draft is still persisted; never submit through a different view.
        // Only consume this captured snapshot after main's durable acceptance.
        const accepted = await onSubmit({
          sessionId: sessionId || undefined,
          cwd: sessionCwd || undefined,
          deliveryId: submitted.submission?.id,
          text,
          images: images.map((img) => ({ ...img })),
          mode,
          imageQuality,
          origin: "user",
        });
        if (accepted) consumeSubmittedDraft(submitted);
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
      captureDraft,
      writeDraft,
      consumeSubmittedDraft,
      sessionCwd,
      sessionId,
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
              <span>{outboxPaused ? "已暂停，内容仍保留" : "本对话的发送记录"} · {promptQueue.length} 条</span>
              {outboxPaused && <button type="button" className="btn ghost btn-sm" onClick={onResumeQueue}>继续尚未发送的内容</button>}
              <span className="prompt-queue-hint">
                回车马上插入 · ⌘回车停下再听
              </span>
            </div>
            <ul className="prompt-queue-list">
              {promptQueue.map((q, i) => (
                <li key={q.id} className="prompt-queue-item">
                  <span className="prompt-queue-idx">{i + 1}</span>
                  <span title={q.error}>{({queued:"稍后",sending:"正在发送",interjecting:"正在插入",interjected:"已插入，等本轮完成",failed:"失败，可重试",uncertain:"结果待核对",cancelled:"已停止",done:"完成",dismissed:"已移除"})[q.status || "queued"]}</span>
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
                    disabled={i === 0 || ["sending", "interjecting", "interjected"].includes(q.status || "")}
                    onClick={() => onQueueMove?.(q.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="下移"
                    disabled={i === promptQueue.length - 1 || ["sending", "interjecting", "interjected"].includes(q.status || "")}
                    onClick={() => onQueueMove?.(q.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="修改这条稍后的话"
                    disabled={["sending", "interjecting", "interjected"].includes(q.status || "")}
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
                    disabled={conn === "connecting" || ["sending", "interjecting", "interjected"].includes(q.status || "")}
                    onClick={() => onSendQueuedNow(q.id)}
                  >
                    现在
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="去掉"
                    disabled={["sending", "interjecting", "interjected"].includes(q.status || "")}
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
          onChange={(e) => { textTokenRef.current = crypto.randomUUID(); inputRef.current = e.target.value; setInput(e.target.value); }}
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
