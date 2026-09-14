/**
 * Legacy formatting helpers retained for recovery diagnostics only.
 * Active transfer uses explicit continuation packs, never time-based overwrite.
 */

export const PROJECTS_EXCLUDES = [
  // Application source follows its Git history, not bidirectional mtimes.
  // In particular an older peer must not restore the retired nested clones.
  "/Grok Desktop/",
  ".dev",
  ".grok-desktop",
  "node_modules",
  ".git",
  "dist",
  "release",
  "target",
  "__pycache__",
  ".DS_Store",
  ".cache",
  ".turbo",
  ".next",
  "coverage",
  "*.pyc",
];

export const GROK_EXCLUDES = [
  "bin",
  "downloads",
  "logs",
  "memtrace",
  "overlays",
  "vendor",
  "marketplace-cache",
  "completions",
  "grove",
  "bundled",
  "docs",
  "relocations",
  "worktrees",
  "worktrees.db",
  "*.lock",
  "active_sessions.json",
  "leader.sock",
  // Login always stays per-machine.
  "auth.json",
];

export const GROK_INCLUDE_TOP = [
  "sessions",
  "memory",
  "skills",
  "rules",
  "hooks",
  "slash-mru.json",
];

/** Installed desktop shell. Align never copies this; it is sent on its own. */
export const APPLICATIONS_APP = "/Applications/Grok Desktop.app";

/**
 * Packaged Electron binary lives at `Something.app/Contents/MacOS/<name>`.
 * @param {string} execPath
 * @returns {string | null}
 */
export function appBundleFromExecPath(execPath) {
  const exe = String(execPath || "").replace(/\\/g, "/");
  const marker = ".app/Contents/MacOS/";
  const idx = exe.toLowerCase().lastIndexOf(marker.toLowerCase());
  if (idx === -1) return null;
  return exe.slice(0, idx + 4);
}

/**
 * Studio vs 僚机. Tailscale first (works on trips), Thunderbolt when docked.
 */
export function peerHostsForThisMachine(hostname) {
  const hn = String(hostname || "").toLowerCase();
  const isLaptop = /macbook|wingman|pro/.test(hn) && !/studio/.test(hn);
  if (isLaptop) {
    return {
      role: "laptop",
      label: "Studio",
      hosts: ["100.98.141.28", "10.10.10.1"],
    };
  }
  return {
    role: "studio",
    label: "僚机 MacBook Pro",
    hosts: ["100.81.49.104", "10.10.10.2"],
  };
}

export function rsyncExcludeArgs(patterns) {
  return (patterns || []).flatMap((p) => ["--exclude", p]);
}

/**
 * Parse `rsync -aunv` dry-run stdout into a short file list.
 * @param {string} text
 */
export function parseRsyncDryRun(text) {
  const lines = String(text || "").split(/\r?\n/);
  /** @type {string[]} */
  const files = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^sending incremental|^sent |^total size|^cannot|^rsync:|^Transfer starting/i.test(line)) {
      continue;
    }
    if (line === "./" || line === ".") continue;
    if (line.endsWith("/")) continue;
    files.push(line.replace(/^\.\//, ""));
  }
  return files;
}

/**
 * @param {string[]} files
 * @param {number} [cap]
 */
export function summarizeFileList(files, cap = 12) {
  const list = Array.isArray(files) ? files : [];
  const shown = list.slice(0, cap);
  const more = Math.max(0, list.length - shown.length);
  return { count: list.length, shown, more };
}

/**
 * Human one-liner after a dry-run of both directions.
 * @param {{ pull: string[], push: string[] }} dirs
 */
export function alignmentPreviewText(dirs) {
  const pull = dirs?.pull || [];
  const push = dirs?.push || [];
  if (pull.length === 0 && push.length === 0) {
    return "两边已经一样，不用动。";
  }
  const bits = [];
  if (pull.length) bits.push(`从对面拿来 ${pull.length} 份`);
  if (push.length) bits.push(`从这边送过去 ${push.length} 份`);
  return bits.join("，") + "。先核对范围，冲突需明确选择，原件会保留。";
}
