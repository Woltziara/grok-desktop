/**
 * Timeline reducer: tool status aligned with grok-build ACP emissions.
 *
 * Real sequence (write / search_replace):
 *   tool_call pending → start update with Diff + no status → optional
 *   permission (no status) → final with status + Diff + typed rawOutput.
 * Diff alone is a start preview, not a final.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applySessionUpdate,
  appendWorkedIfNeeded,
  collapseEchoedUserTurns,
  extractChunkText,
  finalizeOpenTools,
  isBashBackgroundedRawOutput,
  looksLikeFinalToolResult,
  resolveToolUpdateStatus,
} from "../shared/session-timeline.mjs";

const writeStartDiff = {
  type: "diff",
  path: "docs/BACKLOG.md",
  oldText: "",
  newText: "# Product backlog\n",
};

/** Shape mirrors ToolOutput::SearchReplace serde tag from grok-build. */
const searchReplaceRawOutput = {
  type: "SearchReplace",
  EditsApplied: {
    absolute_path: "/proj/docs/BACKLOG.md",
    new_string: "# Product backlog\n",
    old_string: "",
  },
};

test("looksLikeFinalToolResult: Diff-only start is not final", () => {
  assert.equal(
    looksLikeFinalToolResult({
      content: [
        {
          type: "diff",
          path: "/tmp/a.md",
          oldText: "",
          newText: "hello",
        },
      ],
    }),
    false,
  );
});

test("looksLikeFinalToolResult: typed rawOutput is final", () => {
  assert.equal(
    looksLikeFinalToolResult({ rawOutput: { type: "ListDir", Content: {} } }),
    true,
  );
  assert.equal(
    looksLikeFinalToolResult({
      content: [writeStartDiff],
      rawOutput: searchReplaceRawOutput,
    }),
    true,
  );
});

test("looksLikeFinalToolResult: bare rawOutput without type is not final", () => {
  assert.equal(looksLikeFinalToolResult({ rawOutput: {} }), false);
  assert.equal(looksLikeFinalToolResult({ rawOutput: "partial" }), false);
});

test("looksLikeFinalToolResult: text-only content is not assumed final", () => {
  assert.equal(
    looksLikeFinalToolResult({
      content: [
        {
          type: "content",
          content: { type: "text", text: "still working…" },
        },
      ],
    }),
    false,
  );
});

test("isBashBackgroundedRawOutput: signal backgrounded on Bash type", () => {
  assert.equal(
    isBashBackgroundedRawOutput({
      type: "Bash",
      signal: "backgrounded",
      exit_code: 0,
      command: "sleep 999",
    }),
    true,
  );
  assert.equal(
    isBashBackgroundedRawOutput({
      type: "Bash",
      signal: null,
      exit_code: 0,
      command: "echo hi",
    }),
    false,
  );
  assert.equal(
    isBashBackgroundedRawOutput({ type: "ListDir", Content: {} }),
    false,
  );
});

test("looksLikeFinalToolResult: bash-backgrounded rawOutput is not final", () => {
  assert.equal(
    looksLikeFinalToolResult({
      content: [
        {
          type: "content",
          content: { type: "text", text: "started…" },
        },
      ],
      rawOutput: {
        type: "Bash",
        signal: "backgrounded",
        exit_code: 0,
        command: "npm run dev",
        output: [],
      },
    }),
    false,
  );
});

test("resolveToolUpdateStatus: explicit status wins", () => {
  assert.equal(
    resolveToolUpdateStatus(
      { status: "failed", content: [{ type: "diff", path: "x" }] },
      "in_progress",
    ),
    "failed",
  );
  assert.equal(
    resolveToolUpdateStatus(
      {
        status: "completed",
        content: [writeStartDiff],
        rawOutput: searchReplaceRawOutput,
      },
      "pending",
    ),
    "completed",
  );
});

test("resolveToolUpdateStatus: Diff without status stays open (start preview)", () => {
  assert.equal(
    resolveToolUpdateStatus(
      {
        content: [
          { type: "diff", path: "BACKLOG.md", oldText: "", newText: "# hi" },
        ],
      },
      "in_progress",
    ),
    "in_progress",
  );
  assert.equal(
    resolveToolUpdateStatus(
      {
        content: [
          { type: "diff", path: "BACKLOG.md", oldText: "", newText: "# hi" },
        ],
      },
      "pending",
    ),
    "pending",
  );
});

test("resolveToolUpdateStatus: typed rawOutput without status → completed", () => {
  assert.equal(
    resolveToolUpdateStatus(
      { rawOutput: { type: "ListDir", Content: {} } },
      "pending",
    ),
    "completed",
  );
});

test("resolveToolUpdateStatus: bash-backgrounded does not complete", () => {
  assert.equal(
    resolveToolUpdateStatus(
      {
        rawOutput: {
          type: "Bash",
          signal: "backgrounded",
          exit_code: 0,
          command: "sleep 1",
        },
      },
      "in_progress",
    ),
    "in_progress",
  );
  assert.equal(
    resolveToolUpdateStatus(
      {
        rawOutput: {
          type: "Bash",
          signal: "backgrounded",
          exit_code: 0,
          command: "sleep 1",
        },
      },
      "pending",
    ),
    "pending",
  );
});

test("write start Diff keeps card open; final status completes", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call-write-20",
      title: "write",
      status: "pending",
      rawInput: { file_path: "docs/BACKLOG.md", content: "…" },
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "pending");

  // grok-build send_tool_call_start: Diff + no status (proposed edit)
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call-write-20",
      kind: "edit",
      title: "Write `docs/BACKLOG.md`",
      content: [writeStartDiff],
      rawInput: { file_path: "docs/BACKLOG.md", content: "…" },
    },
  });
  assert.equal(items[0].status, "pending");
  assert.ok(Array.isArray(items[0].content));

  // True final from acp_tool_update: status + Diff + typed rawOutput
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call-write-20",
      status: "completed",
      content: [writeStartDiff],
      rawOutput: searchReplaceRawOutput,
    },
  });
  assert.equal(items[0].status, "completed");
});

test("edit batch: Diff-only start stays open until status", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "w1",
      title: "write",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "w1",
      content: [{ type: "diff", path: "a.md", oldText: "", newText: "a" }],
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "e1",
      title: "search_replace",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "e1",
      content: [{ type: "diff", path: "b.md", oldText: "x", newText: "y" }],
    },
  });
  assert.equal(items.find((i) => i.toolCallId === "w1")?.status, "pending");
  assert.equal(items.find((i) => i.toolCallId === "e1")?.status, "pending");

  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "w1",
      status: "completed",
      content: [{ type: "diff", path: "a.md", oldText: "", newText: "a" }],
      rawOutput: { type: "SearchReplace", EditsApplied: {} },
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "e1",
      status: "completed",
      content: [{ type: "diff", path: "b.md", oldText: "x", newText: "y" }],
      rawOutput: { type: "SearchReplace", EditsApplied: {} },
    },
  });
  assert.equal(items.find((i) => i.toolCallId === "w1")?.status, "completed");
  assert.equal(items.find((i) => i.toolCallId === "e1")?.status, "completed");
});

test("tool_call_update upsert Diff-only stays open (no prior tool_call)", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "only-update",
      title: "Write file",
      content: [{ type: "diff", path: "x", oldText: null, newText: "z" }],
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].toolCallId, "only-update");
  assert.equal(items[0].status, "pending");
});

test("typed rawOutput without status completes via applySessionUpdate", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "ld1",
      title: "list_dir",
      status: "pending",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "ld1",
      rawOutput: { type: "ListDir", Content: { entries: [] } },
    },
  });
  assert.equal(items[0].status, "completed");
});

test("bash-backgrounded update keeps tool open via applySessionUpdate", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "bash-bg",
      title: "run_terminal_cmd",
      status: "pending",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "bash-bg",
      status: "in_progress",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "bash-bg",
      // status intentionally omitted (grok-build bash signal=backgrounded)
      content: [
        {
          type: "content",
          content: { type: "text", text: "… running in background" },
        },
      ],
      rawOutput: {
        type: "Bash",
        signal: "backgrounded",
        exit_code: 0,
        command: "npm run dev",
        output: [],
        timed_out: false,
      },
    },
  });
  assert.equal(items[0].status, "in_progress");
});

test("explicit in_progress without final payload stays open", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "run",
      status: "pending",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "in_progress",
    },
  });
  assert.equal(items[0].status, "in_progress");
});

test("turn_completed finalizes leftover open tools", () => {
  let items = [
    {
      id: "1",
      kind: "tool",
      toolCallId: "open",
      title: "Write",
      status: "in_progress",
    },
    {
      id: "2",
      kind: "tool",
      toolCallId: "done",
      title: "Read",
      status: "completed",
    },
  ];
  items = applySessionUpdate(items, {
    update: { sessionUpdate: "turn_completed" },
  });
  assert.equal(items.find((i) => i.toolCallId === "open")?.status, "completed");
  assert.equal(items.find((i) => i.toolCallId === "done")?.status, "completed");
});

test("finalizeOpenTools cancels open cards", () => {
  const items = finalizeOpenTools(
    [
      { id: "1", kind: "tool", toolCallId: "a", status: "pending" },
      { id: "2", kind: "assistant", text: "hi" },
    ],
    "cancelled",
  );
  assert.equal(items[0].status, "cancelled");
  assert.equal(items[1].kind, "assistant");
});

test("read tools with explicit completed still work", () => {
  let items = [];
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "r1",
      title: "read_file",
    },
  });
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "r1",
      kind: "read",
      title: "Read README",
    },
  });
  assert.equal(items[0].status, "pending");
  items = applySessionUpdate(items, {
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "r1",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "file body" },
        },
      ],
    },
  });
  assert.equal(items[0].status, "completed");
});

test("auto_compact_completed becomes a system line with before/after", () => {
  const items = applySessionUpdate([], {
    update: {
      sessionUpdate: "auto_compact_completed",
      tokens_before: 31000,
      tokens_after: 12000,
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "system");
  assert.match(items[0].text, /31,000/);
  assert.match(items[0].text, /12,000/);
});

test("session_recap becomes a recap row", () => {
  const items = applySessionUpdate([], {
    update: {
      sessionUpdate: "session_recap",
      summary: "Edited MessageList and packed the app.",
      auto: true,
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "recap");
  assert.equal(items[0].auto, true);
  assert.match(items[0].text, /Edited MessageList/);
});

test("empty session_recap is ignored", () => {
  const items = applySessionUpdate([], {
    update: { sessionUpdate: "session_recap", summary: "  " },
  });
  assert.equal(items.length, 0);
});

test("turn_completed appends Worked for from last user timestamp", () => {
  const items = applySessionUpdate(
    [
      { id: "u", kind: "user", text: "hi", at: 1_000 },
      { id: "a", kind: "assistant", text: "ok", at: 2_000 },
    ],
    {
      update: { sessionUpdate: "turn_completed" },
      _meta: { agentTimestampMs: 118_000 },
    },
  );
  const last = items[items.length - 1];
  assert.equal(last.kind, "worked");
  assert.equal(last.elapsedMs, 117_000);
});

test("extractChunkText never stringifies image blocks", () => {
  assert.equal(extractChunkText({ type: "image", mimeType: "image/png" }), "");
  assert.equal(extractChunkText({ type: "text", text: "你好" }), "你好");
  assert.equal(extractChunkText({ text: "hi" }), "hi");
});

test("collapseEchoedUserTurns folds a duplicate YOU across a thought", () => {
  const folded = collapseEchoedUserTurns([
    { id: "u1", kind: "user", text: "你好", images: [{ previewUrl: "x" }], at: 1 },
    { id: "th", kind: "thought", text: "", at: 1 },
    { id: "u2", kind: "user", text: "你好[object Object]", at: 2 },
  ]);
  const users = folded.filter((i) => i.kind === "user");
  assert.equal(users.length, 1);
  assert.equal(users[0].text, "你好");
  assert.equal(users[0].images.length, 1);
});

test("user image echo does not append [object Object] onto a second bubble", () => {
  const seeded = [
    {
      id: "u1",
      kind: "user",
      text: "我需要这个加号",
      optimistic: true,
      at: 1,
    },
    { id: "th1", kind: "thought", text: "", at: 1 },
  ];
  const afterText = applySessionUpdate(seeded, {
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "我需要这个加号" },
    },
  });
  const afterImage = applySessionUpdate(afterText, {
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "image", mimeType: "image/jpeg", data: "xxxx" },
    },
  });
  const users = afterImage.filter((i) => i.kind === "user");
  assert.equal(users.length, 1);
  assert.equal(users[0].text, "我需要这个加号");
  assert.doesNotMatch(users[0].text, /object Object/);
});

function assistantChunk(text) {
  return {
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  };
}

test("ordinary chunks concatenate even when they look like suffixes", () => {
  let items = applySessionUpdate([], assistantChunk("100"));
  items = applySessionUpdate(items, assistantChunk("0"));
  assert.equal(items.at(-1).text, "1000");

  items = applySessionUpdate([], assistantChunk("哈"));
  items = applySessionUpdate(items, assistantChunk("哈"));
  assert.equal(items.at(-1).text, "哈哈");

  items = applySessionUpdate([], assistantChunk("one "));
  items = applySessionUpdate(items, assistantChunk("two "));
  items = applySessionUpdate(items, assistantChunk("two "));
  assert.equal(items.at(-1).text, "one two two ");
});

test("appendWorkedIfNeeded does not duplicate", () => {
  const once = appendWorkedIfNeeded(
    [{ id: "u", kind: "user", text: "hi", at: 1_000 }],
    3_000,
  );
  const twice = appendWorkedIfNeeded(once, 4_000);
  assert.equal(once.filter((i) => i.kind === "worked").length, 1);
  assert.equal(twice.filter((i) => i.kind === "worked").length, 1);
  assert.equal(twice[twice.length - 1].elapsedMs, 2_000);
});

test("post_tool_use hook timeout is not shown as a crash", () => {
  const items = applySessionUpdate(
    [
      {
        id: "t1",
        kind: "tool",
        title: "read_file",
        status: "completed",
        at: 1,
      },
    ],
    {
      update: {
        sessionUpdate: "hook_execution",
        event_name: "post_tool_use",
        tool_name: "read_file",
        runs: [
          {
            name: "global/judgment-continuity:post_tool_use[0].hooks[0]",
            status: { status: "failed", error: "timed out after 8000ms" },
          },
        ],
      },
    },
  );
  assert.equal(items.some((i) => i.kind === "system"), false);
  assert.equal(items[0].status, "completed");
});
