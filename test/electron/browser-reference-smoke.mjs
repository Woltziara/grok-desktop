// Real production Composer click -> preload/IPC -> durable delivery -> Owned Preview MCP snapshot.
// Uses a local page and protocol peer; no account, cookie, or private content.
import { app, BrowserWindow, ipcMain } from "electron";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enablePreviewRemoteDebugging } from "../../electron/preview-cdp.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-browser-ref-"));
app.setPath("userData", profile); app.setPath("sessionData", profile); enablePreviewRemoteDebugging();
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const preview = await import("../../electron/preview-window.mjs");
  const api = await import("../../electron/preview-api.mjs");
  const { issuePreviewScope } = await import("../../electron/preview-ownership.mjs");
  const { previewMcpHttpServers } = await import("../../electron/preview-mcp-tools.mjs");
  const { connectPreviewPlaywright, listPlaywrightPages } = await import("../../electron/preview-playwright.mjs");
  const { captureBrowserReference, validateBrowserReference } = await import("../../electron/browser-reference.mjs");
  const { createSessionDelivery } = await import("../../electron/session-delivery.mjs");
  const { registerDeliveryIpc } = await import("../../electron/delivery-ipc.mjs");
  const bundle = path.join(profile, "ui.js");
  await build({ entryPoints: [path.join(root, "test/ui/delivery-harness.tsx")], outfile: bundle, bundle: true, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' } });
  const server = http.createServer((req, res) => {
    if (req.url === "/ui.js") { res.setHeader("content-type", "text/javascript"); res.end(fs.readFileSync(bundle)); return; }
    res.setHeader("content-type", "text/html");
    if (req.url?.startsWith("/fixture")) res.end("<!doctype html><title>Local reference page</title><h1>Owned reference canary</h1>");
    else res.end('<style>textarea{width:650px}</style><div id="root"></div><script type="module" src="/ui.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const href = `http://127.0.0.1:${port}/fixture/account/callback?code=do-not-leak#private`;
  const sessionId = "delivery-session-A", cwd = path.join(profile, sessionId); fs.mkdirSync(cwd);
  const paths = { "delivery-session-A": cwd, "delivery-session-B": path.join(profile, "delivery-session-B") }; fs.mkdirSync(paths["delivery-session-B"]);
  const owner = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, "test/electron/delivery-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  class Peer extends EventEmitter {
    constructor() { super(); this.sessionId = sessionId; this.cwd = cwd; this.ready = true; this.snapshot = ""; }
    async prompt(text, opts) {
      this.text = text; this.opts = opts;
      await fetch(`${address.url}/mcp`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/call", params: { name: "preview_open", arguments: {} } }) });
      const response = await fetch(`${address.url}/mcp`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "preview_snapshot", arguments: {} } }) });
      const body = await response.json(); this.snapshot = body.result.content[0].text; return {};
    }
    cancel() {}
  }
  const agent = new Peer(), ws = { agent, parkedAgents: new Map(), lastSessionId: sessionId };
  const persisted = { theme: "light" };
  preview.registerPreviewIpc({ loadState: () => persisted, savePatch: patch => Object.assign(persisted, patch), broadcast: payload => owner.webContents.send("preview:changed", payload), getOwner: e => e?.sender === owner.webContents ? owner : null, getOwnerSessionId: w => w === owner ? sessionId : null, ownerHasProject: () => true });
  const address = await api.startPreviewApi({ windowById: id => BrowserWindow.fromId(id) });
  const scope = issuePreviewScope({ windowId: owner.id, getSessionId: () => sessionId, isLive: () => !owner.isDestroyed() });
  const headers = Object.fromEntries(previewMcpHttpServers(address, owner.id, scope)[0].headers.map(h => [h.name, h.value]));
  const delivery = createSessionDelivery(path.join(profile, "outbox"), { notify: event => owner.webContents.send("agent:delivery", event), validateBrowserReference: (ref, client) => validateBrowserReference(ref, preview.previewPublicState(), client.sessionId) });
  registerDeliveryIpc(ipcMain, { sessionFromEvent: e => e.sender === owner.webContents ? ws : null, agentForSession: (_ws, id) => id === sessionId ? agent : null, delivery: () => delivery, captureBrowserReference: id => captureBrowserReference(preview.previewPublicState(), id) });
  ipcMain.handle("agent:cancel", (_e, id) => delivery.stop(id));
  ipcMain.handle("test:info", () => paths); ipcMain.handle("test:switch", () => true); ipcMain.handle("test:calls", () => ({})); ipcMain.handle("test:foreign-events", () => []); ipcMain.handle("test:pending", () => []);
  try {
    if (process.env.DESKTOP_BROWSER_REF_FORCE_FAIL === "1") throw new Error("intentional failure probe");
    await owner.loadURL(`http://127.0.0.1:${port}/`);
    await preview.openPreviewWindow({ owner, sessionId, url: href });
    await connectPreviewPlaywright();
    const page = listPlaywrightPages().find(row => row.url() === `http://127.0.0.1:${port}/`); assert.ok(page, "Composer page missing");
    await page.getByRole("button", { name: "@浏览器", exact: true }).click();
    const chip = page.getByLabel("浏览器引用", { exact: true }); await chip.waitFor(); assert.match(await chip.textContent(), /@浏览器 · Local reference page/);
    assert.doesNotMatch(await chip.textContent(), /do-not-leak|private/);
    await page.locator("textarea").fill("read the referenced page"); await page.locator("textarea").press("Enter");
    for (let i = 0; i < 100 && !agent.snapshot; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(agent.text, "read the referenced page"); assert.ok(agent.opts.browserReference?.pageId); assert.match(agent.snapshot, /Owned reference canary/);
    assert.doesNotMatch(agent.snapshot, /do-not-leak|#private/);
    assert.equal(await page.getByLabel("浏览器引用", { exact: true }).count(), 0);
    const aUrl = `http://127.0.0.1:${port}/fixture/orders?state=open#/order/1`;
    const bUrl = `http://127.0.0.1:${port}/fixture/orders?state=closed#/order/1`;
    await preview.navigatePreview(aUrl);
    const aRef = await owner.webContents.executeJavaScript(`window.grokDesktop.captureBrowserReference(${JSON.stringify(sessionId)})`);
    await preview.navigatePreview(bUrl);
    assert.throws(() => validateBrowserReference(aRef, preview.previewPublicState(), sessionId), /重新点 @浏览器/);
    // Closing forces persistence through the production producer.
    preview.closePreviewWindow();
    assert.equal(persisted.previewLastUrl, bUrl);
    await preview.openPreviewWindow({ owner, sessionId, url: `http://127.0.0.1:${port}/fixture/app#/callback?access_token=SYNTHETIC_SECRET` });
    const safeState = preview.previewPublicState();
    const authRef = captureBrowserReference(safeState, sessionId);
    assert.doesNotMatch(JSON.stringify(safeState) + JSON.stringify(authRef) + (await preview.snapshotPreview()).text, /SYNTHETIC_SECRET/);
    preview.closePreviewWindow();
    assert.equal(persisted.previewLastUrl, bUrl, "a login callback must not replace the last safe destination");
    console.log(JSON.stringify({ ok: true, electron: process.versions.electron, chromium: process.versions.chrome, checks: ["production Composer @浏览器 click showed a removable query-free chip", "Enter kept the exact user text and delivered the separate browser reference", "the conversation-scoped MCP snapshot read the referenced Owned Preview page"] }, null, 2));
  } catch (error) {
    console.error(error.stack); process.exitCode = 1;
  } finally {
    preview.closePreviewWindow(); api.stopPreviewApi(); owner.destroy(); server.close(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(process.exitCode || 0);
  }
}).catch(error => { console.error(error.stack); app.exit(1); });
