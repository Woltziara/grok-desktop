import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dropQueuedItem,
  editQueuedItem,
  moveQueuedItem,
  restoreQueuedItem,
} from "../shared/queue-order.mjs";

test("queue items can move, edit, and drop", () => {
  const start = [
    { id: "a", text: "one" },
    { id: "b", text: "two" },
    { id: "c", text: "three" },
  ];
  assert.deepEqual(
    moveQueuedItem(start, "b", -1).map((r) => r.id),
    ["b", "a", "c"],
  );
  assert.equal(editQueuedItem(start, "c", "改过").find((r) => r.id === "c").text, "改过");
  assert.deepEqual(
    dropQueuedItem(start, "a").map((r) => r.id),
    ["b", "c"],
  );
});

test("failed delivery restores the same queue identity at the FIFO head", () => {
  const failed = { id: "a", text: "first" };
  const tail = [{ id: "b", text: "second" }];
  const restored = restoreQueuedItem(tail, failed);
  assert.deepEqual(restored.map((row) => row.id), ["a", "b"]);
  assert.equal(restoreQueuedItem(restored, failed), restored);
});
