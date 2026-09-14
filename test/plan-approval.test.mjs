import assert from "node:assert/strict";
import { test } from "node:test";
import { planApproveCommentsText } from "../shared/plan-approval.mjs";

test("plan approval comments are a follow-up after approval", () => {
  assert.equal(planApproveCommentsText("  "), "");
  assert.equal(
    planApproveCommentsText("Keep the rollback."),
    "The user approved the plan with the following review comments:\n\nKeep the rollback.",
  );
});
