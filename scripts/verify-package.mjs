#!/usr/bin/env node
/** Verify a macOS electron-builder .app before it is signed or shipped. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const plistParser = require("plist");
const yaml = require("js-yaml");

function fail(message) {
  throw new Error(`[package-integrity] ${message}`);
}

function plist(file) {
  try {
    const bytes = fs.readFileSync(file);
    // XML plists are portable; keep macOS plutil for binary plists only.
    // This also exercises real ASAR/Helper checks in Linux CI instead of skipping them.
    if (bytes.subarray(0, 6).toString() !== "bplist") {
      return plistParser.parse(bytes.toString("utf8"));
    }
    return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
  } catch (err) {
    fail(`cannot read Info.plist (${file}): ${err.message}`);
  }
}

function exists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function asarFile(asarPath, relative) {
  try {
    return asar.extractFile(asarPath, relative);
  } catch {
    return null;
  }
}

function packageJsonAt(asarPath, unpacked, dep) {
  const relative = path.posix.join("node_modules", dep, "package.json");
  const packed = asarFile(asarPath, relative);
  if (packed) return { source: "asar", json: JSON.parse(packed.toString("utf8")) };
  const disk = path.join(unpacked, ...relative.split("/"));
  if (exists(disk)) return { source: "unpacked", json: JSON.parse(fs.readFileSync(disk, "utf8")) };
  fail(`direct dependency ${dep} is absent from app.asar and app.asar.unpacked`);
}

function readUpdateConfig(file) {
  if (!exists(file)) fail(`missing updater config: ${file}`);
  let config;
  try { config = yaml.load(fs.readFileSync(file, "utf8")); }
  catch (err) { fail(`cannot parse updater config (${file}): ${err.message}`); }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    fail("updater config must be a YAML object");
  }
  for (const field of ["provider", "owner", "repo", "updaterCacheDirName"]) {
    if (typeof config[field] !== "string" || !config[field].trim()) {
      fail(`updater config ${field} is missing or empty`);
    }
  }
  if (config.provider !== "github") fail(`updater config provider must be github, found ${config.provider}`);
  if (config.token != null || config.requestHeaders != null || config.private === true) {
    fail("updater config must contain only public update-source metadata, never credentials or private-repository settings");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(config.updaterCacheDirName)) {
    fail("updaterCacheDirName must be a safe single directory name");
  }
  return config;
}

export function verifyPackage(appPath, options = {}) {
  const contents = path.join(appPath, "Contents");
  const resources = path.join(contents, "Resources");
  const asarPath = path.join(resources, "app.asar");
  const infoPath = path.join(contents, "Info.plist");
  if (!exists(asarPath)) fail(`missing app.asar: ${asarPath}`);
  if (!exists(infoPath)) fail(`missing app Info.plist: ${infoPath}`);

  const info = plist(infoPath);
  const bundleName = String(info.CFBundleName || "").trim();
  if (!bundleName) fail("CFBundleName is empty");
  for (const suffix of ["Helper", "Helper (Renderer)", "Helper (GPU)", "Helper (Plugin)"]) {
    const name = `${bundleName} ${suffix}`;
    const helper = path.join(contents, "Frameworks", `${name}.app`, "Contents", "MacOS", name);
    if (!exists(helper)) fail(`missing Helper executable matching CFBundleName: ${helper}`);
  }

  const packageBuffer = asarFile(asarPath, "package.json");
  if (!packageBuffer) fail("app.asar is missing package.json");
  let packageJson;
  try { packageJson = JSON.parse(packageBuffer.toString("utf8")); }
  catch { fail("app.asar package.json is invalid JSON"); }

  const updateConfig = readUpdateConfig(path.join(resources, "app-update.yml"));
  const expectedUpdateConfig = options.expectedUpdateConfig;
  if (expectedUpdateConfig) {
    for (const field of ["provider", "owner", "repo", "updaterCacheDirName"]) {
      if (updateConfig[field] !== expectedUpdateConfig[field]) {
        fail(`updater config ${field} mismatch: expected ${expectedUpdateConfig[field]}, found ${updateConfig[field]}`);
      }
    }
  }
  const expected = options.expectedDependencies;
  if (expected) {
    const actualEntries = Object.entries(packageJson.dependencies || {}).sort();
    const expectedEntries = Object.entries(expected).sort();
    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      fail("app.asar package.json direct dependencies do not match the build manifest");
    }
  }
  const unpacked = `${asarPath}.unpacked`;
  for (const dep of Object.keys(packageJson.dependencies || {})) {
    const found = packageJsonAt(asarPath, unpacked, dep);
    if (found.json.name !== dep) fail(`dependency package name mismatch for ${dep}: found ${found.json.name || "(empty)"}`);
  }

  const integrity = info.ElectronAsarIntegrity?.["Resources/app.asar"];
  if (integrity) {
    if (String(integrity.algorithm || "").toUpperCase() !== "SHA256") fail("ElectronAsarIntegrity algorithm must be SHA256");
    const actual = createHash("sha256").update(asar.getRawHeader(asarPath).headerString).digest("hex");
    if (String(integrity.hash || "").toLowerCase() !== actual) fail("ElectronAsarIntegrity hash does not match app.asar header");
  }
  return {
    appPath,
    bundleName,
    dependencies: Object.keys(packageJson.dependencies || {}),
    integrityChecked: Boolean(integrity),
    updateConfig,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appPath = process.argv[2];
  if (!appPath) fail("usage: node scripts/verify-package.mjs /path/to/Grok Desktop.app");
  const sourceManifest = path.join(process.cwd(), "package.json");
  const expectedDependencies = exists(sourceManifest)
    ? JSON.parse(fs.readFileSync(sourceManifest, "utf8")).dependencies || {}
    : undefined;
  let expectedUpdateConfig;
  if (exists(sourceManifest)) {
    const manifest = JSON.parse(fs.readFileSync(sourceManifest, "utf8"));
    const publish = Array.isArray(manifest.build?.publish) ? manifest.build.publish[0] : manifest.build?.publish;
    if (publish?.provider === "github") {
      expectedUpdateConfig = {
        provider: "github",
        owner: publish.owner,
        repo: publish.repo,
        updaterCacheDirName: `${manifest.name.toLowerCase()}-updater`,
      };
    }
  }
  console.log(JSON.stringify(verifyPackage(path.resolve(appPath), { expectedDependencies, expectedUpdateConfig })));
}
