import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachDuplicateKey,
  classifyAttachKind,
  findDuplicateAttach,
  formatAttachedFilesPrompt,
  isAllowedAttachKind,
  mergeComposerTextWithFiles,
} from "../shared/pending-attach.mjs";

test("classifies pdf / word / markdown and rejects unknown binaries", () => {
  assert.equal(classifyAttachKind("note.md"), "markdown");
  assert.equal(classifyAttachKind("brief.pdf", "application/pdf"), "pdf");
  assert.equal(classifyAttachKind("合同.docx"), "word");
  assert.equal(classifyAttachKind("shot.png", "image/png"), "image");
  assert.equal(classifyAttachKind("clip.mp4"), "other");
  assert.equal(isAllowedAttachKind("other"), false);
  assert.equal(isAllowedAttachKind("pdf"), true);
});

test("duplicate drop uses path, then name+size", () => {
  const existing = [{ path: "/tmp/a.pdf", name: "a.pdf", size: 12 }];
  assert.ok(
    findDuplicateAttach(existing, { path: "/tmp/a.pdf", name: "a.pdf", size: 99 }),
  );
  assert.equal(
    findDuplicateAttach(existing, { name: "b.pdf", size: 12 }),
    null,
  );
  assert.equal(attachDuplicateKey({ name: "A.PDF", size: 3 }), "name:a.pdf:3");
});

test("text files inline; pdf keeps a path instruction", () => {
  const prompt = formatAttachedFilesPrompt([
    { name: "a.md", kind: "markdown", text: "# 标题" },
    { name: "b.pdf", kind: "pdf", path: "/tmp/b.pdf" },
  ]);
  assert.match(prompt, /# 标题/);
  assert.match(prompt, /\/tmp\/b\.pdf/);
  const merged = mergeComposerTextWithFiles("请看这两份", [
    { name: "b.pdf", kind: "pdf", path: "/tmp/b.pdf" },
  ]);
  assert.match(merged, /^请看这两份/);
  assert.match(merged, /b\.pdf/);
});
