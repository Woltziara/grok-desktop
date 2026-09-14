/**
 * Resolve Preview action targets (Electron-free).
 * Playwright AI snapshots stamp [ref=e5] / f1e12; we pass those through.
 */

export function normalizePreviewRef(ref) {
  const s = String(ref || "")
    .trim()
    .replace(/^\[|\]$/g, "");
  if (!s) return "";
  if (!/^[a-z][a-z0-9]*$/i.test(s)) return "";
  return s;
}

/**
 * @param {Record<string, unknown>} act
 * @returns {{ kind: string, value: string } | null}
 */
export function previewLocatorSpec(act) {
  const a = act && typeof act === "object" ? act : {};
  const ref = normalizePreviewRef(a.ref || a.uid);
  if (ref) return { kind: "aria-ref", value: ref };
  const selector = String(a.selector || "").trim();
  if (selector) return { kind: "selector", value: selector };
  const name = String(a.name || a.text || "").trim();
  if (name) return { kind: "name", value: name };
  return null;
}

export function hasPreviewCoordinates(act) {
  const a = act && typeof act === "object" ? act : {};
  return Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.y));
}
