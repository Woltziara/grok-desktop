import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  prepareMacUpdateInstall,
  runMacInstallTransaction,
} from "../electron/mac-update-install.mjs";
import { MAC_UPDATE_HELPER_SCRIPT } from "../electron/mac-update-helper.mjs";

const roots = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mac-update-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function receiptFixture(root, arch = "arm64") {
  const name = `GrokDesktop-2.0.0-Mac-${arch}.zip`;
  const downloadedFile = path.join(root, "pending", name);
  fs.mkdirSync(path.dirname(downloadedFile), { recursive: true });
  fs.writeFileSync(downloadedFile, Buffer.alloc(20_000, 1));
  const selected = { url: name, sha512: "verified-sha" };
  const info = { version: "2.0.0", downloadedFile, files: [
    { url: "GrokDesktop-2.0.0-Mac-x64.zip", sha512: "x64-sha" },
    selected,
  ] };
  const autoUpdater = { downloadedUpdateHelper: {
    file: downloadedFile,
    versionInfo: { version: info.version },
    fileInfo: { info: selected },
    downloadedFileInfo: { fileName: name, sha512: selected.sha512 },
  } };
  return { info, autoUpdater };
}

function syntheticCommand({ failLipo = false } = {}) {
  return async (command, args) => {
    if (command.endsWith("ditto")) {
      const stagedApp = path.join(args[3], "Grok Desktop.app");
      const executable = path.join(stagedApp, "Contents", "MacOS", "Grok Desktop");
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, "synthetic");
      fs.chmodSync(executable, 0o755);
      fs.mkdirSync(path.join(stagedApp, "Contents"), { recursive: true });
      fs.writeFileSync(path.join(stagedApp, "Contents", "Info.plist"), "plist");
      return "";
    }
    if (command.endsWith("plutil")) {
      const key = args[1];
      if (key === "CFBundleIdentifier") return "com.karman.grok-desktop";
      if (key === "CFBundleShortVersionString") return "2.0.0";
      if (key === "CFBundleExecutable") return "Grok Desktop";
    }
    if (command.endsWith("lipo")) {
      if (failLipo) throw new Error("lipo could not parse executable");
      return "arm64";
    }
    throw new Error(`unexpected command ${command}`);
  };
}

test("failed Mac preflight keeps the UI available and never reaches native install", async () => {
  const root = tempRoot();
  const { info, autoUpdater } = receiptFixture(root);
  const calls = [];
  autoUpdater.quitAndInstall = () => calls.push("native-install");
  const result = await runMacInstallTransaction({
    prepare: () =>
      prepareMacUpdateInstall({
        autoUpdater,
        downloadInfo: { ...info, downloadedFile: `${info.downloadedFile}.other` },
        appPath: path.join(root, "Grok Desktop.app"),
        currentPid: 123,
        tempRoot: root,
        command: async () => {
          throw new Error("preflight continued after receipt failure");
        },
        spawnProcess: () => {
          calls.push("spawn");
          return { unref() {} };
        },
      }),
    dispose: () => calls.push("dispose"),
    destroyWindows: () => calls.push("destroy"),
    exitSoon: () => calls.push("exit"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "download-path-mismatch");
  assert.deepEqual(calls, []);
});

test("preflight refuses unreadable executable architecture before spawning the helper", async () => {
  const root = tempRoot();
  const appPath = path.join(root, "Grok Desktop.app");
  fs.mkdirSync(path.join(appPath, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), "plist");
  const { info, autoUpdater } = receiptFixture(root);
  let spawned = false;
  const result = await prepareMacUpdateInstall({
    autoUpdater,
    downloadInfo: info,
    appPath,
    currentPid: 123,
    tempRoot: root,
    command: syntheticCommand({ failLipo: true }),
    hashFile: async () => "verified-sha",
    spawnProcess: () => {
      spawned = true;
      return { unref() {} };
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /lipo could not parse/);
  assert.equal(spawned, false);
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.startsWith("grok-desktop-update-stage-")), []);
});

test("preflight passes the updater-selected architecture to the real helper", async () => {
  const root = tempRoot();
  const appPath = path.join(root, "Grok Desktop.app");
  fs.mkdirSync(path.join(appPath, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), "plist");
  const { info, autoUpdater } = receiptFixture(root);
  let spawnedArgs;
  const result = await prepareMacUpdateInstall({
    autoUpdater,
    downloadInfo: info,
    appPath,
    currentPid: 123,
    tempRoot: root,
    command: syntheticCommand(),
    hashFile: async () => "verified-sha",
    spawnProcess: (_command, args) => {
      spawnedArgs = args;
      return { unref() {} };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(spawnedArgs[7], "arm64");
  assert.match(spawnedArgs[3], /grok-desktop-update-stage-/);
});

function writeExecutable(file, body) {
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

function helperFixture() {
  const root = tempRoot();
  const appName = "Grok Desktop.app";
  const dest = path.join(root, appName);
  const staged = path.join(root, "staged");
  const stagedApp = path.join(staged, appName);
  for (const appPath of [dest, stagedApp]) {
    fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
    fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), "plist");
  }
  fs.writeFileSync(path.join(dest, "old-marker"), "old");
  fs.writeFileSync(path.join(stagedApp, "new-marker"), "new");
  const executable = path.join(stagedApp, "Contents", "MacOS", "Grok Desktop");
  fs.writeFileSync(executable, "binary", { mode: 0o755 });
  const script = path.join(root, "helper.sh");
  fs.writeFileSync(script, MAC_UPDATE_HELPER_SCRIPT, { mode: 0o700 });
  const plutil = path.join(root, "plutil");
  const lipo = path.join(root, "lipo");
  const install = path.join(root, "install");
  const open = path.join(root, "open");
  const dialog = path.join(root, "dialog");
  writeExecutable(plutil, 'case "$2" in CFBundleIdentifier) echo com.karman.grok-desktop;; CFBundleShortVersionString) echo 2.0.0;; CFBundleExecutable) echo "Grok Desktop";; esac');
  writeExecutable(lipo, "echo arm64");
  writeExecutable(install, 'cp -R "$1" "$2"');
  writeExecutable(open, `echo open >> "${path.join(root, "open.log")}"`);
  writeExecutable(dialog, `echo dialog >> "${path.join(root, "dialog.log")}"`);
  const args = [
    script,
    path.join(root, "update.log"),
    "99999999",
    staged,
    dest,
    "com.karman.grok-desktop",
    "2.0.0",
    "arm64",
    "1",
    "0",
    open,
    install,
    lipo,
    plutil,
    dialog,
  ];
  return { root, dest, staged, script, install, lipo, open, dialog, args };
}

test("helper timeout exits nonzero without replacing the current app", () => {
  const fixture = helperFixture();
  fixture.args[2] = String(process.pid);
  const result = spawnSync("/bin/bash", fixture.args, { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(fixture.dest, "old-marker")), true);
  assert.equal(fs.existsSync(path.join(fixture.dest, "new-marker")), false);
});

test("helper refuses an unreadable architecture with a nonzero exit", () => {
  const fixture = helperFixture();
  writeExecutable(fixture.lipo, "exit 1");
  const result = spawnSync("/bin/bash", fixture.args, { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(fixture.dest, "old-marker")), true);
});

test("install failure restores the preserved app", () => {
  const fixture = helperFixture();
  writeExecutable(fixture.install, "exit 1");
  const result = spawnSync("/bin/bash", fixture.args, { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(fixture.dest, "old-marker")), true);
  assert.equal(fs.existsSync(path.join(fixture.dest, "new-marker")), false);
  assert.equal(fs.readFileSync(path.join(fixture.root, "open.log"), "utf8").trim(), "open");
  assert.equal(fs.readFileSync(path.join(fixture.root, "dialog.log"), "utf8").trim(), "dialog");
});

test("launch failure restores the preserved app", () => {
  const fixture = helperFixture();
  const state = path.join(fixture.root, "open-state");
  writeExecutable(fixture.open, `echo open >> "${path.join(fixture.root, "open.log")}"\nif [ ! -e "${state}" ]; then touch "${state}"; exit 1; fi`);
  const result = spawnSync("/bin/bash", fixture.args, { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(fixture.dest, "old-marker")), true);
  assert.equal(fs.existsSync(path.join(fixture.dest, "new-marker")), false);
  assert.equal(fs.readFileSync(path.join(fixture.root, "open.log"), "utf8").trim().split("\n").length, 2);
  assert.equal(fs.readFileSync(path.join(fixture.root, "dialog.log"), "utf8").trim(), "dialog");
});

test("successful helper install launches the staged app and preserves the old bundle", () => {
  const fixture = helperFixture();
  const result = spawnSync("/bin/bash", fixture.args, { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(fixture.dest, "new-marker")), true);
  assert.equal(fs.existsSync(path.join(`${fixture.dest}.pre-update`, "old-marker")), true);
  assert.equal(fs.existsSync(path.join(fixture.root, "dialog.log")), false);
});
