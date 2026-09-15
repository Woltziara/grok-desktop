import { test } from "node:test";
import assert from "node:assert/strict";
import { isRedundantSessionResume } from "../shared/session-open-policy.mjs";
import { restoreParkedAgent, rollbackLiveAgent } from "../shared/parked-agent.mjs";

test("same-row click is skipped only while that conversation is on screen", () => {
  const base = { currentSessionId: "A", requestedSessionId: "A", sameProject: true, conn: "online", hasVisibleTimeline: true };
  assert.equal(isRedundantSessionResume(base), true);
  assert.equal(isRedundantSessionResume({ ...base, requestedSessionId: "B" }), false);
  assert.equal(isRedundantSessionResume({ ...base, conn: "error" }), false);
  assert.equal(isRedundantSessionResume({ ...base, hasVisibleTimeline: false }), false);
  assert.equal(isRedundantSessionResume({ ...base, conn: "connecting" }), true);
});

test("a failed switch puts the parked conversation back on the window", () => {
  const parked = { sessionId: "A", cwd: "/synthetic" };
  const ws = { agent: null, parkedAgents: new Map([["A", parked]]) };
  assert.equal(restoreParkedAgent(ws, "A"), parked);
  assert.equal(ws.agent, parked);
  assert.equal(ws.parkedAgents.has("A"), false);
  assert.equal(restoreParkedAgent({ agent: { sessionId: "B" }, parkedAgents: new Map([["A", parked]]) }, "A"), null);
});

test("after B is live, a later failure parks B and restores A", () => {
  const agentA = { sessionId: "A", cwd: "/proj", proc: {} };
  const agentB = { sessionId: "B", cwd: "/proj", proc: {} };
  const ws = { agent: agentB, parkedAgents: new Map([["A", agentA]]) };
  assert.equal(rollbackLiveAgent(ws, "A"), agentA);
  assert.equal(ws.agent, agentA);
  assert.equal(ws.parkedAgents.get("B"), agentB);
});
