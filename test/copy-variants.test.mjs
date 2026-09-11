import assert from "node:assert/strict";
import { test } from "node:test";
import { copyPayloads, markdownTableToTsv } from "../shared/copy-variants.mjs";

test("plain copy drops markdown chrome; tables become TSV", () => {
  const md = [
    "## 结论",
    "",
    "请看 **表格**：",
    "",
    "| 项 | 值 |",
    "| --- | --- |",
    "| 责任 | 甲方 |",
  ].join("\n");
  const payload = copyPayloads(md);
  assert.equal(payload.plain.includes("##"), false);
  assert.match(payload.plain, /结论/);
  assert.equal(payload.tables.length, 1);
  assert.equal(payload.tables[0].tsv, "项\t值\n责任\t甲方");
  assert.match(markdownTableToTsv(payload.tables[0].markdown), /甲方/);
});
