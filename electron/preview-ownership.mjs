/** Preview ownership is a conversation identity plus a revocable window lifetime. */
import { randomUUID } from 'node:crypto';

function ownershipError(message) {
  return Object.assign(new Error(message), { code: 'PREVIEW_OWNERSHIP', statusCode: 409 });
}

export function createPreviewOwnership() {
  let current = null;
  const live = owner => owner && !owner.isDestroyed();
  const same = (owner, sessionId) => Boolean(current && current.windowId === owner?.id && current.sessionId === sessionId);
  return {
    get: () => current,
    claim(owner, sessionId, { transfer = false } = {}) {
      if (!live(owner) || !sessionId) throw ownershipError('请先打开一段对话，再打开它的网页预览。');
      if (current && !same(owner, sessionId) && !transfer) {
        throw ownershipError('这个网页属于另一段对话。请返回原对话，或在界面中明确转交预览。');
      }
      if (!current || !same(owner, sessionId) || transfer) {
        current = Object.freeze({ windowId: owner.id, sessionId, leaseId: randomUUID() });
      }
      return current;
    },
    assert(owner, sessionId, leaseId) {
      if (!live(owner) || !same(owner, sessionId) || (leaseId && current.leaseId !== leaseId)) {
        throw ownershipError('预览归属已变化或请求已过期；请从这段对话重新打开预览。');
      }
      return current;
    },
    release() { current = null; },
  };
}

// A descriptor is issued by the owning ACP client, not inferred from the
// currently focused conversation. Old descriptors expire on client disposal.
const clients = new Map();
export const PREVIEW_SCOPE_HEADER = 'X-Grok-Desktop-Scope';
export function issuePreviewScope({ windowId, getSessionId, isLive }) {
  if (!Number.isInteger(windowId) || windowId < 1) return '';
  const id = randomUUID();
  clients.set(id, { windowId, getSessionId, isLive, leaseId: null });
  return id;
}
export function revokePreviewScope(id) { clients.delete(id); }
export function resolvePreviewScope(id, windowId, { allowPending = false } = {}) {
  const scope = clients.get(String(id || ''));
  if (!scope || scope.windowId !== windowId || !scope.isLive() || (!allowPending && !scope.getSessionId())) {
    throw ownershipError('预览请求没有有效的对话归属，或原连接已结束。请在对话中重新打开预览。');
  }
  return scope;
}
export function clearPreviewScopes() { clients.clear(); }
