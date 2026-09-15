/** A per-conversation durable send box. GrokAcpClient remains the only ACP path.
 * A stored receipt means accepted locally, not that a model/tool finished.
 * Unknown remote outcomes are never replayed automatically after a restart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertSessionNotMoving } from './session-move.mjs';
import { isSafeSessionId } from './sessions.mjs';
import { promptDeliveryAction, interjectFollowUp } from '../shared/prompt-delivery.mjs';
import { COMPACT_PREP_PROMPT, COMPACT_PRESERVE_HINT, COMPACT_CATCH_UP_PROMPT } from '../shared/compact-prep-flow.mjs';

const TERMINAL = new Set(['done', 'dismissed']);
const IN_FLIGHT = new Set(['sending', 'interjecting', 'interjected']);
const STATES = new Set(['queued', ...TERMINAL, ...IN_FLIGHT, 'failed', 'uncertain', 'cancelled']);
const clone = value => JSON.parse(JSON.stringify(value));
const message = error => String(error?.message || error || '发送未完成');
/** Lost receipts after the remote may already have accepted the request. */
export function isUnknownDeliveryOutcome(error) {
  if (!error) return false;
  if (error.code === 'ACP_REQUEST_TIMEOUT') return true;
  return /connection closed|process exited|agent exited|disposed|EPIPE|ECONNRESET|socket hang up/i.test(message(error));
}
function unknownOutcomeNotice(kind, error) {
  const who = kind === 'interject' ? '插话' : '这次发送';
  return `${who}可能已经送到，但确认没有回来。原文仍保留，请先查看历史再决定是否重试。${message(error)}`;
}
/** A window only receives send-box events for the conversation it is currently showing. */
export function windowShowsDelivery(ws, sessionId) {
  if (!ws || ws.disposed) return false;
  const id = String(sessionId || '');
  if (!id) return false;
  if (ws.agent?.sessionId && String(ws.agent.sessionId) === id) return true;
  if (!ws.agent && ws.lastSessionId && String(ws.lastSessionId) === id) return true;
  return false;
}
export function notifySessionDelivery(event, windows, sendToWindow) {
  if (!event?.sessionId) return [];
  const sent = [];
  for (const ws of windows || []) {
    if (!windowShowsDelivery(ws, event.sessionId)) continue;
    sendToWindow(ws, event);
    sent.push(ws);
  }
  return sent;
}
function stripImagePayload(images) {
  return (images || []).map(({ data, ...rest }) => ({ ...rest, attached: Boolean(data) }));
}
function viewState(state) {
  return { ...state, items: state.items.map(item => ({ ...item, images: stripImagePayload(item.images) })) };
}
const signature = payload => {
  const parts = [payload.text, payload.images.map(i => [i.mimeType, i.data]), payload.imageQuality,
    payload.timelineText, payload.origin, payload.purpose];
  // Keep the legacy no-reference signature stable for pending outboxes created
  // before browser references existed.
  if (payload.browserReference) parts.push(payload.browserReference);
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
};
function sid(value) {
  if (!isSafeSessionId(value)) throw new Error('无效的对话标识');
  return String(value);
}
function rowKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) throw new Error('无效的发送标识');
  return value;
}
function payloadOf(input) {
  if (!input || typeof input.text !== 'string' || !Array.isArray(input.images || [])) throw new Error('发送内容格式不完整，草稿未删除。');
  const images = (input.images || []).map(image => {
    if (!image || typeof image.data !== 'string' || !image.data || !/^image\/[a-zA-Z0-9.+-]+$/.test(image.mimeType || '')) throw new Error('图片尚未准备完整，未发送。');
    return { data: image.data, mimeType: image.mimeType, id: String(image.id || ''), name: String(image.name || '') };
  });
  const text = input.text.trim();
  if (!text && !images.length) throw new Error('请先写一句话或附上材料。');
  const result = { text, images, imageQuality: input.imageQuality === 'high' ? 'high' : 'compact', timelineText: String(input.timelineText || ''), origin: input.origin === 'followup' ? 'followup' : 'user', purpose: input.purpose === 'compact' ? 'compact' : '' };
  if (input.browserReference) result.browserReference = clone(input.browserReference);
  if (result.purpose === 'compact') { result.text = COMPACT_PREP_PROMPT; result.origin = 'followup'; }
  if (images.length > 32 || Buffer.byteLength(JSON.stringify(result)) > 64 * 1024 * 1024) throw new Error('这次材料过大，请分开发送；草稿仍保留。');
  return result;
}
function finish(row, status) {
  row.status = status; row.settledAt = Date.now();
  if (TERMINAL.has(status)) {
    // Native history is canonical. Retain only a duplicate-prevention receipt.
    delete row.text; delete row.images; delete row.timelineText; delete row.purpose; delete row.browserReference;
  }
}

export function assertSessionOutbox(value,id,name="发送记录") {
    if (value?.schema !== 1 || value.sessionId !== id || !Array.isArray(value.items) || !Number.isSafeInteger(value.revision) || value.items.some(i => !i || typeof i.id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(i.id) || !STATES.has(i.status))) throw new Error(`发送记录版本或内容不兼容，原件未改写：${name}`);
    if (new Set(value.items.map(i => i.id)).size !== value.items.length || value.revision < 0 || value.items.some(i => !TERMINAL.has(i.status) && (typeof i.text !== 'string' || !Array.isArray(i.images) || i.images.some(image => typeof image.data !== 'string' || typeof image.mimeType !== 'string') || signature(i) !== i.signature))) throw new Error(`发送记录校验失败，原件未改写：${name}`);
  return value;
}

export function createSessionOutbox(root, { write = atomicWrite } = {}) {
  const initialized = new Set();
  function file(id) { return path.join(root, `${sid(id)}.json`); }
  function read(id) {
    const name = file(id);
    if (!fs.existsSync(name)) return { schema: 1, sessionId: id, cwd: '', revision: 0, paused: false, items: [] };
    let value;
    try { value = JSON.parse(fs.readFileSync(name, 'utf8')); } catch { throw new Error(`这段对话的发送记录损坏，原件未改写：${name}`); }
    assertSessionOutbox(value, id, name);
    return value;
  }
  function save(id, value) {
    value.revision++;
    write(file(id), value);
    return value;
  }
  function open(id) {
    id = sid(id);
    const value = read(id);
    if (!initialized.has(id)) {
      const pending = value.items.filter(i => !TERMINAL.has(i.status));
      if (pending.length) {
        for (const row of pending) delete row.immediate;
        for (const row of pending) if (IN_FLIGHT.has(row.status)) {
          row.status = 'uncertain'; row.error = '上次发送在应用退出前没有完整回执；请先查看历史，再决定是否重试。';
        }
        value.paused = true;
        save(id, value);
      }
      initialized.add(id);
    }
    return value;
  }
  return {
    read: open,
    change(id, edit) { const value = clone(open(id)); edit(value); return save(id, value); },
    path: file,
  };
}
export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function createSessionDelivery(root, { notify = () => {}, beforeCancel = () => {}, canRelocate = (a, b) => a === b, validateBrowserReference = reference => reference, write } = {}) {
  const store = createSessionOutbox(root, { write });
  const bindings = new Map(), running = new Map(), inserting = new Map();
  const turns = new Map();
  function busy(id) { const client = bindings.get(id)?.client; return Boolean(running.has(id) || client?.turnOpen || client?._activeTurn); }
  function state(id) {
    const value = store.read(id);
    return { ...value, items: value.items.filter(i => !TERMINAL.has(i.status)), busy: busy(id) };
  }
  function emit(id, type = 'state', row, detail = {}) {
    try {
      const current = state(id);
      const payload = row ? clone(row) : undefined;
      if (payload && type !== 'started') payload.images = stripImagePayload(payload.images);
      notify({ type, sessionId: id, cwd: current.cwd, state: viewState(current), row: payload, ...detail });
    } catch (error) { notify({ type: 'storage-error', sessionId: id, error: message(error) }); }
  }
  function schedule(id) { setImmediate(() => { void pump(id).catch(error => notify({ type: 'storage-error', sessionId: id, error: message(error) })); }); }
  function bind(client) {
    const id = sid(client?.sessionId);
    const current = store.read(id);
    if (current.cwd && current.cwd !== client.cwd && !canRelocate(current.cwd, client.cwd, id)) throw new Error('发送记录属于另一项目，未套用到这段对话。');
    if (current.cwd !== client.cwd) store.change(id, value => { value.cwd = client.cwd; });
    const old = bindings.get(id);
    if (old?.client !== client) {
      if (old) old.client.off('turn-settled', old.settled);
      const settled = info => {
        turns.set(`${id}:${info.turnId}`, info);
        // The map is an in-process acknowledgement aid, not a persistence log.
        if (turns.size > 512) turns.delete(turns.keys().next().value);
        try {
          const rows = store.read(id).items.filter(r => r.status === 'interjected' && r.parentTurn === info.turnId);
          if (rows.length) store.change(id, value => {
            for (const row of value.items) if (rows.some(r => r.id === row.id)) {
              finish(row, info.ok && !info.cancelled ? 'done' : 'uncertain');
              if (row.status === 'uncertain') row.error = '插话已被接收，但原回合未完成；请查看历史后决定是否重试。';
            }
            if (!info.ok || info.cancelled) value.paused = true;
          });
          emit(id); schedule(id);
        } catch (error) { notify({ type: 'storage-error', sessionId: id, error: message(error) }); }
      };
      client.on('turn-settled', settled);
      bindings.set(id, { client, settled });
    }
    schedule(id);
    return state(id);
  }
  function activeClient(id) {
    const client = bindings.get(id)?.client;
    if ((!client?.ready && !client?._needsPromptRestart) || String(client.sessionId) !== id) throw new Error('这段对话尚未连接；内容已保留，连接后再继续。');
    return client;
  }
  function accept(client, input) {
    bind(client);
    const id = sid(client.sessionId), payload = payloadOf(input), key = rowKey(input.id), hash = signature(payload);
    const prior = store.read(id).items.find(i => i.id === key);
    if (prior) {
      if (prior.signature !== hash) throw new Error('同一个发送标识对应了不同内容，旧内容未覆盖。');
      return { accepted: true, duplicate: true, id: key, status: prior.status, state: state(id) };
    }
    const pending = store.read(id);
    const action = promptDeliveryAction(input.mode, busy(id) || (!pending.paused && pending.items.some(i => i.status === "queued")));
    const row = { ...payload, id: key, signature: hash, status: 'queued', at: Date.now(), attempt: 0 };
    store.change(id, value => {
      if (value.items.filter(i => !TERMINAL.has(i.status)).length >= 200) throw new Error('待处理发送较多，请先处理已有内容；当前草稿未删除。');
      if (action === 'send-now' || action === 'prompt') { row.immediate = true; value.items.unshift(row); if (action === 'send-now') value.paused = false; }
      else value.items.push(row);
    });
    emit(id);
    if (action === 'interject') void insert(id, key).catch(error => notify({ type: 'storage-error', sessionId: id, error: message(error) }));
    else if (action === 'send-now') cancelNative(id, false);
    schedule(id);
    return { accepted: true, id: key, status: row.status, state: state(id) };
  }
  function cancelNative(id, pause = true) {
    const client = bindings.get(id)?.client;
    if (pause) store.change(id, value => { value.paused = true; for (const item of value.items) delete item.immediate; });
    const run = running.get(id); if (run) run.cancelled = true;
    if (client) { beforeCancel(client); client.cancel(); }
    emit(id); return true;
  }
  async function insert(id, key) {
    const client = activeClient(id), parentTurn = client._activeTurn?.id || '';
    let row;
    store.change(id, value => {
      row = value.items.find(i => i.id === key);
      row.status = 'interjecting'; row.startedAt = Date.now(); row.attempt++; row.attemptId = randomUUID(); row.parentTurn = parentTurn;
    });
    inserting.set(`${id}:${key}`, true);
    emit(id, 'started', row, { method: 'interject' });
    try {
      const browserReference = validateBrowserReference(row.browserReference, client);
      const result = await client.interject(row.text, { images: row.images, imageQuality: row.imageQuality, interjectionId: row.attemptId, deliveryId: row.id, browserReference });
      const follow = interjectFollowUp(result);
      if (follow === 'error') throw new Error(result?.error || result?.reason || '没能插入当前回合');
      store.change(id, value => {
        const item = value.items.find(i => i.id === key);
        if (follow === 'queue') item.status = 'queued';
        else {
          item.status = 'interjected';
          const ended = turns.get(`${id}:${parentTurn}`);
          if (ended) finish(item, ended.ok && !ended.cancelled ? 'done' : 'uncertain');
        }
      });
      emit(id, follow === 'queue' ? 'fallback' : 'interjected', row, { method: 'interject' });
    } catch (error) {
      const uncertain = isUnknownDeliveryOutcome(error);
      store.change(id, value => {
        const item = value.items.find(i => i.id === key);
        item.status = uncertain ? 'uncertain' : 'failed';
        item.error = uncertain ? unknownOutcomeNotice('interject', error) : message(error);
        value.paused = true;
      });
      emit(id, 'settled', row, { method: 'interject', ok: false, error: uncertain ? unknownOutcomeNotice('interject', error) : message(error) });
    } finally { inserting.delete(`${id}:${key}`); schedule(id); }
  }
  async function pump(id) {
    try { assertSessionNotMoving(id); } catch { return; }
    const value = store.read(id), client = bindings.get(id)?.client;
    if (busy(id) || (!client?.ready && !client?._needsPromptRestart) || !String(client.sessionId || '') || [...inserting.keys()].some(key => key.startsWith(id + ':'))) return;
    const first = value.items.find(i => i.status === 'queued' && i.immediate) || (!value.paused && value.items.find(i => i.status === 'queued'));
    if (!first) return;
    const run = { cancelled: false, id: first.id }; running.set(id, run);
    let row, ok = false, errorText = '', uncertain = false;
    try {
      const browserReference = validateBrowserReference(first.browserReference, client);
      store.change(id, next => { row = next.items.find(i => i.id === first.id); row.status = 'sending'; delete row.immediate; row.startedAt = Date.now(); row.attempt++; row.attemptId = randomUUID(); delete row.error; });
      emit(id, 'started', row, { method: 'prompt' });
      const result = await client.prompt(row.text, { images: row.images, imageQuality: row.imageQuality, origin: row.origin, browserReference, deliveryId: row.id });
      if (result?.stopReason === 'cancelled' || result?.stop_reason === 'cancelled') run.cancelled = true;
      if (run.cancelled) throw new Error('cancelled');
      if (row.purpose === 'compact') {
        const compacted = await client.compactConversation(COMPACT_PRESERVE_HINT);
        if (run.cancelled) throw new Error('cancelled');
        if (compacted?.ok === false) throw new Error(compacted.message || '压缩没有完成');
        emit(id, 'compacted', row);
        // A new user request takes priority over the internal catch-up.
        if (!store.read(id).items.some(i => i.id !== row.id && i.origin === 'user' && !TERMINAL.has(i.status))) {
          const payload = payloadOf({ text: COMPACT_CATCH_UP_PROMPT, images: [], origin: 'followup' });
          store.change(id, next => next.items.push({ ...payload, id: randomUUID(), signature: signature(payload), status: 'queued', at: Date.now(), attempt: 0 }));
        }
      }
      ok = true;
    } catch (error) {
      uncertain = isUnknownDeliveryOutcome(error);
      errorText = uncertain ? unknownOutcomeNotice('prompt', error) : message(error);
    }
    finally {
      try {
        store.change(id, next => {
          const item = next.items.find(i => i.id === first.id);
          finish(item, ok ? 'done' : run.cancelled ? 'cancelled' : uncertain ? 'uncertain' : 'failed');
          if (!ok) { item.error = errorText; if (!run.cancelled) next.paused = true; }
        });
      } catch (error) { ok = false; errorText = `发送回执未能保存：${message(error)}。请先查历史，不要直接重复发送。`; try { store.change(id, next => { next.paused = true; }); } catch {} }
      running.delete(id);
      emit(id, 'settled', row, { method: 'prompt', ok, cancelled: run.cancelled, error: errorText });
      // Never spin after a disk failure or an explicit RPC failure.
      if (ok || run.cancelled) schedule(id);
    }
  }
  function mutate(id, action, data = {}) {
    id = sid(id);
    store.change(id, value => {
      if (action === 'pause') { value.paused = true; for (const item of value.items) delete item.immediate; return; }
      if (action === 'resume') { value.paused = false; return; }
      const row = value.items.find(i => i.id === data.id);
      if (!row || TERMINAL.has(row.status)) throw new Error('这条发送已处理，请刷新列表。');
      if (IN_FLIGHT.has(row.status)) throw new Error('这条内容已经发出，请先停止原回合，不能就地修改。');
      if (action === 'remove') { finish(row, 'dismissed'); return; }
      if (action === 'refresh-browser-reference') {
        if (!data.browserReference) throw new Error('当前浏览器页面没有成功引用，原发送记录未改。');
        row.browserReference = clone(data.browserReference);
        if (row.status === 'failed') { row.status = 'queued'; delete row.error; }
        row.signature = signature(row); return;
      }
      if (action === 'remove-browser-reference') {
        delete row.browserReference;
        if (row.status === 'failed') { row.status = 'queued'; delete row.error; }
        row.signature = signature(row); return;
      }
      if (action === 'edit') { Object.assign(row, payloadOf({ ...row, text: String(data.text || ''), timelineText: '', purpose: '', origin: 'user' })); row.signature = signature(row); return; }
      if (action === 'move') {
        const pending = value.items.filter(i => !TERMINAL.has(i.status)), from = pending.indexOf(row), to = from + (data.direction < 0 ? -1 : 1);
        if (to < 0 || to >= pending.length || IN_FLIGHT.has(pending[to].status)) return;
        const a = value.items.indexOf(row), b = value.items.indexOf(pending[to]); [value.items[a], value.items[b]] = [value.items[b], value.items[a]]; return;
      }
      if (action === 'now' || action === 'retry') {
        if (['uncertain', 'cancelled'].includes(row.status) && data.confirmed !== true) throw new Error('这条可能已经部分执行，请先查看历史并明确确认重试。');
        row.status = 'queued'; delete row.error; value.paused = false;
        if (action === 'now') { value.items = value.items.filter(i => i !== row); value.items.unshift(row); }
        return;
      }
      throw new Error('不支持的发送操作');
    });
    if (action === 'now' && busy(id)) cancelNative(id, false);
    emit(id); schedule(id); return state(id);
  }
  return { bind, submit: accept, state, mutate, stop: id => cancelNative(sid(id)), isActive: id => running.has(id) || [...inserting.keys()].some(key => key.startsWith(id + ':')),
    wake: schedule,
    relocate(id, cwd) { store.change(sid(id), value => { value.cwd = cwd; value.paused = true; }); const old = bindings.get(id); if (old) old.client.off('turn-settled', old.settled); bindings.delete(id); emit(id); },
    store,
  };
}
