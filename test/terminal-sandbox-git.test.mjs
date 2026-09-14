import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseGitConfigUser,
  sandboxedGitEnv,
} from "../electron/terminal-sandbox.mjs";

test("jailed git ignores inaccessible global config and keeps only user identity", () => {
  const identity = parseGitConfigUser(`
[core]
  editor = vim
[user]
  name = "A Person"
  email = a@example.test
`);
  assert.deepEqual(identity, { name: "A Person", email: "a@example.test" });
  const env = sandboxedGitEnv(identity);
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_CONFIG_SYSTEM, "/dev/null");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(env.GIT_CONFIG_KEY_0, "user.name");
  assert.equal(env.GIT_CONFIG_VALUE_1, "a@example.test");
});
