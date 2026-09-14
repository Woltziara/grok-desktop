import os from "node:os";
import path from "node:path";

export const STORE_SCHEMA = 1;

export function defaultKnowledgeRoot() {
  if (process.env.GROK_DESKTOP_WK_ROOT) {
    return path.resolve(process.env.GROK_DESKTOP_WK_ROOT);
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "GrokDesktopWorkingKnowledge",
    );
  }
  return path.join(os.homedir(), ".grok-desktop-working-knowledge");
}

export function resolveKnowledgeRoot(root) {
  const raw = root == null || root === "" ? defaultKnowledgeRoot() : root;
  return path.resolve(String(raw));
}

export function isSafeObjectId(id) {
  return typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id);
}

export const README_TEXT = `这是 Grok Desktop 客厅的本机工作认识（可回滚）。
不是 Grok 自带「记住说过的事」，也不是任何预置业务对象的资料库。

关掉扩展：在窗口输入框旁点「工作认识」关掉开关，
或把本目录 config.json 里的 enabled 设为 false。

删除本文件夹 = 清除本扩展写入的全部记录。
Grok 会话原文仍在 ~/.grok/sessions，不会被这份扩展改写成正本。

probe/ 与带 "test": true 的条目是测试/探针，不会自动转成正式经营记录。
`;
