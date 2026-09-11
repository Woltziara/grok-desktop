import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archivedChats,
  duplicateProjectNames,
  hasDraftContent,
  mergeDraftSessions,
  organizeFolderChats,
  organizeProjects,
  parentPathSnippet,
  sessionOrgKey,
  shouldAbandonEmptySession,
  stableProjectOrder,
  timelineHasUserSpeech,
} from "../shared/workspace-org.mjs";

test("opening another project does not jump it to the top", () => {
  const order = stableProjectOrder(
    ["/Users/oscarwoltz/Projects/Grok Desktop", "/tmp/case-a"],
    ["/tmp/case-a", "/Users/oscarwoltz/Projects/Grok Desktop", "/tmp/new"],
  );
  assert.deepEqual(order, [
    "/Users/oscarwoltz/Projects/Grok Desktop",
    "/tmp/case-a",
    "/tmp/new",
  ]);
});

test("pinned chats stay above, archived chats hide", () => {
  const chats = [
    { id: "a", cwd: "/p", lastMessageAt: "2026-09-01T12:00:00Z", title: "新" },
    { id: "b", cwd: "/p", lastMessageAt: "2026-09-01T10:00:00Z", title: "旧" },
    { id: "c", cwd: "/p", lastMessageAt: "2026-09-01T13:00:00Z", title: "完" },
  ];
  const pinned = { [sessionOrgKey("/p", "b")]: 1 };
  const archived = { [sessionOrgKey("/p", "c")]: Date.now() };
  const shown = organizeFolderChats(chats, { pinned, archived });
  assert.deepEqual(
    shown.map((c) => c.id),
    ["b", "a"],
  );
  assert.deepEqual(
    archivedChats(chats, archived).map((c) => c.id),
    ["c"],
  );
});

test("empty new chats without a draft are abandoned", () => {
  assert.equal(
    shouldAbandonEmptySession({
      sessionId: "s1",
      nextSessionId: "s2",
      hadUserSpeech: false,
      hasDraft: false,
    }),
    true,
  );
  assert.equal(
    shouldAbandonEmptySession({
      sessionId: "s1",
      nextSessionId: "s2",
      hadUserSpeech: false,
      hasDraft: true,
    }),
    false,
  );
  assert.equal(
    timelineHasUserSpeech([{ kind: "system", text: "hello" }]),
    false,
  );
  assert.equal(
    timelineHasUserSpeech([{ kind: "user", text: "开始" }]),
    true,
  );
});

test("draft-only sessions reappear in the catalog", () => {
  const merged = mergeDraftSessions(
    [{ id: "keep", cwd: "/p", title: "已有" }],
    {
      [sessionOrgKey("/p", "drafty")]: {
        cwd: "/p",
        text: "写了一半",
        savedAt: Date.parse("2026-09-01T00:00:00Z"),
      },
    },
  );
  assert.ok(merged.some((s) => s.id === "drafty" && s.isDraft));
  assert.equal(hasDraftContent({ text: "  " }), false);
  assert.equal(hasDraftContent({ text: "hi" }), true);
});

test("pinned projects stay above the saved order", () => {
  const rows = [
    { cwd: "/p/a", name: "a" },
    { cwd: "/p/b", name: "b" },
    { cwd: "/p/c", name: "c" },
  ];
  const out = organizeProjects(rows, { "/p/c": 1 });
  assert.deepEqual(
    out.map((r) => r.name),
    ["c", "a", "b"],
  );
});

test("same-name projects get a parent snippet", () => {
  const dups = duplicateProjectNames([
    { name: "app", cwd: "/x/one/app" },
    { name: "app", cwd: "/x/two/app" },
  ]);
  assert.equal(dups.get("app"), 2);
  assert.equal(parentPathSnippet("/x/two/app"), "two");
});
