import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthStatus,
  BackboneSummary,
  OpenCheckoutRow,
  SessionSummary,
} from "../vite-env";
import type { ConnState } from "../lib/conn";
import { samePathKey } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import { searchByTitle } from "../../shared/title-search.mjs";
import {
  archivedChats,
  duplicateProjectNames,
  organizeFolderChats,
  organizeProjects,
  parentPathSnippet,
  sessionOrgKey,
} from "../../shared/workspace-org.mjs";
import type { UnreadMark } from "../lib/workspace-store";
import { BrandMark, Spinner } from "./BrandMark";
import { ColToggle } from "./ColToggle";
import { Menu, MenuItem, MenuSep } from "./ui/dropdown-menu";
import { Tip } from "./ui/tooltip";
import {
  groupSidebarChats,
  pathFolderKey,
  visibleFolderChats,
} from "../../shared/sidebar-chats.mjs";

const SIDEBAR_PREF_KEY = "grok-desktop-sidebar-v1";

function readSidebarPref(): {
  projectsOpen?: boolean;
  folders?: Record<string, boolean>;
  more?: Record<string, boolean>;
  scroll?: number;
} {
  try {
    const raw = localStorage.getItem(SIDEBAR_PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSidebarPref(next: {
  projectsOpen: boolean;
  folders: Record<string, boolean>;
  more: Record<string, boolean>;
  scroll?: number;
}) {
  try {
    localStorage.setItem(SIDEBAR_PREF_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M3.5 7.5h6.2l1.6 1.8H20.5v8.2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LiveSpin() {
  return (
    <span
      className="session-live-spin"
      title="正在进行"
      aria-label="正在进行"
    />
  );
}

function SessionMarks({
  pinned,
  draft,
  unread,
  needsYou,
  failed,
}: {
  pinned?: boolean;
  draft?: boolean;
  unread?: boolean;
  needsYou?: boolean;
  failed?: boolean;
}) {
  return (
    <span className="session-marks">
      {pinned ? (
        <span className="session-mark pin" title="已置顶">
          ★
        </span>
      ) : null}
      {draft ? (
        <span className="session-mark draft" title="有未发送的草稿">
          稿
        </span>
      ) : null}
      {needsYou ? (
        <span className="session-mark need" title="等你决定">
          问
        </span>
      ) : null}
      {failed ? (
        <span className="session-mark fail" title="刚才失败了">
          !
        </span>
      ) : null}
      {unread ? <span className="session-mark unread" title="有新结果" /> : null}
    </span>
  );
}

function SortableFolder({
  id,
  children,
}: {
  id: string;
  children: (opts: { handleProps: object; style: object }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ handleProps: { ...attributes, ...listeners }, style: {} })}
    </div>
  );
}

export const AppSidebar = memo(function AppSidebar({
  infoVersion,
  grokBinary,
  auth,
  backbone,
  project,
  sessionId,
  sessions,
  recentProjects,
  liveSessionIds = [],
  conn,
  isOpening,
  authBusy,
  onPickProject,
  onAddProject,
  onNewWorktree,
  onOpenProject,
  openCheckouts = [],
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onLogout,
  onOpenSettingsSection,
  billingLine = null,
  onExportChat,
  collapsed,
  onToggleCollapsed,
  inert: shellInert,
  projectOrder,
  onProjectOrder,
  pinned = {},
  pinnedProjects = {},
  archived = {},
  unread = {},
  showArchived = false,
  onTogglePinned,
  onTogglePinnedProject,
  onArchive,
  onUnarchive,
  onToggleShowArchived,
}: {
  infoVersion?: string;
  grokBinary?: string | null;
  auth: AuthStatus | null;
  backbone: BackboneSummary | null;
  project: string;
  sessionId: string | null;
  sessions: SessionSummary[];
  recentProjects: string[];
  liveSessionIds?: string[];
  conn: ConnState;
  isOpening: boolean;
  authBusy: boolean;
  onPickProject: () => void;
  /** Add a folder to the sidebar without switching the live session. */
  onAddProject?: () => void;
  onNewWorktree?: () => void;
  onOpenProject: (cwd: string) => void;
  openCheckouts?: OpenCheckoutRow[];
  onOpenSession: (opts: {
    mode: "new" | "resume";
    sessionId?: string;
    cwd?: string;
  }) => void;
  onRenameSession?: (opts: {
    sessionId: string;
    title: string;
    cwd?: string;
  }) => void | Promise<void>;
  onDeleteSession?: (opts: {
    sessionId: string;
    cwd?: string;
  }) => void | Promise<void>;
  onLogout: () => void;
  onOpenSettingsSection?: (
    section?: "mcp" | "plugins" | "skills" | "memory" | "peer",
  ) => void;
  billingLine?: string | null;
  onExportChat?: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  inert?: boolean;
  projectOrder?: string[];
  onProjectOrder?: (order: string[]) => void;
  pinned?: Record<string, number>;
  pinnedProjects?: Record<string, number>;
  archived?: Record<string, number>;
  unread?: Record<string, UnreadMark>;
  showArchived?: boolean;
  onTogglePinned?: (cwd: string, sessionId: string) => void;
  onTogglePinnedProject?: (cwd: string) => void;
  onArchive?: (cwd: string, sessionId: string) => void;
  onUnarchive?: (cwd: string, sessionId: string) => void;
  onToggleShowArchived?: () => void;
}) {
  const { redact } = usePrivacy();
  const openingGate = isOpening;
  const busyGate = isOpening || conn === "busy";
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [billingNote, setBillingNote] = useState<string | null>(null);
  const [pref, setPref] = useState(readSidebarPref);
  const projectsOpen = pref.projectsOpen !== false;
  const folderOpen = pref.folders || {};
  const moreOpen = pref.more || {};
  const live = new Set(liveSessionIds);

  const [query, setQuery] = useState("");
  const [undoArchive, setUndoArchive] = useState<{
    cwd: string;
    sessionId: string;
    title: string;
  } | null>(null);
  const plusLockRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const grouped = groupSidebarChats({
    sessions,
    projectOrder:
      projectOrder && projectOrder.length
        ? projectOrder
        : [
            project,
            ...recentProjects.filter((p) => !samePathKey(p, project)),
          ],
  }) as {
    projects: Array<{ cwd: string; name: string; chats: SessionSummary[] }>;
    recent: SessionSummary[];
  };
  const visibleProjects = organizeProjects(grouped.projects, pinnedProjects);
  const nameCounts = duplicateProjectNames(visibleProjects);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const patchPref = useCallback(
    (next: {
      projectsOpen?: boolean;
      folders?: Record<string, boolean>;
      more?: Record<string, boolean>;
      scroll?: number;
    }) => {
      setPref((prev) => {
        const merged = {
          projectsOpen: next.projectsOpen ?? prev.projectsOpen ?? true,
          folders: next.folders ?? prev.folders ?? {},
          more: next.more ?? prev.more ?? {},
          scroll: next.scroll ?? prev.scroll ?? 0,
        };
        writeSidebarPref(merged);
        return merged;
      });
    },
    [],
  );
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);

  useEffect(() => {
    if (!renamingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingId]);

  useEffect(() => {
    if (!accountOpen) return;
    let cancelled = false;
    void window.grokDesktop
      .getBilling()
      .then((res) => {
        if (!cancelled) setBillingNote(res?.line || null);
      })
      .catch(() => {
        if (!cancelled) setBillingNote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    const close = () => setAccountOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  const startRename = useCallback((s: SessionSummary) => {
    const current = (s.title || "").trim();
    setRenamingId(s.id);
    setRenameDraft(
      current === "(no summary)" || current === "新对话" ? "" : current,
    );
  }, []);

  const confirmDelete = useCallback(
    async (s: SessionSummary) => {
      if (!onDeleteSession) return;
      const label = (s.title || "").trim() || "this chat";
      if (
        !window.confirm(
          `Delete “${label}”? This cannot be undone.`,
        )
      ) {
        return;
      }
      try {
        await onDeleteSession({ sessionId: s.id, cwd: s.cwd });
      } catch {
        /* App surfaces the error */
      }
    },
    [onDeleteSession],
  );

  const cancelRename = useCallback(() => {
    if (renameBusy) return;
    setRenamingId(null);
    setRenameDraft("");
  }, [renameBusy]);

  const commitRename = useCallback(async () => {
    if (!renamingId || !onRenameSession || renameBusy) return;
    const next = renameDraft.trim();
    const current = sessions.find((s) => s.id === renamingId);
    if (!next || next === (current?.title || "").trim()) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    try {
      await onRenameSession({
        sessionId: renamingId,
        title: next,
        cwd: current?.cwd,
      });
      setRenamingId(null);
      setRenameDraft("");
    } catch {
      /* App surfaces the error; keep the editor open */
    } finally {
      setRenameBusy(false);
    }
  }, [
    cancelRename,
    onRenameSession,
    renameBusy,
    renameDraft,
    renamingId,
    sessions,
  ]);

  const newInFolder = useCallback(
    (cwd: string) => {
      const now = Date.now();
      if (now - plusLockRef.current < 700) return;
      plusLockRef.current = now;
      const key = pathFolderKey(cwd);
      patchPref({ folders: { ...folderOpen, [key]: true } });
      onOpenSession({ mode: "new", cwd });
    },
    [folderOpen, onOpenSession, patchPref],
  );

  const searchHits = useMemo(() => {
    const q = query.trim();
    const sessionHits = searchByTitle(
      sessions.map((s) => ({
        ...s,
        projectName: grouped.projects.find((p) => samePathKey(p.cwd, s.cwd))
          ?.name,
      })),
      q,
      { keys: ["title", "projectName"], limit: 16 },
    );
    const projectHits = searchByTitle(
      grouped.projects.map((p) => ({ id: p.cwd, title: p.name, cwd: p.cwd })),
      q,
      { keys: ["title"], limit: 8 },
    );
    return {
      sessionHits: sessionHits as Array<{ item: SessionSummary; snippet: string }>,
      projectHits: projectHits as Array<{
        item: { id: string; title: string; cwd: string };
        snippet: string;
      }>,
    };
  }, [query, sessions, grouped.projects]);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : "";
      if (!overId || activeId === overId || !onProjectOrder) return;
      const keys = visibleProjects.map((p) => pathFolderKey(p.cwd));
      const from = keys.indexOf(activeId);
      const to = keys.indexOf(overId);
      if (from < 0 || to < 0) return;
      const next = visibleProjects.map((p) => p.cwd);
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      onProjectOrder(next);
    },
    [visibleProjects, onProjectOrder],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof pref.scroll === "number" && pref.scroll > 0) {
      el.scrollTop = pref.scroll;
    }
  }, []);

  const archivedList = archivedChats(sessions, archived);

  const renderChatRow = (
    s: SessionSummary,
    opts: { nested: boolean; live: boolean },
  ) => {
    if (renamingId === s.id) {
      return (
        <form
          key={s.id}
          className="session-row session-row--editing"
          onSubmit={(e) => {
            e.preventDefault();
            void commitRename();
          }}
        >
          <input
            ref={renameInputRef}
            className="session-rename-input"
            value={renameDraft}
            disabled={renameBusy}
            maxLength={100}
            aria-label="对话标题"
            placeholder="对话标题"
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                skipRenameBlurRef.current = true;
                cancelRename();
              }
            }}
            onBlur={() => {
              if (skipRenameBlurRef.current) {
                skipRenameBlurRef.current = false;
                return;
              }
              void commitRename();
            }}
          />
        </form>
      );
    }
    const active = s.id === sessionId && samePathKey(s.cwd || project, project);
    const orgKey = sessionOrgKey(s.cwd || project, s.id);
    const mark = unread[orgKey];
    const isPinned = Boolean(pinned[orgKey]);
    const isArchived = Boolean(archived[orgKey]);
    const isDraft = Boolean((s as SessionSummary & { isDraft?: boolean }).isDraft);
    return (
      <div
        key={s.id}
        className={
          "session-row" +
          (opts.nested ? " session-row--nested" : "") +
          (active ? " active" : "")
        }
      >
        <button
          type="button"
          className={`recent-item session-item ${active ? "active" : ""}`}
          disabled={openingGate}
          title={s.title || "新对话"}
          onClick={() => {
            if (active) return;
            onOpenSession({
              mode: "resume",
              sessionId: s.id,
              cwd: s.cwd,
            });
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onRenameSession) startRename(s);
          }}
        >
          <span className="name">{s.title || "新对话"}</span>
          <SessionMarks
            pinned={isPinned}
            draft={isDraft}
            unread={Boolean(mark?.unread)}
            needsYou={Boolean(mark?.needsYou)}
            failed={Boolean(mark?.failed)}
          />
          {!opts.nested && opts.live ? <LiveSpin /> : null}
        </button>
        {opts.nested ? (
          <span className="sidebar-plus-slot">
            {opts.live ? <LiveSpin /> : null}
          </span>
        ) : null}
        {onRenameSession || onDeleteSession || onTogglePinned || onArchive ? (
          <Menu
            trigger={
              <button
                type="button"
                className="session-more-btn"
                title="对话选项"
                aria-label={`选项：${s.title || "对话"}`}
                disabled={renameBusy}
                onClick={(e) => e.stopPropagation()}
              >
                <span aria-hidden>⋯</span>
              </button>
            }
          >
            {onRenameSession ? (
              <MenuItem onSelect={() => startRename(s)}>重命名</MenuItem>
            ) : null}
            {onTogglePinned ? (
              <MenuItem onSelect={() => onTogglePinned(s.cwd || project, s.id)}>
                {isPinned ? "取消置顶" : "置顶"}
              </MenuItem>
            ) : null}
            {isArchived
              ? onUnarchive && (
                  <MenuItem
                    onSelect={() => onUnarchive(s.cwd || project, s.id)}
                  >
                    取消归档
                  </MenuItem>
                )
              : onArchive && (
                  <MenuItem
                    onSelect={() => {
                      onArchive(s.cwd || project, s.id);
                      setUndoArchive({
                        cwd: s.cwd || project,
                        sessionId: s.id,
                        title: s.title || "对话",
                      });
                      window.setTimeout(() => setUndoArchive(null), 8000);
                    }}
                  >
                    归档
                  </MenuItem>
                )}
            {onDeleteSession ? (
              <>
                <MenuSep />
                <MenuItem danger onSelect={() => void confirmDelete(s)}>
                  删除
                </MenuItem>
              </>
            ) : null}
          </Menu>
        ) : null}
      </div>
    );
  };

  return (
    <aside
      className={"sidebar" + (collapsed ? " sidebar--collapsed" : "")}
      inert={shellInert || undefined}
    >
      <div className="brand">
        {collapsed ? (
          <>
            <ColToggle
              collapsed={collapsed}
              expandToward="right"
              labelExpand="Expand sidebar"
              labelCollapse="Collapse sidebar"
              onClick={onToggleCollapsed}
            />
            <button
              type="button"
              className="brand-mark-btn"
              title="Expand sidebar"
              onClick={onToggleCollapsed}
            >
              <BrandMark size={28} />
            </button>
          </>
        ) : (
          <>
            <BrandMark size={32} />
            <div className="brand-text">
              <h1>Grok</h1>
            </div>
            <ColToggle
              collapsed={collapsed}
              expandToward="right"
              labelExpand="Expand sidebar"
              labelCollapse="Collapse sidebar"
              onClick={onToggleCollapsed}
            />
          </>
        )}
      </div>

      {collapsed ? null : (
      <>
      <div className="sidebar-section">
        <button
          className="btn ghost block"
          type="button"
          onClick={() => onOpenSession({ mode: "new" })}
          disabled={openingGate}
          title={
            conn === "busy"
              ? "停下当前回复，开始新对话"
              : "新对话"
          }
        >
          {isOpening ? (
            <span className="btn-inline">
              <Spinner size={14} />
              打开中…
            </span>
          ) : (
            "新对话"
          )}
        </button>
      </div>

      <div
        className="sidebar-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          patchPref({ scroll: top });
        }}
      >
        <div className="sidebar-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目或对话"
            aria-label="搜索项目或对话"
          />
        </div>
        {query.trim() ? (
          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <h2>找到的</h2>
            </div>
            {searchHits.projectHits.length === 0 &&
            searchHits.sessionHits.length === 0 ? (
              <p className="sidebar-hint">没有叫这个名字的项目或对话</p>
            ) : (
              <>
                {searchHits.projectHits.map((hit) => (
                  <button
                    key={hit.item.id}
                    type="button"
                    className="recent-item session-item"
                    onClick={() => onOpenProject(hit.item.cwd)}
                  >
                    <span className="name">{hit.item.title}</span>
                  </button>
                ))}
                {searchHits.sessionHits.map((hit) =>
                  renderChatRow(hit.item, {
                    nested: false,
                    live: live.has(hit.item.id),
                  }),
                )}
              </>
            )}
          </div>
        ) : null}
        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <button
              type="button"
              className="sidebar-section-toggle"
              onClick={() => patchPref({ projectsOpen: !projectsOpen })}
            >
              <span className="sidebar-chevron" aria-hidden>
                {projectsOpen ? "▾" : "›"}
              </span>
              项目
            </button>
            <span className="sidebar-plus-slot">
              <button
                type="button"
                className="sidebar-section-plus"
                title="把文件夹加到项目列表，不切换当前对话"
                aria-label="添加项目"
                onClick={onAddProject || onPickProject}
                disabled={onAddProject ? false : busyGate}
              >
                +
              </button>
            </span>
          </div>
          {projectsOpen && !query.trim() ? (
            <div className="project-folder-list">
              {grouped.projects.length === 0 ? (
                <p className="sidebar-hint">还没有项目。点 + 打开一个文件夹。</p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={visibleProjects.map((p) => pathFolderKey(p.cwd))}
                    strategy={verticalListSortingStrategy}
                  >
                    {visibleProjects.map((folder) => {
                      const key = pathFolderKey(folder.cwd);
                      const open =
                        folderOpen[key] ??
                        (samePathKey(folder.cwd, project) ||
                          folder.chats.some((c) => live.has(c.id)));
                      const showAll = Boolean(moreOpen[key]);
                      const organized = organizeFolderChats(folder.chats, {
                        pinned,
                        archived,
                      });
                      const shown = visibleFolderChats(organized, showAll);
                      const dup = (nameCounts.get(folder.name) || 0) > 1;
                      return (
                        <SortableFolder key={key} id={key}>
                          {({ handleProps }) => (
                            <div className="project-folder">
                              <div className="project-folder-row">
                                <button
                                  type="button"
                                  className={
                                    "project-folder-head" +
                                    (samePathKey(folder.cwd, project)
                                      ? " is-current"
                                      : "")
                                  }
                                  title={folder.cwd}
                                  onClick={() =>
                                    patchPref({
                                      folders: { ...folderOpen, [key]: !open },
                                    })
                                  }
                                  {...handleProps}
                                >
                                  <FolderGlyph />
                                  <span className="project-folder-name">
                                    {folder.name}
                                    {onTogglePinnedProject ? (
                                      <button
                                        type="button"
                                        className={
                                          "project-pin-inline" +
                                          (pinnedProjects[pathFolderKey(folder.cwd)]
                                            ? " is-on"
                                            : "")
                                        }
                                        title={
                                          pinnedProjects[pathFolderKey(folder.cwd)]
                                            ? "取消置顶这个项目"
                                            : "置顶这个项目"
                                        }
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          onTogglePinnedProject(folder.cwd);
                                        }}
                                        onPointerDown={(e) => e.stopPropagation()}
                                      >
                                        {pinnedProjects[pathFolderKey(folder.cwd)]
                                          ? "★"
                                          : "☆"}
                                      </button>
                                    ) : null}
                                    {dup ? (
                                      <span className="project-folder-path">
                                        {parentPathSnippet(folder.cwd)}
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                                <span className="sidebar-plus-slot">
                                  <Tip
                                    label={`在「${folder.name}」中新建对话`}
                                    side="right"
                                  >
                                    <button
                                      type="button"
                                      className="project-folder-plus"
                                      title={`在「${folder.name}」中新建对话`}
                                      aria-label={`在「${folder.name}」中新建对话`}
                                      disabled={openingGate}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        newInFolder(folder.cwd);
                                      }}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      +
                                    </button>
                                  </Tip>
                                </span>
                              </div>
                              {open ? (
                                <div className="project-folder-chats">
                                  {organized.length === 0 ? (
                                    <button
                                      type="button"
                                      className="recent-item session-item"
                                      disabled={busyGate}
                                      onClick={() => onOpenProject(folder.cwd)}
                                    >
                                      <span className="name">打开这个项目</span>
                                    </button>
                                  ) : (
                                    shown.map((s) =>
                                      renderChatRow(s, {
                                        nested: true,
                                        live: live.has(s.id),
                                      }),
                                    )
                                  )}
                                  {organized.length > shown.length ? (
                                    <button
                                      type="button"
                                      className="sidebar-more"
                                      onClick={() =>
                                        patchPref({
                                          more: { ...moreOpen, [key]: true },
                                        })
                                      }
                                    >
                                      展开显示
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </SortableFolder>
                      );
                    })}
                  </SortableContext>
                </DndContext>
              )}
            </div>
          ) : null}
        </div>

        {query.trim() ? null : (
        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <h2>最近</h2>
          </div>
          <div className="recent-list session-list">
            {organizeFolderChats(grouped.recent, { pinned, archived }).length ===
            0 ? (
              <p className="sidebar-hint">还没有聊天。</p>
            ) : (
              organizeFolderChats(grouped.recent, { pinned, archived }).map((s) =>
                renderChatRow(s, { nested: false, live: live.has(s.id) }),
              )
            )}
          </div>
        </div>
        )}
        {archivedList.length ? (
          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <button
                type="button"
                className="sidebar-section-toggle"
                onClick={() => onToggleShowArchived?.()}
              >
                <span className="sidebar-chevron" aria-hidden>
                  {showArchived ? "▾" : "›"}
                </span>
                已归档
              </button>
            </div>
            {showArchived
              ? archivedList.map((s) =>
                  renderChatRow(s, { nested: false, live: live.has(s.id) }),
                )
              : null}
          </div>
        ) : null}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-account">
          <button
            type="button"
            className="sidebar-account-btn"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            title="账号与设置"
            onClick={(e) => {
              e.stopPropagation();
              setAccountOpen((v) => !v);
            }}
          >
            <div className="name">
              {auth?.displayName || auth?.email || "已登录"}
            </div>
          </button>
          {accountOpen ? (
            <div
              className="account-menu"
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              {billingNote || billingLine ? (
                <div className="account-menu-note">
                  {billingNote || billingLine}
                </div>
              ) : null}
              {onExportChat ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onExportChat}
                  disabled={!project}
                >
                  导出这场对话
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={onPickProject}
                disabled={busyGate}
              >
                打开文件夹…
              </button>
              {onNewWorktree ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onNewWorktree}
                  disabled={busyGate}
                >
                  新工作树…
                </button>
              ) : null}
              {onOpenSettingsSection ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onOpenSettingsSection("peer")}
                >
                  和僚机对齐
                </button>
              ) : null}
              {onOpenSettingsSection ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onOpenSettingsSection("peer")}
                >
                  把登录送到僚机
                </button>
              ) : null}
              {onOpenSettingsSection ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onOpenSettingsSection("peer")}
                >
                  把软件送到僚机
                </button>
              ) : null}
              {onOpenSettingsSection ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onOpenSettingsSection()}
                >
                  设置
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={onLogout}
                disabled={authBusy || isOpening}
              >
                退出
              </button>
            </div>
          ) : null}
        </div>
      </div>
      </>
      )}
      {undoArchive ? (
        <div className="sidebar-undo">
          已归档「{undoArchive.title}」
          <button
            type="button"
            className="btn ghost btn-sm"
            onClick={() => {
              onUnarchive?.(undoArchive.cwd, undoArchive.sessionId);
              setUndoArchive(null);
            }}
          >
            撤销
          </button>
        </div>
      ) : null}
    </aside>
  );
});
