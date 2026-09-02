import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const url = pathToFileURL(
  path.resolve("src/lib/file-tab-chip-label.ts"),
).href;
const { disambiguateFileTabLabels, pathCrumbs, fileTabBasename } =
  await import(url);

test("unique names stay as basename", () => {
  const labels = disambiguateFileTabLabels([
    { id: "a", path: "docs/alpha.md" },
    { id: "b", path: "docs/beta.md" },
  ]);
  assert.equal(labels.get("a"), "alpha.md");
  assert.equal(labels.get("b"), "beta.md");
});

test("colliding names take a parent suffix", () => {
  const labels = disambiguateFileTabLabels([
    { id: "a", path: "FDE/.dev/gold-standard.md" },
    { id: "b", path: "other/gold-standard.md" },
  ]);
  assert.equal(labels.get("a"), ".dev/gold-standard.md");
  assert.equal(labels.get("b"), "other/gold-standard.md");
});

test("crumbs follow Codex path row", () => {
  assert.deepEqual(
    pathCrumbs("FDE/.dev/fde-meeting-dogfooding/gold-standard-overview.md"),
    ["FDE", ".dev", "fde-meeting-dogfooding", "gold-standard-overview.md"],
  );
  assert.equal(fileTabBasename("a/b/c.md"), "c.md");
});
