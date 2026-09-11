import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignmentPreviewText,
  parseRsyncDryRun,
  peerHostsForThisMachine,
  rsyncExcludeArgs,
  summarizeFileList,
} from "../shared/peer-sync.mjs";

test("studio sees the laptop hosts", () => {
  const p = peerHostsForThisMachine("Mac-Studio.local");
  assert.equal(p.role, "studio");
  assert.ok(p.hosts.includes("100.81.49.104"));
  assert.ok(p.hosts.includes("10.10.10.2"));
});

test("macbook sees the studio hosts", () => {
  const p = peerHostsForThisMachine("WoltzdeMacBook-Pro.local");
  assert.equal(p.role, "laptop");
  assert.ok(p.hosts.includes("100.98.141.28"));
});

test("parse rsync dry-run skips noise and directories", () => {
  const files = parseRsyncDryRun(`
sending incremental file list
./
sessions/abc/summary.json
memory/MEMORY.md
foo/
sent 123 bytes
total size is 9
`);
  assert.deepEqual(files, ["sessions/abc/summary.json", "memory/MEMORY.md"]);
});

test("alignment preview is chinese and newer-wins", () => {
  assert.equal(
    alignmentPreviewText({ pull: [], push: [] }),
    "两边已经一样，不用动。",
  );
  const t = alignmentPreviewText({ pull: ["a"], push: ["b", "c"] });
  assert.match(t, /拿来 1/);
  assert.match(t, /送过去 2/);
  assert.match(t, /新的会盖掉旧的/);
  const s = summarizeFileList(["a", "b", "c"], 2);
  assert.equal(s.count, 3);
  assert.equal(s.more, 1);
});

test("exclude args pair with rsync", () => {
  assert.deepEqual(rsyncExcludeArgs([".git", "dist"]), [
    "--exclude",
    ".git",
    "--exclude",
    "dist",
  ]);
});
