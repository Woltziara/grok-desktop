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
        "当前安装的就是现在的版本。没有可安装的新包，也不会去其他仓库下载。\n\n" +
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
  if (!file || !file.endsWith(".zip")) return null;
  if (!Number.isFinite(size) || size <= 10_000) return null;
  if (!String(input.updateVersion || "").trim()) return null;
  if (!String(input.sha512Receipt || "").trim()) return null;
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

export function shouldReplaceAfterWait(processStillAlive) {
  return processStillAlive !== true;
}

/**
 * Refuse install unless every identity field is present and matches.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function macUpdateIdentityAccepted({
  expectedBundleId,
  actualBundleId,
  expectedVersion,
  actualVersion,
  expectedArch,
  actualArch,
} = {}) {
  if (!expectedBundleId) return { ok: false, reason: "bundle-id-unreadable" };
  if (!actualBundleId) return { ok: false, reason: "new-bundle-id-unreadable" };
  if (expectedBundleId !== actualBundleId) return { ok: false, reason: "bundle-id-mismatch" };
  if (!expectedVersion || !actualVersion) return { ok: false, reason: "version-missing" };
  if (expectedVersion !== actualVersion) return { ok: false, reason: "version-mismatch" };
  if (!expectedArch || !actualArch) return { ok: false, reason: "arch-missing" };
  if (!archMatches(expectedArch, actualArch)) return { ok: false, reason: "arch-mismatch" };
  return { ok: true };
}

export function updateReceiptFromDownload(info) {
  const version = String(info?.version || "").trim();
  const files = Array.isArray(info?.files) ? info.files : [];
  const sha = String(files[0]?.sha512 || info?.sha512 || "").trim();
  const url = String(files[0]?.url || files[0]?.path || "").trim();
  let arch = "";
  if (/arm64/i.test(url)) arch = "arm64";
  else if (/x64|x86_64|amd64/i.test(url)) arch = "x64";
  return { version, sha512Receipt: sha, arch, url };
}
