import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineItem } from "../../vite-env";
import { collectSessionArtifacts } from "../../lib/session-artifacts.ts";
import {
  closeOtherSideTabs,
  closeSideTab,
  closeSideTabsToLeft,
  closeSideTabsToRight,
  openOrFocusBrowserTab,
  openSideTab,
  type SideFileTab,
} from "../../lib/side-tabs.ts";
import { artifactKindFromPath, isTryableArtifact } from "../../lib/session-artifacts.ts";
import type { SidePickerKind } from "./SidePicker";
import { FilesToolbar } from "./FilesToolbar";
import { PreviewBody } from "./PreviewBody";
import { SideTabBar } from "./SideTabBar";

let tabSeq = 0;
function nextTabId(): string {
  tabSeq += 1;
  return `file-${tabSeq}`;
}

export const SideWorkbench = memo(function SideWorkbench({
  project,
  sessionId,
  items,
  collapsed,
  expanded,
  onToggleCollapsed,
  onExpand,
  onSidePrompt,
  inert: shellInert,
  browserOpen = null,
}: {
  project: string | null;
  sessionId?: string | null;
  items: TimelineItem[];
  collapsed: boolean;
  expanded: boolean;
  onToggleCollapsed: () => void;
  onExpand: () => void;
  onSidePrompt?: (text: string) => void;
  inert?: boolean;
  browserOpen?: { seq: number; url?: string } | null;
}) {
  const artifacts = useMemo(
    () => collectSessionArtifacts(items, project),
    [items, project],
  );
  const artifactSig = artifacts.map((a) => `${a.absPath}:${a.at}`).join("\n");
  const [tabs, setTabs] = useState<SideFileTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewHref, setPreviewHref] = useState<string | null>(null);
  const [fileUpdated, setFileUpdated] = useState<string | null>(null);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const seenWriteRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setTabs([]);
    setActiveId(null);
  }, [project, sessionId]);

  useEffect(() => {
    if (!artifacts.length) return;
    let lastTryable: string | null = null;
    let changed = false;
    setTabs((prev) => {
      let next = prev;
      lastTryable = null;
      changed = false;
      for (const art of artifacts) {
        const opened = openSideTab(next, {
          id: nextTabId(),
          kind: "file",
          absPath: art.absPath,
          relPath: art.relPath,
          name: art.name,
        });
        if (opened.created) {
          next = opened.tabs;
          changed = true;
          if (isTryableArtifact(art.kind)) lastTryable = opened.activeId;
        }
      }
      return changed ? next : prev;
    });
    if (lastTryable) setActiveId(lastTryable);
    for (const art of artifacts) {
      const prev = seenWriteRef.current[art.absPath];
      if (prev && art.at > prev) setFileUpdated(art.absPath);
      seenWriteRef.current[art.absPath] = art.at;
    }
  }, [artifactSig]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[tabs.length - 1] ?? null;
  const activeKind = active ? artifactKindFromPath(active.absPath) : null;

  useEffect(() => {
    if (
      !active ||
      (activeKind !== "html" && activeKind !== "image" && activeKind !== "pdf")
    ) {
      setPreviewHref(null);
      return;
    }
    let cancelled = false;
    void window.grokDesktop
      .artifactPreview(active.absPath)
      .then((r) => {
        if (!cancelled) setPreviewHref(r.href);
      })
      .catch(() => {
        if (!cancelled) setPreviewHref(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active?.absPath, activeKind]);

  const apply = useCallback(
    (next: { tabs: SideFileTab[]; activeId: string | null }) => {
      setTabs(next.tabs);
      setActiveId(next.activeId);
    },
    [],
  );

  const openPicked = useCallback((tab: SideFileTab) => {
    setTabs((prev) => {
      const opened = openSideTab(prev, tab);
      setActiveId(opened.activeId);
      return opened.tabs;
    });
  }, []);

  const onPickNew = useCallback(
    async (kind: SidePickerKind) => {
      if (kind === "chat") {
        openPicked({
          id: "side-chat",
          kind: "chat",
          absPath: "side://chat",
          relPath: "侧边聊天",
          name: "侧边聊天",
        });
        return;
      }
      if (kind === "browser") {
        setTabs((prev) => {
          const opened = openOrFocusBrowserTab(prev, {
            id: nextTabId(),
            kind: "browser",
            absPath: `side://browser/${tabSeq}`,
            relPath: "浏览器",
            name: "浏览器",
            url: "",
          });
          setActiveId(opened.activeId);
          return opened.tabs;
        });
        return;
      }
      const picked = await window.grokDesktop.pickFile();
      if (!picked) return;
      const rel = project
        ? picked.replace(/\\/g, "/").startsWith(project.replace(/\\/g, "/") + "/")
          ? picked.replace(/\\/g, "/").slice(project.replace(/\\/g, "/").length + 1)
          : picked.replace(/\\/g, "/").split("/").pop() || picked
        : picked.replace(/\\/g, "/").split("/").pop() || picked;
      openPicked({
        id: nextTabId(),
        kind: "file",
        absPath: picked,
        relPath: rel,
        name: rel.split("/").pop() || rel,
      });
    },
    [openPicked, project],
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const absPath = String(
        (event as CustomEvent<{ absPath?: string }>).detail?.absPath || "",
      ).trim();
      if (!absPath || !project) return;
      onExpand();
      const rel = absPath.replace(/\\/g, "/").startsWith(project.replace(/\\/g, "/") + "/")
        ? absPath.replace(/\\/g, "/").slice(project.replace(/\\/g, "/").length + 1)
        : absPath.replace(/\\/g, "/").split("/").pop() || absPath;
      openPicked({
        id: nextTabId(),
        kind: "file",
        absPath:
          absPath.startsWith("/") || /^[A-Za-z]:/.test(absPath)
            ? absPath
            : `${project.replace(/[/\\]+$/, "")}/${absPath.replace(/^[/\\]+/, "")}`,
        relPath: rel,
        name: rel.split("/").pop() || rel,
      });
    };
    window.addEventListener("grok-open-artifact", onOpen as EventListener);
    return () =>
      window.removeEventListener("grok-open-artifact", onOpen as EventListener);
  }, [onExpand, openPicked, project]);

  useEffect(() => {
    if (!browserOpen) return;
    const url = String(browserOpen.url || "").trim();
    setTabs((prev) => {
      const opened = openOrFocusBrowserTab(prev, {
        id: nextTabId(),
        kind: "browser",
        absPath: `side://browser/${tabSeq}`,
        relPath: "浏览器",
        name: "浏览器",
        url,
      });
      setActiveId(opened.activeId);
      return opened.tabs;
    });
  }, [browserOpen?.seq]);

  useEffect(() => {
    if (collapsed) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void onPickNew("file");
      } else if (e.altKey && !meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onPickNew("chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, onPickNew]);

  if (collapsed) {
    return (
      <aside className="panel artifact-panel panel--collapsed" inert={shellInert || undefined} />
    );
  }

  return (
    <aside
      className="panel sw-workbench"
      inert={shellInert || undefined}
    >
      <SideTabBar
        tabs={tabs}
        activeId={active?.id ?? null}
        onActivate={setActiveId}
        onCloseTab={(id) => apply(closeSideTab(tabs, activeId, id))}
        onCloseOtherTabs={(id) => apply(closeOtherSideTabs(tabs, id))}
        onCloseAllTabs={() => apply({ tabs: [], activeId: null })}
        onCloseTabsToLeft={(id) => apply(closeSideTabsToLeft(tabs, id))}
        onCloseTabsToRight={(id) => apply(closeSideTabsToRight(tabs, id))}
        onExpand={onExpand}
        onToggleSide={onToggleCollapsed}
        expanded={expanded}
        onPickNew={(kind) => void onPickNew(kind)}
      />
      <FilesToolbar
        projectName={project ? project.replace(/\\/g, "/").split("/").filter(Boolean).pop() : null}
        relPath={active?.relPath}
        canPopOut={Boolean(previewHref)}
        onPopOut={
          previewHref
            ? () => void window.grokDesktop.openPreview(previewHref)
            : undefined
        }
      />
      <div className="sw-body">
        {fileUpdated && active && fileUpdated === active.absPath ? (
          <div className="file-updated-banner">
            这份文件有更新
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={() => {
                setFileUpdated(null);
                setPreviewEpoch((n) => n + 1);
              }}
            >
              刷新
            </button>
          </div>
        ) : null}
        <PreviewBody
          key={`${active?.id || "none"}:${previewEpoch}`}
          tab={active}
          project={project}
          onSidePrompt={onSidePrompt}
        />
      </div>
    </aside>
  );
});
