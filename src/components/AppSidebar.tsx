import { memo, useCallback, useEffect, useRef, useState } from "react";
import type {
  AuthStatus,
  BackboneSummary,
  OpenCheckoutRow,
  SessionSummary,
} from "../vite-env";
import type { ConnState } from "../lib/conn";
import { samePathKey } from "../lib/path-utils";
import { usePrivacy } from "../lib/privacy-context";
import { BrandMark, Spinner } from "./BrandMark";
import { ColToggle } from "./ColToggle";
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
  onNewWorktree,
  onOpenProject,
  openCheckouts = [],
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onLogout,
  onOpenSettingsSection,
  collapsed,
  onToggleCollapsed,
  inert: shellInert,
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
  onOpenSettingsSection?: (section?: "mcp" | "plugins" | "skills") => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  inert?: boolean;
}) {
  const { redact } = usePrivacy();
  const openingGate = isOpening;
  const busyGate = isOpening || conn === "busy";
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pref, setPref] = useState(readSidebarPref);
  const projectsOpen = pref.projectsOpen !== false;
  const folderOpen = pref.folders || {};
  const moreOpen = pref.more || {};
  const live = new Set(liveSessionIds);

  const grouped = groupSidebarChats({
    sessions,
    projectOrder: [
      project,
      ...recentProjects.filter((p) => !samePathKey(p, project)),
    ],
  });

  const patchPref = useCallback(
    (next: {
      projectsOpen?: boolean;
      folders?: Record<string, boolean>;
      more?: Record<string, boolean>;
    }) => {
      setPref((prev) => {
        const merged = {
          projectsOpen: next.projectsOpen ?? prev.projectsOpen ?? true,
          folders: next.folders ?? prev.folders ?? {},
          more: next.more ?? prev.more ?? {},
        };
        writeSidebarPref(merged);
        return merged;
      });
    },
    [],
  );
  const [chatMenu, setChatMenu] = useState<{
    x: number;
    y: number;
    session: SessionSummary;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);

  useEffect(() => {
    if (!renamingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingId]);

  useEffect(() => {
    if (!chatMenu && !accountOpen) return;
    const close = () => {
      setChatMenu(null);
      setAccountOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [chatMenu, accountOpen]);

  const startRename = useCallback((s: SessionSummary) => {
    const current = (s.title || "").trim();
    setChatMenu(null);
    setRenamingId(s.id);
    setRenameDraft(
      current === "(no summary)" || current === "新对话" ? "" : current,
    );
  }, []);

  const openChatMenu = useCallback(
    (e: { clientX: number; clientY: number; preventDefault: () => void }, s: SessionSummary) => {
      e.preventDefault();
      const pad = 8;
      const w = 180;
      const h = 88;
      setChatMenu({
        session: s,
        x: Math.min(e.clientX, window.innerWidth - w - pad),
        y: Math.min(e.clientY, window.innerHeight - h - pad),
      });
    },
    [],
  );

  const confirmDelete = useCallback(
    async (s: SessionSummary) => {
      setChatMenu(null);
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
          onContextMenu={(e) => {
            if (!onRenameSession && !onDeleteSession) return;
            e.stopPropagation();
            openChatMenu(e, s);
          }}
        >
          <span className="name">{s.title || "新对话"}</span>
          {opts.live ? <LiveSpin /> : null}
        </button>
        {onRenameSession || onDeleteSession ? (
          <button
            type="button"
            className="session-more-btn"
            title="对话选项"
            aria-label={`选项：${s.title || "对话"}`}
            disabled={renameBusy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openChatMenu(e, s);
            }}
          >
            <span aria-hidden>⋯</span>
          </button>
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

      <div className="sidebar-scroll">
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
            <button
              type="button"
              className="sidebar-section-plus"
              title="打开文件夹"
              onClick={onPickProject}
              disabled={busyGate}
            >
              +
            </button>
          </div>
          {projectsOpen ? (
            <div className="project-folder-list">
              {grouped.projects.length === 0 ? (
                <p className="sidebar-hint">还没有项目。点 + 打开一个文件夹。</p>
              ) : (
                grouped.projects.map((folder) => {
                  const key = pathFolderKey(folder.cwd);
                  const open =
                    folderOpen[key] ??
                    (samePathKey(folder.cwd, project) ||
                      folder.chats.some((c) => live.has(c.id)));
                  const showAll = Boolean(moreOpen[key]);
                  const shown = visibleFolderChats(folder.chats, showAll);
                  return (
                    <div key={key} className="project-folder">
                      <button
                        type="button"
                        className={
                          "project-folder-head" +
                          (samePathKey(folder.cwd, project) ? " is-current" : "")
                        }
                        onClick={() =>
                          patchPref({
                            folders: { ...folderOpen, [key]: !open },
                          })
                        }
                      >
                        <FolderGlyph />
                        <span className="project-folder-name">{folder.name}</span>
                      </button>
                      {open ? (
                        <div className="project-folder-chats">
                          {folder.chats.length === 0 ? (
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
                          {folder.chats.length > shown.length ? (
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
                  );
                })
              )}
            </div>
          ) : null}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-head">
            <h2>最近</h2>
          </div>
          <div className="recent-list session-list">
            {grouped.recent.length === 0 ? (
              <p className="sidebar-hint">还没有聊天。</p>
            ) : (
              grouped.recent.map((s) =>
                renderChatRow(s, { nested: false, live: live.has(s.id) }),
              )
            )}
          </div>
        </div>
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
      {chatMenu ? (
        <div
          className="ctx-menu"
          role="menu"
          style={{ left: chatMenu.x, top: chatMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {onRenameSession ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => startRename(chatMenu.session)}
            >
              Rename
            </button>
          ) : null}
          {onDeleteSession ? (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => void confirmDelete(chatMenu.session)}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
});
