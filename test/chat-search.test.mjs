import assert from "node:assert/strict";
import { test } from "node:test";
import { questionIndex, searchTimeline } from "../shared/chat-search.mjs";

test("conversation search hits the sentence and lists questions", () => {
  const items = [
    { id: "u1", kind: "user", text: "请整理客户责任" },
    { id: "a1", kind: "assistant", text: "责任在甲方，验收在下周。" },
    { id: "t1", kind: "tool", text: "ignore me" },
    { id: "u2", kind: "user", text: "再看一眼时间" },
  ];
  const hits = searchTimeline(items, "甲方");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "a1");
  assert.match(hits[0].snippet, /甲方/);
  const qs = questionIndex(items);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].id, "u1");
  assert.equal(qs[1].n, 2);
});

test("multiple hits in one reply get distinct keys", () => {
  const items = [
    { id: "a1", kind: "assistant", text: "Wiki here, and Wiki there" },
  ];
  const hits = searchTimeline(items, "Wiki");
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, hits[1].id);
  assert.notEqual(hits[0].key, hits[1].key);
  assert.equal(hits[0].nth, 1);
  assert.equal(hits[1].nth, 2);
});
