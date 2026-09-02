import { test } from "node:test";
import assert from "node:assert/strict";
import {
  folderDisplayName,
  groupSidebarChats,
  visibleFolderChats,
} from "../shared/sidebar-chats.mjs";

test("folderDisplayName uses the last folder", () => {
  assert.equal(folderDisplayName("/Users/oscarwoltz/Projects/Magician"), "Magician");
  assert.equal(folderDisplayName("/tmp/FDE实践/"), "FDE实践");
});

test("groupSidebarChats puts recent projects first and recents by last message", () => {
  const sessions = [
    { id: "a", cwd: "/p/alpha", lastMessageAt: "2026-09-01T10:00:00Z", title: "A" },
    { id: "b", cwd: "/p/beta", lastMessageAt: "2026-09-01T12:00:00Z", title: "B" },
    { id: "c", cwd: "/p/alpha", lastMessageAt: "2026-09-01T11:00:00Z", title: "C" },
  ];
  const grouped = groupSidebarChats({
    sessions,
    projectOrder: ["/p/beta", "/p/alpha"],
  });
  assert.deepEqual(
    grouped.projects.map((p) => p.name),
    ["beta", "alpha"],
  );
  assert.deepEqual(
    grouped.projects[1].chats.map((s) => s.id),
    ["c", "a"],
  );
  assert.equal(grouped.recent[0].id, "b");
});

test("visibleFolderChats hides extras until expanded", () => {
  const chats = [1, 2, 3, 4, 5].map((n) => ({ id: String(n) }));
  assert.equal(visibleFolderChats(chats, false, 4).length, 4);
  assert.equal(visibleFolderChats(chats, true, 4).length, 5);
});
