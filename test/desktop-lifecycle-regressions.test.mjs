import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { afterEach, test } from 'node:test';
import { EventEmitter } from 'node:events';
import { appendInbox, bindSession, ensureObject, ensureStore, listInbox, readCurrent, readRecords, writeConfig, writeRecord } from '../shared/working-knowledge/store.mjs';
import { buildWirePrompt } from '../shared/working-knowledge/briefing.mjs';
import { applyCommitFromAssistantText, uiWithdraw } from '../shared/working-knowledge/updates.mjs';
import { wrapOutgoingPrompt, consumeTurnOutput, setWorkingKnowledgeEnabled } from '../electron/working-knowledge.mjs';
import { cancelAllPermissions, listPendingPermissionRequests, registerPermissionRequest, settlePermission, settlePendingAllowOnce } from '../electron/pending-permissions.mjs';
register(new URL('./fixtures/resolve-electron-mock.mjs', import.meta.url));
const { GrokAcpClient } = await import('../electron/acp-client.mjs');
const roots = [];
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-lifecycle-'));
  roots.push(dir); process.env.GROK_DESKTOP_WK_ROOT = dir;
  ensureStore(dir); writeConfig(dir, { enabled: true }); ensureObject(dir,'alpha'); bindSession(dir, {sessionId:'s1',objectId:'alpha',cwd:'/synthetic'});
  return dir;
}
function defer() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; }
function client(request) {
  const c = new GrokAcpClient({ cwd: '/synthetic', grokPath: '/unused-in-this-test' });
  c.sessionId = 's1'; c.ready = true;
  c.proc = { stdin: { writable: true, write() {} }, kill() {} };
  c.request = request; return c;
}
const commit = (root, changes) => `<<<WK_COMMIT\n${JSON.stringify({objectId:'alpha', baseVersion:readCurrent(root,'alpha').version, changes})}\nWK_COMMIT>>>`;
afterEach(() => { delete process.env.GROK_DESKTOP_WK_ROOT; cancelAllPermissions(); for (const d of roots.splice(0)) fs.rmSync(d,{recursive:true,force:true}); });

test('accepted interjection reaches the actual prompt source set once, by id rather than text', async () => {
  const dir = root(), done = defer(); let calls = 0;
  const c = client(async (method) => method === 'session/prompt' ? done.promise : (calls++, {status:'queued'}));
  const running = c.prompt('请继续准备');
  await Promise.all([c.interject('预算是90', {interjectionId:'i1'}),c.interject('预算是90', {interjectionId:'i1'})]);
  await c.interject('预算是90', {interjectionId:'i2'});
  assert.equal(calls,2);
  const inputs = listInbox(dir,'alpha').filter(r => r.delivery === 'interjection');
  assert.equal(inputs.length,2);
  assert.equal(c._activeTurn.inboxIds.includes(inputs[0].id),true);
  c._turnAssistantBuf = commit(dir,[{kind:'correction',text:'预算是90',sourceQuote:'预算是90',epistemic:'user_said',inboxIds:[inputs[1].id]}]);
  done.resolve({stopReason:'end_turn'}); await running;
  const record = readCurrent(dir,'alpha').items.find(x=>x.text === '预算是90');
  assert.equal(record.source.type,'user'); assert.equal(record.source.inboxId,inputs[1].id);
  assert.equal(record.source.sessionId,'s1');
  assert.equal(listInbox(dir,'alpha').some(x=>x.id===inputs[0].id),true);
  assert.equal(listInbox(dir,'alpha').some(x=>x.id===inputs[1].id),false);
});

test('unsupported interject then prompt reuses the same working-knowledge inbox id', async () => {
  const dir = root(), done = defer();
  const c = client(async (method) => {
    if (method === 'session/prompt') return done.promise;
    const err = new Error('Method not found');
    err.code = -32601;
    throw err;
  });
  const running = c.prompt('开始');
  const result = await c.interject('同一句原话', { interjectionId: 'att-1', deliveryId: 'send-1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported');
  assert.equal(listInbox(dir, 'alpha').filter((row) => row.id === 'send-1').length, 1);
  const wrapped = wrapOutgoingPrompt({ text: '同一句原话', sessionId: 's1', cwd: '/synthetic', inboxId: 'send-1' });
  assert.equal(wrapped.inboxId, 'send-1');
  assert.equal(listInbox(dir, 'alpha').filter((row) => row.text === '同一句原话').length, 1);
  assert.equal(listInbox(dir, 'alpha').filter((row) => row.id === 'send-1').length, 1);
  done.resolve({});
  await running;
});

test('failed interjection preserves original pending without licensing it as a current-turn source', async () => {
  const dir=root(),done=defer();const c=client(async method=>{if(method==='session/prompt')return done.promise;throw new Error('transport broke');});
  const running=c.prompt('开始');await assert.rejects(c.interject('先不要报价',{interjectionId:'failed'}),/transport broke/);
  const row=listInbox(dir,'alpha').find(r=>r.interjectionId==='failed');
  assert.equal(row.text,'先不要报价');assert.equal(c._activeTurn.inboxIds.includes(row.id),false);
  done.resolve({stopReason:'end_turn'});await running;
  assert.equal(listInbox(dir,'alpha').some(r=>r.id===row.id),true);
});

test('reused interjection id with different content is refused without overwriting the original', async()=>{
  const dir=root(),done=defer();const c=client(async method=>method==='session/prompt'?done.promise:{});
  const running=c.prompt('开始');await c.interject('原话',{interjectionId:'fixed'});
  await assert.rejects(c.interject('另一句话',{interjectionId:'fixed'}),/different input/);
  assert.equal(listInbox(dir,'alpha').filter(r=>r.interjectionId==='fixed').length,1);
  done.resolve({});await running;
});

test('cancel isolates late update, does not consume or clear the next context', async()=>{
  const dir=root(),done=defer();const c=client(()=>done.promise);
  const running=c.prompt('待取消');c._rejectPendingPrompts=err=>done.reject(err);
  let seen=0;c.on('session-update',()=>seen++);c.cancel();
  c._dispatchLine(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'late'}}}}));
  await assert.rejects(running,/cancelled/);
  assert.equal(seen,0);assert.equal(c._turnAssistantBuf,'');assert.equal(c._needsPromptRestart,true);
  assert.equal(listInbox(dir,'alpha').length,1);assert.equal(readCurrent(dir,'alpha').items.length,0);
});

test('binding away and back prevents a late commit even if the object id matches again',()=>{
  const dir=root();const w=wrapOutgoingPrompt({text:'原来的判断',sessionId:'s1',cwd:'/synthetic'});
  bindSession(dir,{sessionId:'s1',objectId:'beta',cwd:'/synthetic'});bindSession(dir,{sessionId:'s1',objectId:'alpha',cwd:'/synthetic'});
  const result=consumeTurnOutput({...w,sessionId:'s1',cwd:'/synthetic',assistantText:commit(dir,[{kind:'background',text:'原来的判断',sourceQuote:'原来的判断'}])});
  assert.equal(result.reason,'binding-changed');assert.equal(readCurrent(dir,'alpha').items.length,0);
  assert.equal(listInbox(dir,'alpha').length,1);
});

test('off and on does not revive an old turn commit',()=>{
  const dir=root();const w=wrapOutgoingPrompt({text:'旧一轮',sessionId:'s1',cwd:'/synthetic'});
  setWorkingKnowledgeEnabled(false);setWorkingKnowledgeEnabled(true);
  const result=consumeTurnOutput({...w,sessionId:'s1',assistantText:commit(dir,[{kind:'background',text:'旧一轮',sourceQuote:'旧一轮'}])});
  assert.equal(result.reason,'disabled-or-reenabled');assert.equal(readCurrent(dir,'alpha').items.length,0);
});

test('a model cannot consume an unseen pending correction using a guessed inbox id',()=>{
  const dir=root();const current=appendInbox(dir,{objectId:'alpha',sessionId:'s1',text:'本轮'});
  const other=appendInbox(dir,{objectId:'alpha',sessionId:'s2',text:'另一对话纠正'});
  const result=applyCommitFromAssistantText(dir,commit(dir,[{kind:'inference',text:'候选解释',inboxIds:[other.id]}]),{objectId:'alpha',inboxId:current.id,sessionId:'s1'});
  assert.equal(result.ok,true);assert.equal(listInbox(dir,'alpha').some(r=>r.id===other.id),true);
});

test('withdrawal survives a new model record id',()=>{
  const dir=root();const old=writeRecord(dir,{objectId:'alpha',kind:'preference',text:'旧偏好',epistemic:'user_said'}).record;
  uiWithdraw(dir,{objectId:'alpha',id:old.id,sessionId:'s1'});
  const result=applyCommitFromAssistantText(dir,commit(dir,[{kind:'preference',text:'旧偏好'}]),{objectId:'alpha',sessionId:'s1'});
  assert.equal(result.ok,false);assert.match(result.error,/revive/);assert.equal(readCurrent(dir,'alpha').items.length,0);
});

test('briefing lists source ids and does not license clipped originals',()=>{
  const dir=root();const huge=appendInbox(dir,{objectId:'alpha',sessionId:'s1',text:'长'.repeat(2400)});
  const small=appendInbox(dir,{objectId:'alpha',sessionId:'s1',text:'短原话'});
  const built=buildWirePrompt({userText:'现在',objectId:'alpha',root:dir,enabled:true});
  assert.match(built.wireText,new RegExp(small.id));assert.equal(built.inboxIds.includes(huge.id),false);assert.equal(built.inboxIds.includes(small.id),true);
});

test('corrupt knowledge journal is visible and never overwritten by a subsequent write',()=>{
  const dir=root(),file=path.join(dir,'objects','alpha','records.jsonl');
  fs.writeFileSync(file,'{broken}\n');assert.throws(()=>readRecords(dir,'alpha'),/损坏/);
  assert.equal(fs.readFileSync(file,'utf8'),'{broken}\n');
});

test('cancel and grants are scoped to one conversation in the same window',()=>{
  const outcomes=[];for(const sessionId of ['A','B']) registerPermissionRequest({reqId:sessionId,ownerId:'window',params:{sessionId,options:[{optionId:'once',kind:'allow_once'}]},respond:value=>outcomes.push([sessionId,value])});
  assert.equal(settlePermission('B',{outcome:'selected'},'window','A'),false);
  cancelAllPermissions(undefined,'window','A');
  assert.deepEqual(outcomes.map(x=>x[0]),['A']);assert.deepEqual(listPendingPermissionRequests('window').map(x=>x.reqId),['B']);
  assert.equal(settlePendingAllowOnce('window','A'),0);assert.equal(settlePendingAllowOnce('window','B'),1);
});


test('explicit second same-text source keeps its own session and does not consume the first',()=>{
  const dir=root();
  const a=appendInbox(dir,{objectId:'alpha',sessionId:'s1',cwd:'/first',text:'同一句更正'});
  const b=appendInbox(dir,{objectId:'alpha',sessionId:'s2',cwd:'/second',text:'同一句更正'});
  const result=applyCommitFromAssistantText(dir,commit(dir,[{kind:'correction',text:b.text,sourceQuote:b.text,inboxIds:[b.id]}]),{objectId:'alpha',inboxId:a.id,inboxIds:[a.id,b.id],sessionId:'s1'});
  assert.deepEqual(result.processedInbox,[b.id]);
  const saved=readCurrent(dir,'alpha').items[0];
  assert.equal(saved.source.inboxId,b.id);assert.equal(saved.source.sessionId,'s2');assert.equal(saved.source.cwd,'/second');
  assert.equal(listInbox(dir,'alpha').some(r=>r.id===a.id),true);
});

test('an explicit unseen id cannot borrow the matching quote from this turn',()=>{
  const dir=root();const a=appendInbox(dir,{objectId:'alpha',sessionId:'s1',text:'相同原话'});
  const b=appendInbox(dir,{objectId:'alpha',sessionId:'s2',text:'相同原话'});
  const result=applyCommitFromAssistantText(dir,commit(dir,[{kind:'correction',text:b.text,sourceQuote:b.text,inboxIds:[b.id]}]),{objectId:'alpha',inboxId:a.id,sessionId:'s1'});
  assert.deepEqual(result.processedInbox,[]);assert.equal(readCurrent(dir,'alpha').items[0].epistemic,'model_inferred');
  assert.equal(listInbox(dir,'alpha').length,2);
});

test('multiple explicitly cited identical sources are not arbitrarily attributed to the first',()=>{
  const dir=root();const a=appendInbox(dir,{objectId:'alpha',sessionId:'s1',text:'相同原话'});
  const b=appendInbox(dir,{objectId:'alpha',sessionId:'s2',text:'相同原话'});
  applyCommitFromAssistantText(dir,commit(dir,[{kind:'inference',text:b.text,sourceQuote:b.text,inboxIds:[a.id,b.id]}]),{objectId:'alpha',inboxId:a.id,inboxIds:[b.id],sessionId:'s1'});
  const item=readCurrent(dir,'alpha').items[0];assert.equal(item.source.type,'model');assert.equal(item.source.inboxId,undefined);
});
