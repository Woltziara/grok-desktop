/**
 * Sidebar order is last real message, not last time the chat was opened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encodeSessionCwd,
  isoFromUpdateTimestamp,
  lastInteractionAtFromUpdates,
  listSessionsForCwd,
} from "../electron/sessions.mjs";

function writeSession(home, cwd, sessionId, summary, updates) {
  const dir = path.join(home, "sessions", encodeSessionCwd(cwd), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  if (updates) {
    fs.writeFileSync(path.join(dir, "updates.jsonl"), updates, "utf8");
  }
}

function updateLine(kind, unixSeconds) {
  return `${JSON.stringify({
    timestamp: unixSeconds,
    method: "session/update",
    params: {
      update: { sessionUpdate: kind },
    },
  })}\n`;
}

test("isoFromUpdateTimestamp treats unix seconds as seconds", () => {
  assert.equal(isoFromUpdateTimestamp(1_788_147_900), "2026-08-31T03:45:00.000Z");
});

test("lastInteractionAtFromUpdates ignores session_start hooks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-upd-"));
  const p = path.join(dir, "updates.jsonl");
  fs.writeFileSync(
    p,
    updateLine("user_message_chunk", 1_700_000_000) +
      updateLine("agent_message_chunk", 1_700_000_010) +
      updateLine("turn_completed", 1_700_000_020) +
      updateLine("hook_execution", 1_800_000_000),
    "utf8",
  );
  assert.equal(
    lastInteractionAtFromUpdates(p),
    isoFromUpdateTimestamp(1_700_000_020),
  );
});

test("listSessionsForCwd orders by last message, not last_active_at from opening", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-list-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    writeSession(
      home,
      cwd,
      "opened-just-now-01",
      {
        info: { id: "opened-just-now-01", cwd },
        generated_title: "Clicked recently",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-31T12:00:00.000Z",
        last_active_at: "2026-08-31T12:00:00.000Z",
        num_chat_messages: 2,
      },
      updateLine("user_message_chunk", 1_720_000_000) +
        updateLine("hook_execution", 1_788_000_000),
    );
    writeSession(
      home,
      cwd,
      "messaged-later-02",
      {
        info: { id: "messaged-later-02", cwd },
        generated_title: "Talked more recently",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-20T00:00:00.000Z",
        last_active_at: "2026-08-20T00:00:00.000Z",
        num_chat_messages: 10,
      },
      updateLine("user_message_chunk", 1_750_000_000) +
        updateLine("turn_completed", 1_750_000_100),
    );
    const listed = listSessionsForCwd(cwd);
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, "messaged-later-02");
    assert.equal(listed[1].id, "opened-just-now-01");
    assert.equal(listed[0].title, "Talked more recently");
  } finally {
    process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("hook-only empty shells are not listed", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-empty-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    writeSession(
      home,
      cwd,
      "empty-never-spoke",
      {
        info: { id: "empty-never-spoke", cwd },
        generated_title: "",
        session_summary: "",
        created_at: "2026-08-31T12:00:00.000Z",
        last_active_at: "2026-08-31T18:00:00.000Z",
        num_chat_messages: 2,
      },
      updateLine("hook_execution", 1_788_000_000),
    );
    writeSession(
      home,
      cwd,
      "real-chat",
      {
        info: { id: "real-chat", cwd },
        generated_title: "Real talk",
        created_at: "2026-08-01T00:00:00.000Z",
        last_active_at: "2026-08-01T00:00:00.000Z",
        num_chat_messages: 4,
      },
      updateLine("user_message_chunk", 1_750_000_000),
    );
    const listed = listSessionsForCwd(cwd);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "real-chat");
  } finally {
    process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("listSessionsForCwd keeps a long chat when the last tool line exceeds the cheap tail", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-huge-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    const hugeTool = `${JSON.stringify({
      timestamp: 1_750_000_200,
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          rawOutput: "x".repeat(300 * 1024),
        },
      },
    })}\n`;
    writeSession(
      home,
      cwd,
      "long-chat-huge-tail",
      {
        info: { id: "long-chat-huge-tail", cwd },
        generated_title: "Grok客户端功能",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-31T12:00:00.000Z",
        last_active_at: "2026-08-31T12:00:00.000Z",
        num_chat_messages: 425,
      },
      updateLine("user_message_chunk", 1_750_000_000) +
        updateLine("turn_completed", 1_750_000_100) +
        hugeTool,
    );
    const listed = listSessionsForCwd(cwd);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "long-chat-huge-tail");
    assert.equal(listed[0].title, "Grok客户端功能");
    assert.equal(
      listed[0].lastMessageAt,
      isoFromUpdateTimestamp(1_750_000_100),
    );
    assert.equal(
      lastInteractionAtFromUpdates(
        path.join(
          home,
          "sessions",
          encodeSessionCwd(cwd),
          "long-chat-huge-tail",
          "updates.jsonl",
        ),
        256 * 1024,
      ),
      isoFromUpdateTimestamp(1_750_000_100),
    );
  } finally {
    process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("untitled chats with a real prompt use the first sentence, not (no summary)", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-title-"));
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    const cwd = path.join(home, "proj");
    const promptLine = `${JSON.stringify({
      timestamp: 1_750_000_000,
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "帮我改窗口默认出现的位置" },
        },
      },
    })}\n`;
    writeSession(
      home,
      cwd,
      "untitled-but-spoke",
      {
        info: { id: "untitled-but-spoke", cwd },
        generated_title: "",
        session_summary: "",
        created_at: "2026-08-31T00:00:00.000Z",
        last_active_at: "2026-08-31T18:00:00.000Z",
        num_chat_messages: 2,
      },
      promptLine + updateLine("turn_completed", 1_750_000_010),
    );
    const listed = listSessionsForCwd(cwd);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, "帮我改窗口默认出现的位置");
    assert.equal(listed[0].lastMessageAt, isoFromUpdateTimestamp(1_750_000_010));
  } finally {
    process.env.GROK_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
