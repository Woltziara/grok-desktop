import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listParked,
  settleParked,
  wrapParked,
} from "../electron/parked-request.mjs";

test("parked request preserves params for rehydrate and settles once owned", () => {
  let got = null;
  const entry = wrapParked((decision) => {
    got = decision;
  }, { cwd: "/repo" });
  const map = new Map([["trust-1", entry]]);
  assert.deepEqual(listParked(map), [
    { reqId: "trust-1", params: { cwd: "/repo" } },
  ]);
  assert.equal(settleParked(entry, { outcome: "trust" }), true);
  assert.deepEqual(got, { outcome: "trust" });
});

test("parked helpers fail closed on legacy callbacks and junk", () => {
  assert.equal(settleParked(() => {}, { outcome: "trust" }), false);
  assert.equal(settleParked({}, { outcome: "trust" }), false);
  assert.deepEqual(listParked(new Map([["bad", () => {}]])), []);
});
