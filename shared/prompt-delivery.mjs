import { INTERJECT_UNSUPPORTED_REASON } from "./acp-interject.mjs";

/**
 * Decide how a composer submit reaches the agent.
 * Enter while busy steers; the explicit Later action queues; Send now cancels.
 * @param {unknown} mode
 * @param {boolean} busy
 * @returns {"prompt" | "interject" | "queue" | "send-now"}
 */
export function promptDeliveryAction(mode, busy) {
  if (!busy) return "prompt";
  if (mode === "now") return "send-now";
  if (mode === "queue") return "queue";
  return "interject";
}

/** @param {unknown} result */
export function isInterjectUnsupported(result) {
  return Boolean(
    result &&
      typeof result === "object" &&
      result.ok === false &&
      result.reason === INTERJECT_UNSUPPORTED_REASON,
  );
}

/**
 * Thrown RPC errors are real failures. Only the explicit structured result
 * from main may fall back to the follow-up queue.
 * @param {unknown} result
 * @param {unknown} [thrown]
 * @returns {"ok" | "queue" | "error"}
 */
export function interjectFollowUp(result, thrown) {
  if (thrown) return "error";
  if (isInterjectUnsupported(result)) return "queue";
  if (result && typeof result === "object" && result.ok === false) {
    return "error";
  }
  return "ok";
}
