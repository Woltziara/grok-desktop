import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClockShort,
  formatDayLabel,
  shouldShowTimeDivider,
} from "../shared/time.mjs";

test("formatClockShort is 24-hour Chinese clock", () => {
  const at = Date.parse("2026-08-31T13:36:00");
  assert.equal(formatClockShort(at), "13:36");
});

test("formatDayLabel uses 今天 with the clock", () => {
  const now = new Date();
  const at = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    13,
    36,
  ).getTime();
  assert.equal(formatDayLabel(at), "今天 13:36");
});

test("shouldShowTimeDivider after a pause or a new day", () => {
  const t1 = Date.parse("2026-08-31T13:00:00");
  const t2 = Date.parse("2026-08-31T13:02:00");
  const t3 = Date.parse("2026-08-31T13:10:00");
  const nextDay = Date.parse("2026-09-01T09:00:00");
  assert.equal(shouldShowTimeDivider(null, t1), true);
  assert.equal(shouldShowTimeDivider(t1, t2), false);
  assert.equal(shouldShowTimeDivider(t1, t3), true);
  assert.equal(shouldShowTimeDivider(t1, nextDay), true);
});
