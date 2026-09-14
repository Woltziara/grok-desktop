import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { verifyPackage } from "../scripts/verify-package.mjs";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const plist = (name, hash) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>${name}</string><key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>${hash}</string></dict></dict></dict></plist>`;

async function fixture({ missing = null, badHash = false, asarDeps } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-package-"));
  const app = path.join(root, "Fixture.app");
  const contents = path.join(app, "Contents");
  const resources = path.join(contents, "Resources");
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "node_modules", "react"), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  const dependencies = asarDeps || { react: "1", "playwright-core": "1" };
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "fixture", dependencies }));
  fs.writeFileSync(path.join(source, "node_modules", "react", "package.json"), JSON.stringify({ name: "react" }));
  await asar.createPackage(source, path.join(resources, "app.asar"));
  const unpacked = path.join(resources, "app.asar.unpacked", "node_modules", "playwright-core");
  if (missing !== "playwright") {
    fs.mkdirSync(unpacked, { recursive: true });
    fs.writeFileSync(path.join(unpacked, "package.json"), JSON.stringify({ name: "playwright-core" }));
  }
  const name = "Fixture";
  for (const suffix of ["Helper", "Helper (Renderer)", "Helper (GPU)", "Helper (Plugin)"]) {
    if (missing === suffix) continue;
    const executable = path.join(contents, "Frameworks", `${name} ${suffix}.app`, "Contents", "MacOS", `${name} ${suffix}`);
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "fixture");
  }
  const raw = asar.getRawHeader(path.join(resources, "app.asar"));
  const hash = createHash("sha256").update(raw.headerString).digest("hex");
  fs.writeFileSync(path.join(contents, "Info.plist"), plist(name, badHash ? "0".repeat(64) : hash));
  return { root, app };
}

async function withFixture(options, fn) {
  const item = await fixture(options);
  try { await fn(item.app); } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
}

test("package verifier accepts an app with packed and unpacked direct dependencies", async () => {
  await withFixture({}, async (app) => {
    const result = verifyPackage(app);
    assert.deepEqual(result.dependencies.sort(), ["playwright-core", "react"]);
    assert.equal(result.integrityChecked, true);
  });
});

test("package verifier rejects an absent unpacked playwright-core", async () => {
  await withFixture({ missing: "playwright" }, async (app) => {
    assert.throws(() => verifyPackage(app), /playwright-core is absent/);
  });
});

test("package verifier rejects an app.asar manifest that lost playwright-core", async () => {
  await withFixture({ asarDeps: { react: "1" } }, async (app) => {
    assert.throws(
      () => verifyPackage(app, { expectedDependencies: { react: "1", "playwright-core": "1" } }),
      /direct dependencies do not match/,
    );
  });
});

test("package verifier rejects a Helper path that no longer matches CFBundleName", async () => {
  await withFixture({ missing: "Helper (GPU)" }, async (app) => {
    assert.throws(() => verifyPackage(app), /missing Helper executable/);
  });
});

test("package verifier rejects an ElectronAsarIntegrity header mismatch", async () => {
  await withFixture({ badHash: true }, async (app) => {
    assert.throws(() => verifyPackage(app), /hash does not match/);
  });
});
