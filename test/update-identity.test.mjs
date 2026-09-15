import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UPDATE_RELEASES_URL,
  classifyUpdateCheckError,
  formatUpdateCheckError,
  macBundleIdFromPlistXml,
  macUpdateIdentityAccepted,
  pickMacUpdateZip,
  shouldReplaceAfterWait,
  updateReceiptFromDownload,
} from "../shared/update-identity.mjs";

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
  const ok = { downloadedFile: "/tmp/GrokDesktop-1.4.2-unified.2-Mac-arm64.zip", size: 80_000, updateVersion: "1.4.2-unified.2", sha512Receipt: "abc" };
  assert.equal(pickMacUpdateZip(ok), ok.downloadedFile);
  assert.equal(pickMacUpdateZip({ ...ok, size: 80 }), null);
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

test("install refuses missing identity, arch mismatch, and a still-running process", () => {
  assert.equal(macUpdateIdentityAccepted({ expectedBundleId: "", actualBundleId: "com.x", expectedVersion: "1", actualVersion: "1", expectedArch: "arm64", actualArch: "arm64" }).ok, false);
  assert.equal(macUpdateIdentityAccepted({ expectedBundleId: "com.x", actualBundleId: "com.x", expectedVersion: "1.4.2", actualVersion: "1.4.2", expectedArch: "arm64", actualArch: "arm64" }).ok, true);
  assert.equal(macUpdateIdentityAccepted({ expectedBundleId: "com.x", actualBundleId: "com.x", expectedVersion: "1.4.2", actualVersion: "1.4.1", expectedArch: "arm64", actualArch: "arm64" }).reason, "version-mismatch");
  assert.equal(macUpdateIdentityAccepted({ expectedBundleId: "com.x", actualBundleId: "com.x", expectedVersion: "1.4.2", actualVersion: "1.4.2", expectedArch: "arm64", actualArch: "x86_64" }).reason, "arch-mismatch");
  assert.equal(shouldReplaceAfterWait(true), false);
  assert.equal(shouldReplaceAfterWait(false), true);
  const receipt = updateReceiptFromDownload({ version: "1.4.2-unified.2", files: [{ sha512: "deadbeef", url: "GrokDesktop-1.4.2-unified.2-Mac-arm64.zip" }] });
  assert.equal(receipt.version, "1.4.2-unified.2");
  assert.equal(receipt.sha512Receipt, "deadbeef");
  assert.equal(receipt.arch, "arm64");
});

test("install helper can read the bundle id from Info.plist xml", () => {
  const xml = `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.karman.grok-desktop.candidate</string></dict></plist>`;
  assert.equal(macBundleIdFromPlistXml(xml), "com.karman.grok-desktop.candidate");
});
