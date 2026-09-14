import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {moveSessionFiles, resolveMovedSessionCwd, recoverSessionMoves, readSessionMoves} from '../electron/session-move.mjs';
import {encodeSessionCwd, loadSessionOpenState, listSessionsForCwd} from '../electron/sessions.mjs';
const id='alias-move-session-0001';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'alias-move-'));
  const real=path.join(root,'physical'); fs.mkdirSync(real);
  const alias=path.join(root,'alias'); fs.symlinkSync(real,alias,process.platform==='win32'?'junction':'dir');
  const cwd=path.join(root,'source'); fs.mkdirSync(cwd);
  const home=path.join(root,'grok');
  const store=c=>path.join(home,'sessions',encodeSessionCwd(c),id);
  fs.mkdirSync(store(cwd),{recursive:true});
  const history=JSON.stringify({update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'keep original'}},timestamp:'2026-09-14T00:00:00Z'})+'\n';
  fs.writeFileSync(path.join(store(cwd),'updates.jsonl'),history);
  fs.writeFileSync(path.join(store(cwd),'summary.json'),JSON.stringify({info:{cwd,id},generated_title:'原对话',updated_at:'2026-09-14T00:00:00Z'}));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,real,alias,cwd,home,store,history};
}
test('real project symlink preserves requested storage key, summary, history and repeated/reverse moves',t=>{
  const f=fixture(t),r=moveSessionFiles({cwd:f.cwd,targetCwd:f.alias,sessionId:id},{home:f.home});
  assert.equal(r.targetCwd,f.alias); assert.equal(encodeSessionCwd(f.alias),encodeURIComponent(path.resolve(f.alias)));
  assert.ok(fs.existsSync(f.store(f.alias))); assert.ok(!fs.existsSync(f.store(f.real)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.store(f.alias),'summary.json'),'utf8')).info.cwd,f.alias);
  assert.equal(resolveMovedSessionCwd(f.cwd,id,f.home),f.alias);
  assert.equal(resolveMovedSessionCwd(f.real,id,f.home),f.alias);
  const old=process.env.GROK_HOME; process.env.GROK_HOME=f.home;
  try {assert.equal(listSessionsForCwd(f.alias)[0].cwd,f.alias);assert.equal(loadSessionOpenState(f.alias,id).items.find(r=>r.kind==='user').text,'keep original');}
  finally {if(old===undefined)delete process.env.GROK_HOME;else process.env.GROK_HOME=old;}
  moveSessionFiles({cwd:f.real,targetCwd:f.cwd,sessionId:id},{home:f.home});
  assert.equal(fs.readFileSync(path.join(f.store(f.cwd),'updates.jsonl'),'utf8'),f.history);
  assert.equal(resolveMovedSessionCwd(f.alias,id,f.home),f.cwd);
  assert.equal(resolveMovedSessionCwd(f.real,id,f.home),f.cwd);
});
for(const target of ['alias','real']) test(`same-ID collision in ${target} bucket cannot be bypassed by the other path`,t=>{
  const f=fixture(t);fs.mkdirSync(f.store(f[target]),{recursive:true});
  fs.writeFileSync(path.join(f.store(f[target]),'original'),'untouched target');
  assert.throws(()=>moveSessionFiles({cwd:f.cwd,targetCwd:f[target==='alias'?'real':'alias'],sessionId:id},{home:f.home}),/同标识/);
  assert.equal(fs.readFileSync(path.join(f.store(f[target]),'original'),'utf8'),'untouched target');
  assert.ok(!fs.lstatSync(f.store(f.cwd)).isSymbolicLink());assert.equal(readSessionMoves(f.home).length,0);
});
test('interrupted rename into symlink-spelled project recovers with that exact cwd',t=>{
  const f=fixture(t);assert.throws(()=>moveSessionFiles({cwd:f.cwd,targetCwd:f.alias,sessionId:id},{home:f.home,afterRename(){throw new Error('interrupt');}}),/interrupt/);
  recoverSessionMoves(f.home); assert.equal(readSessionMoves(f.home)[0].targetCwd,f.alias);
  assert.equal(resolveMovedSessionCwd(f.cwd,id,f.home),f.alias);
  assert.equal(fs.readFileSync(path.join(f.store(f.alias),'updates.jsonl'),'utf8'),f.history);
});
test('two preexisting native identities under physical aliases are refused as an ambiguous source',t=>{
  const f=fixture(t);for(const c of [f.alias,f.real])fs.mkdirSync(f.store(c),{recursive:true});
  assert.throws(()=>resolveMovedSessionCwd(f.alias,id,f.home),/不能自动选择/);
});
