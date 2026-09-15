import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  archMatches,
  macBundleIdFromPlistXml,
  pickMacUpdateZip,
  updateReceiptFromDownload,
} from "../shared/update-identity.mjs";
import { MAC_UPDATE_HELPER_SCRIPT } from "./mac-update-helper.mjs";

const execFileAsync = promisify(execFile);

function failure(reason, detail) {
  return {
    ok: false,
    reason,
    detail: String(detail || reason),
    message:
      "The update was not installed. Grok Desktop is still open and usable. Try downloading the installer from Releases, or try again later.",
  };
}

export async function sha512File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha512");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    hash.on("error", reject);
    hash.on("finish", () => resolve(hash.digest("base64")));
    input.pipe(hash);
  });
}

async function defaultCommand(command, args) {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(result.stdout || "").trim();
}

async function plistValue(appPath, key, command = defaultCommand) {
  return await command("/usr/bin/plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    path.join(appPath, "Contents", "Info.plist"),
  ]);
}

async function currentBundleId(appPath, command = defaultCommand) {
  try {
    return await plistValue(appPath, "CFBundleIdentifier", command);
  } catch {
    const xml = await fsp.readFile(path.join(appPath, "Contents", "Info.plist"), "utf8");
    return macBundleIdFromPlistXml(xml);
  }
}

/** Inspect exactly the executable named by CFBundleExecutable. */
export async function inspectMacBundle(appPath, command = defaultCommand) {
  const bundleId = await plistValue(appPath, "CFBundleIdentifier", command);
  const version = await plistValue(appPath, "CFBundleShortVersionString", command);
  const executable = await plistValue(appPath, "CFBundleExecutable", command);
  if (!executable || executable === "." || executable === ".." || executable.includes("/")) {
    throw new Error("invalid CFBundleExecutable");
  }
  const executablePath = path.join(appPath, "Contents", "MacOS", executable);
  const stat = await fsp.stat(executablePath);
  if (!stat.isFile()) throw new Error("CFBundleExecutable is not a file");
  await fsp.access(executablePath, fs.constants.X_OK);
  const architectures = await command("/usr/bin/lipo", ["-archs", executablePath]);
  if (!architectures) throw new Error("could not read executable architecture");
  return { bundleId, version, executable, executablePath, architectures };
}

/**
 * Validate, hash and extract the downloaded zip before the running app closes,
 * then start a detached helper that waits for this process to exit.
 */
export async function prepareMacUpdateInstall({
  autoUpdater,
  downloadInfo,
  appPath,
  currentPid,
  logPath = path.join(os.homedir(), "Library", "Logs", "grok-desktop-update.log"),
  tempRoot = os.tmpdir(),
  command = defaultCommand,
  hashFile = sha512File,
  spawnProcess = spawn,
} = {}) {
  let stagedRoot = "";
  let scriptPath = "";
  let helperStarted = false;
  try {
    const helper = autoUpdater?.downloadedUpdateHelper;
    const receipt = updateReceiptFromDownload(downloadInfo, helper);
    if (!receipt.ok) return failure(receipt.reason, "The downloaded update receipt did not match the updater's selected file.");

    if (!appPath || !appPath.endsWith(".app")) return failure("bad-app-path", "The running application path is not a .app bundle.");
    const appStat = await fsp.stat(appPath);
    if (!appStat.isDirectory()) return failure("bad-app-path", "The running application bundle is missing.");
    await fsp.access(path.dirname(appPath), fs.constants.W_OK);

    const size = (await fsp.stat(receipt.downloadedFile)).size;
    const actualSha512 = await hashFile(receipt.downloadedFile);
    const zipPath = pickMacUpdateZip({
      downloadedFile: receipt.downloadedFile,
      size,
      updateVersion: receipt.version,
      sha512Receipt: receipt.sha512Receipt,
      actualSha512,
    });
    if (!zipPath) return failure("download-verification-failed", "The downloaded update failed its SHA-512 or file checks.");

    const expectedBundleId = await currentBundleId(appPath, command);
    if (!expectedBundleId) return failure("current-bundle-id-unreadable", "The current application identity could not be read.");

    stagedRoot = await fsp.mkdtemp(path.join(tempRoot, "grok-desktop-update-stage-"));
    await command("/usr/bin/ditto", ["-x", "-k", zipPath, stagedRoot]);
    const stagedApp = path.join(stagedRoot, path.basename(appPath));
    const identity = await inspectMacBundle(stagedApp, command);
    if (identity.bundleId !== expectedBundleId) return failure("bundle-id-mismatch", "The update belongs to a different application.");
    if (identity.version !== receipt.version) return failure("version-mismatch", "The extracted app version does not match the update receipt.");
    if (!archMatches(receipt.arch, identity.architectures)) {
      return failure("arch-mismatch", "The update architecture does not match this installation.");
    }

    scriptPath = path.join(tempRoot, `grok-desktop-update-${currentPid}-${Date.now()}.sh`);
    await fsp.writeFile(scriptPath, MAC_UPDATE_HELPER_SCRIPT, { encoding: "utf8", mode: 0o700 });
    const child = spawnProcess(
      "/bin/bash",
      [
        scriptPath,
        logPath,
        String(currentPid),
        stagedRoot,
        appPath,
        expectedBundleId,
        receipt.version,
        receipt.arch,
        "180",
        "0.5",
        "/usr/bin/open",
        "/usr/bin/ditto",
        "/usr/bin/lipo",
        "/usr/bin/plutil",
        "/usr/bin/osascript",
      ],
      {
        detached: true,
        stdio: "ignore",
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          LANG: process.env.LANG || "C",
        },
      },
    );
    child.unref();
    helperStarted = true;
    return { ok: true, stagedRoot, scriptPath, receipt };
  } catch (err) {
    return failure("preflight-failed", err?.message || err);
  } finally {
    // Ownership transfers to the detached helper only after a successful spawn.
    // The caller can identify that state because both paths still exist here.
    if (stagedRoot && !helperStarted) await fsp.rm(stagedRoot, { recursive: true, force: true }).catch(() => {});
    if (scriptPath && !helperStarted) await fsp.rm(scriptPath, { force: true }).catch(() => {});
  }
}

/**
 * The only point that makes the running UI unavailable. It runs strictly after
 * prepareMacUpdateInstall has completed and spawned its waiting helper.
 */
export async function runMacInstallTransaction({ prepare, dispose, destroyWindows, exitSoon }) {
  const prepared = await prepare();
  if (!prepared?.ok) return prepared || failure("preflight-failed");
  dispose?.();
  destroyWindows();
  exitSoon();
  return prepared;
}
