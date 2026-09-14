import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INTERJECT_UNSUPPORTED_REASON,
  interjectAcceptedResult,
  interjectAttempts,
  interjectFromAttemptErrors,
  interjectRequestParams,
  interjectUnsupportedResult,
  isInterjectMethodMissing,
  mapInterjectIpcError,
  unwrapSessionInterjection,
} from "../shared/acp-interject.mjs";

test("text-only interject omits content and tries stdio method first", () => {
  const attempts = interjectAttempts({
    sessionId: "s1",
    text: "steer",
    interjectionId: "i1",
  });
  assert.equal(attempts[0].method, "_x.ai/interject");
  assert.equal(attempts[1].method, "x.ai/interject");
  assert.deepEqual(attempts[0].params, {
    sessionId: "s1",
    text: "steer",
    interjectionId: "i1",
  });
});

test("image interject builds ordered text and image content", () => {
  const params = interjectRequestParams({
    sessionId: "s1",
    text: "look",
    interjectionId: "i2",
    images: [{ data: "abc", mimeType: "image/jpeg" }, { data: "" }],
  });
  assert.deepEqual(params.content, [
    { type: "text", text: "look" },
    { type: "image", data: "abc", mimeType: "image/jpeg" },
  ]);
});

test("only method-missing becomes structured unsupported", () => {
  const miss = Object.assign(new Error("Method not found"), { code: -32601 });
  assert.equal(isInterjectMethodMissing(miss), true);
  assert.equal(INTERJECT_UNSUPPORTED_REASON, "unsupported");
  assert.deepEqual(interjectFromAttemptErrors([miss, miss], "i3"), {
    ok: false,
    reason: "unsupported",
    interjectionId: "i3",
  });
  assert.throws(
    () => interjectFromAttemptErrors([miss, new Error("session not found")], "i3"),
    /session not found/,
  );
  assert.deepEqual(
    mapInterjectIpcError(new Error("Mid-turn interject is not available"), "i4"),
    interjectUnsupportedResult("i4"),
  );
  assert.equal(mapInterjectIpcError(new Error("Method not found"), "i4"), null);
});

test("accepted result allowlists fields and cannot be overwritten", () => {
  assert.deepEqual(interjectAcceptedResult("i5", "queued"), {
    ok: true,
    status: "queued",
    interjectionId: "i5",
  });
});

test("session interjection unwraps direct and ext_notification forms", () => {
  assert.deepEqual(
    unwrapSessionInterjection("_x.ai/session/interjection", {
      sessionId: "s1",
      text: "one",
      interjectionId: "i1",
    }),
    { sessionId: "s1", text: "one", interjectionId: "i1" },
  );
  assert.deepEqual(
    unwrapSessionInterjection("ext_notification", {
      method: "x.ai/session/interjection",
      params: { session_id: "s2", text: "two", interjection_id: "i2" },
    }),
    { sessionId: "s2", text: "two", interjectionId: "i2" },
  );
  assert.equal(unwrapSessionInterjection("session/update", { update: {} }), null);
});
