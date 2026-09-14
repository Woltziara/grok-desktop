#!/usr/bin/env node
// Test-only JSON-RPC peer. This exercises real child-process restarts, not Grok/model behavior.
import fs from 'node:fs';
import { createInterface } from 'node:readline';
const log = process.env.DESKTOP_RECOVERY_TEST_LOG;
const send = m => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...m})+'\n');
const record = m => fs.appendFileSync(log, JSON.stringify({pid:process.pid,...m})+'\n');
const reply = (id,result={}) => send({id,result});
const update = text => send({method:'session/update',params:{sessionId:'recovery-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
let gateId = 10000;
const gates = new Map();
function ask(method,params) { return new Promise(resolve=>{const id=gateId++;gates.set(id,resolve);send({id,method,params});}); }
async function loadGates() {
  const trust = await ask('_x.ai/folder_trust/request',{cwd:process.cwd(),workspace:process.cwd()});
  const elicit = await ask('_x.ai/mcp/elicit',{mode:'form',message:'Recovery confirmation',requestedSchema:{type:'object',properties:{}}});
  return {trust,elicit};
}
createInterface({input:process.stdin}).on('line',async line=>{
  const m=JSON.parse(line);record(m);
  if(!m.method) { gates.get(m.id)?.(m);gates.delete(m.id);return; }
  if(m.method==='initialize') return reply(m.id,{agentCapabilities:{loadSession:true}});
  if(m.method==='session/new') return reply(m.id,{sessionId:'recovery-session',modes:{currentModeId:'default',availableModes:[]}});
  if(m.method==='session/load') {
    if(fs.existsSync(log+'.fail-load')) {fs.unlinkSync(log+'.fail-load');send({id:m.id,error:{code:-32000,message:'synthetic load failed'}});return;}
    update('historical replay must not duplicate');
    const answers=await loadGates();
    record({loadAnswers:answers});
    if(answers.trust.result?.outcome!=='trust'||answers.elicit.result?.outcome!=='accept') {
      return send({id:m.id,error:{code:-32000,message:'recovery gates not answered'}});
    }
    return reply(m.id,{sessionId:m.params.sessionId,modes:{currentModeId:'default',availableModes:[]}});
  }
  if(m.method==='session/prompt') {
    const text=m.params.prompt[0]?.text;
    if(text==='hold') {update('partial old turn');return;}
    if(text?.startsWith('rpc-error:')) return send({id:m.id,error:{code:Number(text.split(':')[1]),message:'synthetic prompt rejection'}});
    if(text==='gates') {await loadGates();}
    update('fresh answer');return reply(m.id,{stopReason:'end_turn'});
  }
  if(m.method==='session/cancel') {update('late cancelled data');return;}
  reply(m.id,{});
});
