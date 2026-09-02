import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const mod = await import(
  pathToFileURL(path.resolve("src/lib/activity-cluster.ts")).href
);

function tool(id, extra = {}) {
  return {
    id,
    kind: "tool",
    toolCallId: id,
    title: extra.title || "Read",
    status: extra.status || "completed",
    toolKind: extra.toolKind,
    raw: extra.raw,
    content: extra.content,
    at: extra.at || 1,
  };
}

test("clusterTimeline folds consecutive tools between prose", () => {
  const items = [
    { id: "u", kind: "user", text: "hi", at: 1 },
    tool("r1", { toolKind: "read", raw: { path: "a.ts" } }),
    tool("r2", { toolKind: "read", raw: { path: "b.ts" } }),
    { id: "a", kind: "assistant", text: "好了", at: 3 },
  ];
  const clusters = mod.clusterTimeline(items);
  assert.equal(clusters.length, 3);
  assert.equal(clusters[0].type, "solo");
  assert.equal(clusters[1].type, "activity");
  assert.equal(clusters[1].items.length, 2);
  assert.equal(clusters[2].item.kind, "assistant");
});

test("digest collapses a log dump into one sentence", () => {
  const items = [
    tool("r1", { toolKind: "read", raw: { path: "MessageList.tsx" } }),
    tool("r2", { toolKind: "read", raw: { path: "app.css" } }),
    tool("r3", { toolKind: "read", raw: { path: "tool-display.ts" } }),
    {
      id: "t",
      kind: "thought",
      text: "hmm",
      at: 10,
    },
    tool("e1", {
      toolKind: "edit",
      at: 20,
      raw: { path: "MessageList.tsx", old_string: "a\n", new_string: "b\n" },
    }),
    tool("x1", { toolKind: "execute", raw: { command: "cd /tmp" } }),
    tool("x2", { toolKind: "execute", raw: { command: "ls" } }),
    tool("fail", {
      toolKind: "read",
      status: "failed",
      raw: { path: "missing.ts" },
    }),
  ];
  const line = mod.formatActivityDigest(items, { now: 20_000 });
  assert.match(line, /读了 4 个文件/);
  assert.match(line, /改了 MessageList\.tsx/);
  assert.match(line, /失败/);
  assert.doesNotMatch(line, /思考了 3 秒/);
  assert.doesNotMatch(line, /运行了 cd/);
  assert.doesNotMatch(line, /运行了 ls/);
});

test("two edits collapse into one line without line counts", () => {
  const items = [
    tool("e1", {
      toolKind: "edit",
      raw: { path: "App.tsx", old_string: "a\n", new_string: "b\n" },
    }),
    tool("e2", { toolKind: "edit", raw: { path: "main.tsx" } }),
  ];
  assert.equal(mod.shouldCollapseActivity(items), true);
  const line = mod.formatActivityDigest(items);
  assert.match(line, /改了 App\.tsx、main\.tsx/);
  assert.doesNotMatch(line, /\+/);
  assert.doesNotMatch(line, /−/);
});

test("two reads collapse", () => {
  const items = [
    tool("r1", { toolKind: "read", raw: { path: "a.ts" } }),
    tool("r2", { toolKind: "read", raw: { path: "b.ts" } }),
  ];
  assert.equal(mod.shouldCollapseActivity(items), true);
  assert.equal(mod.formatActivityDigest(items), "读了 2 个文件");
});
