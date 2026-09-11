import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canApplyReadingRestore,
  shouldSaveReadingPosition,
} from "../shared/reading-restore.mjs";

test("does not apply a saved position onto an empty timeline", () => {
  assert.equal(canApplyReadingRestore(800, 40, 400), false);
  assert.equal(canApplyReadingRestore(800, 1200, 400), true);
});

test("does not overwrite a pending restore with scrollTop 0", () => {
  assert.equal(
    shouldSaveReadingPosition({
      pendingRestore: true,
      scrollTop: 0,
    }),
    false,
  );
  assert.equal(
    shouldSaveReadingPosition({
      opening: true,
      scrollTop: 40,
    }),
    false,
  );
  assert.equal(
    shouldSaveReadingPosition({ scrollTop: 120 }),
    true,
  );
});
