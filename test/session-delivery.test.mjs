import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSessionDelivery, createSessionOutbox, atomicWrite, isUnknownDeliveryOutcome, notifySessionDelivery, windowShowsDelivery } from '../electron/session-delivery.mjs';
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

test('browser reference survives the outbox and is revalidated immediately before delivery',async t=>{
  let currentPage='page-1';
  const {service}=fixture(t,{validateBrowserReference(ref){if(ref&&ref.pageId!==currentPage)throw new Error('引用的浏览器页面已经跳转，请重新点 @浏览器');}});
  const a=new Peer('session-A'),ref={version:1,kind:'owned-preview',sessionId:'session-A',leaseId:'lease-1',pageId:'page-1',title:'Page',displayUrl:'https://example.test',capturedAt:1};
  service.submit(a,{...input('inspect page','browser-send','queue'),browserReference:ref});
  assert.deepEqual(service.state('session-A').items[0].browserReference,ref);
  currentPage='page-2';service.mutate('session-A','resume');
  await waitFor(()=>service.state('session-A').items[0].status==='failed');
  assert.equal(a.calls.length,0);assert.match(service.state('session-A').items[0].error,/重新点 @浏览器/);
});

test('browser context is opt-in and travels outside the stored user text',async t=>{
  const {service}=fixture(t,{validateBrowserReference:ref=>ref}),a=new Peer('session-A');
  const ref={version:1,kind:'owned-preview',sessionId:'session-A',leaseId:'lease-1',pageId:'page-1',title:'Page',displayUrl:'https://example.test',capturedAt:1};
  service.submit(a,{...input('with browser','with-browser'),browserReference:ref});await waitFor(()=>a.calls.length===1);
  assert.equal(a.calls[0].text,'with browser');assert.deepEqual(a.calls[0].opts.browserReference,ref);
  a.complete();await waitFor(()=>!service.state('session-A').busy);
  service.submit(a,input('plain prompt','plain'));await waitFor(()=>a.calls.length===2);
  assert.equal(a.calls[1].opts.browserReference,undefined);a.complete();await tick();
});

test('a failed browser row can refresh or remove only its reference while preserving user text',async t=>{
  const {service}=fixture(t,{validateBrowserReference:ref=>{if(ref?.leaseId==='old')throw new Error('stale browser');return ref;}}),a=new Peer('session-A');
  const oldRef={version:1,kind:'owned-preview',sessionId:'session-A',leaseId:'old',pageId:'old',title:'Old',displayUrl:'https://old.test',capturedAt:1};
  const newRef={...oldRef,leaseId:'new',pageId:'new',title:'New',displayUrl:'https://new.test'};
  service.submit(a,{...input('keep my exact words','refresh-row'),browserReference:oldRef});
  await waitFor(()=>service.state('session-A').items[0]?.status==='failed');
  assert.equal(a.calls.length,0);
  service.mutate('session-A','refresh-browser-reference',{id:'refresh-row',browserReference:newRef});
  let row=service.state('session-A').items[0];assert.equal(row.text,'keep my exact words');assert.deepEqual(row.browserReference,newRef);
  service.mutate('session-A','remove-browser-reference',{id:'refresh-row'});row=service.state('session-A').items[0];
  assert.equal(row.text,'keep my exact words');assert.equal(row.browserReference,undefined);
});

test('changing browser references cannot silently replay uncertain or cancelled requests',async t=>{
  for (const expected of ['uncertain','cancelled']) {
    const {service}=fixture(t,{validateBrowserReference:ref=>ref}),a=new Peer('session-A');
    const ref={version:1,kind:'owned-preview',sessionId:'session-A',leaseId:'lease-1',pageId:'page-1',displayUrl:'https://example.test'};
    service.submit(a,{...input('preserve result boundary','boundary'),browserReference:ref});
    await waitFor(()=>a.calls.length===1);
    if(expected==='uncertain')a.reject(new Error('connection closed'));else service.stop('session-A');
    await waitFor(()=>service.state('session-A').items[0]?.status===expected);
    service.mutate('session-A','refresh-browser-reference',{id:'boundary',browserReference:{...ref,pageId:'page-2'}});
    assert.equal(service.state('session-A').items[0].status,expected);
    service.mutate('session-A','remove-browser-reference',{id:'boundary'});
    assert.equal(service.state('session-A').items[0].status,expected);
    service.mutate('session-A','resume');await tick();
    assert.equal(a.calls.length,1);
    assert.throws(()=>service.mutate('session-A','retry',{id:'boundary'}),/明确确认/);
  }
});

test('real interject rejection pauses without enqueue fallback or cancelling a live parent',async t=>{
  const {service}=fixture(t),a=new Peer('session-A');a.interject=async()=>{throw Object.assign(new Error('permission denied'),{code:-32003});};
  service.submit(a,input('first'));await tick();service.submit(a,input('correction'));await tick();
  assert.equal(service.state('session-A').items.find(i=>i.id==='correction').status,'failed');assert.equal(a.calls.length,1);assert.equal(a.turnOpen,true);
  a.complete();await tick();assert.equal(a.calls.length,1);
});

test('lost interject receipts stay uncertain with original text and require an explicit retry',async t=>{
  assert.equal(isUnknownDeliveryOutcome(Object.assign(new Error('timeout'),{code:'ACP_REQUEST_TIMEOUT'})),true);
  assert.equal(isUnknownDeliveryOutcome(new Error('Agent exited (code=null, signal=SIGTERM)')),true);
  assert.equal(isUnknownDeliveryOutcome(new Error('connection closed')),true);
  assert.equal(isUnknownDeliveryOutcome(new Error('Agent disposed')),true);
  assert.equal(isUnknownDeliveryOutcome(new Error('permission denied')),false);
  const cases=[{message:'connection closed'},{message:'Agent process exited',code:'EPIPE'},{message:'rpc failed',code:'ACP_REQUEST_TIMEOUT'}];
  for(const [index,lost] of cases.entries()){
    const {service}=fixture(t),a=new Peer('session-lost-'+index);
    service.submit(a,input('first'));await tick();
    a.interject=async()=>{throw Object.assign(new Error(lost.message),lost.code?{code:lost.code}:{})};
    service.submit(a,input('keep-this','keep-this'));
    await waitFor(()=>service.state(a.sessionId).items.find(i=>i.id==='keep-this')?.status==='uncertain');
    const row=service.state(a.sessionId).items.find(i=>i.id==='keep-this');
    assert.equal(row.text,'keep-this');
    assert.match(row.error,/确认没有回来|查看历史/);
    assert.throws(()=>service.mutate(a.sessionId,'retry',{id:'keep-this'}),/明确确认/);
    a.complete();await tick();
  }
});

test('delivery events only go to the window currently showing that conversation and omit queued image bytes',async t=>{
  const {service,events}=fixture(t),a=new Peer('session-A'),b=new Peer('session-B');
  const picture={data:'A'.repeat(8000),mimeType:'image/png',id:'pic',name:'large.png'};
  service.submit(a,{...input('with-image','with-image'),images:[picture]});await tick();
  a.complete();await waitFor(()=>!service.state('session-A').busy);
  const started=events.find(e=>e.type==='started'&&e.sessionId==='session-A');
  assert.equal(started.row.images[0].data,picture.data);
  assert.equal(started.state.items[0].images[0].data,undefined);
  assert.equal(started.state.items[0].images[0].attached,true);
  const shownA={agent:a,lastSessionId:'session-A'},shownB={agent:b,lastSessionId:'session-B'},parked={agent:b,lastSessionId:'session-B',parkedAgents:new Map([['session-A',a]])};
  assert.equal(windowShowsDelivery(shownA,'session-A'),true);
  assert.equal(windowShowsDelivery(shownB,'session-A'),false);
  assert.equal(windowShowsDelivery(parked,'session-A'),false);
  const hits=[];
  notifySessionDelivery(started,[shownA,shownB,parked],ws=>hits.push(ws));
  assert.deepEqual(hits,[shownA]);
  const packed=JSON.stringify(started.state);
  assert.equal(packed.includes(picture.data),false);
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
