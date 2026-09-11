/**
 * Interpret an ACP round-trip used as a health check.
 * Process-alive is not enough: a hung or disconnected agent still has a pid.
 */
export function interpretAcpPing({
  processAlive,
  ready = true,
  rpcErrorMessage = null,
} = {}) {
  if (!processAlive) {
    return { ok: false, rpc: false, reason: "process" };
  }
  if (!ready) {
    return { ok: false, rpc: false, reason: "not-ready" };
  }
  if (rpcErrorMessage == null || rpcErrorMessage === "") {
    return { ok: true, rpc: true };
  }
  const msg = String(rpcErrorMessage);
  if (/-32601|method not found|unknown method/i.test(msg)) {
    return { ok: true, rpc: true };
  }
  if (/timed out/i.test(msg)) {
    return { ok: false, rpc: false, reason: "rpc-timeout", message: msg };
  }
  if (/not writable|stdin/i.test(msg)) {
    return { ok: false, rpc: false, reason: "disconnected", message: msg };
  }
  return { ok: false, rpc: false, reason: "rpc", message: msg };
}
