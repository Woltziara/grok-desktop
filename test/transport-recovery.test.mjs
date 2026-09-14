import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { test } from 'node:test';
register(new URL('./fixtures/resolve-electron-mock.mjs',import.meta.url));
const { GrokAcpClient } = await import('../electron/acp-client.mjs');
const peer=fileURLToPath(new URL('./fixtures/acp-recovery-peer.mjs',import.meta.url));
async function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acp-real-recovery-'));
  const log=path.join(dir,'transport.jsonl');
  const old=process.env.DESKTOP_RECOVERY_TEST_LOG;process.env.DESKTOP_RECOVERY_TEST_LOG=log;
  const c=new GrokAcpClient({cwd:dir,grokPath:peer,promptLifecycle:{
    prepare:({text})=>({wrapped:{inboxId:null,objectId:''},prompt:[{type:'text',text}]}),
    consume:()=>({ok:true}),
  }});
  c.on('error',()=>{});
  const requests=[];
  c.on('folder-trust-request',({respond})=>{requests.push('trust');respond({outcome:'trust'});});
  c.on('mcp-elicit-request',({respond})=>{requests.push('elicit');respond({outcome:'accept',content:{}});});
  t.after(async()=>{await c.dispose();if(old===undefined)delete process.env.DESKTOP_RECOVERY_TEST_LOG;else process.env.DESKTOP_RECOVERY_TEST_LOG=old;fs.rmSync(dir,{recursive:true,force:true});});
  await c.start();return {c,requests,log};
}
const opts={skip:process.platform==='win32',timeout:12000};

test('ordinary rate-limit/auth/server RPC failures keep the real connection usable for reverse requests and next prompt',opts,async t=>{
  const {c,requests}=await setup(t),pid=c.proc.pid;
  for(const code of [-32005,-32001,-32603]) {
    await assert.rejects(c.prompt(`rpc-error:${code}`),e=>e.code===code);
    assert.equal(c._discardUpdates,false);assert.equal(c._needsPromptRestart,false);
    const updates=[];c.once('session-update',u=>updates.push(u));
    await c.prompt('gates');
    assert.equal(c.proc.pid,pid);assert.equal(updates.length,1);
  }
  assert.deepEqual(requests,['trust','elicit','trust','elicit','trust','elicit']);
});

test('cancel restarts a real child, answers trust and MCP during session/load, suppresses replay and fences the old reader',opts,async t=>{
  const {c,requests,log}=await setup(t),oldProc=c.proc,oldReader=c.rl;
  const running=c.prompt('hold');const rejected=assert.rejects(running,/cancelled/);
  c.cancel();await rejected;
  const updates=[];c.on('session-update',u=>updates.push(u));
  await c.prompt('next');
  assert.notEqual(c.proc.pid,oldProc.pid);assert.deepEqual(requests,['trust','elicit']);
  assert.deepEqual(updates.map(u=>u.update.content.text),['fresh answer']);
  oldReader.emit('line',JSON.stringify({method:'session/update',params:{sessionId:'recovery-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'retired reader'}}}}));
  assert.equal(updates.length,1);assert.equal(c._discardUpdates,false);
  const records=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.filter(r=>r.method==='initialize').length,2);
  assert.equal(records.find(r=>r.method==='session/load').params.sessionId,'recovery-session');
  assert.equal(records.find(r=>r.loadAnswers).loadAnswers.trust.result.outcome,'trust');
});

test('failed recovery load retains the original session and retries on a third fresh connection',opts,async t=>{
  const {c,log}=await setup(t);const running=c.prompt('hold');const rejected=assert.rejects(running,/cancelled/);c.cancel();await rejected;
  fs.writeFileSync(log+'.fail-load','1');
  await assert.rejects(c.prompt('next'),/synthetic load failed/);
  assert.equal(c.sessionId,'recovery-session');assert.equal(c.proc,null);
  await c.prompt('next');assert.equal(c._needsPromptRestart,false);
  const rows=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.filter(r=>r.method==='initialize').length,3);
  assert.deepEqual(rows.filter(r=>r.method==='session/load').map(r=>r.params.sessionId),['recovery-session','recovery-session']);
});

test('a second cancel during load is not erased by recovery completion',opts,async t=>{
  const {c}=await setup(t);const running=c.prompt('hold');const rejected=assert.rejects(running,/cancelled/);c.cancel();await rejected;
  c.once('folder-trust-request',()=>c.cancel());
  await assert.rejects(c.prompt('must not run'),/cancelled during session recovery/);
  assert.equal(c._needsPromptRestart,true);assert.equal(c.proc,null);
  await c.prompt('retry');assert.equal(c._needsPromptRestart,false);
});
