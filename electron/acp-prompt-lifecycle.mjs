/** The single Working Knowledge boundary around ACP session/prompt. */
import {
  consumeTurnOutput,
  wrapOutgoingPrompt,
} from "./working-knowledge.mjs";

export function prepareAcpPrompt(
  { text, sessionId, cwd, origin = "user", inboxId },
  hooks = {},
) {
  const wrap = hooks.wrapOutgoingPrompt || wrapOutgoingPrompt;
  const wrapped = wrap({
    text,
    sessionId,
    cwd,
    origin,
    ...(inboxId ? { inboxId } : {}),
  });
  return {
    wrapped,
    prompt: [{ type: "text", text: wrapped.wireText }],
  };
}

export function consumeCompletedAcpPrompt(payload, hooks = {}) {
  if (payload?.cancelled) {
    return { ok: true, skipped: true, reason: "cancelled" };
  }
  const consume = hooks.consumeTurnOutput || consumeTurnOutput;
  return consume(payload);
}
