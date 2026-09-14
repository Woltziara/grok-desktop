/**
 * Shared ACP sessionUpdate → timeline item reducer.
 * Used by the renderer (live stream) and main process (disk history rebuild).
 *
 * Tool status (ACP + grok-build wire, see agent `acp_conversion` / `tool_calls`):
 * - Clients must key updates by toolCallId. session/update is progress-only;
 *   it does not replace client RPCs (fs/*, terminal/*, request_permission).
 * - Grok lifecycle for normal tools:
 *   1. tool_call status=pending
 *   2. tool_call_update refine/start — title/kind/locations/rawInput; write and
 *      search_replace attach proposed Diff content here with **no** status
 *   3. optional permission update (title/kind/rawInput, no status)
 *   4. final tool_call_update from acp_tool_update — **status** completed|failed
 *      plus content and typically typed rawOutput (serde tag `type`)
 * - Grok rarely emits in_progress for normal tools (bash-mode / backend do).
 * - Bash with signal "backgrounded" is the intentional final omit of status;
 *   do not infer completed from rawOutput alone in that case.
 * - Diff without status is a **start preview**, not a final result. Older
 *   session dumps that truly omitted final status stay open until turn_completed.
 */

import {
  hideWorkingKnowledgeCommit,
  stripWorkingKnowledgeFromUserText,
} from "./working-knowledge/envelope.mjs";

export const INTERJECTION_NOTE =
  "The user sent a message while you were working:";
export const INTERRUPT_NOTE = "The user interrupted the previous turn:";
export const UNFINISHED_TASKS_REMINDER =
  "Make sure to complete any unfinished tasks from previous turns.";

/** @param {any} item */
export function isInterjectionUser(item) {
  return item?.kind === "user" && item?.marker === "interjection";
}

/**
 * Persisted prompts can contain more than one user_query wrapper. Extract all
 * human text without ever stringifying image/content objects.
 * @param {unknown} value
 * @returns {{ text: string, marker: "interjection" | "interrupt" | null }}
 */
export function unwrapUserQueryEnvelope(value) {
  const raw = typeof value === "string" ? value : extractChunkText(value);
  if (!raw) return { text: "", marker: null };
  const parts = [];
  const re = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/gi;
  let match;
  while ((match = re.exec(raw))) {
    const text = String(match[1] || "").trim();
    if (text && text !== parts[parts.length - 1]) parts.push(text);
  }
  const marker = raw.includes(INTERJECTION_NOTE)
    ? "interjection"
    : raw.includes(INTERRUPT_NOTE)
      ? "interrupt"
      : null;
  if (parts.length) return { text: parts.join("\n\n"), marker };
  let text = raw.trim();
  if (text.startsWith(INTERJECTION_NOTE)) {
    text = text.slice(INTERJECTION_NOTE.length).trim();
  } else if (text.startsWith(INTERRUPT_NOTE)) {
    text = text.slice(INTERRUPT_NOTE.length).trim();
  }
  if (text.endsWith(UNFINISHED_TASKS_REMINDER)) {
    text = text.slice(0, -UNFINISHED_TASKS_REMINDER.length).trim();
  }
  return { text: text || raw, marker };
}

/** @param {unknown} value */
export function displayUserMessageText(value) {
  return unwrapUserQueryEnvelope(value).text;
}

/**
 * Append the broadcast echo only when the optimistic originator row is absent.
 * @param {any[]} items
 * @param {{ text?: unknown, interjectionId?: unknown }} payload
 */
export function applySessionInterjection(items, payload = {}) {
  const list = Array.isArray(items) ? items : [];
  const interjectionId = String(payload.interjectionId || "").trim();
  if (
    interjectionId &&
    list.some(
      (item) =>
        item?.kind === "user" && item.interjectionId === interjectionId,
    )
  ) {
    return list;
  }
  const text = displayUserMessageText(payload.text);
  if (!text && !interjectionId) return list;
  return [
    ...list,
    {
      id: interjectionId || uid("user"),
      kind: "user",
      text,
      marker: "interjection",
      interjectionId: interjectionId || undefined,
      optimistic: false,
      at: Date.now(),
    },
  ];
}

/** @param {{ sessionId?: unknown } | null | undefined} payload */
export function shouldApplySessionInterjection(payload, opts = {}) {
  if (opts.opening) return false;
  const incoming = String(payload?.sessionId || "").trim();
  if (!incoming) return true;
  return incoming === String(opts.sessionId || "").trim();
}

let seq = 0;

export function uid(prefix = "id") {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}`;
}

/**
 * ACP content blocks may be text, image, or nested wrappers.
 * Never String(object) — that becomes "[object Object]" in the bubble.
 */
export function extractChunkText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content !== "object") return "";
  if (typeof content.text === "string") return content.text;
  const type = String(content.type || "");
  if (type && type !== "text" && type !== "content") return "";
  if (content.content != null) return extractChunkText(content.content);
  return "";
}

function lastUserIndexThisTurn(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    const k = items[i]?.kind;
    if (k === "user") return i;
    if (k === "assistant" || k === "system" || k === "recap") return -1;
  }
  return -1;
}

export function scrubUserText(s) {
  return stripWorkingKnowledgeFromUserText(
    String(s || "")
      .replace(/\[object Object\]/g, "")
      .replace(/[ \t]+\n/g, "\n"),
  );
}

/**
 * Optimistic bubble + ACP echo (and image chunks) used to create a second
 * YOU bubble, sometimes with "[object Object]". Fold those back into one.
 */
export function collapseEchoedUserTurns(items) {
  if (!Array.isArray(items) || items.length < 2) {
    if (!Array.isArray(items) || items.length === 0) return items;
    if (items[0]?.kind === "user") {
      const text = scrubUserText(items[0].text);
      if (text === items[0].text) return items;
      return [{ ...items[0], text }];
    }
    return items;
  }
  const out = [];
  let changed = false;
  for (const it of items) {
    if (it?.kind !== "user") {
      out.push(it);
      continue;
    }
    const text = scrubUserText(it.text);
    if (text !== it.text) changed = true;
    let prevUser = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      const k = out[i].kind;
      if (k === "user") {
        prevUser = i;
        break;
      }
      if (k === "assistant" || k === "system" || k === "recap") break;
    }
    if (prevUser >= 0) {
      const prev = out[prevUser];
      const incomingSteer = isInterjectionUser(it);
      const prevSteer = isInterjectionUser(prev);
      const sameSteer =
        (it.interjectionId && prev.interjectionId === it.interjectionId) ||
        (incomingSteer && prevSteer);
      // A mid-turn steer must not fold into the prompt that started the turn,
      // even when the typed text happens to match.
      if (incomingSteer !== prevSteer && !sameSteer) {
        out.push(text === it.text ? it : { ...it, text });
        continue;
      }
      const pt = scrubUserText(prev.text);
      if (pt === text || (text && pt && (text.startsWith(pt) || pt.startsWith(text)))) {
        out[prevUser] = {
          ...prev,
          text: pt.length >= text.length ? pt : text,
          images: prev.images?.length ? prev.images : it.images,
          marker: prev.marker || it.marker,
          interjectionId: prev.interjectionId || it.interjectionId,
        };
        changed = true;
        continue;
      }
    }
    out.push(text === it.text ? it : { ...it, text });
  }
  return changed ? out : items;
}

/** @param {unknown} status */
export function isOpenToolStatus(status) {
  const st = String(status || "").toLowerCase();
  return !st || st === "pending" || st === "in_progress";
}

/** @param {unknown} status */
export function isTerminalToolStatus(status) {
  const st = String(status || "").toLowerCase();
  return (
    st === "completed" ||
    st === "failed" ||
    st === "error" ||
    st === "cancelled" ||
    st === "canceled"
  );
}

/**
 * True when typed rawOutput is a bash tool result with signal "backgrounded".
 * Grok omits status on that update on purpose (task continues in background).
 *
 * @param {any} rawOut
 * @returns {boolean}
 */
export function isBashBackgroundedRawOutput(rawOut) {
  if (rawOut == null || typeof rawOut !== "object") return false;
  const type = String(rawOut.type || "");
  if (type !== "Bash" && type !== "bash") return false;
  return String(rawOut.signal || "") === "backgrounded";
}

/**
 * Whether a tool_call_update (with status omitted) should be treated as a
 * terminal success for UI purposes.
 *
 * Grok true finals almost always set status; when status is missing we only
 * infer completion from a typed rawOutput (ToolOutput serde tag), and never
 * for bash-backgrounded. Diff content alone is **not** final — write and
 * search_replace send proposed Diff on the start/refine update before the
 * tool runs (and often before permission).
 *
 * @param {any} update
 * @returns {boolean}
 */
export function looksLikeFinalToolResult(update) {
  if (!update || typeof update !== "object") return false;
  // Explicit non-empty status means the agent already decided; callers should
  // use resolveToolUpdateStatus. This helper only covers status-omitted cases.
  const rawOut = update.rawOutput ?? update.raw_output;
  if (rawOut != null && typeof rawOut === "object" && rawOut.type) {
    // Bare/empty objects without type are not final (avoids early completed
    // while client RPCs e.g. terminal/wait_for_exit are still open).
    if (isBashBackgroundedRawOutput(rawOut)) return false;
    return true;
  }
  // Diff / text content without typed rawOutput: intermediate or incomplete.
  return false;
}

/**
 * Resolve status for a tool_call_update. Explicit status always wins.
 * @param {any} update
 * @param {string | undefined | null} previousStatus
 * @returns {string}
 */
export function resolveToolUpdateStatus(update, previousStatus) {
  if (update?.status != null && String(update.status) !== "") {
    return String(update.status);
  }
  if (looksLikeFinalToolResult(update) && isOpenToolStatus(previousStatus)) {
    return "completed";
  }
  return previousStatus || "pending";
}

/**
 * Close open tool cards (turn ended, cancel, or hydrate safety net).
 * @param {any[]} items
 * @param {string} [status]
 * @returns {any[]}
 */
export function finalizeOpenTools(items, status = "completed") {
  if (!Array.isArray(items) || items.length === 0) return items;
  let changed = false;
  const next = items.map((item) => {
    if (item?.kind !== "tool") return item;
    if (!isOpenToolStatus(item.status)) return item;
    changed = true;
    return { ...item, status };
  });
  return changed ? next : items;
}

/**
 * TUI `Worked for 1m57s` line. Elapsed is ACP `elapsed_ms`, else now − last user.
 * @param {any[]} items
 * @param {number} at
 * @param {unknown} [elapsedMs]
 * @returns {any[]}
 */
export function appendWorkedIfNeeded(items, at, elapsedMs) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const last = items[items.length - 1];
  if (last?.kind === "worked") return items;
  let elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (
        items[i]?.kind === "user" &&
        typeof items[i].at === "number" &&
        !isInterjectionUser(items[i])
      ) {
        elapsed = at - items[i].at;
        break;
      }
    }
  }
  if (!Number.isFinite(elapsed) || elapsed <= 0) return items;
  return [
    ...items,
    { id: uid("worked"), kind: "worked", elapsedMs: elapsed, at },
  ];
}

/**
 * @param {any[]} items
 * @param {any} params - full session/update params or a bare update object
 * @returns {any[]}
 */
export function applySessionUpdate(items, params) {
  const update = params?.update ?? params;
  if (!update) return items;
  const kind = update.sessionUpdate || update.session_update;
  const at =
    params?._meta?.agentTimestampMs ||
    (typeof params?.timestamp === "number" ? params.timestamp * 1000 : Date.now());
  const next = collapseEchoedUserTurns(items).slice();

  switch (kind) {
    case "user_message_chunk": {
      const rawText = scrubUserText(extractChunkText(update.content));
      const parsed = unwrapUserQueryEnvelope(rawText);
      const text = scrubUserText(parsed.text);
      const meta = params?._meta && typeof params._meta === "object" ? params._meta : {};
      const interjectionId = String(
        meta.interjectionId || meta.interjection_id || "",
      ).trim();
      const marker =
        parsed.marker === "interjection" || meta.interjection
          ? "interjection"
          : parsed.marker === "interrupt"
            ? "interrupt"
            : null;
      if (!text && !interjectionId) return next;
      if (interjectionId) {
        const existing = next.findIndex(
          (item) =>
            item?.kind === "user" && item.interjectionId === interjectionId,
        );
        if (existing >= 0) {
          const last = next[existing];
          if (last.optimistic || scrubUserText(last.text) === text) return next;
        }
      }
      const ui = lastUserIndexThisTurn(next);
      if (ui >= 0) {
        const last = next[ui];
        const lastSteer = isInterjectionUser(last);
        const incomingSteer = marker === "interjection";
        if (incomingSteer && !lastSteer) {
          next.push({
            id: interjectionId || uid("user"),
            kind: "user",
            text,
            marker: "interjection",
            interjectionId: interjectionId || undefined,
            at,
          });
          return next;
        }
        const prev = scrubUserText(last.text);
        if (last.optimistic) return next;
        if (prev === text || prev.endsWith(text) || text.startsWith(prev)) {
          if (text.length > prev.length) {
            next[ui] = {
              ...last,
              text,
              at: last.at || at,
              marker: last.marker || marker || undefined,
              interjectionId: last.interjectionId || interjectionId || undefined,
            };
          }
          return next;
        }
        next[ui] = {
          ...last,
          text: prev + text,
          at: last.at || at,
        };
        return next;
      }
      next.push({
        id: interjectionId || uid("user"),
        kind: "user",
        text,
        marker: marker || undefined,
        interjectionId: interjectionId || undefined,
        at,
      });
      return next;
    }
    case "agent_message_chunk": {
      const text = extractChunkText(update.content);
      const last = next[next.length - 1];
      // Clear optimistic flag once the agent is responding
      if (last?.kind === "user" && last.optimistic) {
        next[next.length - 1] = { ...last, optimistic: false };
      }
      if (!text) return next;
      const tip = next[next.length - 1];
      if (tip?.kind === "assistant") {
        const raw = String(tip.wkRaw || tip.text || "") + text;
        next[next.length - 1] = {
          ...tip,
          wkRaw: raw,
          text: hideWorkingKnowledgeCommit(raw),
        };
      } else {
        next.push({
          id: uid("asst"),
          kind: "assistant",
          wkRaw: text,
          text: hideWorkingKnowledgeCommit(text),
          at,
        });
      }
      return next;
    }
    case "agent_thought_chunk": {
      const text = extractChunkText(update.content);
      const last = next[next.length - 1];
      if (last?.kind === "user" && last.optimistic) {
        next[next.length - 1] = { ...last, optimistic: false };
      }
      if (!text) return next;
      const tip = next[next.length - 1];
      if (tip?.kind === "thought") {
        next[next.length - 1] = {
          ...tip,
          text: (tip.text || "") + text,
        };
      } else {
        next.push({
          id: uid("thought"),
          kind: "thought",
          text,
          at,
        });
      }
      return next;
    }
    case "tool_call": {
      const last = next[next.length - 1];
      if (last?.kind === "user" && last.optimistic) {
        next[next.length - 1] = { ...last, optimistic: false };
      }
      const rawId =
        update.toolCallId ??
        update.tool_call_id ??
        update.id ??
        null;
      const toolCallId =
        rawId != null && String(rawId) !== ""
          ? String(rawId)
          : uid("tool");
      // Upsert: agent may re-emit tool_call for the same id
      const existing = next.findIndex(
        (i) => i.kind === "tool" && String(i.toolCallId) === toolCallId,
      );
      if (existing >= 0 && next[existing].kind === "tool") {
        next[existing] = {
          ...next[existing],
          title:
            update.title ||
            update.tool ||
            next[existing].title,
          toolKind: update.kind || next[existing].toolKind,
          status: update.status || next[existing].status || "pending",
          raw:
            update.rawInput ??
            update.raw_input ??
            update.arguments ??
            next[existing].raw,
        };
        return next;
      }
      next.push({
        id: uid("tool"),
        kind: "tool",
        toolCallId,
        title: update.title || update.tool || update.kind || "Tool call",
        toolKind: update.kind,
        status: update.status || "pending",
        raw: update.rawInput ?? update.raw_input ?? update.arguments,
        at,
      });
      return next;
    }
    case "tool_call_update": {
      const rawId =
        update.toolCallId ?? update.tool_call_id ?? update.id ?? null;
      const toolCallId =
        rawId != null && String(rawId) !== "" ? String(rawId) : null;
      if (!toolCallId) return next;
      const idx = next.findIndex(
        (i) => i.kind === "tool" && String(i.toolCallId) === toolCallId,
      );
      if (idx >= 0 && next[idx].kind === "tool") {
        const prev = next[idx];
        next[idx] = {
          ...prev,
          status: resolveToolUpdateStatus(update, prev.status),
          content: update.content ?? prev.content,
          title: update.title || prev.title,
          toolKind: update.kind || prev.toolKind,
          raw: update.rawInput ?? update.raw_input ?? prev.raw,
        };
      } else {
        // ACP v2-style upsert: some agents only send tool_call_update
        next.push({
          id: uid("tool"),
          kind: "tool",
          toolCallId,
          title: update.title || update.tool || update.kind || "Tool call",
          toolKind: update.kind,
          status: resolveToolUpdateStatus(update, update.status || "pending"),
          content: update.content,
          raw: update.rawInput ?? update.raw_input ?? update.arguments,
          at,
        });
      }
      return next;
    }
    case "plan": {
      // Replace the latest plan card when the agent updates todos (avoid stacking)
      const entries = update.entries || [];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]?.kind === "plan") {
          next[i] = {
            ...next[i],
            entries,
            at: next[i].at || at,
          };
          return next;
        }
      }
      next.push({
        id: uid("plan"),
        kind: "plan",
        entries,
        at,
      });
      return next;
    }
    case "auto_compact_started":
    case "compact_started": {
      const pct = Number(update.percentage ?? update.percent);
      const used = Number(update.tokens_used ?? update.tokensUsed);
      const bits = ["Compressing conversation…"];
      if (Number.isFinite(pct) && pct > 0) bits.push(`(${Math.round(pct)}% full)`);
      else if (Number.isFinite(used) && used > 0) {
        bits.push(`(${used.toLocaleString()} tokens)`);
      }
      next.push({
        id: uid("sys"),
        kind: "system",
        text: bits.join(" "),
        at,
      });
      return next;
    }
    case "auto_compact_completed":
    case "compact_completed": {
      const before = Number(
        update.tokens_before ?? update.tokensBefore ?? 0,
      );
      const after = Number(update.tokens_after ?? update.tokensAfter ?? 0);
      let text = "Conversation compacted.";
      if (before > 0 && after >= 0) {
        text = `Conversation compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens.`;
      }
      const preview = String(
        update.summary_preview ?? update.summaryPreview ?? "",
      ).trim();
      if (preview) text += `\n${preview}`;
      next.push({ id: uid("sys"), kind: "system", text, at });
      return next;
    }
    case "auto_compact_failed":
    case "compact_failed": {
      const err = String(
        update.error || update.message || "unknown error",
      );
      next.push({
        id: uid("sys"),
        kind: "system",
        text: `Compress failed: ${err}`,
        at,
      });
      return next;
    }
    case "auto_compact_cancelled":
    case "compact_cancelled": {
      next.push({
        id: uid("sys"),
        kind: "system",
        text: "Compress cancelled.",
        at,
      });
      return next;
    }
    case "session_recap": {
      const text = String(
        update.summary ?? update.text ?? update.content?.text ?? "",
      ).trim();
      if (!text) return next;
      next.push({
        id: uid("recap"),
        kind: "recap",
        text,
        auto: Boolean(update.auto),
        at,
      });
      return next;
    }
    case "turn_completed":
    case "turn_complete": {
      // Safety net when the agent omits final tool status on the last tools.
      return appendWorkedIfNeeded(
        finalizeOpenTools(next, "completed"),
        at,
        update.elapsed_ms ?? update.elapsedMs,
      );
    }
    case "hook_execution": {
      // Pre/post tool hooks (project/user). When a hook *crashes* (exit ≠ 0)
      // the agent often never emits tool_call_update — the card stays "pending"
      // forever. Surface the failure and close the matching pending tool card.
      const runs = Array.isArray(update.runs) ? update.runs : [];
      const failed = runs.filter(
        (r) =>
          String(r?.status?.status || r?.status || "").toLowerCase() ===
            "failed" ||
          (typeof r?.status?.exit_code === "number" &&
            r.status.exit_code !== 0),
      );
      if (failed.length === 0) return next;

      const eventName = String(update.event_name || update.eventName || "");
      // post_tool_use timeouts are bookkeeping. The tool already ran; do not
      // scare the user or mark the read/write as failed.
      if (/post_tool_use/i.test(eventName)) {
        return next;
      }

      const toolName = String(
        update.tool_name || update.toolName || update.event_name || "tool",
      );
      const details = failed
        .map((r) => {
          const name = r?.name || "hook";
          const err =
            r?.status?.error ||
            r?.error ||
            (r?.status?.exit_code != null
              ? `exit ${r.status.exit_code}`
              : "failed");
          return `${name}: ${err}`;
        })
        .join("\n");

      next.push({
        id: uid("sys"),
        kind: "system",
        text:
          `Hook blocked or crashed (${update.event_name || "hook"} on ${toolName}).\n` +
          `${details}\n` +
          `The tool may stay stuck until you Stop. Check project hooks under .grok/hooks (Windows often breaks bash path / CRLF).`,
        at,
      });

      // Fail the newest pending tool that looks related
      for (let i = next.length - 1; i >= 0; i--) {
        const item = next[i];
        if (item?.kind !== "tool") continue;
        const st = String(item.status || "").toLowerCase();
        if (st && st !== "pending" && st !== "in_progress") continue;
        const title = String(item.title || "").toLowerCase();
        const tn = toolName.toLowerCase();
        const related =
          !tn ||
          title.includes(tn) ||
          tn.includes("terminal") ||
          tn.includes("bash") ||
          title.includes("execute") ||
          title.includes("run_terminal");
        if (!related) continue;
        next[i] = {
          ...item,
          status: "failed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: `Blocked by hook failure:\n${details}`,
              },
            },
          ],
        };
        break;
      }
      return next;
    }
    default:
      return next;
  }
}

export function formatOptionLabel(optionId, name) {
  if (name) return name;
  const map = {
    "allow-once": "Allow once",
    "allow-always": "Always allow",
    "enable-always-approve":
      "Yes, and don't ask again for anything (always-approve mode)",
    reject: "Reject",
    cancelled: "Cancel",
  };
  return map[optionId] || optionId;
}
