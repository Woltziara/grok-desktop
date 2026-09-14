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

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn("[afterPack] app not found:", appPath);
    return;
  }

  const verifier = await import(pathToFileURL(path.join(__dirname, "verify-package.mjs")).href);
  verifier.verifyPackage(appPath, {
    expectedDependencies: require(path.join(context.packager.info.projectDir || context.packager.projectDir || process.cwd(), "package.json")).dependencies || {},
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
