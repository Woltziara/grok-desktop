import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  publicAccountRow,
  snapshotIdFromSummary,
  summarizeAuthRaw,
} from "../shared/account-auth.mjs";

const sample = {
  "https://auth.x.ai::abc": {
    email: "a@example.com",
    first_name: "Ann",
    last_name: "Lee",
    user_id: "uid-1",
    refresh_token: "SECRET",
    key: "SECRETKEY",
    expires_at: "2099-01-01T00:00:00Z",
  },
};

test("summarize strips tokens and keeps the name", () => {
  const s = summarizeAuthRaw(sample);
  assert.equal(s.email, "a@example.com");
  assert.equal(s.displayName, "Ann Lee");
  assert.equal(s.userId, "uid-1");
  assert.equal(s.expired, false);
  const json = JSON.stringify(s);
  assert.equal(json.includes("SECRET"), false);
  assert.equal(json.includes("SECRETKEY"), false);
});

test("snapshot id prefers user id", () => {
  assert.equal(snapshotIdFromSummary(summarizeAuthRaw(sample)), "uid-1");
});

test("public row never includes token fields", () => {
  const row = publicAccountRow(summarizeAuthRaw(sample), { active: true });
  assert.equal(row.active, true);
  assert.equal(row.email, "a@example.com");
  assert.equal("refresh_token" in row, false);
  assert.equal("key" in row, false);
});

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "grok-desktop-acct-"));
const grokHome = path.join(tmpHome, ".grok");
fs.mkdirSync(grokHome, { recursive: true });
process.env.GROK_HOME = grokHome;

const acc = await import("../electron/account-auth.mjs");

function writeAuth(userId, email) {
  fs.writeFileSync(
    path.join(grokHome, "auth.json"),
    JSON.stringify(
      {
        "https://auth.x.ai::x": {
          email,
          first_name: "Woltz",
          last_name: "Kai",
          user_id: userId,
          refresh_token: "tok-" + userId,
          key: "key-" + userId,
          auth_mode: "oidc",
        },
      },
      null,
      2,
    ),
  );
}

test("save and switch keeps both logins", () => {
  writeAuth("one", "one@example.com");
  const first = acc.saveCurrentSnapshot();
  assert.equal(first.email, "one@example.com");
  writeAuth("two", "two@example.com");
  acc.saveCurrentSnapshot();
  const listed = acc.listAccountSnapshots();
  assert.equal(listed.current.email, "two@example.com");
  assert.equal(listed.saved.length, 2);
  const switched = acc.activateAccount("one");
  assert.equal(switched.ok, true);
  const now = JSON.parse(
    fs.readFileSync(path.join(grokHome, "auth.json"), "utf8"),
  );
  const entry = Object.values(now)[0];
  assert.equal(entry.email, "one@example.com");
  assert.equal(entry.refresh_token, "tok-one");
});
