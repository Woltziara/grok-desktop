import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addComposerQuote,
  isQuotesOnlySend,
  parseQuotesFromContent,
  serializeQuotesForAgent,
} from "../shared/composer-quotes.mjs";

test("serialize then parse round-trips quotes ahead of the typed reply", () => {
  const quotes = [{ id: "q1", text: "这一段有问题" }];
  const sent = serializeQuotesForAgent(quotes, "请改这里");
  assert.match(sent, /Quoted excerpt/);
  assert.match(sent, /请改这里$/);
  const parsed = parseQuotesFromContent(sent);
  assert.equal(parsed.quotes.length, 1);
  assert.equal(parsed.quotes[0].text, "这一段有问题");
  assert.equal(parsed.text, "请改这里");
});

test("duplicate excerpt is not added twice", () => {
  const once = addComposerQuote([], { text: "同一段" });
  const twice = addComposerQuote(once, { text: "同一段" });
  assert.equal(once.length, 1);
  assert.equal(twice.length, 1);
});

test("quotes-only send is allowed", () => {
  assert.equal(isQuotesOnlySend("", [{ text: "摘" }]), true);
  assert.equal(isQuotesOnlySend("  ", []), false);
});
