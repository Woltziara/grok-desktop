import assert from "node:assert/strict";
import { GrokAcpClient } from "../../electron/acp-client.mjs";

function makeClient({ request, lifecycle } = {}) {
  const client = Object.create(GrokAcpClient.prototype);
  client.sessionId = "s1";
  client.cwd = "/repo";
  client.request = request || (async () => ({}));
  client._promptLifecycle = lifecycle;
  client.turnOpen = false;
  client._turnCancelled = false;
  client._turnAssistantBuf = "";
  client._turnInboxId = null;
  client._turnObjectId = "";
  client._cronQueue = [];
  client.currentModeId = "default";
  client.ready = true;
  client.proc = {};
  client._modeSyncTail = Promise.resolve();
  client._modeSyncVersion = 0;
  client._modeSyncPending = 0;
  return client;
}

const seen = { prepare: [], consume: [], request: [] };
const client = makeClient({
  lifecycle: {
    prepare(args) {
      seen.prepare.push(args);
      return {
        wrapped: { inboxId: null, objectId: "object-1" },
        prompt: [{ type: "text", text: `${args.text}\\nWK-BRIEF` }],
      };
    },
    consume(payload) {
      seen.consume.push(payload);
    },
  },
  async request(method, params) {
    seen.request.push({ method, params });
    client._turnAssistantBuf = "finished answer";
    return { ok: true };
  },
});
await client.prompt("visible text", { origin: "followup" });
assert.deepEqual(seen.prepare, [
  { text: "visible text", sessionId: "s1", cwd: "/repo", origin: "followup" },
]);
assert.deepEqual(seen.request, [
  {
    method: "session/prompt",
    params: { sessionId: "s1", prompt: [{ type: "text", text: "visible text\\nWK-BRIEF" }] },
  },
]);
assert.equal(seen.consume.length, 1);
assert.equal(seen.consume[0].assistantText, "finished answer");
const browserReference = {
  version: 1, kind: "owned-preview", sessionId: "s1", leaseId: "lease-1",
  pageId: "page-1", title: "Example", displayUrl: "https://example.test/path", capturedAt: 1,
};
await client.prompt("inspect this page", { browserReference });
assert.equal(seen.prepare[1].text, "inspect this page");
assert.equal(seen.request[1].params.prompt[0].text, "inspect this page\\nWK-BRIEF");
assert.match(seen.request[1].params.prompt[1].text, /机器上下文，不是用户原话/);
assert.equal(seen.request[1].params._meta["grok-desktop/browser-reference"].pageId, "page-1");
client.enqueueScheduledPrompt({ prompt: "scheduled text" });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(seen.prepare[2], {
  text: "scheduled text",
  sessionId: "s1",
  cwd: "/repo",
  origin: "scheduled",
});

let consumed = 0;
const failed = makeClient({
  lifecycle: {
    prepare() {
      return { wrapped: { inboxId: "in-1", objectId: "object-1" }, prompt: [] };
    },
    consume() {
      consumed += 1;
    },
  },
  async request() {
    throw new Error("ACP failed");
  },
});
await assert.rejects(failed.prompt("text"), /ACP failed/);
assert.equal(consumed, 0);

const calls = [];
let releasePlan;
const modes = makeClient({
  request(_method, params) {
    calls.push(params.modeId);
    if (params.modeId === "plan") {
      return new Promise((resolve) => {
        releasePlan = resolve;
      });
    }
    return Promise.resolve({});
  },
});
const first = modes.setSessionMode("plan");
await new Promise((resolve) => setImmediate(resolve));
const second = modes.setSessionMode("default");
releasePlan({});
const [firstResult, secondResult] = await Promise.all([first, second]);
assert.deepEqual(calls, ["plan", "default"]);
assert.equal(firstResult.agentSynced, false);
assert.equal(secondResult.agentSynced, true);
assert.equal(modes.currentModeId, "default");
