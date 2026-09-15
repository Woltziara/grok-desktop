/**
 * electron-builder afterPack hook.
 * On Apple Silicon CI, binaries often get a partial linker ad-hoc signature that
 * macOS reports as "damaged". Re-sign the whole .app deeply with a clean ad-hoc
 * signature so xattr + open works for the team (until Developer ID notarization).
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

function updaterConfigFromContext(context) {
  const publish = context.packager.config.publish;
  const selected = Array.isArray(publish) ? publish[0] : publish;
  if (!selected || typeof selected !== "object") {
    throw new Error("[afterPack] build.publish must define this edition's update provider");
  }
  if (selected.provider !== "github") {
    throw new Error(`[afterPack] unsupported update provider: ${selected.provider || "(empty)"}`);
  }
  const owner = String(selected.owner || "").trim();
  const repo = String(selected.repo || "").trim();
  const updaterCacheDirName = String(context.packager.appInfo.updaterCacheDirName || "").trim();
  if (!owner || !repo || !updaterCacheDirName) {
    throw new Error("[afterPack] GitHub owner, repo, and updater cache identity are required");
  }
  return { provider: "github", owner, repo, updaterCacheDirName };
}

function writeUpdaterConfig(appPath, config) {
  const target = path.join(appPath, "Contents", "Resources", "app-update.yml");
  const scalar = (value) => JSON.stringify(String(value));
  const yaml = [
    `provider: ${scalar(config.provider)}`,
    `owner: ${scalar(config.owner)}`,
    `repo: ${scalar(config.repo)}`,
    `updaterCacheDirName: ${scalar(config.updaterCacheDirName)}`,
    "",
  ].join("\n");
  fs.writeFileSync(target, yaml, { encoding: "utf8", mode: 0o644 });
  return target;
}

exports.updaterConfigFromContext = updaterConfigFromContext;
exports.writeUpdaterConfig = writeUpdaterConfig;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn("[afterPack] app not found:", appPath);
    return;
  }

  // electron-builder's publish manager skips app-update.yml for a --dir-only
  // macOS build. electron-updater still requires it both to select the GitHub
  // provider and to isolate this edition's download cache.
  const expectedUpdateConfig = updaterConfigFromContext(context);
  const updaterConfigPath = writeUpdaterConfig(appPath, expectedUpdateConfig);
  console.log("[afterPack] updater config:", updaterConfigPath);

  const verifier = await import(pathToFileURL(path.join(__dirname, "verify-package.mjs")).href);
  verifier.verifyPackage(appPath, {
    expectedDependencies: require(path.join(context.packager.info.projectDir || context.packager.projectDir || process.cwd(), "package.json")).dependencies || {},
    expectedUpdateConfig,
  });
  console.log("[afterPack] package integrity ok");

  console.log("[afterPack] ad-hoc deep codesign:", appPath);
  // Remove any broken partial signatures first, then deep ad-hoc sign
  try {
    execFileSync("xattr", ["-cr", appPath], { stdio: "inherit" });
  } catch {
    /* optional */
  }
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log("[afterPack] codesign ok");
};
