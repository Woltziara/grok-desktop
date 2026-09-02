import { test } from "node:test";
import assert from "node:assert/strict";
import {
  userPromptIndexOf,
  dropUserPromptExecIndex,
  cutIndexBeforeUserId,
  userPromptIndexAtOrBefore,
  lastUserPromptIndex,
  shouldRewindFork,
} from "../shared/edit-user-message.mjs";
import {
  parseForkSessionId,
  sessionForkAttempts,
} from "../shared/acp-rpc.mjs";
import {
  rewindExecuteAttempts,
  rewindExecuteRequestParams,
} from "../shared/acp-rpc.mjs";

test("dropUserPromptExecIndex keeps the previous prompt", () => {
  assert.equal(dropUserPromptExecIndex(-1), null);
  assert.equal(dropUserPromptExecIndex(0), 0);
  assert.equal(dropUserPromptExecIndex(1), 0);
  assert.equal(dropUserPromptExecIndex(3), 2);
});

test("userPromptIndexOf counts only user bubbles", () => {
  const items = [
    { id: "u1", kind: "user" },
    { id: "a1", kind: "assistant" },
    { id: "u2", kind: "user" },
  ];
  assert.equal(userPromptIndexOf(items, "u1"), 0);
  assert.equal(userPromptIndexOf(items, "u2"), 1);
  assert.equal(userPromptIndexOf(items, "a1"), -1);
  assert.equal(cutIndexBeforeUserId(items, "u2"), 2);
  assert.equal(cutIndexBeforeUserId(items, "missing"), 3);
});

test("assistant branch point is the user prompt at or before it", () => {
  const items = [
    { id: "u1", kind: "user" },
    { id: "a1", kind: "assistant" },
    { id: "u2", kind: "user" },
    { id: "a2", kind: "assistant" },
  ];
  assert.equal(userPromptIndexAtOrBefore(items, "a1"), 0);
  assert.equal(userPromptIndexAtOrBefore(items, "a2"), 1);
  assert.equal(lastUserPromptIndex(items), 1);
  assert.equal(shouldRewindFork(0, 1), true);
  assert.equal(shouldRewindFork(1, 1), false);
});

test("parseForkSessionId requires a new id", () => {
  assert.equal(parseForkSessionId({ sessionId: "b" }, "a"), "b");
  assert.equal(parseForkSessionId({ newSessionId: "b" }, "a"), "b");
  assert.equal(parseForkSessionId({ result: { sessionId: "b" } }, "a"), "b");
  assert.equal(parseForkSessionId({ sessionId: "a" }, "a"), "");
  const attempts = sessionForkAttempts({ sessionId: "a", cwd: "/p" });
  assert.equal(attempts[0].method, "session/fork");
});

test("rewindExecuteAttempts uses stdio ext methods", () => {
  const params = rewindExecuteRequestParams("sess-1", 2, false);
  assert.equal(params.sessionId, "sess-1");
  assert.equal(params.targetPromptIndex, 2);
  assert.equal(params.restoreFiles, false);
  assert.equal("target_prompt_index" in params, false);
  assert.equal("restore_files" in params, false);
  const attempts = rewindExecuteAttempts("sess-1", 2);
  assert.equal(attempts[0].method, "_x.ai/rewind/execute");
  assert.equal(attempts[1].method, "x.ai/rewind/execute");
});
