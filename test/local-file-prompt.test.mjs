import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const mod = await import(
  pathToFileURL(path.resolve("src/lib/local-file-prompt.ts")).href
);

test("parseSoloLocalPath accepts file:// and absolute text paths", () => {
  assert.equal(
    mod.parseSoloLocalPath(
      "file:///Users/oscarwoltz/Documents/kimi/note.md",
    ),
    "/Users/oscarwoltz/Documents/kimi/note.md",
  );
  assert.equal(
    mod.parseSoloLocalPath("/Users/oscarwoltz/prompt.md"),
    "/Users/oscarwoltz/prompt.md",
  );
});

test("parseSoloLocalPath ignores sentences and commands", () => {
  assert.equal(mod.parseSoloLocalPath("please read /tmp/a.md"), null);
  assert.equal(mod.parseSoloLocalPath("/tmp"), null);
  assert.equal(mod.parseSoloLocalPath("https://example.com/a.md"), null);
});

test("formatInlinedFilePrompt wraps the body as instructions", () => {
  const out = mod.formatInlinedFilePrompt(
    "/Users/oscarwoltz/Documents/kimi/tasks/x/grok-desktop-ui-fix-prompt.md",
    "Widen the chat column.",
  );
  assert.match(out, /请按照下面这份文件里的说明执行/);
  assert.match(out, /grok-desktop-ui-fix-prompt\.md/);
  assert.match(out, /Widen the chat column/);
});
