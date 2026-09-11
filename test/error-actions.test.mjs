import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyErrorAction } from "../shared/error-actions.mjs";

test("maps login / missing file / network to a next step", () => {
  assert.equal(classifyErrorAction("Please sign in to Grok")?.kind, "signin");
  assert.equal(classifyErrorAction("ENOENT: file not found")?.kind, "reselect");
  assert.equal(classifyErrorAction("network timeout")?.kind, "retry");
  assert.equal(classifyErrorAction("something else")?.kind, "dismiss");
  assert.equal(classifyErrorAction(""), null);
});
