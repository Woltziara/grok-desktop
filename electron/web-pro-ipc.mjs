import { createWebProAssignment, listWebProAssignments, readWebProAssignment, recordWebProResult, recordWebProSnapshot } from './web-pro-assignment.mjs';

export function registerWebProIpc(ipc, { userData, windowFromEvent }) {
  const owner = e => {
    const w = windowFromEvent(e);
    if (!w || w.isDestroyed?.()) throw new Error('原窗口已关闭。');
    return w;
  };
  ipc.handle('web-pro:list', e => { owner(e); return listWebProAssignments(userData()); });
  ipc.handle('web-pro:create', (e, input) => { owner(e); return createWebProAssignment(userData(), input); });
  ipc.handle('web-pro:read', (e, id) => { owner(e); return readWebProAssignment(userData(), id); });
  ipc.handle('web-pro:snapshot', (e, { id, text } = {}) => { owner(e); return recordWebProSnapshot(userData(), id, text); });
  ipc.handle('web-pro:result', (e, { id, files, note, apply } = {}) => { owner(e); return recordWebProResult(userData(), id, { files, note, apply }); });
}
