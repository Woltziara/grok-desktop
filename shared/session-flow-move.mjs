/** Durable, retryable UI-key migration. A directory move never deletes a draft. */
import { FLOW_KEY, draftStorageKey, readJsonItem, writeJsonItem } from './flow-persist.mjs';
import { sessionOrgKey } from './workspace-org.mjs';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function migrateSessionFlow(storage, move) {
  if(!move || move.phase!=='committed') return {ok:true};
  const location=readJsonItem(storage,FLOW_KEY)?.sessionLocations?.[move.sessionId];
  if(location && Number(location.sequence)>Number(move.sequence||0)) return {ok:true};
  const from=sessionOrgKey(move.cwd,move.sessionId),to=sessionOrgKey(move.targetCwd,move.sessionId);
  if(!from || !to || from===to) return {ok:true};
  const journalKey=`grok-desktop-flow-move-v1:${move.id}`;
  const set=(k,v)=>{const r=writeJsonItem(storage,k,v);if(!r.ok)throw new Error(r.error);};
  try {
    let journal=readJsonItem(storage,journalKey);
    const old=readJsonItem(storage,draftStorageKey(from));
    const target=readJsonItem(storage,draftStorageKey(to));
    if(!journal) { journal={original:old,next:old?{...old,cwd:move.targetCwd}:null,done:false};set(journalKey,journal); }
    if(!journal.done) {
      if(journal.next && target && !equal(target,journal.next)) throw new Error('新旧位置各有草稿，均已保留；请先核对草稿。');
      if(journal.next && !target) set(draftStorageKey(to),journal.next);
      const flow=readJsonItem(storage,FLOW_KEY)||{};
      for(const name of ['pinned','archived','reading','unread']) {
        const map={...(flow[name]||{})};
        if(Object.hasOwn(map,from)) { if(!Object.hasOwn(map,to))map[to]=map[from];delete map[from]; }
        flow[name]=map;
      }
      flow.lastSessions=(flow.lastSessions||[]).map(r=>r.sessionId===move.sessionId && sessionOrgKey(r.cwd,r.sessionId)===from?{...r,cwd:move.targetCwd}:r);
      // Old inline drafts were migrated separately in previous versions.
      if(flow.drafts) {if(flow.drafts[from] && !flow.drafts[to])flow.drafts[to]={...flow.drafts[from],cwd:move.targetCwd};delete flow.drafts[from];}
      flow.sessionLocations={...(flow.sessionLocations||{}),[move.sessionId]:{cwd:move.targetCwd,sequence:move.sequence||0,id:move.id}};
      set(FLOW_KEY,flow);set(journalKey,{...journal,done:true});
    }
    // An unmount may flush the exact old snapshot after the first migration.
    // Discard only that duplicate, never a later edit. The journal is a backup.
    if(old) {
      const content=d=>d?{...d,savedAt:0}:d;
      if(!equal(content(old),content(journal.original))) throw new Error('移动后原位置又出现修改，两个草稿均已保留。');
      set(draftStorageKey(from),null);
    }
    return {ok:true};
  } catch(e) { return {ok:false,error:`对话移动已保存，界面状态暂未同步：${e.message} 原草稿与移动备份仍在。`}; }
}
