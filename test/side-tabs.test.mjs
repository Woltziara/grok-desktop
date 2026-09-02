import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const url = pathToFileURL(path.resolve("src/lib/side-tabs.ts")).href;
const {
  openSideTab,
  openOrFocusBrowserTab,
  closeSideTab,
  closeOtherSideTabs,
  closeSideTabsToRight,
  SIDE_TABS_MAX,
} = await import(url);

function tab(id, abs) {
  return {
    id,
    kind: "file",
    absPath: abs,
    relPath: abs.split("/").pop(),
    name: id,
  };
}

test("reopening the same path focuses the existing tab", () => {
  const first = openSideTab([], tab("1", "/p/a.md"));
  const again = openSideTab(first.tabs, tab("2", "/p/a.md"));
  assert.equal(again.created, false);
  assert.equal(again.activeId, "1");
  assert.equal(again.tabs.length, 1);
});

test("close moves focus to a neighbor", () => {
  let s = openSideTab([], tab("1", "/p/a.md"));
  s = openSideTab(s.tabs, tab("2", "/p/b.md"));
  const closed = closeSideTab(s.tabs, s.activeId, "2");
  assert.equal(closed.activeId, "1");
  assert.equal(closed.tabs.length, 1);
});

test("preview reuses one browser tab instead of stacking windows", () => {
  const first = openOrFocusBrowserTab([], {
    id: "b1",
    kind: "browser",
    absPath: "side://browser/1",
    relPath: "浏览器",
    name: "浏览器",
    url: "",
  });
  const again = openOrFocusBrowserTab(first.tabs, {
    id: "b2",
    kind: "browser",
    absPath: "side://browser/2",
    relPath: "浏览器",
    name: "浏览器",
    url: "http://127.0.0.1:8899/",
  });
  assert.equal(again.created, false);
  assert.equal(again.tabs.length, 1);
  assert.equal(again.tabs[0].url, "http://127.0.0.1:8899/");
});

test("close others and close right match grok-app policies", () => {
  const tabs = [
    tab("1", "/p/a.md"),
    tab("2", "/p/b.md"),
    tab("3", "/p/c.md"),
  ];
  assert.equal(closeOtherSideTabs(tabs, "2").tabs.length, 1);
  assert.deepEqual(
    closeSideTabsToRight(tabs, "2").tabs.map((t) => t.id),
    ["1", "2"],
  );
  assert.equal(SIDE_TABS_MAX, 12);
});
