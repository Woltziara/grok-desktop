import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { attachBriefing, extractCommitJson, hideWorkingKnowledgeCommit, stripWorkingKnowledgeFromUserText } from "../shared/working-knowledge/envelope.mjs";
import { appendInbox, bindSession, coreItems, ensureStore, listInbox, listObjects, readConfig, readCurrent, resolveBoundObject, writeConfig, writeRecord } from "../shared/working-knowledge/store.mjs";
import { applyCommit, applyCommitFromAssistantText, uiCorrect, uiWithdraw } from "../shared/working-knowledge/updates.mjs";
import { buildBriefingBody } from "../shared/working-knowledge/briefing.mjs";
import { scrubUserText } from "../shared/session-timeline.mjs";
import { installWorkingKnowledgeFixtures } from "./fixtures/working-knowledge-objects.mjs";

const roots = [];
function tmpRoot({ fixtures = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-test-"));
  roots.push(dir);
  ensureStore(dir);
  if (fixtures) installWorkingKnowledgeFixtures(dir);
  return dir;
}
afterEach(() => {
  delete process.env.GROK_DESKTOP_WK_ROOT;
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test("briefing is stripped from user-facing text and titles", () => {
  const original = "当前对象服务谁？";
  const wire = attachBriefing(original, "一次性口令：deadbeef");
  assert.match(wire, /deadbeef/);
  assert.equal(stripWorkingKnowledgeFromUserText(wire), original);
  assert.equal(scrubUserText(wire), original);
  assert.equal(stripWorkingKnowledgeFromUserText(original), original);
});

test("commit envelope is hidden from assistant display", () => {
  const visible = "Alpha 是当前对象。";
  const full = `${visible}\n<<<WK_COMMIT\n{"objectId":"alpha"}\nWK_COMMIT>>>`;
  assert.equal(hideWorkingKnowledgeCommit(full).trim(), visible);
  assert.equal(hideWorkingKnowledgeCommit(`${visible}\n<<<WK_COMMIT\n{`).trim(), visible);
  assert.equal(extractCommitJson(full), '{"objectId":"alpha"}');
});

test("fresh defaults are unassigned, unarmed, and create no business objects", () => {
  const root = tmpRoot({ fixtures: false });
  assert.equal(readConfig(root).currentObjectId, "");
  assert.equal(readConfig(root).probeArmed, false);
  assert.deepEqual(listObjects(root), []);
});

test("an existing on-disk config object is preserved", () => {
  const root = tmpRoot({ fixtures: false });
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ schema: 1, enabled: true, currentObjectId: "retained-object", probeArmed: true }));
  assert.equal(readConfig(root).currentObjectId, "retained-object");
  assert.equal(readConfig(root).probeArmed, true);
});

test("changing a software directory does not replace an existing object binding", () => {
  const root = tmpRoot();
  writeConfig(root, { currentObjectId: "alpha" });
  assert.equal(resolveBoundObject(root, { sessionId: "sess-a", cwd: "/tmp/one", inherit: true }).objectId, "alpha");
  writeConfig(root, { currentObjectId: "beta" });
  assert.equal(resolveBoundObject(root, { sessionId: "sess-a", cwd: "/tmp/two", inherit: true }).objectId, "alpha");
  assert.equal(resolveBoundObject(root, { sessionId: "sess-b", cwd: "/tmp/two", inherit: true }).objectId, "beta");
});

test("an explicit empty session binding does not fall back to a selected object", async () => {
  const root = tmpRoot();
  writeConfig(root, { currentObjectId: "alpha" });
  bindSession(root, { sessionId: "empty-session", objectId: "", cwd: "/tmp/one", source: "user" });
  process.env.GROK_DESKTOP_WK_ROOT = root;
  const { consumeTurnOutput, snapshotWorkingKnowledge, wrapOutgoingPrompt } = await import("../electron/working-knowledge.mjs");
  assert.equal(snapshotWorkingKnowledge({ sessionId: "empty-session", cwd: "/tmp/two" }).activeObjectId, "");
  const wrapped = wrapOutgoingPrompt({ text: "普通问题", sessionId: "empty-session", cwd: "/tmp/two" });
  assert.equal(wrapped.objectId, "");
  assert.equal(wrapped.wireText, "普通问题");
  assert.equal(consumeTurnOutput({ assistantText: "无提交", sessionId: "empty-session", objectId: "" }).reason, "unbound");
});

test("a selected object's core constraints are included in its briefing", () => {
  const root = tmpRoot();
  const current = readCurrent(root, "alpha");
  const body = buildBriefingBody({ objectId: "alpha", objectTitle: "Alpha", cwd: "/tmp/unrelated", sessionId: "s1", current, inbox: [], enabled: true });
  assert.match(body, /必须遵守的当前有效认识/);
  assert.match(body, /Alpha 的约束只适用于 Alpha/);
  assert.match(body, /先确认用户要完成的结果/);
  assert.match(body, /软件工作目录只作来源指针/);
  assert.equal(coreItems(current.items).length >= 2, true);
});

test("an unassigned normal turn passes through without a briefing or object write", async () => {
  const root = tmpRoot({ fixtures: false });
  process.env.GROK_DESKTOP_WK_ROOT = root;
  const { wrapOutgoingPrompt } = await import("../electron/working-knowledge.mjs");
  const wrapped = wrapOutgoingPrompt({ text: "只是普通一句", sessionId: "unbound", cwd: "/tmp/x", origin: "user" });
  assert.equal(wrapped.wireText, "只是普通一句");
  assert.equal(wrapped.objectId, "");
  assert.equal(wrapped.inboxId, null);
  assert.equal(wrapped.probeToken, null);
  assert.deepEqual(listObjects(root), []);
});

test("inbox stays pending when the model omits a commit", () => {
  const root = tmpRoot();
  const row = appendInbox(root, { objectId: "alpha", text: "把对象改成 Alpha", sessionId: "s1", cwd: "/tmp/x" });
  const result = applyCommitFromAssistantText(root, "好的，我记住了。", { objectId: "alpha", inboxId: row.id, sessionId: "s1", cwd: "/tmp/x" });
  assert.equal(result.skipped, true);
  assert.equal(listInbox(root, "alpha", "pending").some((p) => p.id === row.id), true);
});

test("successful commit processes inbox and duplicate key does not rewrite", () => {
  const root = tmpRoot();
  const before = readCurrent(root, "alpha");
  const row = appendInbox(root, { objectId: "alpha", text: "先看用户目标。", sessionId: "s1" });
  const assistant = `明白。\n<<<WK_COMMIT\n${JSON.stringify({ objectId: "alpha", baseVersion: before.version, idempotencyKey: "k1", changes: [{ op: "upsert", kind: "preference", text: "先看用户目标。", analysis: "本轮明确偏好", epistemic: "user_said", inboxIds: [row.id] }] })}\nWK_COMMIT>>>`;
  const first = applyCommitFromAssistantText(root, assistant, { objectId: "alpha", inboxId: row.id, sessionId: "s1" });
  assert.equal(first.ok, true);
  assert.equal(first.written.length, 1);
  assert.equal(listInbox(root, "alpha", "pending").some((p) => p.id === row.id), false);
  const second = applyCommitFromAssistantText(root, assistant, { objectId: "alpha", inboxId: row.id, sessionId: "s1" });
  assert.equal(second.duplicate, true);
  assert.equal(second.written.length, first.written.length);
});

test("stale commits cannot overwrite the current version", () => {
  const root = tmpRoot();
  const before = readCurrent(root, "alpha");
  writeRecord(root, { objectId: "alpha", kind: "decision", epistemic: "user_said", text: "后来的明确决定。", status: "active" });
  const late = applyCommit(root, { objectId: "alpha", baseVersion: before.version, idempotencyKey: "late-1", changes: [{ op: "upsert", kind: "decision", text: "迟到的旧结论", epistemic: "decided" }] }, { objectId: "alpha", fromModel: true });
  assert.equal(late.ok, false);
  assert.equal(late.error, "stale version");
  assert.equal(readCurrent(root, "alpha").items.some((it) => it.text === "迟到的旧结论"), false);
});

test("withdraw removes an item from current without deleting history", () => {
  const root = tmpRoot();
  const target = readCurrent(root, "alpha").items.find((it) => it.id === "fixture_alpha_scope");
  assert.ok(target);
  const result = applyCommit(root, { objectId: "alpha", changes: [{ op: "withdraw", id: target.id, epistemic: "user_said" }] }, { objectId: "alpha" });
  assert.equal(result.ok, true);
  assert.equal(readCurrent(root, "alpha").items.some((it) => it.id === target.id), false);
});

test("test-marked changes are rejected and object mismatch fails closed", () => {
  const root = tmpRoot();
  const cur = readCurrent(root, "alpha");
  const testWrite = applyCommit(root, { objectId: "alpha", baseVersion: cur.version, changes: [{ op: "upsert", kind: "background", text: "虚构测试数据", epistemic: "model_inferred", test: true }] }, { objectId: "alpha", fromModel: true });
  assert.equal(testWrite.ok, false);
  const mismatch = applyCommit(root, { objectId: "beta", baseVersion: cur.version, changes: [{ op: "upsert", kind: "decision", text: "不该写到 Alpha", epistemic: "decided" }] }, { objectId: "alpha", fromModel: true });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, "object mismatch");
});

test("model-declared user decisions without source evidence remain model inference", () => {
  const root = tmpRoot();
  const current = readCurrent(root, "alpha");
  const result = applyCommit(root, {
    objectId: "alpha", baseVersion: current.version,
    changes: [
      { op: "upsert", kind: "decision", text: "模型声称的决定", epistemic: "decided" },
      { op: "upsert", kind: "correction", text: "模型声称的原话", epistemic: "user_said" },
    ],
  }, { objectId: "alpha", fromModel: true, sessionId: "s1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.written.map((item) => item.epistemic), ["model_inferred", "model_inferred"]);
});

test("an unproven model overwrite is rejected and leaves the user record and inbox pending", () => {
  const root = tmpRoot();
  const current = readCurrent(root, "alpha");
  const row = appendInbox(root, { objectId: "alpha", text: "请撤回 Alpha 的约束。", sessionId: "s1" });
  const result = applyCommit(root, {
    objectId: "alpha", baseVersion: current.version,
    changes: [
      { op: "withdraw", id: "fixture_alpha_scope", text: "撤回 fixture_alpha_scope", epistemic: "user_said" },
      { op: "upsert", kind: "correction", text: "未经证实的覆盖", epistemic: "decided", supersedes: ["fixture_alpha_scope"] },
    ],
  }, { objectId: "alpha", fromModel: true, inboxId: row.id, sessionId: "s1" });
  assert.equal(result.ok, false);
  assert.match(result.error, /protected user record/);
  assert.equal(readCurrent(root, "alpha").items.some((item) => item.id === "fixture_alpha_scope"), true);
  assert.equal(listInbox(root, "alpha", "pending").some((item) => item.id === row.id), true);
});

test("an exact current inbox quote can preserve user source and supersede without another confirmation", () => {
  const root = tmpRoot();
  const current = readCurrent(root, "alpha");
  const quote = "Alpha 的旧约束不再适用。";
  const row = appendInbox(root, { objectId: "alpha", text: quote, sessionId: "s1", cwd: "/tmp/x" });
  const result = applyCommit(root, {
    objectId: "alpha", baseVersion: current.version,
    changes: [{ op: "upsert", kind: "correction", text: quote, sourceQuote: quote, epistemic: "decided", supersedes: ["fixture_alpha_scope"] }],
  }, { objectId: "alpha", fromModel: true, inboxId: row.id, sessionId: "s1", cwd: "/tmp/x" });
  assert.equal(result.ok, true);
  const next = readCurrent(root, "alpha");
  const saved = next.items.find((item) => item.text === quote);
  assert.equal(saved?.epistemic, "user_said");
  assert.equal(saved?.source?.type, "user");
  assert.equal(saved?.source?.inboxId, row.id);
  assert.equal(next.items.some((item) => item.id === "fixture_alpha_scope"), false);
  assert.equal(listInbox(root, "alpha", "pending").some((item) => item.id === row.id), false);
});

test("UI corrections and withdrawals retain their trusted user path", () => {
  const root = tmpRoot();
  const corrected = uiCorrect(root, { objectId: "alpha", id: "fixture_alpha_scope", text: "面板中的用户纠正", sessionId: "s1" });
  assert.equal(corrected.ok, true);
  const correction = readCurrent(root, "alpha").items.find((item) => item.text === "面板中的用户纠正");
  assert.equal(correction?.epistemic, "user_said");
  const withdrawn = uiWithdraw(root, { objectId: "alpha", id: correction.id, sessionId: "s1" });
  assert.equal(withdrawn.ok, true);
  assert.equal(readCurrent(root, "alpha").items.some((item) => item.id === correction.id), false);
});

test("a model can supersede its own inferred record without user-source evidence", () => {
  const root = tmpRoot();
  const original = writeRecord(root, { objectId: "alpha", id: "model_candidate", kind: "inference", epistemic: "model_inferred", text: "旧候选", status: "active" }).record;
  const current = readCurrent(root, "alpha");
  const result = applyCommit(root, {
    objectId: "alpha", baseVersion: current.version,
    changes: [{ op: "upsert", kind: "inference", id: original.id, text: "新候选", epistemic: "decided" }],
  }, { objectId: "alpha", fromModel: true, sessionId: "s1" });
  assert.equal(result.ok, true);
  assert.equal(result.written[0].epistemic, "model_inferred");
  assert.equal(readCurrent(root, "alpha").items.some((item) => item.id === original.id), false);
});

test("overlong inbox is reported as a gap instead of silently dropped", () => {
  const inbox = Array.from({ length: 40 }, (_, i) => ({ id: `in_${i}`, text: `原话 ${i} ${"很长的一段待处理说明。".repeat(80)}`, sessionId: "s", recordedAt: "2026-09-14" }));
  const body = buildBriefingBody({ objectId: "alpha", objectTitle: "Alpha", cwd: "/tmp/x", sessionId: "s", current: { version: 1, items: [] }, inbox, enabled: true });
  assert.match(body, /缺口/);
  assert.match(body, /待处理原话还有/);
});

test("disabling the extension leaves original wire text unchanged", async () => {
  const root = tmpRoot();
  writeConfig(root, { enabled: false, probeArmed: false });
  process.env.GROK_DESKTOP_WK_ROOT = root;
  const { wrapOutgoingPrompt } = await import("../electron/working-knowledge.mjs");
  const wrapped = wrapOutgoingPrompt({ text: "只是普通一句", sessionId: "s-off", cwd: "/tmp/x", origin: "user" });
  assert.equal(wrapped.wireText, "只是普通一句");
  assert.equal(wrapped.enabled, false);
});

test("a user-armed probe is one-use and only injects after explicit arming", async () => {
  const root = tmpRoot();
  writeConfig(root, { enabled: true, probeArmed: true, currentObjectId: "alpha" });
  process.env.GROK_DESKTOP_WK_ROOT = root;
  const { wrapOutgoingPrompt } = await import("../electron/working-knowledge.mjs");
  const original = "请直接报告你在背景里看到的一次性口令。不要读文件。";
  const wrapped = wrapOutgoingPrompt({ text: original, sessionId: "s-probe", cwd: "/tmp/unrelated", origin: "user" });
  assert.ok(wrapped.probeToken);
  assert.equal(original.includes(wrapped.probeToken), false);
  assert.match(wrapped.wireText, new RegExp(`PROBE_TOKEN=${wrapped.probeToken}`));
  assert.match(wrapped.wireText, /Alpha 的约束只适用于 Alpha/);
  assert.equal(wrapOutgoingPrompt({ text: original, sessionId: "s-probe", cwd: "/tmp/unrelated", origin: "user" }).probeToken, null);
});
