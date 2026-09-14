/**
 * Local Chromium DevTools endpoint so Playwright can attach to this
 * Electron process. Bound to 127.0.0.1 only. Must run before app ready.
 *
 * Never point this at the public network. Do not shut down the
 * Playwright browser handle — that would quit the whole app.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

let enabled = false;
let enabledAt = 0;

export function enablePreviewRemoteDebugging() {
  if (enabled) return previewCdpPort();
  enabled = true;
  enabledAt = Date.now();
  // Chromium chooses an available port and records it in this app's profile.
  app.commandLine.appendSwitch("remote-debugging-port", "0");
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  // Node/Playwright does not need a browser Origin exception. In particular,
  // never let arbitrary pages connect to the application's DevTools socket.
  app.commandLine.removeSwitch("remote-allow-origins");
  return 0;
}

export function previewCdpPort() {
  if (!enabled) return 0;
  try {
    const file = path.join(app.getPath("userData"), "DevToolsActivePort");
    if (fs.statSync(file).mtimeMs < enabledAt - 1000) return 0;
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/, 1)[0];
    const port = Number(line);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
  } catch {
    return 0;
  }
}

export function previewCdpHttpUrl() {
  const port = previewCdpPort();
  return port > 0 ? `http://127.0.0.1:${port}` : "";
}
