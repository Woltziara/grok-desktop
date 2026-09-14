/** Grok Build mid-turn interject wire and IPC result helpers. */

export const INTERJECT_UNSUPPORTED_REASON = "unsupported";

export function interjectUnsupportedResult(interjectionId) {
  return {
    ok: false,
    reason: INTERJECT_UNSUPPORTED_REASON,
    interjectionId: String(interjectionId || "").trim(),
  };
}

export function interjectAcceptedResult(interjectionId, status) {
  return {
    ok: true,
    status: String(status || "queued").trim() || "queued",
    interjectionId: String(interjectionId || "").trim(),
  };
}

export function isInterjectMethodMissing(err) {
  if (!err) return false;
  if (typeof err === "object" && err.code === -32601) return true;
  return /method not found|-32601|unknown method/i.test(
    String(typeof err === "object" && err.message ? err.message : err),
  );
}

export function mapInterjectIpcError(err, interjectionId) {
  const message = String(
    err && typeof err === "object" && err.message != null
      ? err.message
      : err || "",
  );
  if (!/interject is not available/i.test(message)) return null;
  return interjectUnsupportedResult(interjectionId);
}

export function interjectFromAttemptErrors(errors, interjectionId) {
  const list = Array.isArray(errors) ? errors : [];
  for (const err of list) {
    if (!isInterjectMethodMissing(err)) {
      throw err instanceof Error ? err : new Error(String(err?.message || err));
    }
  }
  return interjectUnsupportedResult(interjectionId);
}

export function interjectRequestParams(opts = {}) {
  const sessionId = String(opts.sessionId || "").trim();
  const text = String(opts.text || "");
  const interjectionId = String(opts.interjectionId || "").trim();
  const images = Array.isArray(opts.images) ? opts.images : [];
  const params = { sessionId, text, interjectionId };
  if (images.length === 0) return params;
  const content = [];
  if (text.trim()) content.push({ type: "text", text });
  for (const img of images) {
    const data = String(img?.data || "");
    if (!data) continue;
    content.push({
      type: "image",
      data,
      mimeType: String(img?.mimeType || "image/png"),
    });
  }
  if (content.length) params.content = content;
  return params;
}

export function interjectAttempts(opts = {}) {
  const params = interjectRequestParams(opts);
  return [
    { method: "_x.ai/interject", params },
    { method: "x.ai/interject", params },
  ];
}

export function isSessionInterjectionMethod(method) {
  const value = String(method || "").replace(/^_/, "");
  return (
    value === "x.ai/session/interjection" ||
    value.endsWith("/session/interjection")
  );
}

/** Peel ext_notification wrappers around x.ai/session/interjection. */
export function unwrapSessionInterjection(method, params) {
  let currentMethod = String(method || "");
  let currentParams = params;
  for (let depth = 0; depth < 4; depth += 1) {
    if (isSessionInterjectionMethod(currentMethod)) {
      const body =
        currentParams && typeof currentParams === "object" ? currentParams : {};
      return {
        sessionId: String(body.sessionId || body.session_id || "").trim(),
        text: String(body.text || ""),
        interjectionId: String(
          body.interjectionId || body.interjection_id || "",
        ).trim(),
      };
    }
    if (
      !currentParams ||
      typeof currentParams !== "object" ||
      currentParams.method == null
    ) {
      break;
    }
    const inner = String(currentParams.method);
    if (
      inner === "ext_notification" ||
      inner.endsWith("/ext_notification") ||
      isSessionInterjectionMethod(inner)
    ) {
      currentMethod = inner;
      currentParams =
        currentParams.params !== undefined
          ? currentParams.params
          : currentParams;
      continue;
    }
    break;
  }
  return null;
}
