/** Shared by production main and Electron integration tests. Never resolve a missing
 * owner from the currently focused conversation for a delayed composer request. */
import { isSafeSessionId } from './sessions.mjs';
export function registerDeliveryIpc(ipc, { sessionFromEvent, agentForSession, delivery, captureBrowserReference }) {
  function target(event, sessionId, requireAgent = true) {
    if (!isSafeSessionId(sessionId)) throw new Error('发送没有明确的对话归属，草稿仍保留。');
    const ws = sessionFromEvent(event);
    if (!ws || ws.disposed) throw new Error('原窗口已经关闭，内容未发送。');
    const client = agentForSession(ws, sessionId);
    if (!client && (requireAgent || ws.lastSessionId !== sessionId)) throw new Error('请先返回这段对话并连接，内容仍保留。');
    return client;
  }
  ipc.handle('agent:submit-delivery', async (event, input) => {
    const client = target(event, input?.sessionId);
    if (!client.ready && !client._needsPromptRestart) throw new Error('原对话尚未连接，草稿仍保留。');
    if (input.cwd !== client.cwd) throw new Error('附件准备期间对话的项目已改变，草稿仍在原对话；请核对后重发。');
    return delivery().submit(client, input);
  });
  ipc.handle('agent:outbox', async (event, sessionId) => {
    const client = target(event, sessionId, false);
    if (client) delivery().bind(client);
    return delivery().state(sessionId);
  });
  ipc.handle('agent:outbox-mutate', async (event, { sessionId, action, data } = {}) => {
    const client = target(event, sessionId);
    delivery().bind(client);
    if (action === 'refresh-browser-reference') data = { ...(data || {}), browserReference: captureBrowserReference(sessionId) };
    return delivery().mutate(sessionId, action, data);
  });
  ipc.handle('preview:reference', async (event, sessionId) => {
    target(event, sessionId);
    return captureBrowserReference(sessionId);
  });
}
