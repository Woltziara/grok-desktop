import vm from "node:vm";
import {register} from "node:module";
import {fileURLToPath} from "node:url";
register(new URL("./fixtures/resolve-electron-mock.mjs",import.meta.url));
const {GrokAcpClient}=await import("../electron/acp-client.mjs");
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { moveSessionFiles, readSessionMoves, recoverSessionMoves, resolveMovedSessionCwd, movableSessionClients, withSessionMove, assertSessionNotMoving } from '../electron/session-move.mjs';
import { encodeSessionCwd, listSessionsForCwd, loadSessionOpenState } from '../electron/sessions.mjs';
import { migrateSessionFlow } from '../shared/session-flow-move.mjs';
import { FLOW_KEY, draftStorageKey } from '../shared/flow-persist.mjs';
import { sessionOrgKey } from '../shared/workspace-org.mjs';
const id='move-session-0001';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-move-')),home=path.join(root,'grok');
  const cwd=path.join(root,'A'),targetCwd=path.join(root,'B');fs.mkdirSync(cwd);fs.mkdirSync(targetCwd);
  const from=path.join(home,'sessions',encodeSessionCwd(cwd),id),to=path.join(home,'sessions',encodeSessionCwd(targetCwd),id);
  fs.mkdirSync(path.join(from,'attachments'),{recursive:true});
  fs.writeFileSync(path.join(from,'summary.json'),JSON.stringify({info:{id,cwd},generated_title:'保留的对话',updated_at:'2026-09-01T00:00:00Z'}));
  const attachment=path.join(from,'attachments','report.pdf');fs.writeFileSync(attachment,'local synthetic attachment bytes');
  const history=JSON.stringify({sessionId:id,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'read '+attachment}},timestamp:'2026-09-01T00:00:00Z'})+'\n';
  fs.writeFileSync(path.join(from,'updates.jsonl'),history);
  fs.writeFileSync(path.join(from,'chat_history.jsonl'),JSON.stringify({role:'user',content:'原文 '+attachment})+'\n');
  fs.writeFileSync(path.join(cwd,'independent.txt'),'not part of the move');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,home,cwd,targetCwd,from,to,attachment,history};
}
test('one canonical native directory moves; original history bytes, attachments, project originals and restore backup remain readable', t=> {
  const f=fixture(t),row=moveSessionFiles({...f,sessionId:id},{home:f.home});
  assert.equal(row.phase,'committed');assert.ok(fs.lstatSync(f.from).isSymbolicLink());assert.ok(fs.lstatSync(f.to).isDirectory());
  assert.equal(fs.readFileSync(path.join(f.to,'updates.jsonl'),'utf8'),f.history);
  assert.equal(fs.readFileSync(f.attachment,'utf8'),'local synthetic attachment bytes');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.to,'summary.json'),'utf8')).info.cwd,f.targetCwd);
  assert.equal(JSON.parse(fs.readFileSync(path.join(row.backup,'summary.json'),'utf8')).info.cwd,f.cwd);
  assert.equal(fs.readFileSync(path.join(f.cwd,'independent.txt'),'utf8'),'not part of the move');
  const old=process.env.GROK_HOME;process.env.GROK_HOME=f.home;
  try {assert.equal(listSessionsForCwd(f.cwd).length,0);assert.equal(listSessionsForCwd(f.targetCwd)[0].cwd,f.targetCwd);assert.match(loadSessionOpenState(f.targetCwd,id).items.find(x=>x.kind==='user').text,/read /);}
  finally {if(old===undefined)delete process.env.GROK_HOME;else process.env.GROK_HOME=old;}
});
test('real interrupted rename recovers idempotently without creating a duplicate native identity',t=> {
  const f=fixture(t);assert.throws(()=>moveSessionFiles({...f,sessionId:id},{home:f.home,afterRename:()=>{throw new Error('power loss fixture');}}),/power loss/);
  assert.equal(readSessionMoves(f.home)[0].phase,'prepared');recoverSessionMoves(f.home);recoverSessionMoves(f.home);
  assert.equal(readSessionMoves(f.home)[0].phase,'committed');assert.equal(fs.readFileSync(f.attachment,'utf8'),'local synthetic attachment bytes');
  assert.equal(resolveMovedSessionCwd(f.cwd,id,f.home),f.targetCwd);
});
test('second move keeps original attachment references through a forward-only alias chain',t=> {
  const f=fixture(t);moveSessionFiles({...f,sessionId:id},{home:f.home});const third=path.join(f.root,'C');fs.mkdirSync(third);
  moveSessionFiles({cwd:f.targetCwd,targetCwd:third,sessionId:id},{home:f.home});
  assert.equal(resolveMovedSessionCwd(f.cwd,id,f.home),third);assert.equal(fs.readFileSync(f.attachment,'utf8'),'local synthetic attachment bytes');
});
test('target collision refuses before any original changes',t=> {
  const f=fixture(t);fs.mkdirSync(f.to,{recursive:true});fs.writeFileSync(path.join(f.to,'other'),'keep');
  assert.throws(()=>moveSessionFiles({...f,sessionId:id},{home:f.home}),/同标识/);
  assert.ok(!fs.lstatSync(f.from).isSymbolicLink());assert.equal(fs.readFileSync(path.join(f.to,'other'),'utf8'),'keep');
});
test('busy, background terminals and other visible windows are checked before unrelated consumers are touched',()=> {
  const client={sessionId:id,turnOpen:false};const other={sessionId:'another',turnOpen:true};const caller={agent:client,parkedAgents:new Map([['another',other]])};
  assert.deepEqual(movableSessionClients([caller],caller,id),[{ws:caller,client}]);
  client.turnOpen=true;assert.throws(()=>movableSessionClients([caller],caller,id),/执行/);client.turnOpen=false;
  assert.throws(()=>movableSessionClients([caller,{agent:{sessionId:id}}],caller,id),/另一个窗口/);
  client.terminals={terminals:new Map([['t',{exited:false}]])};assert.throws(()=>movableSessionClients([caller],caller,id),/执行/);
  assert.equal(other.turnOpen,true);
});
test('movement lock excludes prompt/open races and releases on error',async()=> {
  await assert.rejects(withSessionMove(id,async()=>{assert.throws(()=>assertSessionNotMoving(id));assert.doesNotThrow(()=>assertSessionNotMoving('other'));throw new Error('intentional');}),/intentional/);
  assert.doesNotThrow(()=>assertSessionNotMoving(id));
});
function storage() { const data=new Map();return {data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; }
function flowFixture() {const s=storage(),move={id:'receipt1',cwd:'/A',targetCwd:'/B',sessionId:id,phase:'committed'},from=sessionOrgKey('/A',id),to=sessionOrgKey('/B',id);const draft={text:'draft',cwd:'/A',cursor:2,files:[{id:'img',blobId:'img',kind:'image'},{id:'pdf',path:'/unchanged-attachment'}],quotes:[{id:'q',text:'quoted'}],savedAt:123};s.setItem(draftStorageKey(from),JSON.stringify(draft));s.setItem(FLOW_KEY,JSON.stringify({reading:{[from]:{scrollTop:456}},pinned:{[from]:1},unread:{[from]:{needsYou:true}},lastSessions:[{cwd:'/A',sessionId:id}]}));return {s,move,from,to,draft};}
test('UI migration moves full draft/quote/blob identities/reading and can safely replay after unmount',()=> {
  const {s,move,from,to,draft}=flowFixture();assert.equal(migrateSessionFlow(s,move).ok,true);
  assert.equal(s.getItem(draftStorageKey(from)),null);assert.deepEqual(JSON.parse(s.getItem(draftStorageKey(to))),{...draft,cwd:'/B'});
  const f=JSON.parse(s.getItem(FLOW_KEY));assert.equal(f.reading[to].scrollTop,456);assert.equal(f.unread[to].needsYou,true);assert.equal(f.lastSessions[0].cwd,'/B');
  s.setItem(draftStorageKey(from),JSON.stringify({...draft,savedAt:999}));assert.equal(migrateSessionFlow(s,move).ok,true);assert.equal(s.getItem(draftStorageKey(from)),null);
});
test('storage quota between native receipt and UI migration leaves a retryable journal and never deletes original draft',()=> {
  const {s,move,from,to,draft}=flowFixture();const set=s.setItem;s.setItem=(k,v)=>{if(k===FLOW_KEY)throw new Error('quota');return set(k,v);};
  assert.equal(migrateSessionFlow(s,move).ok,false);assert.deepEqual(JSON.parse(s.getItem(draftStorageKey(from))),draft);
  s.setItem=set;assert.equal(migrateSessionFlow(s,move).ok,true);assert.ok(s.getItem(draftStorageKey(to)));
});
test('different target draft and late source edits are kept rather than silently overwritten',()=> {
  const {s,move,from,to}=flowFixture();s.setItem(draftStorageKey(to),JSON.stringify({text:'concurrent target'}));assert.equal(migrateSessionFlow(s,move).ok,false);
  assert.equal(JSON.parse(s.getItem(draftStorageKey(to))).text,'concurrent target');assert.ok(s.getItem(draftStorageKey(from)));
});

test('moving back to a previous project replaces only its own compatibility alias',t=> {
  const f=fixture(t);moveSessionFiles({...f,sessionId:id},{home:f.home});
  moveSessionFiles({cwd:f.targetCwd,targetCwd:f.cwd,sessionId:id},{home:f.home});
  assert.ok(!fs.lstatSync(f.from).isSymbolicLink());assert.ok(fs.lstatSync(f.to).isSymbolicLink());
  assert.equal(resolveMovedSessionCwd(f.cwd,id,f.home),f.cwd);assert.equal(fs.readFileSync(f.attachment,'utf8'),'local synthetic attachment bytes');
});
test('returning to original project and replaying old move receipts cannot consume its newer draft',()=> {
  const {s,move,from,to}=flowFixture();move.sequence=1;migrateSessionFlow(s,move);
  const back={...move,id:'receipt2',cwd:'/B',targetCwd:'/A',sequence:2};assert.equal(migrateSessionFlow(s,back).ok,true);
  const newest={...JSON.parse(s.getItem(draftStorageKey(from))),text:'newest A'};s.setItem(draftStorageKey(from),JSON.stringify(newest));
  assert.equal(migrateSessionFlow(s,move).ok,true);assert.equal(migrateSessionFlow(s,back).ok,true);
  assert.deepEqual(JSON.parse(s.getItem(draftStorageKey(from))),newest);assert.equal(s.getItem(draftStorageKey(to)),null);
});

test('moved native history resumes through a fresh real ACP process with target cwd and no code restore', {skip:process.platform==='win32',timeout:15000}, async t=> {
  const f=fixture(t);moveSessionFiles({...f,sessionId:id},{home:f.home});
  const old=process.env.DESKTOP_RECOVERY_TEST_LOG,log=path.join(f.root,'rpc.jsonl');process.env.DESKTOP_RECOVERY_TEST_LOG=log;
  const c=new GrokAcpClient({cwd:f.targetCwd,grokPath:fileURLToPath(new URL('./fixtures/acp-recovery-peer.mjs',import.meta.url))});
  c.on('error',()=>{});c.on('folder-trust-request',({respond})=>respond({outcome:'trust'}));c.on('mcp-elicit-request',({respond})=>respond({outcome:'accept',content:{}}));
  try {
    await c.start({resumeSessionId:id});assert.equal(c.cwd,f.targetCwd);assert.equal(c.sessionId,id);
    const load=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).find(r=>r.method==='session/load');
    assert.equal(load.params.cwd,f.targetCwd);assert.equal(load.params._meta['x.ai/restore_code'],false);
    assert.equal(c._resolveFsPath('new-result.txt'),path.join(f.targetCwd,'new-result.txt'));
    assert.equal(fs.readFileSync(path.join(f.to,'updates.jsonl'),'utf8'),f.history);
  } finally {await c.dispose();if(old===undefined)delete process.env.DESKTOP_RECOVERY_TEST_LOG;else process.env.DESKTOP_RECOVERY_TEST_LOG=old;}
});

test('a rejected native resume does not allocate an unrelated new conversation',async()=> {
  const source=fs.readFileSync(new URL('../electron/window-session.mjs',import.meta.url),'utf8');
  const start=source.indexOf('export async function openSessionOnWindow('),end=source.indexOf('\n/**',start);
  const calls=[];
  const open=vm.runInNewContext('('+source.slice(start,end).replace(/^export /,'')+')',{resolveMovedSessionCwd:cwd=>cwd,ensureAgent:async(_ws,cwd,opts)=>{calls.push({cwd,...opts});throw new Error('resume failed');}});
  await assert.rejects(open({generation:1},{cwd:'/B',mode:'resume',sessionId:id}),/resume failed/);
  assert.equal(calls.length,1);assert.equal(calls[0].resumeSessionId,id);assert.equal(calls[0].forceNew,false);
});
