/**
 * Loopback static server for the right-rail "try this file" preview.
 * Only files under the current project root. Bound to 127.0.0.1.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { isPathInProject } from "./path-safety.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

const MAX_BYTES = 24 * 1024 * 1024;

/** @type {http.Server | null} */
let server = null;
/** @type {string} */
let root = "";
let port = 0;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

function safeResolve(projectRoot, urlPath) {
  const decoded = decodeURIComponent(urlPath || "/").split("?")[0];
  const rel = decoded.replace(/^\/+/, "");
  if (!rel) {
    const index = path.join(projectRoot, "index.html");
    return index;
  }
  const abs = path.resolve(projectRoot, rel);
  if (!isPathInProject(projectRoot, abs)) return null;
  return abs;
}

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

async function handle(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }
  if (!root) {
    send(res, 503, "No project");
    return;
  }
  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    send(res, 400, "Bad URL");
    return;
  }
  const abs = safeResolve(root, pathname);
  if (!abs) {
    send(res, 403, "Forbidden");
    return;
  }
  let st;
  try {
    st = await fs.promises.stat(abs);
  } catch {
    send(res, 404, "Not found");
    return;
  }
  let filePath = abs;
  if (st.isDirectory()) {
    filePath = path.join(abs, "index.html");
    try {
      st = await fs.promises.stat(filePath);
    } catch {
      send(res, 404, "Not found");
      return;
    }
  }
  if (!st.isFile() || st.size > MAX_BYTES) {
    send(res, 404, "Not found");
    return;
  }
  const type = contentType(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": st.size,
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

export async function ensureArtifactServer(projectRoot) {
  const next = path.resolve(projectRoot);
  if (server && root === next && port) {
    return { origin: `http://127.0.0.1:${port}`, root };
  }
  await stopArtifactServer();
  root = next;
  server = http.createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const addr = server.address();
  port = addr && typeof addr === "object" ? addr.port : 0;
  return { origin: `http://127.0.0.1:${port}`, root };
}

export async function stopArtifactServer() {
  const current = server;
  server = null;
  root = "";
  port = 0;
  if (!current) return;
  await new Promise((resolve) => current.close(() => resolve()));
}

export function artifactHref(projectRoot, absPath) {
  if (!port || !root) return null;
  const rel = path.relative(root, absPath).split(path.sep).join("/");
  if (!rel || rel.startsWith("..")) return null;
  return `http://127.0.0.1:${port}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}
