import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

test("session switching stays aligned after IPC and preserves A on IPC failure", () => {
  const electron = createRequire(import.meta.url)("electron");
  const result = spawnSync(electron, ["test/electron/session-switch-smoke.mjs"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    timeout: 45_000,
    killSignal: "SIGKILL",
  });
  assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join("\n"));
  assert.match(result.stdout, /post-IPC refresh failure leaves UI and delivery routed to B/);
});
