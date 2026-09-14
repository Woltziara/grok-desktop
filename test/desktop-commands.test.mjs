import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_COMMANDS,
  mergeCommands,
} from "../src/lib/commands.ts";
import { runDesktopCommand } from "../src/lib/desktop-commands.ts";

test("agent-advertised plan cannot replace the desktop mode action", () => {
  const merged = mergeCommands({
    desktop: DESKTOP_COMMANDS,
    agent: [
      {
        name: "plan",
        description: "agent token command",
        source: "agent",
      },
    ],
  });
  const plan = merged.find((command) => command.name === "plan");
  assert.equal(plan?.source, "desktop");
  assert.equal(plan?.local, true);
});

test("desktop plan handler receives its description", () => {
  let received = "";
  const handled = runDesktopCommand(
    "plan",
    {
      newChat() {},
      toggleAlwaysApprove() {},
      plan(args) {
        received = args;
      },
    },
    "先调查再改",
  );
  assert.equal(handled, true);
  assert.equal(received, "先调查再改");
});
