import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAR_FROM_BOTTOM_PX,
  NEAR_BOTTOM_PX,
  TAIL_PX,
  distanceFromBottom,
  isNearBottom,
  shouldHonorScrollPosition,
  stickAfterScroll,
  wheelWantsEarlierContent,
} from "../shared/stick-to-bottom.mjs";

test("distanceFromBottom is remaining px under the fold", () => {
  assert.equal(distanceFromBottom(1000, 800, 200), 0);
  assert.equal(distanceFromBottom(1000, 700, 200), 100);
});

test("near-bottom band is tight so a short flick unpins", () => {
  assert.equal(isNearBottom(0), true);
  assert.equal(isNearBottom(NEAR_BOTTOM_PX), true);
  assert.equal(isNearBottom(NEAR_BOTTOM_PX + 1), false);
});

test("wheel toward earlier content unpins", () => {
  assert.equal(wheelWantsEarlierContent(-12), true);
  assert.equal(wheelWantsEarlierContent(12), false);
  assert.equal(wheelWantsEarlierContent(0), false);
});

test("programmatic stick writes do not unlock while still at the tail", () => {
  assert.equal(shouldHonorScrollPosition(2, 0), false);
  assert.equal(shouldHonorScrollPosition(2, NEAR_BOTTOM_PX), false);
});

test("user leaving the tail is honored even during programmatic ignore", () => {
  assert.equal(shouldHonorScrollPosition(2, FAR_FROM_BOTTOM_PX + 1), true);
  assert.equal(shouldHonorScrollPosition(0, 10), true);
});

test("unpin stays unpinned in the near-bottom band until the real tail", () => {
  assert.equal(stickAfterScroll(true, 0), true);
  assert.equal(stickAfterScroll(true, NEAR_BOTTOM_PX), true);
  assert.equal(stickAfterScroll(true, NEAR_BOTTOM_PX + 1), false);
  assert.equal(stickAfterScroll(false, 20), false);
  assert.equal(stickAfterScroll(false, TAIL_PX), true);
  assert.equal(stickAfterScroll(false, 0), true);
});
