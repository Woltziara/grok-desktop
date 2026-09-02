import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_PREP_PROMPT,
  COMPACT_PRESERVE_HINT,
  COMPACT_CATCH_UP_PROMPT,
  MANUAL_COMPACT_REMAINING_PCT,
  shouldCompactAfterPrep,
  shouldSendCatchUpAfterCompact,
  shouldSendCatchUpAfterUserInsert,
} from "../shared/compact-prep-flow.mjs";

test("meter-click compact asks Compact Prep then preserves the capsule", () => {
  assert.equal(COMPACT_PREP_PROMPT, "/compact-prep");
  assert.match(COMPACT_PRESERVE_HINT, /Continuation Capsule/);
  assert.equal(MANUAL_COMPACT_REMAINING_PCT, 25);
});

test("native compact follows prep only when the capsule turn finished", () => {
  assert.equal(shouldCompactAfterPrep({ ok: true, cancelled: false }), true);
  assert.equal(shouldCompactAfterPrep({ ok: false, cancelled: false }), false);
  assert.equal(shouldCompactAfterPrep({ ok: true, cancelled: true }), false);
  assert.equal(shouldCompactAfterPrep({}), false);
});

test("catch-up prompt forces a capsule read and only follows a successful compact", () => {
  assert.match(COMPACT_CATCH_UP_PROMPT, /^Catch up：/);
  assert.match(COMPACT_CATCH_UP_PROMPT, /Continuation Capsule/);
  assert.match(COMPACT_CATCH_UP_PROMPT, /不要重问/);
  assert.equal(shouldSendCatchUpAfterCompact(true), true);
  assert.equal(shouldSendCatchUpAfterCompact(false), false);
  assert.equal(shouldSendCatchUpAfterUserInsert({}), true);
  assert.equal(shouldSendCatchUpAfterUserInsert({ sendNow: { id: "q1" } }), false);
  assert.equal(shouldSendCatchUpAfterUserInsert({ queued: [{ id: "q1" }] }), false);
});
