import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  consumeCompletedAcpPrompt,
  prepareAcpPrompt,
} from "../electron/acp-prompt-lifecycle.mjs";

test("ACP prompt sends WK wire text while preserving original metadata", () => {
  let received = null;
  const prepared = prepareAcpPrompt(
    {
      text: "user-visible",
      sessionId: "s1",
      cwd: "/repo",
      origin: "scheduled",
    },
    {
      wrapOutgoingPrompt(args) {
        received = args;
        return {
          original: args.text,
          wireText: `${args.text}\nWK-BRIEF`,
          inboxId: null,
          objectId: "object-1",
        };
      },
    },
  );
  assert.deepEqual(received, {
    text: "user-visible",
    sessionId: "s1",
    cwd: "/repo",
    origin: "scheduled",
  });
  assert.equal(prepared.wrapped.original, "user-visible");
  assert.deepEqual(prepared.prompt, [
    { type: "text", text: "user-visible\nWK-BRIEF" },
  ]);
});

test("cancelled ACP turn cannot consume incomplete WK output", () => {
  let calls = 0;
  const result = consumeCompletedAcpPrompt(
    { assistantText: "partial", cancelled: true },
    {
      consumeTurnOutput() {
        calls += 1;
      },
    },
  );
  assert.equal(calls, 0);
  assert.deepEqual(result, { ok: true, skipped: true, reason: "cancelled" });
});

test("completed ACP turn consumes the accumulated assistant output once", () => {
  let payload = null;
  const result = consumeCompletedAcpPrompt(
    {
      assistantText: "complete",
      sessionId: "s1",
      cwd: "/repo",
      inboxId: "in-1",
      objectId: "object-1",
      cancelled: false,
    },
    {
      consumeTurnOutput(next) {
        payload = next;
        return { ok: true };
      },
    },
  );
  assert.equal(payload.assistantText, "complete");
  assert.equal(payload.inboxId, "in-1");
  assert.deepEqual(result, { ok: true });
});

test("real ACP client prompt and mode paths run against a fake ACP transport", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      path.join(testDir, "fixtures/register-electron-mock.mjs"),
      path.join(testDir, "fixtures/acp-client-wk-fixture.mjs"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
