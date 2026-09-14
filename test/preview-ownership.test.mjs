import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewOwnership, issuePreviewScope, resolvePreviewScope, revokePreviewScope } from '../electron/preview-ownership.mjs';
const win = id => ({ id, isDestroyed: () => false });
test('Preview owner includes the native conversation, not merely its window', () => {
  const p = createPreviewOwnership(), a = win(1), b = win(2);
  const first = p.claim(a, 'A');
  for (const [w, s] of [[b, 'B'], [a, 'B'], [null, 'A'], [a, '']]) {
    assert.throws(() => p.assert(w, s));
    assert.throws(() => p.claim(w, s));
    assert.equal(p.get(), first);
  }
  assert.equal(p.claim(a, 'A'), first);
});
test('Preview reopening revokes an old lease even for the same conversation', () => {
  const p = createPreviewOwnership(), a = win(1), first = p.claim(a, 'A');
  p.release();p.claim(a, 'A');
  assert.throws(() => p.assert(a, 'A', first.leaseId));
  assert.throws(() => p.assert({ ...a, isDestroyed: () => true }, 'A'));
});
test('ACP Preview scope is per client and revoked when that client ends', () => {
  let session = 'A', live = true;
  const id = issuePreviewScope({ windowId: 4, getSessionId: () => session, isLive: () => live });
  assert.equal(resolvePreviewScope(id, 4).getSessionId(), 'A');
  assert.throws(() => resolvePreviewScope(id, 5));assert.throws(() => resolvePreviewScope('', 4));
  live = false;assert.throws(() => resolvePreviewScope(id, 4));
  live = true;session = '';assert.throws(() => resolvePreviewScope(id, 4));
  session = 'A';revokePreviewScope(id);assert.throws(() => resolvePreviewScope(id, 4));
});
