import assert from "node:assert/strict";
import { test } from "node:test";
import { applySessionUpdate } from "../shared/session-timeline.mjs";
import {
  beginOpen,
  bindOpenSession,
  commitOpenTimeline,
  createOpenGate,
  drainOpenTimeline,
  enqueueLiveUpdate,
  finishOpen,
  replayLiveOntoHistory,
} from "../shared/open-timeline.mjs";

function chunk(sessionId, text, seq) {
  const ev = {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  };
  if (seq != null) ev._desktopSeq = seq;
  return ev;
}

test("history commit after a live tail keeps the new last message", () => {
  const gate = createOpenGate();
  const gen = beginOpen(gate, "S");
  bindOpenSession(gate, "S");
  assert.equal(enqueueLiveUpdate(gate, chunk("S", "LIVE_TAIL")), "buffer");

  const before = applySessionUpdate(
    [{ id: "h", kind: "assistant", text: "SAVED_HISTORY", at: 1 }],
    chunk("S", "LIVE_TAIL"),
  );
  assert.equal(
    before.filter((i) => i.kind === "assistant").at(-1)?.text.includes("LIVE_TAIL"),
    true,
  );

  const wiped = [
    { id: "banner", kind: "system", text: "banner", at: 0 },
    { id: "h", kind: "assistant", text: "SAVED_HISTORY", at: 1 },
  ];
  assert.equal(
    wiped.some((i) => String(i.text || "").includes("LIVE_TAIL")),
    false,
  );

  const committed = commitOpenTimeline(gate, {
    banner: { id: "banner", kind: "system", text: "banner", at: 0 },
    history: [{ id: "h", kind: "assistant", text: "SAVED_HISTORY", at: 1 }],
    gen,
  });
  const assistants = committed.items.filter((i) => i.kind === "assistant");
  assert.equal(assistants.at(-1)?.text.includes("LIVE_TAIL"), true);
  assert.equal(assistants.at(-1)?.text.includes("SAVED_HISTORY"), true);
});

test("late events from another session are not replayed", () => {
  const gate = createOpenGate();
  const gen = beginOpen(gate, "S");
  assert.equal(enqueueLiveUpdate(gate, chunk("OTHER", "NOPE")), "stale");
  assert.equal(enqueueLiveUpdate(gate, chunk("S", "KEEP")), "buffer");
  const committed = commitOpenTimeline(gate, {
    banner: { id: "b", kind: "system", text: "b", at: 0 },
    history: [],
    gen,
  });
  const text = committed.items.map((i) => i.text).join("\n");
  assert.match(text, /KEEP/);
  assert.equal(text.includes("NOPE"), false);
});

test("snapshot boundary uses seq, not matching text", () => {
  const history = [{ id: "h", kind: "assistant", text: "AB", at: 1 }];
  const items = replayLiveOntoHistory(
    { id: "b", kind: "system", text: "b", at: 0 },
    history,
    [chunk("S", "A", 1), chunk("S", "B", 2), chunk("S", "C", 3)],
    "S",
    2,
  );
  const last = items.filter((i) => i.kind === "assistant").at(-1);
  assert.equal(last.text, "ABC");
});

test("same seq is not applied twice", () => {
  const items = replayLiveOntoHistory(
    { id: "b", kind: "system", text: "b", at: 0 },
    [],
    [chunk("S", "哈", 8), chunk("S", "哈", 8)],
    "S",
    0,
  );
  const last = items.filter((i) => i.kind === "assistant").at(-1);
  assert.equal(last.text, "哈");
});

test("events after history drain still attach when opening finishes", () => {
  const gate = createOpenGate();
  const gen = beginOpen(gate, "S");
  enqueueLiveUpdate(gate, chunk("S", "LIVE_TAIL"));
  const drained = drainOpenTimeline(gate, {
    banner: { id: "b", kind: "system", text: "b", at: 0 },
    history: [{ id: "h", kind: "assistant", text: "SAVED_HISTORY", at: 1 }],
    gen,
  });
  assert.equal(gate.opening, true);
  enqueueLiveUpdate(gate, chunk("S", " AFTER"));
  const extra = finishOpen(gate, gen);
  assert.equal(gate.opening, false);
  const items = replayLiveOntoHistory(
    drained.items[0],
    drained.items.slice(1),
    extra,
    "S",
  );
  const last = items.filter((i) => i.kind === "assistant").at(-1);
  assert.match(last.text, /LIVE_TAIL/);
  assert.match(last.text, /AFTER/);
});

test("stale open generation does not replace a newer hydrate", () => {
  const gate = createOpenGate();
  const first = beginOpen(gate, "A");
  beginOpen(gate, "B");
  enqueueLiveUpdate(gate, chunk("B", "B_LIVE"));
  const stale = commitOpenTimeline(gate, {
    banner: { id: "b", kind: "system", text: "old", at: 0 },
    history: [{ id: "h", kind: "assistant", text: "A_HISTORY", at: 1 }],
    gen: first,
  });
  assert.equal(stale, null);
});
