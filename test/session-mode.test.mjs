import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALREADY_IN_PLAN_NOTICE,
  currentModeIdFromUpdate,
  isPlanMode,
  looksLikePlanQuestion,
  planSlashAction,
  planSlashDisplay,
  rememberSessionMode,
  setSessionModeParams,
} from "../shared/session-mode.mjs";

test("session mode uses ACP camelCase and restores new/load state", () => {
  assert.deepEqual(setSessionModeParams("s1", "plan"), {
    sessionId: "s1",
    modeId: "plan",
  });
  assert.equal(rememberSessionMode({ modes: { currentModeId: "plan" } }), "plan");
  assert.equal(rememberSessionMode({ modes: { current_mode_id: "ask" } }), "ask");
  assert.equal(rememberSessionMode({ sessionId: "s1" }), null);
});

test("only current_mode_update changes live mode", () => {
  assert.equal(
    currentModeIdFromUpdate({
      update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
    }),
    "plan",
  );
  assert.equal(
    currentModeIdFromUpdate({ sessionUpdate: "agent_message_chunk" }),
    undefined,
  );
});

test("plan slash is a client mode action, never prompt text", () => {
  assert.deepEqual(planSlashAction(""), { type: "set-mode", modeId: "plan" });
  assert.deepEqual(planSlashAction("add auth"), {
    type: "set-mode-then-prompt",
    modeId: "plan",
    text: "add auth",
  });
  assert.deepEqual(planSlashAction("more", { alreadyInPlan: true }), {
    type: "already-in-plan",
  });
  assert.equal(planSlashDisplay(" add auth "), "/plan add auth");
  assert.equal(isPlanMode("plan"), true);
  assert.match(ALREADY_IN_PLAN_NOTICE, /view-plan/);
  assert.equal(looksLikePlanQuestion("1. One?\n2. Two?"), true);
});
