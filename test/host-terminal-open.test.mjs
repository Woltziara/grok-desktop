import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isHostTerminalOpen,
  isSimpleTerminalOpenScript,
} from "../electron/terminal-sandbox.mjs";

test("open of a .command file is a host Terminal launch", () => {
  assert.equal(
    isHostTerminalOpen("/usr/bin/open", [
      "/tmp/start-project-os-4317.command",
    ]),
    true,
  );
  assert.equal(
    isHostTerminalOpen("open", ["-a", "Terminal", "/tmp/run.command"]),
    true,
  );
  assert.equal(isHostTerminalOpen("open", ["-a", "iTerm"]), true);
});

test("ordinary open stays in the jail", () => {
  assert.equal(isHostTerminalOpen("/usr/bin/open", ["https://x.ai"]), false);
  assert.equal(isHostTerminalOpen("open", ["README.md"]), false);
  assert.equal(isHostTerminalOpen("ls", ["-la"]), false);
});

test("simple bash -lc open .command is a host Terminal launch", () => {
  assert.equal(
    isSimpleTerminalOpenScript(
      'open "/tmp/start-project-os-4317.command"',
    ),
    true,
  );
  assert.equal(
    isHostTerminalOpen("/bin/bash", [
      "-lc",
      "open /tmp/start-project-os-4317.command",
    ]),
    true,
  );
});

test("compound shell is not a host escape", () => {
  assert.equal(
    isSimpleTerminalOpenScript(
      "open /tmp/x.command; cat ~/.ssh/id_rsa",
    ),
    false,
  );
  assert.equal(
    isHostTerminalOpen("/bin/bash", [
      "-lc",
      "open /tmp/x.command && rm -rf /",
    ]),
    false,
  );
});
