import assert from "node:assert/strict";
import { test } from "node:test";
import Fuse from "fuse.js";
import {
  normalizeSearchText,
  searchByTitle,
  snippetAround,
} from "../shared/title-search.mjs";

test("fuse.js is the real search library, not an empty stub", () => {
  const fuse = new Fuse([{ title: "Session resume flow" }], { keys: ["title"] });
  assert.equal(typeof fuse.search, "function");
  assert.ok(fuse.search("resum").length >= 1);
});

test("Chinese titles match by substring and keep a snippet", () => {
  const items = [
    { title: "客户责任对齐", cwd: "/p/a" },
    { title: "周报草稿", cwd: "/p/b" },
    { title: "Grok Desktop 加号", cwd: "/p/c" },
  ];
  const hits = searchByTitle(items, "责任", { keys: ["title"] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].item.title, "客户责任对齐");
  assert.match(hits[0].snippet, /责任/);
});

test("Latin fuzzy still finds a near title", () => {
  const items = [{ title: "Session resume flow" }, { title: " unrelated " }];
  const hits = searchByTitle(items, "resum", { keys: ["title"] });
  assert.ok(hits.some((h) => h.item.title === "Session resume flow"));
});

test("snippetAround clips around the hit", () => {
  const s = snippetAround("一二三四五六七八九十责任对齐甲乙丙丁", "责任", 4);
  assert.match(s, /责任/);
  assert.ok(s.length < 40);
});

test("empty query returns the original list", () => {
  const items = [{ title: "A" }, { title: "B" }];
  assert.equal(searchByTitle(items, "  ", { keys: ["title"] }).length, 2);
  assert.equal(normalizeSearchText("  Foo  BAR "), "foo bar");
});
