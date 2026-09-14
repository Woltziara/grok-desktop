import assert from "node:assert/strict";
import { test } from "node:test";
import {
  latestUserTurnId,
  scrollTopToAlignStart,
  shouldRevealTurnOnReturn,
  timelineGrewSince,
} from "../shared/reveal-turn.mjs";

test("aligns the element top to the scroller top with padding", () => {
  assert.equal(scrollTopToAlignStart(200, 500, 80, 12), 608);
  assert.equal(scrollTopToAlignStart(0, 80, 80, 12), 0);
});

test("latest user turn is the last user item", () => {
  assert.equal(latestUserTurnId([]), null);
  assert.equal(
    latestUserTurnId([
      { id: "u1", kind: "user" },
      { id: "a1", kind: "assistant" },
      { id: "u2", kind: "user" },
      { id: "t1", kind: "thought" },
    ]),
    "u2",
  );
});

test("timeline grew only when the tail id or length changed", () => {
  const items = [
    { id: "u1", kind: "user" },
    { id: "a1", kind: "assistant" },
  ];
  assert.equal(timelineGrewSince(null, items), false);
  assert.equal(
    timelineGrewSince({ lastId: "a1", length: 2 }, items),
    false,
  );
  assert.equal(
    timelineGrewSince({ lastId: "a1", length: 2 }, [
      ...items,
      { id: "u2", kind: "user" },
    ]),
    true,
  );
});

test("return jumps down only when the new turn is still below the view", () => {
  assert.equal(shouldRevealTurnOnReturn(500, 80), true);
  assert.equal(shouldRevealTurnOnReturn(80, 80), false);
  assert.equal(shouldRevealTurnOnReturn(40, 80), false);
});
