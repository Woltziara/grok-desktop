/**
 * Side workbench tab strip — structure from RongleCat/grok-app SideTabBar (MIT).
 * [ tabs… ]  ·········  [ expand ] [ side ]
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { disambiguateFileTabLabels } from "../../lib/file-tab-chip-label.ts";
import {
  isSideTabMiddleClick,
  sideTabNeighborFlags,
  type SideFileTab,
} from "../../lib/side-tabs.ts";
import { SidePicker, type SidePickerKind } from "./SidePicker";

export function SideTabBar({
  tabs,
  activeId,
  onActivate,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onExpand,
  onToggleSide,
  expanded,
  onPickNew,
}: {
  tabs: SideFileTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToLeft: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  onExpand: () => void;
  onToggleSide: () => void;
  expanded: boolean;
  onPickNew: (kind: SidePickerKind) => void;
}) {
  const labels = useMemo(
    () =>
      disambiguateFileTabLabels(
        tabs.map((t) => ({ id: t.id, path: t.relPath, name: t.name })),
      ),
    [tabs],
  );
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    tab: SideFileTab;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);

  const openMenu = (e: ReactMouseEvent, tab: SideFileTab) => {
    e.preventDefault();
    e.stopPropagation();
    onActivate(tab.id);
    setMenu({ x: e.clientX, y: e.clientY, tab });
  };

  const flags = menu ? sideTabNeighborFlags(tabs, menu.tab.id) : null;

  useEffect(() => {
    if (!menu && !plusOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menu && !menuRef.current?.contains(t)) setMenu(null);
      if (
        plusOpen &&
        !pickerRef.current?.contains(t) &&
        !plusRef.current?.contains(t)
      ) {
        setPlusOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu, plusOpen]);

  return (
    <div className="sw-chrome">
      <div className="sw-tabs-cluster">
        <div className="sw-tabs__scroll" role="tablist" aria-label="打开的文件">
          {tabs.length === 0 ? (
            <span className="sw-tabs__hint">这次生成的文件会开在这里</span>
          ) : (
            tabs.map((tab) => {
              const active = tab.id === activeId;
              const label = labels.get(tab.id) || tab.name;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={tab.relPath}
                  className={"sw-tab" + (active ? " is-active" : "")}
                  onClick={() => onActivate(tab.id)}
                  onAuxClick={(e) => {
                    if (!isSideTabMiddleClick(e)) return;
                    e.preventDefault();
                    onCloseTab(tab.id);
                  }}
                  onContextMenu={(e) => openMenu(e, tab)}
                >
                  <span className="sw-tab__name">{label}</span>
                  <span
                    className="sw-tab__x"
                    title="关闭"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                  >
                    ×
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="sw-plus-wrap">
          <button
            ref={plusRef}
            type="button"
            className={"sw-plus" + (plusOpen ? " is-on" : "")}
            title="打开"
            aria-label="打开"
            aria-expanded={plusOpen}
            onClick={() => setPlusOpen((v) => !v)}
          >
            +
          </button>
          {plusOpen ? (
            <div ref={pickerRef} className="sw-plus-menu">
              <SidePicker
                onPick={(kind) => {
                  setPlusOpen(false);
                  onPickNew(kind);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="sw-chrome__drag" aria-hidden />
      <div className="sw-chrome__actions">
        <button
          type="button"
          className={"sw-icon-btn" + (expanded ? " is-on" : "")}
          title="加宽这一栏"
          aria-label="加宽这一栏"
          aria-pressed={expanded}
          onClick={onExpand}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M2 5V2h3M9 2h3v3M12 9v3H9M5 12H2V9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="sw-icon-btn is-on sw-icon-btn--pill"
          title="收起侧栏"
          aria-label="收起侧栏"
          onClick={onToggleSide}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <rect
              x="1.5"
              y="2.5"
              width="11"
              height="9"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path d="M8.5 2.5v9" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
      {menu ? (
        <div
          ref={menuRef}
          className="sw-tab-menu"
          style={{ position: "fixed", left: menu.x, top: menu.y }}
          onMouseLeave={() => setMenu(null)}
        >
          <button type="button" onClick={() => { onCloseTab(menu.tab.id); setMenu(null); }}>
            关闭
          </button>
          <button
            type="button"
            disabled={!flags?.hasOthers}
            onClick={() => { onCloseOtherTabs(menu.tab.id); setMenu(null); }}
          >
            关闭其他
          </button>
          <button
            type="button"
            disabled={!flags?.hasRight}
            onClick={() => { onCloseTabsToRight(menu.tab.id); setMenu(null); }}
          >
            关闭右侧
          </button>
          <button
            type="button"
            disabled={!flags?.hasLeft}
            onClick={() => { onCloseTabsToLeft(menu.tab.id); setMenu(null); }}
          >
            关闭左侧
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => { onCloseAllTabs(); setMenu(null); }}
          >
            全部关闭
          </button>
        </div>
      ) : null}
    </div>
  );
}
