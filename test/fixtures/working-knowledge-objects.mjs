import { ensureObject, writeRecord } from "../../shared/working-knowledge/store.mjs";

/** Small synthetic objects used only by working-knowledge tests. */
export function installWorkingKnowledgeFixtures(root) {
  ensureObject(root, "alpha", { title: "Alpha（测试）", test: true });
  ensureObject(root, "beta", { title: "Beta（测试）", test: true });
  writeRecord(root, {
    objectId: "alpha", id: "fixture_alpha_scope", kind: "correction",
    epistemic: "user_said", text: "Alpha 的约束只适用于 Alpha。",
    scope: "Alpha", status: "active",
  });
  writeRecord(root, {
    objectId: "alpha", id: "fixture_alpha_method", kind: "preference",
    epistemic: "user_said", text: "先确认用户要完成的结果，再选择手段。",
    scope: "Alpha", status: "active",
  });
  writeRecord(root, {
    objectId: "beta", id: "fixture_beta_scope", kind: "background",
    epistemic: "user_said", text: "Beta 保持独立的工作边界。",
    scope: "Beta", status: "active",
  });
}
