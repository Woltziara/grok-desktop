import assert from "node:assert/strict";
import { test } from "node:test";
import { composerEnterAction, isImeComposing } from "../shared/composer-ime.mjs";

test("IME Enter does not send", () => {
  assert.equal(
    composerEnterAction({
      key: "Enter",
      nativeEvent: { isComposing: true, keyCode: 229 },
    }),
    "ignore",
  );
  assert.equal(isImeComposing({ keyCode: 229 }), true);
});

test("plain Enter submits, Shift is newline, ⌘Enter is now", () => {
  assert.equal(composerEnterAction({ key: "Enter" }), "submit");
  assert.equal(composerEnterAction({ key: "Enter", shiftKey: true }), "newline");
  assert.equal(composerEnterAction({ key: "Enter", metaKey: true }), "now");
  assert.equal(composerEnterAction({ key: "a" }), "ignore");
});
