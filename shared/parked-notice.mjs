/**
 * Decide whether a parked (not currently viewed) session update should
 * mark unread / notify. Live timeline still only applies to the current agent.
 */

export function parkedUpdateNotice(params) {
  const update = params?.update || params || {};
  const kind = String(update.sessionUpdate || update.session_update || "");
  if (
    kind === "task_completed" ||
    kind === "subagent_complete" ||
    kind === "subagent_completed"
  ) {
    return { unread: true, failed: false, needsYou: false, kind };
  }
  if (kind === "subagent_finished") {
    const status = String(update.status || "").toLowerCase();
    const failed =
      status.includes("fail") ||
      status.includes("error") ||
      status.includes("cancel");
    return { unread: true, failed, needsYou: false, kind };
  }
  if (
    kind === "task_failed" ||
    kind === "subagent_failed" ||
    kind === "subagent_error"
  ) {
    return { unread: true, failed: true, needsYou: false, kind };
  }
  if (kind === "turn_completed") {
    const status = String(update.status || update.stopReason || "").toLowerCase();
    const failed = status === "failed" || status === "error";
    return { unread: true, failed, needsYou: false, kind };
  }
  if (
    kind === "available_commands_update" ||
    kind === "session_info_update" ||
    kind === "usage_update"
  ) {
    return null;
  }
  return null;
}

export function parkedNeedNotice(kind) {
  const k = String(kind || "");
  if (
    k === "permission" ||
    k === "plan" ||
    k === "ask" ||
    k === "folder-trust" ||
    k === "elicit"
  ) {
    return { unread: true, failed: false, needsYou: true, kind: k };
  }
  return null;
}
