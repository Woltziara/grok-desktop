import { test } from "node:test";
import assert from "node:assert/strict";
import {
  memoryEnabledFromToml,
  setMemoryEnabledInToml,
} from "../shared/memory-config.mjs";
import {
  parseMemoryMarkdown,
  removeMemoryEntryFromMarkdown,
  pickWorkspaceSlug,
  serializeMemoryMarkdown,
} from "../shared/memory-files.mjs";
import {
  applyScheduledUpdate,
  scheduledInjectFromInbound,
  scheduledTaskUpdateFromInbound,
} from "../shared/scheduled-tasks.mjs";
import { remainingFromBilling } from "../shared/billing-display.mjs";
import {
  billingAttempts,
  schedulerDeleteAttempts,
} from "../shared/acp-rpc.mjs";
import {
  timelineToMarkdown,
  exportFilename,
} from "../shared/export-transcript.mjs";
import { cutIndexAfterUserId } from "../shared/edit-user-message.mjs";

test("memory toml toggle inserts and rewrites only [memory] enabled", () => {
  assert.equal(memoryEnabledFromToml(""), false);
  const added = setMemoryEnabledInToml("# keep\n[ui]\ntheme = \"dark\"\n", true);
  assert.match(added, /\[memory\]/);
  assert.match(added, /enabled = true/);
  assert.match(added, /\[ui\]/);
  assert.equal(memoryEnabledFromToml(added), true);
  const off = setMemoryEnabledInToml(added, false);
  assert.match(off, /enabled = false/);
  assert.match(off, /theme = "dark"/);
  const withOther = setMemoryEnabledInToml(
    "[memory]\nsession.save_on_end = true\n",
    true,
  );
  assert.match(withOther, /enabled = true/);
  assert.match(withOther, /session.save_on_end = true/);
});

test("memory toggle handles blank lines and commented headers without crossing tables", () => {
  const source = '# keep\r\n\r\n[memory] # local memory\r\n\r\n[ui]\r\nenabled = false\r\n';
  const enabled = setMemoryEnabledInToml(source, true);
  assert.equal(memoryEnabledFromToml(enabled), true);
  assert.ok(enabled.endsWith('[ui]\r\nenabled = false\r\n'));
  assert.equal(memoryEnabledFromToml(setMemoryEnabledInToml(enabled, false)), false);
  assert.equal(memoryEnabledFromToml('[memory]\n\n[ui]\nenabled = true\n'), false);
  assert.equal(setMemoryEnabledInToml('[memory]', true), '[memory]\nenabled = true\n');
});

test("memory markdown parse and remove keeps other headings", () => {
  const md = `## Preferences\n\nAlways use Chinese.\n\n## Project Context\n\nRepo is Magician.\n`;
  const entries = parseMemoryMarkdown(md, { file: "MEMORY.md", scope: "global" });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].heading, "Preferences");
  const next = removeMemoryEntryFromMarkdown(md, entries[0].id, {
    file: "MEMORY.md",
    scope: "global",
  });
  assert.match(next, /Project Context/);
  assert.doesNotMatch(next, /Always use Chinese/);
  const round = serializeMemoryMarkdown(
    parseMemoryMarkdown(next, { file: "MEMORY.md", scope: "global" }),
  );
  assert.match(round, /Repo is Magician/);
});

test("pickWorkspaceSlug matches project folder stem", () => {
  assert.equal(
    pickWorkspaceSlug(["other-aaaaaaa1", "grok-desktop-deadbeef"], "/Users/me/grok-desktop"),
    "grok-desktop-deadbeef",
  );
  assert.equal(pickWorkspaceSlug([], "/tmp/x"), null);
});

test("scheduled task create/fire/delete reduce", () => {
  const created = scheduledTaskUpdateFromInbound("x.ai/scheduled_task_created", {
    sessionId: "s1",
    update: {
      sessionUpdate: "scheduled_task_created",
      taskId: "loop-1",
      prompt: "看一下邮箱",
      humanSchedule: "every 1h",
    },
  });
  assert.equal(created.update.taskId, "loop-1");
  let list = applyScheduledUpdate([], created);
  assert.equal(list.length, 1);
  list = applyScheduledUpdate(list, {
    update: {
      sessionUpdate: "scheduled_task_fired",
      taskId: "loop-1",
      nextFireAt: "2026-09-04T00:00:00Z",
    },
  });
  assert.equal(list[0].nextFireAt, "2026-09-04T00:00:00Z");
  list = applyScheduledUpdate(list, {
    update: { sessionUpdate: "scheduled_task_deleted", taskId: "loop-1" },
  });
  assert.equal(list.length, 0);
});

test("scheduled inject prompt peels ext_notification", () => {
  const inject = scheduledInjectFromInbound("ext_notification", {
    method: "x.ai/scheduled_task_inject_prompt",
    params: {
      sessionId: "s1",
      taskId: "loop-1",
      prompt: "看一下邮箱",
      humanSchedule: "every 1h",
    },
  });
  assert.equal(inject?.prompt, "看一下邮箱");
  assert.equal(inject?.sessionId, "s1");
});

test("billing remaining prefers creditUsagePercent", () => {
  const a = remainingFromBilling({
    config: { creditUsagePercent: 42 },
  });
  assert.equal(a.kind, "percent");
  assert.equal(a.remainingPct, 58);
  assert.match(a.line, /58%/);
  const empty = remainingFromBilling({});
  assert.equal(empty.kind, "unknown");
  const done = remainingFromBilling({ config: { creditUsagePercent: 100 } });
  assert.equal(done.line, "额度已用完");
});

test("export transcript keeps people talk, skips tools", () => {
  const md = timelineToMarkdown(
    [
      { kind: "user", text: "今天做什么" },
      { kind: "tool", text: "ran ls" },
      { kind: "assistant", text: "先看记忆。" },
    ],
    { title: "案子", project: "/tmp/p" },
  );
  assert.match(md, /^# 案子/m);
  assert.match(md, /\*\*你\*\*/);
  assert.match(md, /今天做什么/);
  assert.doesNotMatch(md, /ran ls/);
  assert.equal(exportFilename("a/b:c"), "a b c.md");
});

test("billing and scheduler delete use stdio ext methods", () => {
  assert.equal(billingAttempts()[0].method, "_x.ai/billing");
  const del = schedulerDeleteAttempts("sess-1", "loop-9");
  assert.equal(del[0].method, "_x.ai/scheduler/delete");
  assert.equal(del[0].params.sessionId, "sess-1");
  assert.equal(del[0].params.taskId, "loop-9");
});

test("rewind keep-this-prompt cuts after the user bubble", () => {
  const items = [
    { id: "u1", kind: "user" },
    { id: "a1", kind: "assistant" },
    { id: "u2", kind: "user" },
    { id: "a2", kind: "assistant" },
  ];
  assert.equal(cutIndexAfterUserId(items, "u1"), 1);
  assert.equal(cutIndexAfterUserId(items, "u2"), 3);
});
