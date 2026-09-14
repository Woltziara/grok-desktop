import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  hasPreviewCoordinates,
  normalizePreviewRef,
  previewLocatorSpec,
} from "../electron/preview-locator.mjs";
import { shouldApplyDeviceEmulation } from "../electron/preview-lifecycle.mjs";
import {
  PreviewNetworkLog,
  ingestPlaywrightEvent,
} from "../electron/preview-network.mjs";

test("normalizePreviewRef strips brackets and rejects junk", () => {
  assert.equal(normalizePreviewRef("e3"), "e3");
  assert.equal(normalizePreviewRef("[e12]"), "e12");
  assert.equal(normalizePreviewRef("f1e12"), "f1e12");
  assert.equal(normalizePreviewRef("  [E2]  "), "E2");
  assert.equal(normalizePreviewRef("div.foo"), "");
  assert.equal(normalizePreviewRef(""), "");
});

test("previewLocatorSpec prefers aria-ref then selector then name", () => {
  assert.deepEqual(previewLocatorSpec({ ref: "e9" }), {
    kind: "aria-ref",
    value: "e9",
  });
  assert.deepEqual(previewLocatorSpec({ selector: "#go" }), {
    kind: "selector",
    value: "#go",
  });
  assert.deepEqual(previewLocatorSpec({ name: "Sign in" }), {
    kind: "name",
    value: "Sign in",
  });
  assert.equal(previewLocatorSpec({}), null);
});

test("hasPreviewCoordinates requires both x and y", () => {
  assert.equal(hasPreviewCoordinates({ x: 10, y: 20 }), true);
  assert.equal(hasPreviewCoordinates({ x: 10 }), false);
  assert.equal(hasPreviewCoordinates({}), false);
});

test("device emulation waits for a real Preview navigation", () => {
  assert.equal(shouldApplyDeviceEmulation("about:blank", { width: 390 }), false);
  assert.equal(shouldApplyDeviceEmulation("", { width: 390 }), false);
  assert.equal(shouldApplyDeviceEmulation("https://example.com", { width: 390 }), true);
  assert.equal(shouldApplyDeviceEmulation("https://example.com", {}), false);
});

test("ingestPlaywrightEvent folds into the network log", () => {
  const log = new PreviewNetworkLog();
  ingestPlaywrightEvent(log, "request", {
    id: "pw-1",
    ts: 1,
    url: "http://localhost/app.js",
    method: "GET",
    resourceType: "script",
    initiator: "parser",
    frameId: "",
  });
  ingestPlaywrightEvent(log, "response", {
    id: "pw-1",
    ts: 1.05,
    resourceType: "script",
    status: 200,
    mime: "text/javascript",
  });
  ingestPlaywrightEvent(log, "finished", {
    id: "pw-1",
    ts: 1.2,
    encoded: 4096,
  });
  const snap = log.snapshot();
  assert.equal(snap.count, 1);
  assert.equal(snap.rows[0].status, 200);
  assert.equal(snap.rows[0].type, "js");
  assert.equal(snap.rows[0].size, 4096);
});

test("Preview aims with Playwright over CDP, never closes the app browser", () => {
  const pw = fs.readFileSync(
    new URL("../electron/preview-playwright.mjs", import.meta.url),
    "utf8",
  );
  const win = fs.readFileSync(
    new URL("../electron/preview-window.mjs", import.meta.url),
    "utf8",
  );
  const main = fs.readFileSync(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(typeof pkg.dependencies["playwright-core"], "string");
  assert.match(pw, /connectOverCDP/);
  assert.match(pw, /ariaSnapshot/);
  assert.match(pw, /mode:\s*["']ai["']/);
  assert.match(pw, /aria-ref=/);
  assert.doesNotMatch(pw, /browser\.close\s*\(/);
  assert.doesNotMatch(win, /browser\.close\s*\(/);
  assert.match(win, /pinGuestPage/);
  assert.match(win, /__GROK_PREVIEW_GUEST/);
  assert.match(win, /snapshotGuestPage/);
  assert.match(win, /runGuestAction/);
  assert.match(main, /enablePreviewRemoteDebugging/);
  const cdpAt = main.indexOf("enablePreviewRemoteDebugging()");
  const readyAt = main.indexOf("app.whenReady");
  assert.ok(cdpAt > 0 && readyAt > 0 && cdpAt < readyAt);
});

test("Preview keeps its own logins and does not import Edge", () => {
  const win = fs.readFileSync(
    new URL("../electron/preview-window.mjs", import.meta.url),
    "utf8",
  );
  assert.match(win, /persist:grok-preview/);
  assert.doesNotMatch(win, /Microsoft Edge/);
  assert.doesNotMatch(win, /Login Data/);
  assert.doesNotMatch(win, /fromPartition\("grok-preview"\)/);
});
