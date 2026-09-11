import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asarPathFromExec,
  bundlePathFromExec,
  isBundleNewerThanLaunch,
  isPackNewerThanLaunch,
} from "../shared/stale-bundle.mjs";

test("a newer bundle mtime means this window is stale", () => {
  assert.equal(isBundleNewerThanLaunch(2000, 1000, 100), true);
  assert.equal(isBundleNewerThanLaunch(1050, 1000, 100), false);
  assert.equal(isBundleNewerThanLaunch(0, 1000), false);
});

test("macOS exec path maps back to the .app bundle", () => {
  assert.equal(
    bundlePathFromExec(
      "/Applications/Grok Desktop.app/Contents/MacOS/Grok Desktop",
      "darwin",
    ),
    "/Applications/Grok Desktop.app",
  );
});

test("asar path is detected even when .app mtime is unchanged", () => {
  assert.equal(
    asarPathFromExec(
      "/Applications/Grok Desktop.app/Contents/MacOS/Grok Desktop",
      "darwin",
    ),
    "/Applications/Grok Desktop.app/Contents/Resources/app.asar",
  );
  assert.equal(isPackNewerThanLaunch([1000, 5000], [1000, 1000], 100), true);
  assert.equal(isPackNewerThanLaunch([1000, 1050], [1000, 1000], 100), false);
});
