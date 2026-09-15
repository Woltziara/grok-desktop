/** This edition's GitHub Releases. Never send people to a different fork. */

export const UPDATE_RELEASES_URL =
  "https://github.com/Woltziara/grok-desktop/releases";
export const UPDATE_RELEASES_LATEST_URL =
  "https://github.com/Woltziara/grok-desktop/releases/latest";
export const UPDATE_INSTALL_GUIDE_URL =
  "https://github.com/Woltziara/grok-desktop#本地构建";

const TRANSIENT =
  /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ERR_FAILED|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network changed|temporarily unavailable/i;

const UNPUBLISHED =
  /Unable to find latest version on GitHub|has no published releases|no published updates for this edition/i;

export function isTransientUpdateError(err) {
  return TRANSIENT.test(String(err?.message || err || ""));
}

export function isUnpublishedUpdateError(err) {
  const raw = String(err?.message || err || "");
  if (isTransientUpdateError(err)) return false;
  return UNPUBLISHED.test(raw);
}

/**
 * @returns {"unpublished" | "transient" | "error"}
 */
export function classifyUpdateCheckError(err) {
  if (isUnpublishedUpdateError(err)) return "unpublished";
  if (isTransientUpdateError(err)) return "transient";
  return "error";
}

export function formatUpdateCheckError(err) {
  const raw = String(err?.message || err || "Unknown error");
  const withoutXml = raw
    .replace(/,?\s*XML:\s*[\s\S]*$/i, "")
    .replace(/<\?xml[\s\S]*$/i, "")
    .trim();
  const head =
    withoutXml.split("\n")[0]?.slice(0, 280) || withoutXml.slice(0, 280);
  const kind = classifyUpdateCheckError(err);

  if (kind === "unpublished") {
    return {
      kind,
      title: "还没有新版本",
      message: "这一版还没有发布自动更新。",
      detail:
        "这个发布源目前没有可安装的新包；这不代表本机安装已包含仓库里的最新源码。也不会去其他仓库下载。\n\n" +
        head,
      transient: false,
      offerReleases: false,
      releasesUrl: UPDATE_RELEASES_URL,
    };
  }

  if (kind === "transient") {
    return {
      kind,
      title: "Could not reach GitHub",
      message: "Network glitch while checking for updates.",
      detail:
        "This is usually a brief network change (Wi‑Fi, VPN, or sleep). Try again in a moment.\n\n" +
        head,
      transient: true,
      offerReleases: true,
      releasesUrl: UPDATE_RELEASES_URL,
    };
  }

  return {
    kind,
    title: "Could not check for updates",
    message: "Auto-update check failed.",
    detail: head,
    transient: false,
    offerReleases: true,
    releasesUrl: UPDATE_RELEASES_URL,
  };
}

/**
 * Only the updater's completed download may be installed.
 * Requires the updater's version + sha512 receipt, never a leftover cache zip.
 *
 * @param {{ downloadedFile?: string, size?: number, updateVersion?: string, sha512Receipt?: string }} input
 * @returns {string | null}
 */
export function pickMacUpdateZip(input = {}) {
  const file = String(input.downloadedFile || "").trim();
  const size = Number(input.size || 0);
  const receipt = String(input.sha512Receipt || "").trim();
  const actual = String(input.actualSha512 || "").trim();
  if (!file || !file.endsWith(".zip")) return null;
  if (!Number.isFinite(size) || size <= 10_000) return null;
  if (!String(input.updateVersion || "").trim()) return null;
  if (!receipt || !actual || receipt !== actual) return null;
  return file;
}

export function macBundleIdFromPlistXml(xml) {
  const text = String(xml || "");
  const match = text.match(
    /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
  );
  return match ? match[1].trim() : "";
}

export function macVersionFromPlistXml(xml) {
  const text = String(xml || "");
  const match = text.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
  );
  return match ? match[1].trim() : "";
}

export function normalizeCpuArch(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "x64" || raw === "amd64" || raw === "x86_64") return "x86_64";
  if (raw === "arm64" || raw === "aarch64") return "arm64";
  return raw;
}

export function archMatches(expected, actual) {
  const exp = normalizeCpuArch(expected);
  if (!exp) return false;
  const tokens = String(actual || "")
    .split(/[\s,/]+/)
    .map(normalizeCpuArch)
    .filter(Boolean);
  return tokens.includes(exp);
}

/**
 * Bind an update-downloaded event to electron-updater's exact selected file.
 * The helper fields are populated only after electron-updater has verified and
 * committed the download to its cache. All four copies must describe one file.
 *
 * @param {object} info update-downloaded event (includes downloadedFile)
 * @param {object} helper electron-updater downloadedUpdateHelper
 * @returns {{ ok: true, version: string, sha512Receipt: string, arch: string, url: string, downloadedFile: string } | { ok: false, reason: string }}
 */
export function updateReceiptFromDownload(info, helper) {
  const version = String(info?.version || "").trim();
  const files = Array.isArray(info?.files) ? info.files : [];
  const downloadedFile = String(info?.downloadedFile || "").trim();
  const helperFile = String(helper?.file || "").trim();
  const helperVersion = String(helper?.versionInfo?.version || "").trim();
  const selected = helper?.fileInfo?.info;
  const sha = String(selected?.sha512 || "").trim();
  const url = String(selected?.url || "").trim();
  const cachedSha = String(helper?.downloadedFileInfo?.sha512 || "").trim();
  const cachedName = String(helper?.downloadedFileInfo?.fileName || "").trim();

  if (!version || !downloadedFile || !helperFile) return { ok: false, reason: "download-path-missing" };
  if (downloadedFile !== helperFile) return { ok: false, reason: "download-path-mismatch" };
  if (!helperVersion || helperVersion !== version) return { ok: false, reason: "download-version-mismatch" };
  if (!sha || !cachedSha || sha !== cachedSha) return { ok: false, reason: "download-sha-mismatch" };
  if (!cachedName || !downloadedFile.endsWith(`/${cachedName}`)) return { ok: false, reason: "download-cache-name-mismatch" };
  const metadataFile = files.find(
    (file) => String(file?.url || "").trim() === url && String(file?.sha512 || "").trim() === sha,
  );
  if (!metadataFile) return { ok: false, reason: "selected-file-not-in-metadata" };
  if (!/\.zip(?:$|[?#])/i.test(url)) return { ok: false, reason: "selected-file-not-zip" };
  let arch = "";
  if (/arm64/i.test(url)) arch = "arm64";
  else if (/x64|x86_64|amd64/i.test(url)) arch = "x64";
  if (!arch) return { ok: false, reason: "selected-file-arch-missing" };
  return { ok: true, version, sha512Receipt: sha, arch, url, downloadedFile };
}
