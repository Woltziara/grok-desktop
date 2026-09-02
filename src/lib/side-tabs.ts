/**
 * File-tab open/close policies — structure from RongleCat/grok-app (MIT)
 * resourceTabs / useResourceFileTabs, slimmed for this shell.
 */

export const SIDE_TABS_MAX = 12;

export type SideTabKind = "file" | "browser" | "chat";

export type SideFileTab = {
  id: string;
  kind: SideTabKind;
  absPath: string;
  relPath: string;
  name: string;
  url?: string;
};

function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function tabsEqualPath(a: SideFileTab, absPath: string): boolean {
  return norm(a.absPath) === norm(absPath);
}

export function openOrFocusBrowserTab(
  tabs: SideFileTab[],
  next: SideFileTab,
): { tabs: SideFileTab[]; activeId: string; created: boolean } {
  const existing = tabs.find((t) => (t.kind || "file") === "browser");
  if (existing) {
    const url = typeof next.url === "string" ? next.url : existing.url;
    const out = tabs.map((t) =>
      t.id === existing.id
        ? {
            ...t,
            url,
            name: next.name || t.name,
            relPath: next.relPath || t.relPath,
          }
        : t,
    );
    return { tabs: out, activeId: existing.id, created: false };
  }
  return openSideTab(tabs, { ...next, kind: "browser" });
}

export function openSideTab(
  tabs: SideFileTab[],
  next: SideFileTab,
): { tabs: SideFileTab[]; activeId: string; created: boolean } {
  const kind = next.kind || "file";
  const existing = tabs.find((t) => {
    const k = t.kind || "file";
    if (k !== kind) return false;
    if (kind === "chat") return true;
    if (kind === "browser") return false;
    return tabsEqualPath(t, next.absPath);
  });
  if (existing) {
    return { tabs, activeId: existing.id, created: false };
  }
  let out = [...tabs, next];
  if (out.length > SIDE_TABS_MAX) {
    out = out.slice(out.length - SIDE_TABS_MAX);
  }
  return { tabs: out, activeId: next.id, created: true };
}

export function closeSideTab(
  tabs: SideFileTab[],
  activeId: string | null,
  id: string,
): { tabs: SideFileTab[]; activeId: string | null } {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return { tabs, activeId };
  const out = tabs.filter((t) => t.id !== id);
  if (activeId !== id) return { tabs: out, activeId };
  const neighbor = out[i] || out[i - 1] || null;
  return { tabs: out, activeId: neighbor?.id ?? null };
}

export function closeOtherSideTabs(
  tabs: SideFileTab[],
  id: string,
): { tabs: SideFileTab[]; activeId: string | null } {
  const keep = tabs.find((t) => t.id === id);
  if (!keep) return { tabs, activeId: id };
  return { tabs: [keep], activeId: id };
}

export function closeSideTabsToRight(
  tabs: SideFileTab[],
  id: string,
): { tabs: SideFileTab[]; activeId: string | null } {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return { tabs, activeId: id };
  return { tabs: tabs.slice(0, i + 1), activeId: id };
}

export function closeSideTabsToLeft(
  tabs: SideFileTab[],
  id: string,
): { tabs: SideFileTab[]; activeId: string | null } {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return { tabs, activeId: id };
  return { tabs: tabs.slice(i), activeId: id };
}

export function sideTabNeighborFlags(
  tabs: SideFileTab[],
  id: string,
): { hasOthers: boolean; hasLeft: boolean; hasRight: boolean } {
  const i = tabs.findIndex((t) => t.id === id);
  return {
    hasOthers: tabs.length > 1,
    hasLeft: i > 0,
    hasRight: i >= 0 && i < tabs.length - 1,
  };
}

export function isSideTabMiddleClick(e: { button: number }): boolean {
  return e.button === 1;
}
