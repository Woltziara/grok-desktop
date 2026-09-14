import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  alignmentPreviewText,
  appBundleFromExecPath,
  parseRsyncDryRun,
  peerHostsForThisMachine,
  rsyncExcludeArgs,
  summarizeFileList,
  PROJECTS_EXCLUDES,
} from "../shared/peer-sync.mjs";

test("file alignment cannot restore a retired Grok Desktop source copy", (t) => {
  if (spawnSync("rsync", ["--version"]).error) {
    t.skip("rsync is not installed on this host");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-peer-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  fs.mkdirSync(path.join(source, "Grok Desktop", "grok-app"), { recursive: true });
  fs.mkdirSync(path.join(source, "notes", ".dev"), { recursive: true });
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, "Grok Desktop", "grok-app", "old.js"), "old version");
  fs.writeFileSync(path.join(source, "notes", ".dev", "scratch.js"), "scratch");
  fs.writeFileSync(path.join(source, "notes", "keep.md"), "user material");
  const result = spawnSync("rsync", ["-a", ...rsyncExcludeArgs(PROJECTS_EXCLUDES), `${source}/`, `${target}/`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(target, "Grok Desktop")), false);
  assert.equal(fs.existsSync(path.join(target, "notes", ".dev")), false);
  assert.equal(fs.readFileSync(path.join(target, "notes", "keep.md"), "utf8"), "user material");
});

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

test("legacy alignment summary no longer promises timestamp overwrite", () => {
  assert.equal(
    alignmentPreviewText({ pull: [], push: [] }),
    "两边已经一样，不用动。",
  );
  const t = alignmentPreviewText({ pull: ["a"], push: ["b", "c"] });
  assert.match(t, /拿来 1/);
  assert.match(t, /送过去 2/);
  assert.match(t, /冲突需明确选择/);
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

test("app bundle path is the .app, not the inner binary", () => {
  assert.equal(
    appBundleFromExecPath(
      "/Applications/Grok Desktop.app/Contents/MacOS/Grok Desktop",
    ),
    "/Applications/Grok Desktop.app",
  );
  assert.equal(appBundleFromExecPath("/usr/local/bin/electron"), null);
  assert.equal(appBundleFromExecPath(""), null);
});
