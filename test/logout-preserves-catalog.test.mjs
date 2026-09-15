import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearSessionApiKey } from "../electron/auth.mjs";

test("logout clears only the in-process API key and does not delete the session catalog", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-logout-home-"));
  const sessions = path.join(home, "sessions", "synthetic", "meta.json");
  fs.mkdirSync(path.dirname(sessions), { recursive: true });
  fs.writeFileSync(sessions, '{"id":"synthetic"}');
  const recents = path.join(home, "desktop-state.json");
  fs.writeFileSync(recents, '{"projects":["/synthetic"]}');
  clearSessionApiKey();
  assert.equal(fs.readFileSync(sessions, "utf8"), '{"id":"synthetic"}');
  assert.match(fs.readFileSync(recents, "utf8"), /synthetic/);
  const auth = fs.readFileSync(new URL("../electron/auth.mjs", import.meta.url), "utf8");
  const start = auth.indexOf("export function startLogout()");
  const fn = auth.slice(start, auth.indexOf("\nfunction isLoopbackHost", start));
  assert.match(fn, /spawn\(bin, \["logout"\]/);
  assert.doesNotMatch(fn, /deleteSession|rmSync|sessionsRoot|desktop-state/);
  const main = fs.readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
  const ipc = main.slice(main.indexOf('ipcMain.handle("auth:logout"'), main.indexOf("ipcMain.handle(\"auth:set-api-key\""));
  assert.match(ipc, /startLogout/);
  assert.doesNotMatch(ipc, /deleteSession/);
  fs.rmSync(home, { recursive: true, force: true });
});
