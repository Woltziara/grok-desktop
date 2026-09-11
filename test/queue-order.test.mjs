import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dropQueuedItem,
  editQueuedItem,
  moveQueuedItem,
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
