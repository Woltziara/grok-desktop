import assert from "node:assert/strict";
import { test } from "node:test";
import { splitHighlight } from "../shared/highlight-text.mjs";

test("splitHighlight marks every occurrence", () => {
  const parts = splitHighlight("责任在甲方，还是甲方验收", "甲方");
  const hits = parts.filter((p) => p.hit);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].text, "甲方");
});

test("empty query returns the original text", () => {
  const parts = splitHighlight("hello", "");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].hit, false);
});

test("collapsed whitespace does not shift the highlighted range", () => {
  const parts = splitHighlight("alpha   beta Wiki", "Wiki");
  const hits = parts.filter((p) => p.hit);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, "Wiki");
});
