/** Presentation URLs never serve as the authority for page identity. */
const SECRET_QUERY = /^(?:code|(?:access|refresh|id|oauth)[_-]?token|token|client[_-]?secret|authenticity[_-]?token|id[_-]?token[_-]?hint|samlresponse|assertion)$/i;
const AUTH_PATH = /(?:^|\/)(?:oauth2?|oidc|authorize|callback|signin|sign-in|login|sso|auth)(?:\/|$)/i;

function httpUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch { return null; }
}
function authPath(pathname, hostname = "") {
  return AUTH_PATH.test(pathname) || /^auth\./i.test(hostname) || /^(?:accounts\.google\.com|login\.microsoftonline\.com)$/i.test(hostname);
}
function hasSecret(params) { return [...params.keys()].some(key => SECRET_QUERY.test(key)); }

/** Main-process input to an opaque hash. Never broadcast or persist this value. */
export function previewIdentityHref(raw) {
  const url = httpUrl(raw);
  if (!url) return "";
  url.username = ""; url.password = "";
  return url.href;
}

/** Model-facing and cross-window presentation: no query, fragment or userinfo. */
export function publicPreviewHref(raw) {
  const url = httpUrl(raw);
  if (!url) return "";
  url.username = ""; url.password = ""; url.search = ""; url.hash = "";
  return url.href;
}
export function canonicalPreviewHref(raw) { return publicPreviewHref(raw); }
export function safePreviewLabel(raw) {
  const href = publicPreviewHref(raw);
  if (!href) return "浏览器页面";
  const url = new URL(href);
  const pathname = url.pathname.length > 240 ? `${url.pathname.slice(0, 237)}…` : url.pathname;
  return `${url.origin}${pathname === "/" ? "" : pathname}`;
}

/** null preserves the last safe destination instead of replaying an OAuth URL. */
export function persistablePreviewUrl(raw) {
  if (!raw || raw === "about:blank") return "";
  const url = httpUrl(raw);
  if (!url) return "";
  if (url.username || url.password || authPath(url.pathname, url.hostname) || hasSecret(url.searchParams)) return null;
  const fragment = url.hash.slice(1);
  const bang = fragment.startsWith("!/");
  if (fragment.startsWith("/") || bang) {
    const route = new URL(bang ? fragment.slice(1) : fragment, "https://hash-route.invalid");
    if (authPath(route.pathname) || hasSecret(route.searchParams)) return null;
    const nested = new URLSearchParams(route.hash.slice(1));
    if (hasSecret(nested) || nested.has("session_state")) return null;
  } else if (fragment.includes("=")) {
    const params = new URLSearchParams(fragment);
    if (hasSecret(params) || params.has("state") || params.has("session_state")) return null;
  }
  return url.href;
}
