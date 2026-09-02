import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const url = pathToFileURL(
  path.resolve("src/lib/session-artifacts.ts"),
).href;

const { collectSessionArtifacts, artifactKindFromPath, isTryableArtifact } =
  await import(url);

test("html and images are tryable; source files are listed but not auto-tried", () => {
  assert.equal(artifactKindFromPath("deck/index.html"), "html");
  assert.equal(artifactKindFromPath("shot.png"), "image");
  assert.equal(artifactKindFromPath("note.md"), "markdown");
  assert.equal(isTryableArtifact("html"), true);
  assert.equal(isTryableArtifact("text"), false);
});

test("collects written files from the conversation, one row per path", () => {
  const project = "/Users/oscarwoltz/case";
  const artifacts = collectSessionArtifacts(
    [
      {
        id: "1",
        kind: "user",
        text: "做一页",
        at: 1,
      },
      {
        id: "2",
        kind: "tool",
        toolCallId: "t1",
        title: "Edit index.html",
        status: "completed",
        toolKind: "edit",
        raw: { target_file: "site/index.html" },
        at: 2,
      },
      {
        id: "3",
        kind: "tool",
        toolCallId: "t2",
        title: "Read package.json",
        status: "completed",
        toolKind: "read",
        raw: { path: "package.json" },
        at: 3,
      },
      {
        id: "4",
        kind: "tool",
        toolCallId: "t3",
        title: "Edit index.html",
        status: "completed",
        toolKind: "write",
        raw: { path: `${project}/site/index.html` },
        at: 4,
      },
    ],
    project,
  );
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].relPath, "site/index.html");
  assert.equal(artifacts[0].kind, "html");
  assert.equal(artifacts[0].toolCallId, "t3");
});

test("skips failed writes and empty project", () => {
  assert.deepEqual(collectSessionArtifacts([], null), []);
  const artifacts = collectSessionArtifacts(
    [
      {
        id: "1",
        kind: "tool",
        toolCallId: "t1",
        title: "Edit gone.html",
        status: "failed",
        toolKind: "edit",
        raw: { path: "gone.html" },
        at: 1,
      },
    ],
    "/tmp/p",
  );
  assert.equal(artifacts.length, 0);
});
