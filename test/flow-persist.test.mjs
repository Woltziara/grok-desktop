import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readAllDraftRecords,
  writeDraftRecord,
} from "../shared/flow-persist.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(i) {
      return [...map.keys()][i] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("two windows saving different session drafts keep both records", () => {
  const shared = memoryStorage();
  const a = writeDraftRecord(shared, "/audit::A", {
    text: "from A",
    files: [],
    cwd: "/audit",
    savedAt: 1,
  });
  const b = writeDraftRecord(shared, "/audit::B", {
    text: "from B",
    files: [],
    cwd: "/audit",
    savedAt: 2,
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const drafts = readAllDraftRecords(shared);
  assert.equal(drafts["/audit::A"].text, "from A");
  assert.equal(drafts["/audit::B"].text, "from B");
  assert.deepEqual(Object.keys(drafts).sort(), ["/audit::A", "/audit::B"]);
});

test("draft write failure is returned instead of swallowed", () => {
  const storage = memoryStorage();
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const result = writeDraftRecord(storage, "/audit::A", { text: "x", files: [] });
  assert.equal(result.ok, false);
  assert.match(String(result.error), /QuotaExceededError/);
});

test("a browser-only draft survives renderer storage instead of becoming an empty draft", () => {
  const storage = memoryStorage();
  const browserReference = {version:1,kind:"owned-preview",sessionId:"A",leaseId:"lease",pageId:"page",title:"Page",displayUrl:"https://example.test",capturedAt:1};
  assert.equal(writeDraftRecord(storage, "/audit::A", {text:"",files:[],cwd:"/audit",savedAt:1,browserReference}).ok,true);
  assert.deepEqual(readAllDraftRecords(storage)["/audit::A"].browserReference,browserReference);
});
