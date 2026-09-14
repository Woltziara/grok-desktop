import assert from "node:assert/strict";
import { test } from "node:test";
import { nextRecentProjects } from "../shared/recent-projects.mjs";

test("adding a folder pins it first and does not imply lastProject", () => {
  assert.deepEqual(nextRecentProjects(["/a", "/b"], "/c"), ["/c", "/a", "/b"]);
  assert.deepEqual(nextRecentProjects(["/a", "/b"], "/b"), ["/b", "/a"]);
  assert.deepEqual(nextRecentProjects([], "/a"), ["/a"]);
  assert.deepEqual(nextRecentProjects(["/a"], ""), ["/a"]);
});
