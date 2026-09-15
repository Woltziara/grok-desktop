import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UPDATE_RELEASES_URL,
  classifyUpdateCheckError,
  formatUpdateCheckError,
  macBundleIdFromPlistXml,
  pickMacUpdateZip,
  updateReceiptFromDownload,
} from "../shared/update-identity.mjs";
import {
  createInteractiveUpdateOperation,
  shouldShowUpdaterError,
  watchInteractiveDownload,
} from "../shared/update-error-state.mjs";

test("missing GitHub releases are unpublished, not a network glitch", () => {
  assert.equal(classifyUpdateCheckError(new Error("Unable to find latest version on GitHub")), "unpublished");
  const formatted = formatUpdateCheckError(new Error("Unable to find latest version on GitHub"));
  assert.equal(formatted.offerReleases, false);
  assert.match(formatted.message, /还没有发布自动更新/);
  assert.doesNotMatch(formatted.detail, /liaan/);
});

test("transient network errors still offer this edition's releases", () => {
  const formatted = formatUpdateCheckError(new Error("net::ERR_NETWORK_CHANGED"));
  assert.equal(formatted.kind, "transient");
  assert.equal(formatted.offerReleases, true);
  assert.equal(formatted.releasesUrl, UPDATE_RELEASES_URL);
  assert.match(UPDATE_RELEASES_URL, /Woltziara\/grok-desktop/);
  assert.doesNotMatch(UPDATE_RELEASES_URL, /liaan/);
});

test("Mac update zip requires the updater receipt, never a leftover cache file", () => {
  const ok = { downloadedFile: "/tmp/GrokDesktop-1.4.2-unified.2-Mac-arm64.zip", size: 80_000, updateVersion: "1.4.2-unified.2", sha512Receipt: "abc", actualSha512: "abc" };
  assert.equal(pickMacUpdateZip(ok), ok.downloadedFile);
  assert.equal(pickMacUpdateZip({ ...ok, size: 80 }), null);
  assert.equal(pickMacUpdateZip({ ...ok, actualSha512: "different" }), null);
  assert.equal(pickMacUpdateZip({ downloadedFile: ok.downloadedFile, size: 80_000 }), null);
  assert.equal(pickMacUpdateZip({}), null);
  assert.equal(pickMacUpdateZip({ downloadedFile: "/tmp/update.dmg", size: 90_000, updateVersion: "1", sha512Receipt: "x" }), null);
});

test("generic 404 is a check failure, not proof this machine is up to date", () => {
  assert.equal(classifyUpdateCheckError(new Error("404 Not Found latest-mac.yml")), "error");
  const formatted = formatUpdateCheckError(new Error("Cannot download latest-mac.yml: 404"));
  assert.equal(formatted.kind, "error");
  assert.equal(formatted.offerReleases, true);
  assert.doesNotMatch(formatted.message, /还没有发布自动更新/);
});

test("download receipt binds the selected updater file in mixed-architecture metadata", () => {
  const downloadedFile = "/tmp/pending/GrokDesktop-1.4.2-unified.2-Mac-arm64.zip";
  const arm = { sha512: "arm-hash", url: "GrokDesktop-1.4.2-unified.2-Mac-arm64.zip" };
  const x64 = { sha512: "x64-hash", url: "GrokDesktop-1.4.2-unified.2-Mac-x64.zip" };
  const info = { version: "1.4.2-unified.2", downloadedFile, files: [x64, arm] };
  const helper = {
    file: downloadedFile,
    versionInfo: { version: info.version },
    fileInfo: { info: arm },
    downloadedFileInfo: { fileName: arm.url, sha512: arm.sha512 },
  };
  const receipt = updateReceiptFromDownload(info, helper);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.version, "1.4.2-unified.2");
  assert.equal(receipt.sha512Receipt, "arm-hash");
  assert.equal(receipt.arch, "arm64");
  assert.equal(updateReceiptFromDownload(info, { ...helper, fileInfo: { info: x64 } }).ok, false);
  assert.equal(updateReceiptFromDownload({ ...info, downloadedFile: `${downloadedFile}.other` }, helper).reason, "download-path-mismatch");
});

test("install helper can read the bundle id from Info.plist xml", () => {
  const xml = `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.karman.grok-desktop.candidate</string></dict></plist>`;
  assert.equal(macBundleIdFromPlistXml(xml), "com.karman.grok-desktop.candidate");
});

test("interactive download rejection is surfaced once after check errors were deferred", async () => {
  const operation = createInteractiveUpdateOperation();
  assert.equal(shouldShowUpdaterError(operation), false);
  let rejectDownload;
  const downloadPromise = new Promise((_resolve, reject) => {
    rejectDownload = reject;
  });
  const shown = [];
  let settled = 0;
  watchInteractiveDownload(downloadPromise, operation, {
    onError: async (err) => shown.push(err.message),
    onSettled: () => settled++,
  });
  rejectDownload(new Error("download failed asynchronously"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shown, ["download failed asynchronously"]);
  assert.equal(settled, 1);
  assert.equal(operation.phase, "done");
});

test("download promise does not duplicate an error already owned by the updater event", async () => {
  const operation = createInteractiveUpdateOperation();
  let rejectDownload;
  const downloadPromise = new Promise((_resolve, reject) => {
    rejectDownload = reject;
  });
  const shownByPromise = [];
  watchInteractiveDownload(downloadPromise, operation, {
    onError: async (err) => shownByPromise.push(err.message),
    onSettled: () => {},
  });
  assert.equal(shouldShowUpdaterError(operation), true);
  rejectDownload(new Error("same download error"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shownByPromise, []);
});
