// Full application delivery controller -> the real GrokAcpClient -> real stdio
// child process. The child is explicitly a protocol fixture, not a Grok account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createSessionDelivery } from '../electron/session-delivery.mjs';
import { registerDeliveryIpc } from '../electron/delivery-ipc.mjs';
register(new URL('./fixtures/resolve-electron-mock.mjs',import.meta.url));
const { GrokAcpClient } = await import('../electron/acp-client.mjs');
const peer=fileURLToPath(new URL('./fixtures/acp-recovery-peer.mjs',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(test){for(let n=0;n<200;n++){if(test())return;await sleep(5);}assert.fail('native delivery never settled');}
test('main IPC owners, ordinary RPC failure and stop-then-now use the same native restart/load path',{skip:process.platform==='win32',timeout:12000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-native-')),log=path.join(root,'rpc.jsonl');
  const old=process.env.DESKTOP_RECOVERY_TEST_LOG;process.env.DESKTOP_RECOVERY_TEST_LOG=log;
  const client=new GrokAcpClient({cwd:root,grokPath:peer,promptLifecycle:{prepare:({text})=>({wrapped:{inboxId:null,objectId:''},prompt:[{type:'text',text}]}),consume:()=>({ok:true})}});
  client.on('error',()=>{});let trust=0,elicit=0;
  client.on('folder-trust-request',({respond})=>{trust++;respond({outcome:'trust'});});
  client.on('mcp-elicit-request',({respond})=>{elicit++;respond({outcome:'accept',content:{}});});
  const events=[],service=createSessionDelivery(path.join(root,'outbox'),{notify:e=>events.push(e)}),routes=new Map();
  const ws={agent:client,lastSessionId:'recovery-session',parkedAgents:new Map()};
  registerDeliveryIpc({handle:(name,fn)=>routes.set(name,fn)},{sessionFromEvent:()=>ws,agentForSession:(w,id)=>w.agent?.sessionId===id?w.agent:w.parkedAgents.get(id),delivery:()=>service});
  t.after(async()=>{await client.dispose();if(old===undefined)delete process.env.DESKTOP_RECOVERY_TEST_LOG;else process.env.DESKTOP_RECOVERY_TEST_LOG=old;fs.rmSync(root,{recursive:true,force:true});});
  await client.start();const pid=client.proc.pid;
  const submit=(text,id,mode='auto')=>routes.get('agent:submit-delivery')({}, {sessionId:client.sessionId,cwd:root,text,id,images:[],mode});
  await submit('rpc-error:-32005','failed');await waitFor(()=>service.state(client.sessionId).items.some(i=>i.id==='failed'&&i.status==='failed'));
  assert.equal(client._discardUpdates,false);assert.equal(client.proc.pid,pid);
  await submit('hold','holding');await waitFor(()=>client._activeTurn);
  // A parked connection still belongs to A after the renderer changes to B.
  ws.parkedAgents.set(client.sessionId,client);ws.agent={sessionId:'another-session',cwd:'/another',ready:true};
  await assert.rejects(routes.get('agent:submit-delivery')({}, {cwd:root,text:'bad',id:'missing-owner',images:[]}),/归属/);
  await submit('gates','after-cancel','now');await waitFor(()=>events.some(e=>e.type==='settled'&&e.row?.id==='after-cancel'&&e.ok));
  assert.notEqual(client.proc.pid,pid);assert.ok(trust>=2&&elicit>=2);assert.equal(ws.agent.sessionId,'another-session');
  const rows=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.filter(r=>r.method==='session/load').length,1);
  assert.deepEqual(rows.filter(r=>r.method==='session/prompt').map(r=>r.params.prompt[0].text),['rpc-error:-32005','hold','gates']);
});
