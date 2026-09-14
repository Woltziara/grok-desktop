import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INTERJECTION_NOTE,
  INTERRUPT_NOTE,
  UNFINISHED_TASKS_REMINDER,
  unwrapUserQueryEnvelope,
} from "../shared/session-timeline.mjs";
import {
  interjectAttempts,
  isSessionInterjectionMethod,
  unwrapSessionInterjection,
} from "../shared/acp-interject.mjs";
import {
  interjectFollowUp,
  promptDeliveryAction,
} from "../shared/prompt-delivery.mjs";
import {
  appendWorkedIfNeeded,
  applySessionUpdate,
  collapseEchoedUserTurns,
} from "../shared/session-timeline.mjs";

test("busy Enter steers; 稍后 queues; ⌘Enter is send-now", () => {
  assert.equal(promptDeliveryAction("auto", true), "interject");
  assert.equal(promptDeliveryAction(undefined, true), "interject");
  assert.equal(promptDeliveryAction("queue", true), "queue");
  assert.equal(promptDeliveryAction("now", true), "send-now");
});

test("interjectAttempts prefer stdio underscore then unprefixed", () => {
  const attempts = interjectAttempts({
    sessionId: "sess-1",
    text: "先改测试",
    interjectionId: "ij-1",
  });
  assert.equal(attempts[0].method, "_x.ai/interject");
  assert.equal(attempts[1].method, "x.ai/interject");
  assert.deepEqual(attempts[0].params, {
    sessionId: "sess-1",
    text: "先改测试",
    interjectionId: "ij-1",
  });
});

test("interjectAttempts omit content on text-only wire", () => {
  const attempts = interjectAttempts({ sessionId: "s", text: "hi" });
  assert.equal("content" in attempts[0].params, false);
});

test("unwrapUserQueryEnvelope strips steer and interrupt wrappers", () => {
  const steered = unwrapUserQueryEnvelope(
    `${INTERJECTION_NOTE}\n<user_query>\n先改测试\n</user_query>\n${UNFINISHED_TASKS_REMINDER}`,
  );
  assert.equal(steered.text, "先改测试");
  assert.equal(steered.marker, "interjection");

  const interrupted = unwrapUserQueryEnvelope(
    `${INTERRUPT_NOTE}\n<user_query>\n改方向\n</user_query>\n${UNFINISHED_TASKS_REMINDER}`,
  );
  assert.equal(interrupted.text, "改方向");
  assert.equal(interrupted.marker, "interrupt");

  const plain = unwrapUserQueryEnvelope("普通一句");
  assert.equal(plain.text, "普通一句");
  assert.equal(plain.marker, null);
});

test("single ACP parser peels interjection ext_notification", () => {
  assert.equal(isSessionInterjectionMethod("x.ai/session/interjection"), true);
  assert.equal(isSessionInterjectionMethod("_x.ai/session/interjection"), true);
  const update = unwrapSessionInterjection("ext_notification", {
    method: "x.ai/session/interjection",
    params: {
      sessionId: "s1",
      text: "补一句",
      interjectionId: "ij-9",
    },
  });
  assert.equal(update?.text, "补一句");
  assert.equal(update?.interjectionId, "ij-9");
  assert.equal(update?.sessionId, "s1");
});

test("delivery only queues explicit unsupported; real errors stay visible", () => {
  assert.equal(promptDeliveryAction("auto", true), "interject");
  assert.equal(promptDeliveryAction("steer", true), "interject");
  assert.equal(promptDeliveryAction("queue", true), "queue");
  assert.equal(promptDeliveryAction("now", true), "send-now");
  assert.equal(promptDeliveryAction("auto", false), "prompt");
  assert.equal(
    interjectFollowUp({ ok: false, reason: "unsupported", interjectionId: "i" }),
    "queue",
  );
  assert.equal(interjectFollowUp(undefined, new Error("session not found")), "error");
});

test("timeline strips persisted steer envelope and keeps a separate bubble", () => {
  const start = [
    { id: "u1", kind: "user", text: "开始做", at: 1 },
    { id: "th", kind: "thought", text: "想", at: 2 },
  ];
  const next = applySessionUpdate(start, {
    update: {
      sessionUpdate: "user_message_chunk",
      content: {
        type: "text",
        text: `${INTERJECTION_NOTE}\n<user_query>\n先改测试\n</user_query>\n${UNFINISHED_TASKS_REMINDER}`,
      },
    },
    _meta: { interjection: true, interjectionId: "ij-2" },
  });
  const users = next.filter((i) => i.kind === "user");
  assert.equal(users.length, 2);
  assert.equal(users[1].text, "先改测试");
  assert.equal(users[1].marker, "interjection");
  assert.equal(users[1].interjectionId, "ij-2");
});

test("timeline dedupes optimistic steer against the broadcast echo", () => {
  const seeded = [
    { id: "u1", kind: "user", text: "开始做", at: 1 },
    {
      id: "ij-2",
      kind: "user",
      text: "先改测试",
      optimistic: true,
      marker: "interjection",
      interjectionId: "ij-2",
      at: 3,
    },
  ];
  const next = applySessionUpdate(seeded, {
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "先改测试" },
    },
    _meta: { interjection: true, interjectionId: "ij-2" },
  });
  const users = next.filter((i) => i.kind === "user");
  assert.equal(users.length, 2);
  assert.equal(users[1].text, "先改测试");
});

test("same-text steer does not fold into the original prompt", () => {
  const folded = collapseEchoedUserTurns([
    { id: "u1", kind: "user", text: "先改测试", at: 1 },
    { id: "th", kind: "thought", text: "", at: 2 },
    {
      id: "ij",
      kind: "user",
      text: "先改测试",
      marker: "interjection",
      interjectionId: "ij-3",
      at: 3,
    },
  ]);
  const users = folded.filter((i) => i.kind === "user");
  assert.equal(users.length, 2);
});

test("Worked for measures from the original prompt, not a mid-turn steer", () => {
  const items = [
    { id: "u1", kind: "user", text: "开始做", at: 1000 },
    { id: "th", kind: "thought", text: "想", at: 1500 },
    {
      id: "ij",
      kind: "user",
      text: "补一句",
      marker: "interjection",
      at: 8000,
    },
  ];
  const next = appendWorkedIfNeeded(items, 9000);
  const worked = next[next.length - 1];
  assert.equal(worked.kind, "worked");
  assert.equal(worked.elapsedMs, 8000);
});
