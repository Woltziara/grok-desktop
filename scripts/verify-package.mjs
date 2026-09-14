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

function fail(message) {
  throw new Error(`[package-integrity] ${message}`);
}

function plist(file) {
  try {
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
  return { appPath, bundleName, dependencies: Object.keys(packageJson.dependencies || {}), integrityChecked: Boolean(integrity) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appPath = process.argv[2];
  if (!appPath) fail("usage: node scripts/verify-package.mjs /path/to/Grok Desktop.app");
  const sourceManifest = path.join(process.cwd(), "package.json");
  const expectedDependencies = exists(sourceManifest)
    ? JSON.parse(fs.readFileSync(sourceManifest, "utf8")).dependencies || {}
    : undefined;
  console.log(JSON.stringify(verifyPackage(path.resolve(appPath), { expectedDependencies })));
}
