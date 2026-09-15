/** Preview URLs: opaque identity keeps routing; public form strips auth only. */

const AUTH_QUERY =
  /^(?:code|state|session_state|access_token|refresh_token|id_token|token|client_secret|oauth_token|authenticity_token|id_token_hint)$/i;

function httpUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function isOauthHash(hash) {
  const h = String(hash || "");
  return /^(#|#!)?(?:access_token|id_token|token|code|session_state)=/i.test(h);
}

function keepHash(hash) {
  const h = String(hash || "");
  if (!h || h === "#") return false;
  if (h.startsWith("#/") || h.startsWith("#!/")) return true;
  if (isOauthHash(h) || h.includes("=")) return false;
  return false;
}

/** Full page identity: keep query and hash, drop userinfo. */
export function previewIdentityHref(raw) {
  const url = httpUrl(raw);
  if (!url) return "";
  url.username = "";
  url.password = "";
  return url.href;
}

export function publicPreviewHref(raw) {
  const url = httpUrl(raw);
  if (!url) return "";
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (AUTH_QUERY.test(key)) url.searchParams.delete(key);
  }
  if (!keepHash(url.hash)) url.hash = "";
  return url.href;
}

export function canonicalPreviewHref(raw) {
  return publicPreviewHref(raw);
}

export function safePreviewLabel(raw) {
  const href = publicPreviewHref(raw);
  if (!href) return "浏览器页面";
  try {
    const url = new URL(href);
    const path =
      url.pathname.length > 160 ? `${url.pathname.slice(0, 157)}…` : url.pathname;
    const query = url.search.length > 80 ? `${url.search.slice(0, 77)}…` : url.search;
    const hash = url.hash.length > 80 ? `${url.hash.slice(0, 77)}…` : url.hash;
    return `${url.origin}${path === "/" && !query && !hash ? "" : path}${query}${hash}`;
  } catch {
    return "浏览器页面";
  }
}

export function persistablePreviewUrl(raw) {
  if (!raw || raw === "about:blank") return "";
  return publicPreviewHref(raw);
}
