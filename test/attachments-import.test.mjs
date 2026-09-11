import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { importAttachmentFile } from "../electron/attachments.mjs";

test("PDF is copied into the session folder so the agent can read it", async () => {
  const grokHome = fs.mkdtempSync(path.join(os.tmpdir(), "grok-att-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-att-cwd-"));
  const src = path.join(os.tmpdir(), `attachment-check-${Date.now()}.pdf`);
  fs.writeFileSync(src, "%PDF-1.4 test");
  const prev = process.env.GROK_HOME;
  process.env.GROK_HOME = grokHome;
  try {
    const row = await importAttachmentFile(src, {
      cwd,
      sessionId: "sess12345678",
    });
    assert.equal(row.kind, "pdf");
    assert.equal(row.staged, true);
    assert.equal(fs.existsSync(row.path), true);
    assert.match(row.path, /attachments/);
    assert.notEqual(row.path, src);
  } finally {
    if (prev == null) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prev;
    fs.rmSync(src, { force: true });
    fs.rmSync(grokHome, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("missing files ask the person to pick again", async () => {
  await assert.rejects(
    () => importAttachmentFile("/tmp/does-not-exist-grok-attach.pdf"),
    /不存在/,
  );
});
