import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { rejectPendingByMethod } from "../shared/cancel-pending.mjs";
import { AcpTerminalManager } from "../electron/acp-terminals.mjs";

test("rejectPendingByMethod only drops session/prompt", async () => {
  const pending = new Map();
  let promptErr = null;
  const promptWait = new Promise((_, reject) => {
    pending.set(11, {
      method: "session/prompt",
      reject(err) {
        promptErr = err;
        reject(err);
      },
    });
  });
  let otherRejected = false;
  pending.set(12, {
    method: "session/set_model",
    reject() {
      otherRejected = true;
    },
  });

  const n = rejectPendingByMethod(
    pending,
    "session/prompt",
    new Error("cancelled"),
  );
  await promptWait.catch(() => {});

  assert.equal(n, 1);
  assert.match(String(promptErr?.message || ""), /cancel/i);
  assert.equal(otherRejected, false);
  assert.equal(pending.has(12), true);
  assert.equal(pending.has(11), false);
});

test("killAllImmediate clears terminals even if pid is already gone", () => {
  const mgr = new AcpTerminalManager({ defaultCwd: os.tmpdir() });
  mgr.terminals.set("t1", {
    id: "t1",
    sessionId: "s",
    proc: {
      kill() {},
    },
    pid: 999999999,
    output: "",
    truncated: false,
    outputByteLimit: 10,
    exitCode: null,
    signal: null,
    exited: false,
    waiters: [],
    command: "sleep",
    args: ["30"],
    cwd: os.tmpdir(),
    cleanup: null,
  });
  mgr.killAllImmediate();
  assert.equal(mgr.terminals.size, 0);
});
