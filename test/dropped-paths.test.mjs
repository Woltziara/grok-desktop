import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectDroppedPaths,
  resolveDroppedFilePath,
} from "../shared/dropped-paths.mjs";

test("prefers host pathForFile over legacy File.path", () => {
  const file = { path: "/old/name", name: "src" };
  assert.equal(
    resolveDroppedFilePath(file, () => "/real/src"),
    "/real/src",
  );
  assert.equal(resolveDroppedFilePath(file), "/old/name");
  assert.equal(resolveDroppedFilePath({}, () => ""), "");
});

test("collects folder paths from files and items without duplicating", () => {
  const folder = { path: "", name: "docs" };
  const dt = {
    files: [folder],
    items: [
      { kind: "file", getAsFile: () => folder },
      { kind: "string", getAsFile: () => null },
    ],
  };
  assert.deepEqual(
    collectDroppedPaths(dt, (f) => (f === folder ? "/Users/me/docs" : "")),
    ["/Users/me/docs"],
  );
});

test("empty drop yields no paths", () => {
  assert.deepEqual(collectDroppedPaths(null), []);
  assert.deepEqual(collectDroppedPaths({ files: [], items: [] }), []);
});
