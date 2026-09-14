import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSessionDelivery, createSessionOutbox, atomicWrite } from '../electron/session-delivery.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(predicate) { for (let i=0;i<100;i++) { if(predicate())return; await tick(); } assert.fail('delivery condition did not settle'); }
function fixture(t, options={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'session-outbox-'));
  t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const events=[];const service=createSessionDelivery(root,{notify:e=>events.push(e),...options});
  return {root,events,service};
}
class Peer extends EventEmitter {
  constructor(id){super();this.sessionId=id;this.cwd='/synthetic/'+id;this.ready=true;this.calls=[];this.interjections=[];this._activeTurn=null;this.turnOpen=false;}
  async prompt(text,opts){
    this.calls.push({text,opts});this.turnOpen=true;const turn=this._activeTurn={id:`turn-${this.calls.length}`};
    let ok=false;try{return await new Promise((resolve,reject)=>{this.complete=value=>{ok=true;resolve(value||{});};this.reject=reject;});}
    finally{this.turnOpen=false;this._activeTurn=null;this.emit('turn-settled',{sessionId:this.sessionId,turnId:turn.id,ok,cancelled:!ok});}
  }
  async interject(text,opts){this.interjections.push({text,opts});return this.interjectResult||{ok:true};}
  cancel(){this.reject?.(new Error('cancelled'));}
  async compactConversation(hint){this.compacted=hint;return {};}
}
const input=(text,id=text,mode='auto')=>({text,id:id.replace(/ /g,'-'),images:[],mode});

test('two sessions keep separate FIFO queues while their original views are absent',async t=>{
  const {service}=fixture(t),a=new Peer('session-A'),b=new Peer('session-B');
  service.submit(a,input('a1'));service.submit(b,input('b1'));await tick();
  service.submit(a,input('a2','a2','queue'));service.submit(a,input('a3','a3','queue'));service.submit(b,input('b2','b2','queue'));
  a.complete();await waitFor(()=>a.calls.length===2);assert.equal(b.calls.length,1);
  assert.equal(a.calls[1].text,'a2');assert.equal(service.state('session-B').items[1].text,'b2');
  b.complete();await waitFor(()=>b.calls.length===2);a.complete();await waitFor(()=>a.calls.length===3);
  a.complete();b.complete();await waitFor(()=>!service.state('session-A').busy&&!service.state('session-B').busy);
  assert.equal(service.state('session-A').items.length,0);assert.equal(service.state('session-B').items.length,0);
});

test('accept persists encoded attachments before model invocation; duplicate id is not sent twice',async t=>{
  const {service,root}=fixture(t),a=new Peer('session-A');
  const request={...input('image','stable'),images:[{data:'cGljdHVyZQ==',mimeType:'image/png'}]};
  const response=service.submit(a,request);assert.equal(response.accepted,true);assert.equal(a.calls.length,0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'session-A.json'),'utf8')).items[0].images[0].data,'cGljdHVyZQ==');
  service.submit(a,request);await tick();assert.equal(a.calls.length,1);a.complete();await waitFor(()=>!service.state('session-A').busy);
  assert.equal(service.submit(a,request).duplicate,true);await tick();assert.equal(a.calls.length,1);
  assert.throws(()=>service.submit(a,{...request,text:'other'}),/不同内容/);
});

test('ordinary RPC failure retains failed body and pauses FIFO; edit/retry does not mutate other session',async t=>{
  const {service}=fixture(t),a=new Peer('session-A'),b=new Peer('session-B');service.submit(a,input('first'));service.submit(b,input('other'));await tick();
  service.submit(a,input('later','later','queue'));a.reject(Object.assign(new Error('rate limited'),{code:429}));
  await waitFor(()=>service.state('session-A').items[0].status==='failed');assert.equal(a.calls.length,1);assert.equal(service.state('session-A').paused,true);
  service.mutate('session-A','edit',{id:'first',text:'edited'});service.mutate('session-A','retry',{id:'first'});
  await waitFor(()=>a.calls.length===2);assert.equal(a.calls[1].text,'edited');a.complete();await waitFor(()=>a.calls.length===3);a.complete();b.complete();
  await waitFor(()=>!service.state('session-A').busy);assert.equal(b.calls.length,1);
});

test('stop is scoped, keeps unsent rows paused; explicit now cancels only the target and preserves FIFO',async t=>{
  const {service}=fixture(t),a=new Peer('session-A'),b=new Peer('session-B');service.submit(a,input('old'));service.submit(b,input('b'));await tick();
  service.submit(a,input('later','later','queue'));service.stop('session-A');await waitFor(()=>!service.state('session-A').busy);
  assert.equal(service.state('session-A').items.find(i=>i.id==='old').status,'cancelled');assert.equal(service.state('session-B').busy,true);assert.equal(a.calls.length,1);
  service.mutate('session-A','now',{id:'later'});await waitFor(()=>a.calls.length===2);service.submit(a,input('priority','priority','now'));
  await waitFor(()=>a.calls.length===3);assert.equal(a.calls[2].text,'priority');a.complete();b.complete();await tick();
  assert.throws(()=>service.mutate('session-A','retry',{id:'old'}),/明确确认/);
});

test('app restart exposes unknown sent outcomes without replay, and queued entries need explicit resume',async t=>{
  const {root,service}=fixture(t),a=new Peer('session-A');service.submit(a,input('first'));await tick();service.submit(a,input('later','later','queue'));
  // A new service is a new main process; original test peer remains deliberately unacknowledged.
  const next=createSessionDelivery(root),reopened=new Peer('session-A');const state=next.bind(reopened);await tick();
  assert.equal(state.paused,true);assert.equal(state.items[0].status,'uncertain');assert.equal(reopened.calls.length,0);
  next.mutate('session-A','resume');await waitFor(()=>reopened.calls.length===1);assert.equal(reopened.calls[0].text,'later');reopened.complete();await tick();
  assert.throws(()=>next.mutate('session-A','now',{id:'first'}),/明确确认/);
  a.complete();await tick();
});

test('interject uses one native path and real errors never quietly become queued prompts',async t=>{
  const {service,events}=fixture(t),a=new Peer('session-A');service.submit(a,input('first'));await tick();service.submit(a,input('correction'));await tick();
  assert.equal(a.interjections.length,1);assert.equal(a.calls.length,1);assert.equal(service.state('session-A').items.find(i=>i.id==='correction').status,'interjected');
  service.stop('session-A');await waitFor(()=>!service.state('session-A').busy);
  assert.equal(service.state('session-A').items.find(i=>i.id==='correction').status,'uncertain');assert.ok(events.some(e=>e.type==='started'&&e.method==='interject'));
});

test('unsupported interject alone falls back to FIFO and a cancelled turn does not reset another owner',async t=>{
  const {service}=fixture(t),a=new Peer('session-A');a.interjectResult={ok:false,reason:'unsupported'};
  service.submit(a,input('first'));await tick();service.submit(a,input('later'));await tick();assert.equal(service.state('session-A').items.find(i=>i.id==='later').status,'queued');
  a.complete();await waitFor(()=>a.calls.length===2);assert.equal(a.calls[1].text,'later');a.complete();await tick();
});

test('durable edit, reorder, remove and same-ID receipt survive a new store',async t=>{
  const {service,root}=fixture(t),a=new Peer('session-A');service.submit(a,input('live'));await tick();
  for(const text of ['q1','q2','q3'])service.submit(a,input(text,text,'queue'));
  service.mutate('session-A','move',{id:'q3',direction:-1});service.mutate('session-A','edit',{id:'q2',text:'corrected'});service.mutate('session-A','remove',{id:'q1'});
  const saved=createSessionOutbox(root).read('session-A');assert.deepEqual(saved.items.filter(i=>i.status==='queued').map(i=>i.text),['q3','corrected']);
  service.stop('session-A');await tick();
});

test('failed disk writes refuse acceptance; corrupt original is never replaced',async t=>{
  const {root}=fixture(t);let blocked=false;
  const service=createSessionDelivery(root,{write(file,value){if(blocked)throw new Error('ENOSPC');atomicWrite(file,value);}}),a=new Peer('session-A');service.bind(a);blocked=true;
  assert.throws(()=>service.submit(a,input('keep draft')),/ENOSPC/);assert.equal(a.calls.length,0);assert.equal(service.state('session-A').items.length,0);
  fs.writeFileSync(path.join(root,'session-B.json'),'{broken');assert.throws(()=>service.state('session-B'),/损坏/);assert.equal(fs.readFileSync(path.join(root,'session-B.json'),'utf8'),'{broken');await tick();
});

test('compact prep, native compact and catch-up run on one captured session; user input wins',async t=>{
  const {service}=fixture(t),a=new Peer('session-A');service.submit(a,{...input('ignored','prep'),purpose:'compact'});await tick();
  assert.equal(a.calls[0].text,'/compact-prep');assert.equal(a.calls[0].opts.origin,'followup');
  a.complete();await waitFor(()=>a.calls.length===2);assert.match(a.compacted,/Continuation Capsule/);assert.match(a.calls[1].text,/^Catch up/);a.complete();await waitFor(()=>!service.state('session-A').busy);
  service.submit(a,{...input('ignored','prep2'),purpose:'compact'});await tick();service.submit(a,input('user-next','user-next','queue'));a.complete();await waitFor(()=>a.calls.length===4);
  assert.equal(a.calls[3].text,'user-next');a.complete();await tick();
});

test('two accepts before the first IPC turn starts preserve the first submission order',async t=>{
  const {service}=fixture(t),a=new Peer('session-A');
  // Native Grok reports turn-ended if the immediate interject reaches it before prompt.
  a.interject=async()=>({ok:false,reason:'turn-ended'});
  service.submit(a,input('first'));service.submit(a,input('second'));await waitFor(()=>a.calls.length===1);
  assert.equal(a.calls[0].text,'first');a.complete();await waitFor(()=>a.calls.length===2);assert.equal(a.calls[1].text,'second');a.complete();await tick();
});

test('real interject rejection pauses without enqueue fallback or cancelling a live parent',async t=>{
  const {service}=fixture(t),a=new Peer('session-A');a.interject=async()=>{throw Object.assign(new Error('permission denied'),{code:-32003});};
  service.submit(a,input('first'));await tick();service.submit(a,input('correction'));await tick();
  assert.equal(service.state('session-A').items.find(i=>i.id==='correction').status,'failed');assert.equal(a.calls.length,1);assert.equal(a.turnOpen,true);
  a.complete();await tick();assert.equal(a.calls.length,1);
});

test('stop before the deferred first send and cold-start before first send never bypass pause',async t=>{
  const {root,service}=fixture(t),a=new Peer('session-A');service.submit(a,input('first'));service.stop('session-A');await tick();assert.equal(a.calls.length,0);
  service.submit(a,input('new-explicit'));await waitFor(()=>a.calls.length===1);assert.equal(a.calls[0].text,'new-explicit');a.complete();await tick();assert.equal(a.calls.length,1);
  const cold=createSessionDelivery(root),fresh=new Peer('session-A');cold.bind(fresh);await tick();assert.equal(fresh.calls.length,0);
});
test('cold start immediately after durable accept still pauses a never-started priority row',async t=>{
  const {root,service}=fixture(t),a=new Peer('session-A');service.submit(a,input('accepted'));
  // Restore before the old event-loop tick, then prevent the obsolete process's test peer from acting.
  a.ready=false;const cold=createSessionDelivery(root),fresh=new Peer('session-A');cold.bind(fresh);await tick();assert.equal(fresh.calls.length,0);assert.equal(cold.state('session-A').paused,true);
});
