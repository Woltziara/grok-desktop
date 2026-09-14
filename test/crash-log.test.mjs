import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  errorFields,
  getCrashLogPath,
  writeCrashLog,
} from "../electron/crash-log.mjs";

test("crash log has a stable default path and useful Error fields", () => {
  assert.match(getCrashLogPath(), /desktop-crash\.log$/);
  const err = new Error("boom");
  err.code = -32000;
  const fields = errorFields(err);
  assert.equal(fields.name, "Error");
  assert.equal(fields.message, "boom");
  assert.equal(fields.code, -32000);
});

test("crash log writes JSON lines and does not throw on circular metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-crash-log-"));
  const file = path.join(dir, "desktop-crash.log");
  try {
    writeCrashLog("preview", "opened", { n: 1 }, file);
    const circular = {}; circular.self = circular;
    assert.doesNotThrow(() => writeCrashLog("preview", "circular", circular, file));
    const row = JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n")[0]);
    assert.equal(row.scope, "preview");
    assert.equal(row.msg, "opened");
    assert.equal(row.data.n, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
