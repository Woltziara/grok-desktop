/**
 * Loopback JSON API for the detachable Preview window.
 * The grok agent cannot import Electron; the MCP child calls this instead.
 */
import http from "node:http";
import crypto from "node:crypto";
import { PREVIEW_SCOPE_HEADER, resolvePreviewScope, clearPreviewScopes } from "./preview-ownership.mjs";
import { previewOwnerIdFromHeaders } from "./preview-mcp-tools.mjs";

/** @type {typeof import("./preview-window.mjs") | null} */
let previewWinApi = null;

async function previewWindowApi() {
  if (!previewWinApi) previewWinApi = await import("./preview-window.mjs");
  return previewWinApi;
}

/** Known loopback routes. `/screenshot` is intentionally absent (chrome Send only). */
export function previewApiRecognizes(method, path) {
  const m = String(method || "GET").toUpperCase();
  const p = String(path || "/");
  if (m === "GET" && (p === "/health" || p === "/state")) return true;
  if (
    m === "POST" &&
    (p === "/open" ||
      p === "/close" ||
      p === "/navigate" ||
      p === "/snapshot" ||
      p === "/click" ||
      p === "/fill" ||
      p === "/press" ||
      p === "/hover" ||
      p === "/viewport")
  ) {
    return true;
  }
  if (
    (m === "GET" || m === "POST") &&
    (p === "/network" || p === "/network/log")
  ) {
    return true;
  }
  return false;
}

/** @type {http.Server | null} */
let server = null;
/** @type {string} */
let token = "";
/** @type {number} */
let port = 0;
/** @type {() => import('electron').BrowserWindow | null} */
let getOwner = () => null;
/** @type {(id: number) => import('electron').BrowserWindow | null} */
let windowById = () => null;

export function previewApiAddress() {
  if (!server || !port || !token) return null;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    port,
  };
}

/** Resolve only open/navigate fallback ownership; stamped agents never steal focus. */
export function previewRequestOwner({ owner = null, ownerStamped = false } = {}, fallback = getOwner) {
  return owner || (ownerStamped ? null : fallback());
}

/**
 * @param {object} req
 * @param {string} req.method
 * @param {string} req.path
 * @param {Record<string, unknown>} [req.body]
 * @param {import('electron').BrowserWindow | null} [req.owner]
 * @param {boolean} [req.ownerStamped]
 */
async function dispatchPreviewRequest(req) {
  const method = String(req.method || "GET").toUpperCase();
  const path = String(req.path || "/");
  const body = req.body && typeof req.body === "object" ? req.body : {};

  if (!previewApiRecognizes(method, path)) {
    const err = new Error(`Not found: ${method} ${path}`);
    err.statusCode = 404;
    throw err;
  }

  const {
    assertPreviewOwner,
    closePreviewWindow,
    navigatePreview,
    openPreviewWindow,
    previewPublicState,
    runPreviewAction,
    setPreviewViewport,
    snapshotPreview,
    snapshotPreviewNetwork,
    VIEWPORTS,
  } = await previewWindowApi();

  if (method === "GET" && path === "/health") return { ok: true };
  // No focus fallback: a BrowserWindow alone is not a conversation identity.
  const owner = req.owner;
  const sessionId = req.ownerSessionId;
  if (!owner || owner.isDestroyed() || !sessionId) {
    throw Object.assign(new Error("Preview requires a live conversation owner"), { statusCode: 403 });
  }
  req.validateOwner?.();
  if (path !== "/open") {
    if (req.scope && !req.scope.leaseId) throw new Error("Call preview_open from this conversation first.");
    assertPreviewOwner(owner, sessionId, req.scope?.leaseId);
  }
  if (method === "GET" && path === "/health") {
    return { ok: true, ...previewPublicState() };
  }
  if (method === "GET" && path === "/state") {
    return previewPublicState();
  }
  if (method === "POST" && path === "/open") {
    const url = typeof body.url === "string" ? body.url : "";
    const result = await openPreviewWindow({ owner, sessionId, url });
    req.validateOwner?.();
    if (req.scope) req.scope.leaseId = result.leaseId;
    return result;
  }
  if (method === "POST" && path === "/close") {
    return { ok: closePreviewWindow(), ...previewPublicState() };
  }
  if (method === "POST" && path === "/navigate") {
    const url = typeof body.url === "string" ? body.url : "";
    if (!previewPublicState().open) {
      throw new Error("Preview is closed. Call preview_open first.");
    }
    return navigatePreview(url);
  }
  if (method === "POST" && path === "/snapshot") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return snapshotPreview();
  }
  if (method === "POST" && path === "/click") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return runPreviewAction({
      action: "click",
      ref: body.ref || body.uid,
      selector: body.selector,
      name: body.name || body.text,
      x: body.x,
      y: body.y,
    });
  }
  if (method === "POST" && path === "/fill") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return runPreviewAction({
      action: "fill",
      ref: body.ref || body.uid,
      selector: body.selector,
      name: body.name || body.text,
      value: body.value,
    });
  }
  if (method === "POST" && path === "/press") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return runPreviewAction({
      action: "press",
      ref: body.ref || body.uid,
      selector: body.selector,
      name: body.name || body.text,
      key: body.key || "Enter",
    });
  }
  if (method === "POST" && path === "/hover") {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return runPreviewAction({
      action: "hover",
      ref: body.ref || body.uid,
      selector: body.selector,
      name: body.name || body.text,
      x: body.x,
      y: body.y,
    });
  }
  if (method === "POST" && path === "/viewport") {
    const id = String(body.id || body.viewport || "fluid");
    if (!VIEWPORTS[id]) {
      throw new Error(`Unknown viewport: ${id}`);
    }
    return setPreviewViewport(id);
  }
  if (
    (method === "GET" || method === "POST") &&
    (path === "/network" || path === "/network/log")
  ) {
    if (!previewPublicState().open) {
      throw new Error("Preview is not open. Call preview_open first.");
    }
    return snapshotPreviewNetwork({
      filter: body.filter,
      afterLoad: Boolean(body.afterLoad),
      limit: body.limit,
    });
  }
  const err = new Error(`Not found: ${method} ${path}`);
  err.statusCode = 404;
  throw err;
}

let operationTail = Promise.resolve();
export function dispatchPreviewApi(req) {
  const leaseId = req.scope?.leaseId;
  const operation = operationTail.then(async () => {
    if (req.scope && req.path !== "/open" && req.scope.leaseId !== leaseId) {
      throw new Error("Preview request expired while another operation opened the page.");
    }
    return dispatchPreviewRequest(req);
  });
  operationTail = operation.catch(() => {});
  return operation;
}

function requestContext(headers, { allowPending = false } = {}) {
  const windowId = previewOwnerIdFromHeaders(headers);
  const scopeId = headers[PREVIEW_SCOPE_HEADER.toLowerCase()];
  const scope = resolvePreviewScope(scopeId, windowId, { allowPending });
  const owner = windowById(windowId);
  const ownerSessionId = scope.getSessionId();
  const validateOwner = () => {
    if (resolvePreviewScope(scopeId, windowId, { allowPending }) !== scope || scope.getSessionId() !== ownerSessionId || !owner || owner.isDestroyed()) {
      throw new Error("Preview conversation changed or closed");
    }
  };
  validateOwner();
  return { owner, ownerSessionId, scope, ownerStamped: true, validateOwner };
}

async function handleMcpHttp(req, res, rawBody) {
  const { handlePreviewMcpMessage } = await import("./preview-mcp-protocol.mjs");
  if (String(req.method || "").toUpperCase() === "GET") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "POST JSON-RPC to /mcp" }));
    return;
  }
  let msg = {};
  try {
    msg = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }
  const context = requestContext(req.headers, { allowPending: msg.method !== "tools/call" });
  const reply = await handlePreviewMcpMessage(msg, context);
  if (!reply) {
    res.writeHead(202);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": "application/json",
    "mcp-session-id": "desktop-preview",
  });
  res.end(JSON.stringify(reply));
}

/**
 * @param {{ getOwner?: () => import('electron').BrowserWindow | null, windowById?: (id: number) => import('electron').BrowserWindow | null }} [opts]
 * @returns {Promise<{ url: string, token: string, port: number } | null>}
 */
export function startPreviewApi(opts = {}) {
  if (opts.getOwner) getOwner = opts.getOwner;
  if (opts.windowById) windowById = opts.windowById;
  if (server && port) return Promise.resolve(previewApiAddress());

  token = token || crypto.randomBytes(24).toString("hex");
  if (server) {
    return new Promise((resolve) => {
      if (port) resolve(previewApiAddress());
      else server.once("listening", () => resolve(previewApiAddress()));
    });
  }

  server = http.createServer(async (req, res) => {
    if (req.headers.origin) { res.writeHead(403); res.end("Browser origins are not accepted"); return; }
    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 8_000_000) { res.writeHead(413); res.end("Request too large"); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (url.pathname === "/mcp") {
        try {
          await handleMcpHttp(req, res, raw);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
        }
        return;
      }
      try {
        let body = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = {};
          }
        }
        const result = await dispatchPreviewApi({
          method: req.method,
          path: url.pathname,
          body,
          ...requestContext(req.headers),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const status = Number(err?.statusCode) || 400;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = addr && typeof addr === "object" ? addr.port : 0;
      resolve(previewApiAddress());
    });
  });
}

export function stopPreviewApi() {
  if (!server) return;
  try {
    server.close();
  } catch {
    /* ignore */
  }
  clearPreviewScopes();
  server = null;
  port = 0;
  token = "";
}
