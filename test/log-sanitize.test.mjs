import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeDiagnostic } from "../electron/log-sanitize.mjs";
import { persistablePreviewUrl } from "../shared/preview-url.mjs";

test("client_secret keys are redacted and preview persistence drops query credentials", () => {
  const san = sanitizeDiagnostic({
    url: "https://account:secret@auth.example.test/authorize?code=test-code#access_token=tok",
    client_secret: "oauth-client-secret",
    Cookie: "session=test-cookie",
  });
  assert.equal(san.url, "https://auth.example.test/authorize");
  assert.equal(san.client_secret, "[redacted]");
  assert.equal(san.Cookie, "[redacted]");
  assert.doesNotMatch(JSON.stringify(san), /oauth-client-secret|test-code|test-cookie|account:secret/);
  assert.equal(
    persistablePreviewUrl("https://user:pass@accounts.example.test/login?code=SECRET#frag"),
    "https://accounts.example.test/login",
  );
  assert.equal(
    persistablePreviewUrl("https://example.test/record?id=A#/keep"),
    "https://example.test/record?id=A#/keep",
  );
});
