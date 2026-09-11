import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parkedNeedNotice,
  parkedUpdateNotice,
} from "../shared/parked-notice.mjs";

test("parked turn and task completions mark unread", () => {
  assert.deepEqual(
    parkedUpdateNotice({ update: { sessionUpdate: "turn_completed" } }),
    { unread: true, failed: false, needsYou: false, kind: "turn_completed" },
  );
  assert.equal(
    parkedUpdateNotice({ update: { sessionUpdate: "task_failed" } }).failed,
    true,
  );
  assert.equal(
    parkedUpdateNotice({ update: { sessionUpdate: "usage_update" } }),
    null,
  );
  assert.deepEqual(
    parkedUpdateNotice({
      update: { sessionUpdate: "subagent_finished", status: "completed" },
    }),
    {
      unread: true,
      failed: false,
      needsYou: false,
      kind: "subagent_finished",
    },
  );
  assert.equal(
    parkedUpdateNotice({
      update: { sessionUpdate: "subagent_finished", status: "failed" },
    }).failed,
    true,
  );
});

test("permission-like events need the person", () => {
  assert.equal(parkedNeedNotice("permission").needsYou, true);
  assert.equal(parkedNeedNotice("other"), null);
});
