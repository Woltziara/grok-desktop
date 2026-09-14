/**
 * Attach Playwright to the existing Preview guest (no second browser).
 * Snapshot = aria tree with refs. Clicks = real input + auto-wait.
 */
import { chromium } from "playwright-core";
import { previewCdpHttpUrl } from "./preview-cdp.mjs";
import {
  hasPreviewCoordinates,
  normalizePreviewRef,
  previewLocatorSpec,
} from "./preview-locator.mjs";
import { ingestPlaywrightEvent } from "./preview-network.mjs";

const ACTION_TIMEOUT_MS = 8000;
const SNAPSHOT_TIMEOUT_MS = 8000;

/** @type {import('playwright-core').Browser | null} */
let browser = null;
/** @type {import('playwright-core').Page | null} */
let guestPage = null;

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listPages(b) {
  /** @type {import('playwright-core').Page[]} */
  const out = [];
  if (!b) return out;
  for (const ctx of b.contexts()) {
    for (const page of ctx.pages()) out.push(page);
  }
  return out;
}

function looksLikePreviewChrome(page) {
  const url = String(page.url() || "");
  return url.startsWith("file:") && url.includes("/preview/index.html");
}

export function listPlaywrightPages() {
  if (!browser || !browser.isConnected()) return [];
  return listPages(browser);
}

export function getGuestPage() {
  if (guestPage && !guestPage.isClosed()) return guestPage;
  return null;
}

export function unpinGuestPage() {
  guestPage = null;
}

export function isPlaywrightGuestLive() {
  return Boolean(getGuestPage());
}

/**
 * Connect to this Electron process. Do not shut down the browser handle.
 */
export async function connectPreviewPlaywright() {
  if (browser && browser.isConnected()) return browser;
  let lastErr;
  for (let i = 0; i < 25; i++) {
    try {
      const url = previewCdpHttpUrl();
      if (!url) throw new Error("Preview CDP is not ready");
      browser = await chromium.connectOverCDP(url);
      return browser;
    } catch (err) {
      lastErr = err;
      await waitMs(80 + i * 40);
    }
  }
  throw lastErr || new Error("Playwright could not connect to Preview");
}

export async function snapshotPlaywrightPages() {
  await connectPreviewPlaywright();
  let pages = listPlaywrightPages();
  for (let i = 0; i < 16; i++) {
    await waitMs(50);
    const next = listPlaywrightPages();
    if (next.length && next.length === pages.length) return next;
    pages = next;
  }
  return listPlaywrightPages();
}

/**
 * @param {import('playwright-core').Page[]} known
 * @param {(page: import('playwright-core').Page) => Promise<boolean>} [isGuest]
 */
export async function pinGuestPage(known, isGuest) {
  await connectPreviewPlaywright();
  const knownSet = new Set(known || []);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const candidates = listPlaywrightPages().filter(
      (p) => !p.isClosed() && !looksLikePreviewChrome(p),
    );
    const fresh = candidates.filter((p) => !knownSet.has(p));
    const ordered = fresh.length ? fresh : candidates;
    for (const page of ordered) {
      if (isGuest) {
        try {
          if (!(await isGuest(page))) continue;
        } catch {
          continue;
        }
      }
      bindGuestPage(page);
      return page;
    }
    await waitMs(40);
  }
  throw new Error("Could not attach Playwright to the Preview page");
}

/**
 * Re-bind if the pinned page died or navigated away from the guest.
 * @param {{ getURL?: () => string } | null} wc
 */
const guestBindings = new WeakMap();
export function bindGuestWebContents(wc, page) { guestBindings.set(wc, page); }
export async function ensureGuestPage(wc) {
  const bound = wc && guestBindings.get(wc);
  if (bound && !bound.isClosed()) { bindGuestPage(bound); return bound; }
  guestPage = null;
  return null;
}

/** @param {import('playwright-core').Page} page */
function bindGuestPage(page) {
  guestPage = page;
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  page.on("close", () => {
    if (guestPage === page) guestPage = null;
  });
}

function locatorFromSpec(page, spec) {
  if (!spec) return null;
  if (spec.kind === "aria-ref") return page.locator(`aria-ref=${spec.value}`);
  if (spec.kind === "selector") return page.locator(spec.value);
  if (spec.kind === "name") {
    return page.getByText(spec.value, { exact: false }).first();
  }
  return null;
}

async function requireGuest() {
  const page = getGuestPage();
  if (!page) throw new Error("Preview is not open");
  return page;
}

export async function snapshotGuestPage() {
  const page = await requireGuest();
  const yaml = await page.ariaSnapshot({
    mode: "ai",
    timeout: SNAPSHOT_TIMEOUT_MS,
  });
  let title = "";
  try {
    title = await page.title();
  } catch {
    title = "";
  }
  return {
    yaml: String(yaml || "").trim(),
    url: page.url(),
    title,
  };
}

/**
 * SPA-friendly settle: load event if it happens, then a short mutation quiet.
 * Hard-capped so long-polling pages (chat, dashboards) cannot stall.
 * @param {import('playwright-core').Page} page
 */
export async function waitForGuestQuiet(page, timeoutMs = 1200) {
  const start = Date.now();
  try {
    await page.waitForLoadState("domcontentloaded", {
      timeout: Math.min(1500, timeoutMs),
    });
  } catch {
    /* client-side route, no document load */
  }
  const remaining = Math.max(0, timeoutMs - (Date.now() - start));
  if (remaining < 40) return;
  try {
    await page.evaluate(
      ({ quietMs, hardMs }) =>
        new Promise((resolve) => {
          const done = () => {
            clearTimeout(hard);
            clearTimeout(quiet);
            try {
              mo.disconnect();
            } catch {
              /* ignore */
            }
            resolve();
          };
          const hard = setTimeout(done, hardMs);
          let quiet = setTimeout(done, quietMs);
          const mo = new MutationObserver(() => {
            clearTimeout(quiet);
            quiet = setTimeout(done, quietMs);
          });
          try {
            mo.observe(document, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true,
            });
          } catch {
            done();
          }
        }),
      { quietMs: 220, hardMs: remaining },
    );
  } catch {
    /* navigating */
  }
}

async function fillLocator(locator, value) {
  const info = await locator.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: String(el.type || "").toLowerCase(),
    role: (el.getAttribute("role") || "").toLowerCase(),
  }));
  if (info.tag === "select") {
    try {
      await locator.selectOption({ label: value }, { timeout: ACTION_TIMEOUT_MS });
    } catch {
      await locator.selectOption({ value }, { timeout: ACTION_TIMEOUT_MS });
    }
    return { as: "select" };
  }
  if (
    info.type === "checkbox" ||
    info.type === "radio" ||
    info.role === "checkbox" ||
    info.role === "radio" ||
    info.role === "switch"
  ) {
    const on = !["false", "0", "off", "unchecked", "no"].includes(
      value.toLowerCase(),
    );
    await locator.setChecked(on, { timeout: ACTION_TIMEOUT_MS });
    return { as: "check", checked: on };
  }
  await locator.fill(value, { timeout: ACTION_TIMEOUT_MS });
  return { as: "fill" };
}

/**
 * @param {Record<string, unknown>} act
 */
export async function runGuestAction(act, expectedPage) {
  const page = expectedPage || await requireGuest();
  const action = String(act?.action || "click").toLowerCase();
  const spec = previewLocatorSpec(act);
  const x = Number(act?.x);
  const y = Number(act?.y);
  const coord = hasPreviewCoordinates(act);

  if (action === "press") {
    const key = String(act?.key || "Enter");
    const locator = locatorFromSpec(page, spec);
    if (locator) await locator.press(key, { timeout: ACTION_TIMEOUT_MS });
    else await page.keyboard.press(key);
    await waitForGuestQuiet(page);
    return { ok: true, action: "press", key, engine: "playwright" };
  }

  if ((action === "click" || action === "hover") && coord && !spec) {
    if (action === "hover") await page.mouse.move(x, y);
    else await page.mouse.click(x, y);
    await waitForGuestQuiet(page);
    return { ok: true, action, x, y, engine: "playwright" };
  }

  const locator = locatorFromSpec(page, spec);
  if (!locator) {
    return {
      ok: false,
      error: "No matching control. Take a snapshot and use a ref like e3.",
    };
  }

  if (action === "hover") {
    await locator.hover({ timeout: ACTION_TIMEOUT_MS });
    await waitForGuestQuiet(page);
    return {
      ok: true,
      action: "hover",
      ref: normalizePreviewRef(act?.ref),
      engine: "playwright",
    };
  }

  if (action === "fill" || action === "type") {
    const value = act?.value == null ? "" : String(act.value);
    const how = await fillLocator(locator, value);
    await waitForGuestQuiet(page);
    return {
      ok: true,
      action: "fill",
      value,
      ref: normalizePreviewRef(act?.ref),
      engine: "playwright",
      ...how,
    };
  }

  await locator.click({ timeout: ACTION_TIMEOUT_MS });
  await waitForGuestQuiet(page);
  return {
    ok: true,
    action: "click",
    ref: normalizePreviewRef(act?.ref),
    engine: "playwright",
  };
}

/**
 * Fold Playwright network events into PreviewNetworkLog.
 * @param {import('playwright-core').Page} page
 * @param {import('./preview-network.mjs').PreviewNetworkLog} log
 * @param {() => void} [onChange]
 */
export function bindPlaywrightNetwork(page, log, onChange) {
  const ids = new WeakMap();
  let seq = 0;
  const idFor = (req) => {
    const existing = ids.get(req);
    if (existing) return existing;
    const id = `pw-${++seq}`;
    ids.set(req, id);
    return id;
  };
  const ts = () => Date.now() / 1000;

  const onRequest = (req) => {
    ingestPlaywrightEvent(log, "request", {
      id: idFor(req),
      ts: ts(),
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      headers: req.headers(),
      initiator: req.isNavigationRequest() ? "parser" : "script",
      frameId: req.isNavigationRequest() ? "main" : "",
    });
    onChange?.();
  };
  const onResponse = (res) => {
    const req = res.request();
    ingestPlaywrightEvent(log, "response", {
      id: idFor(req),
      ts: ts(),
      resourceType: req.resourceType(),
      status: res.status(),
      statusText: res.statusText(),
      mime: res.headers()["content-type"] || "",
      headers: res.headers(),
      fromCache: Boolean(res.fromServiceWorker()),
    });
    onChange?.();
  };
  const onFinished = (req) => {
    const fail = req.failure();
    if (fail) {
      ingestPlaywrightEvent(log, "failed", {
        id: idFor(req),
        ts: ts(),
        resourceType: req.resourceType(),
        error: fail.errorText || "failed",
        canceled: /NS_BINDING_ABORTED|ERR_ABORTED|cancelled|canceled/i.test(
          fail.errorText || "",
        ),
      });
    } else {
      ingestPlaywrightEvent(log, "finished", {
        id: idFor(req),
        ts: ts(),
        encoded: 0,
      });
    }
    onChange?.();
  };
  const onFailed = (req) => {
    const fail = req.failure();
    ingestPlaywrightEvent(log, "failed", {
      id: idFor(req),
      ts: ts(),
      resourceType: req.resourceType(),
      error: fail?.errorText || "failed",
      canceled: false,
    });
    onChange?.();
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);

  return () => {
    try {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    } catch {
      /* page gone */
    }
  };
}
