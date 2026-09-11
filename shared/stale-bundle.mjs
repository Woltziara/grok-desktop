/**
 * Running window vs installed bundle. Replacing the .app while a window is
 * still open is how "source has the plus, this window does not" happens.
 */

export function isBundleNewerThanLaunch(currentMtime, launchedMtime, slackMs = 1500) {
  const now = Number(currentMtime);
  const then = Number(launchedMtime);
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return false;
  return now > then + slackMs;
}

export function bundlePathFromExec(execPath, platform = process.platform) {
  const exe = String(execPath || "");
  if (!exe) return "";
  if (platform === "darwin") {
    const needle = ".app/Contents/MacOS/";
    const at = exe.lastIndexOf(needle);
    if (at >= 0) return exe.slice(0, at + 4);
  }
  return exe;
}

/** Packaged UI lives in Resources/app.asar — replacing it does not bump .app mtime. */
export function asarPathFromExec(execPath, platform = process.platform) {
  const exe = String(execPath || "");
  if (!exe) return "";
  if (platform === "darwin") {
    const needle = ".app/Contents/MacOS/";
    const at = exe.lastIndexOf(needle);
    if (at >= 0) return `${exe.slice(0, at + 4)}/Contents/Resources/app.asar`;
  }
  return "";
}

export function isPackNewerThanLaunch(currentMtimes, launchedMtimes, slackMs = 1500) {
  const now = Array.isArray(currentMtimes) ? currentMtimes : [currentMtimes];
  const then = Array.isArray(launchedMtimes) ? launchedMtimes : [launchedMtimes];
  for (let i = 0; i < now.length; i += 1) {
    if (isBundleNewerThanLaunch(now[i], then[i] || then[0], slackMs)) return true;
  }
  return false;
}
