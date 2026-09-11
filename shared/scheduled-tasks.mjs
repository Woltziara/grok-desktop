/**
 * Reduce ACP scheduled-task notifications into a living-room list.
 */

const METHODS = new Set([
  "x.ai/scheduled_task_created",
  "x.ai/scheduled_task_fired",
  "x.ai/scheduled_task_deleted",
  "_x.ai/scheduled_task_created",
  "_x.ai/scheduled_task_fired",
  "_x.ai/scheduled_task_deleted",
]);

const KINDS = new Set([
  "scheduled_task_created",
  "scheduled_task_fired",
  "scheduled_task_deleted",
]);

export function isScheduledTaskMethod(method) {
  const m = String(method || "").replace(/^_/, "");
  return METHODS.has(m) || METHODS.has(String(method || ""));
}

function unwrapParams(method, params) {
  let m = String(method || "");
  let p = params;
  for (let i = 0; i < 4; i += 1) {
    if (!p || typeof p !== "object") break;
    const inner = p.method != null ? String(p.method) : "";
    if (
      inner === "ext_notification" ||
      inner.endsWith("/ext_notification") ||
      isScheduledTaskMethod(inner) ||
      String(inner).replace(/^_/, "").includes("scheduled_task_inject_prompt")
    ) {
      m = inner;
      p = p.params !== undefined ? p.params : p;
      continue;
    }
    break;
  }
  return { method: m, params: p };
}

function updateKind(update) {
  if (!update || typeof update !== "object") return "";
  return String(
    update.sessionUpdate || update.session_update || update.type || "",
  );
}

function field(obj, ...keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return "";
}

/**
 * Normalize inbound ACP into a session-update-shaped blob, or null.
 * @param {unknown} method
 * @param {any} params
 */
export function scheduledTaskUpdateFromInbound(method, params) {
  const peeled = unwrapParams(method, params);
  const p = peeled.params;
  if (!p || typeof p !== "object") {
    if (!isScheduledTaskMethod(peeled.method) && !isScheduledTaskMethod(method)) {
      return null;
    }
    return null;
  }
  const update = p.update && typeof p.update === "object" ? p.update : p;
  let kind = updateKind(update);
  if (!kind && isScheduledTaskMethod(peeled.method)) {
    const bare = String(peeled.method).replace(/^_/, "");
    kind = bare.replace(/^x\.ai\//, "");
  }
  if (!KINDS.has(kind)) {
    const sessionKind =
      p.sessionUpdate || p.session_update || p.update?.sessionUpdate;
    if (KINDS.has(String(sessionKind || ""))) kind = String(sessionKind);
  }
  if (!KINDS.has(kind)) return null;
  const body = update.sessionUpdate || update.session_update ? update : p;
  return {
    sessionId: String(field(p, "sessionId", "session_id") || ""),
    update: {
      sessionUpdate: kind,
      taskId: String(field(body, "taskId", "task_id") || ""),
      prompt: String(field(body, "prompt") || ""),
      humanSchedule: String(
        field(body, "humanSchedule", "human_schedule") || "",
      ),
      nextFireAt: field(body, "nextFireAt", "next_fire_at") || null,
    },
  };
}

/**
 * Also accept ordinary session/update params (jsonl hydrate).
 * @param {any} params
 */
export function scheduledTaskFromSessionParams(params) {
  const update = params?.update ?? params;
  const kind = String(update?.sessionUpdate || update?.session_update || "");
  if (!KINDS.has(kind)) {
    return scheduledTaskUpdateFromInbound(
      params?.method,
      params,
    );
  }
  return {
    sessionId: String(params?.sessionId || params?.session_id || ""),
    update: {
      sessionUpdate: kind,
      taskId: String(update.taskId || update.task_id || ""),
      prompt: String(update.prompt || ""),
      humanSchedule: String(
        update.humanSchedule || update.human_schedule || "",
      ),
      nextFireAt: update.nextFireAt || update.next_fire_at || null,
    },
  };
}

/**
 * @param {Array<{ id: string, prompt: string, schedule: string, nextFireAt?: string | null }>} list
 * @param {any} params
 */
export function applyScheduledUpdate(list, params) {
  const normalized =
    scheduledTaskFromSessionParams(params) ||
    scheduledTaskUpdateFromInbound(params?.method, params);
  if (!normalized) return list;
  const kind = normalized.update.sessionUpdate;
  const id = String(normalized.update.taskId || "").trim();
  if (!id) return list;
  const prev = Array.isArray(list) ? list : [];
  if (kind === "scheduled_task_deleted") {
    const next = prev.filter((t) => t.id !== id);
    return next.length === prev.length ? prev : next;
  }
  const row = {
    id,
    prompt: normalized.update.prompt || id,
    schedule: normalized.update.humanSchedule || "",
    nextFireAt: normalized.update.nextFireAt || null,
  };
  const idx = prev.findIndex((t) => t.id === id);
  if (idx < 0) return [row, ...prev];
  const cur = prev[idx];
  if (
    cur.prompt === row.prompt &&
    cur.schedule === row.schedule &&
    cur.nextFireAt === row.nextFireAt
  ) {
    return prev;
  }
  const next = [...prev];
  next[idx] = { ...cur, ...row };
  return next;
}

export function hasActiveScheduledTasks(list) {
  return Array.isArray(list) && list.length > 0;
}

function isInjectMethod(method) {
  const m = String(method || "").replace(/^_/, "");
  return (
    m === "x.ai/scheduled_task_inject_prompt" ||
    m.endsWith("/scheduled_task_inject_prompt")
  );
}

/**
 * Parse `x.ai/scheduled_task_inject_prompt` (client must session/prompt).
 * @param {unknown} method
 * @param {any} params
 * @returns {{ sessionId: string, taskId: string, prompt: string, humanSchedule: string } | null}
 */
export function scheduledInjectFromInbound(method, params) {
  const peeled = unwrapParams(method, params);
  const p = peeled.params;
  if (!isInjectMethod(peeled.method) && !isInjectMethod(method)) {
    if (!p || typeof p !== "object") return null;
    if (!isInjectMethod(p.method)) {
      /* still accept a bare payload with prompt + sessionId */
      if (!p.prompt && !p.sessionId && !p.session_id) return null;
    }
  }
  const body =
    p && typeof p === "object" && p.params && typeof p.params === "object"
      ? p.params
      : p;
  if (!body || typeof body !== "object") return null;
  const prompt = String(body.prompt || "").trim();
  const sessionId = String(body.sessionId || body.session_id || "").trim();
  if (!prompt) return null;
  return {
    sessionId,
    taskId: String(body.taskId || body.task_id || ""),
    prompt,
    humanSchedule: String(body.humanSchedule || body.human_schedule || ""),
  };
}
