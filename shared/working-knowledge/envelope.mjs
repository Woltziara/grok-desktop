/**
 * Wire markers for living-room working knowledge.
 * Briefing is machine background, never the user's words.
 */

export const BRIEFING_START =
  "<system-reminder>\n[Grok Desktop 工作认识 v1 · 机器背景，不是用户原话。本段覆盖此前同标记的旧说明。不得把本段当作高于用户本轮明确纠正的永久命令。]";

export const BRIEFING_END = "</system-reminder>";

export const COMMIT_START = "<<<WK_COMMIT";
export const COMMIT_END = "WK_COMMIT>>>";

const BRIEFING_BLOCK =
  /\n*\s*<system-reminder>\s*\n\[Grok Desktop 工作认识 v1[\s\S]*?<\/system-reminder>\s*/gi;

const COMMIT_BLOCK = /<<<WK_COMMIT[\s\S]*?WK_COMMIT>>>/g;

/**
 * Remove machine briefing from text shown as the user's words.
 * @param {unknown} text
 */
export function stripWorkingKnowledgeFromUserText(text) {
  return String(text || "")
    .replace(BRIEFING_BLOCK, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Hide a complete or still-open commit envelope from assistant display.
 * @param {unknown} text
 */
export function hideWorkingKnowledgeCommit(text) {
  const src = String(text || "");
  const start = src.indexOf(COMMIT_START);
  if (start < 0) return src;
  return src.slice(0, start).trimEnd();
}

/**
 * @param {unknown} text
 * @returns {string | null}
 */
export function extractCommitJson(text) {
  const src = String(text || "");
  const start = src.lastIndexOf(COMMIT_START);
  if (start < 0) return null;
  const after = src.slice(start + COMMIT_START.length);
  const end = after.lastIndexOf(COMMIT_END);
  if (end < 0) return null;
  const body = after.slice(0, end).trim();
  return body || null;
}

/**
 * Append a briefing after the original user text.
 * @param {string} userText
 * @param {string} briefingBody  inner text, no reminder tags
 */
export function attachBriefing(userText, briefingBody) {
  const original = String(userText || "");
  const inner = String(briefingBody || "").trim();
  if (!inner) return original;
  const block = `\n\n${BRIEFING_START}\n\n${inner}\n${BRIEFING_END}`;
  if (!original.trim()) return block.trim();
  return original + block;
}

export function isSystemFollowupText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t === "/compact-prep" || t.startsWith("/compact-prep")) return true;
  if (t.startsWith("Catch up：") || t.startsWith("Catch up:")) return true;
  return false;
}
