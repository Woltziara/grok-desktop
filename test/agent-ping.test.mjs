import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretAcpPing } from "../shared/agent-ping.mjs";

test("a live pid is not enough to call the agent healthy", () => {
  assert.equal(interpretAcpPing({ processAlive: false }).ok, false);
  assert.equal(interpretAcpPing({ processAlive: false }).reason, "process");
  assert.equal(
    interpretAcpPing({ processAlive: true, ready: false }).reason,
    "not-ready",
  );
  assert.equal(
    interpretAcpPing({
      processAlive: true,
      ready: true,
      rpcErrorMessage: "ACP request timed out after 4000ms: session/list",
    }).reason,
    "rpc-timeout",
  );
  assert.equal(
    interpretAcpPing({
      processAlive: true,
      ready: true,
      rpcErrorMessage: "Agent stdin not writable",
    }).reason,
    "disconnected",
  );
});

test("any ACP response, including method-not-found, counts as rpc ok", () => {
  assert.deepEqual(
    interpretAcpPing({ processAlive: true, ready: true, rpcErrorMessage: null }),
    { ok: true, rpc: true },
  );
  assert.equal(
    interpretAcpPing({
      processAlive: true,
      ready: true,
      rpcErrorMessage: "Method not found (-32601)",
    }).ok,
    true,
  );
});
