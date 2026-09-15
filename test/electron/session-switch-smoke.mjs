// Test-only renderer fixture mounts the production session and delivery hooks.
import { app, BrowserWindow } from "electron";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-session-switch-"));
app.setPath("userData", path.join(tmp, "profile"));
const { enablePreviewRemoteDebugging } = await import("../../electron/preview-cdp.mjs");
enablePreviewRemoteDebugging();

app.whenReady().then(async () => {
  let win;
  let server;
  try {
    const bundle = path.join(tmp, "ui.js");
    await build({
      entryPoints: [path.join(root, "test/ui/session-switch-harness.tsx")],
      outfile: bundle,
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"test"' },
    });
    server = http.createServer((req, res) => {
      res.setHeader("content-type", req.url === "/ui.js" ? "text/javascript" : "text/html");
      res.end(req.url === "/ui.js" ? fs.readFileSync(bundle) : '<div id="root"></div><script type="module" src="/ui.js"></script>');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ width: 900, height: 700, show: false });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const { connectPreviewPlaywright, listPlaywrightPages } = await import("../../electron/preview-playwright.mjs");
    await connectPreviewPlaywright();
    const page = listPlaywrightPages().find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
    assert.ok(page);

    const value = (label) => page.getByLabel(label).textContent();
    await page.getByText("queued for A", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Fail switch" }).click();
    await page.getByText("synthetic IPC open failure", { exact: true }).waitFor();
    assert.equal(await value("session"), "A");
    assert.equal(await value("connection"), "busy");
    assert.equal(await value("draft"), "unsent A draft");
    assert.equal(await value("grant"), "granted");
    assert.equal(await value("queue"), "queued for A");
    assert.match(await value("timeline"), /real A transcript/);

    await page.getByRole("button", { name: "Switch B" }).click();
    await page.getByText(/Project tools could not be refreshed/).waitFor();
    assert.equal(await value("session"), "B");
    assert.equal(await value("connection"), "online");
    assert.equal(await value("grant"), "revoked");
    assert.equal(await value("queue"), "empty");
    assert.match(await value("timeline"), /real B transcript/);
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForFunction(() => window.sessionSwitchHarness.submissions.length === 1);
    const evidence = await page.evaluate(() => window.sessionSwitchHarness);
    assert.deepEqual(evidence.submissions, [{ requested: "B", routed: "B", text: "send after switch" }]);
    assert.equal(evidence.cancelCalls, 0);
    assert.equal(evidence.draftFlushes, 2);
    console.log(JSON.stringify({ ok: true, checks: ["failed IPC preserves A transcript/draft/queue/grant and busy turn", "post-IPC refresh failure leaves UI and delivery routed to B"] }));
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    win?.destroy();
    server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
