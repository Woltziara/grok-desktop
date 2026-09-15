import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { finished } from "node:stream/promises";
import { verifyPackage } from "../scripts/verify-package.mjs";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const plist = (name, hash) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleName</key><string>${name}</string><key>ElectronAsarIntegrity</key><dict><key>Resources/app.asar</key><dict><key>algorithm</key><string>SHA256</string><key>hash</key><string>${hash}</string></dict></dict></dict></plist>`;

async function fixture({ missing = null, badHash = false, asarDeps, updateConfig } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-package-"));
  const app = path.join(root, "Fixture.app");
  const contents = path.join(app, "Contents");
  const resources = path.join(contents, "Resources");
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "node_modules", "react"), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  if (updateConfig !== null) {
    const config = updateConfig || {
      provider: "github",
      owner: "Woltziara",
      repo: "grok-desktop",
      updaterCacheDirName: "grok-desktop-updater",
    };
    fs.writeFileSync(
      path.join(resources, "app-update.yml"),
      Object.entries(config).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n") + "\n",
    );
  }
  const dependencies = asarDeps || { react: "1", "playwright-core": "1" };
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "fixture", dependencies }));
  fs.writeFileSync(path.join(source, "node_modules", "react", "package.json"), JSON.stringify({ name: "react" }));
  const archiveWrite = await asar.createPackage(source, path.join(resources, "app.asar"));
  // ASAR 3 returns the ended stream before its final writes have finished.
  await finished(archiveWrite);
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
    const result = verifyPackage(app, {
      expectedUpdateConfig: {
        provider: "github",
        owner: "Woltziara",
        repo: "grok-desktop",
        updaterCacheDirName: "grok-desktop-updater",
      },
    });
    assert.deepEqual(result.dependencies.sort(), ["playwright-core", "react"]);
    assert.equal(result.integrityChecked, true);
    assert.equal(result.updateConfig.updaterCacheDirName, "grok-desktop-updater");
  });
});

test("package verifier rejects a missing electron-updater config", async () => {
  await withFixture({ updateConfig: null }, async (app) => {
    assert.throws(() => verifyPackage(app), /missing updater config/);
  });
});

test("package verifier rejects another GitHub repository", async () => {
  await withFixture({ updateConfig: {
    provider: "github",
    owner: "Woltziara",
    repo: "another-fork",
    updaterCacheDirName: "grok-desktop-updater",
  } }, async (app) => {
    assert.throws(() => verifyPackage(app, {
      expectedUpdateConfig: {
        provider: "github",
        owner: "Woltziara",
        repo: "grok-desktop",
        updaterCacheDirName: "grok-desktop-updater",
      },
    }), /repo mismatch/);
  });
});

test("package verifier rejects credentials in updater metadata", async () => {
  await withFixture({ updateConfig: {
    provider: "github",
    owner: "Woltziara",
    repo: "grok-desktop",
    updaterCacheDirName: "grok-desktop-updater",
    token: "must-not-ship",
  } }, async (app) => {
    assert.throws(() => verifyPackage(app), /never credentials/);
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
