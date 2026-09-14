/** Explicit, object-level transfer. Hash-linked checkpoints, never mtime voting. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { KINDS, STATUSES, EPISTEMIC, ensureStore, ensureObject, objectDir, readCurrent, readRecords, listObjects } from './store.mjs';
import { isSafeObjectId, resolveKnowledgeRoot } from './paths.mjs';
import { OBJECT_FILES, writeSyncJson, recoverObjectTransfer, replaceObject } from './object-transaction.mjs';
const LIMIT=128*1024*1024, FORMAT='grok-desktop-working-knowledge-v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const json=value=>JSON.stringify(value)+'\n';
function canonical(value) {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const sha=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
function readJson(file,fallback) {if(!fs.existsSync(file))return fallback;if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>LIMIT)throw new Error('接续文件过大或为链接，未读取。');return JSON.parse(fs.readFileSync(file,'utf8'));}
function jsonl(file) {if(!fs.existsSync(file))return [];if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>LIMIT)throw new Error('对象记录过大或为链接，未读取。');return fs.readFileSync(file,'utf8').split('\n').filter(line=>line.trim()).map(JSON.parse);}
function assertData(data) {
  const id=data?.meta?.id;
  if(!isSafeObjectId(id)||data.meta.test||typeof data.meta.title!=='string'||data.meta.title.length>1000)throw new Error('这不是可接入的正式工作认识对象。');
  for(const key of ['records','inbox','commits'])if(!Array.isArray(data[key])||data[key].length>100000)throw new Error('接续记录集合不完整或过大。');
  for(const r of data.records)if(r?.objectId!==id||typeof r.id!=='string'||!r.id||typeof r.text!=='string'||!KINDS.includes(r.kind)||!STATUSES.includes(r.status)||!EPISTEMIC.includes(r.epistemic))throw new Error('接续认识记录无效，未覆盖本机。');
  for(const r of data.inbox)if(r?.objectId!==id||typeof r.id!=='string'||!r.id||typeof r.text!=='string'||!STATUSES.includes(r.status))throw new Error('接续原话记录无效，未覆盖本机。');
  const c=data.current;
  if(c?.objectId!==id||!Number.isSafeInteger(c.version)||c.version<0||!Array.isArray(c.items))throw new Error('接续当前版本无效。');
  const latest=new Map(data.records.map(r=>[r.id,r]));
  const active=[...latest.values()].filter(r=>!r.test&&!['withdrawn','superseded'].includes(r.status)&&r.kind!=='utterance');
  if(new Set(c.items.map(r=>r.id)).size!==c.items.length||active.length!==c.items.length||active.some(r=>!c.items.some(i=>i.id===r.id&&hash(i)===hash(r))))throw new Error('接续当前认识与历史不一致，保留原件，不自动拼补。');
  return data;
}
function dataFiles(data) {return {'object.json':json(data.meta),'records.jsonl':data.records.map(json).join(''),'inbox.jsonl':data.inbox.map(json).join(''),'commits.jsonl':data.commits.map(json).join(''),'current.json':json(data.current)};}
function readData(root,id) {
  recoverObjectTransfer(root,id);ensureObject(root,id);
  const dir=objectDir(root,id);
  const data={meta:readJson(path.join(dir,'object.json'),null),records:jsonl(path.join(dir,'records.jsonl')),inbox:jsonl(path.join(dir,'inbox.jsonl')),commits:jsonl(path.join(dir,'commits.jsonl')),current:readCurrent(root,id)};
  return assertData(data);
}
function node(id,parents,data) {const value={objectId:id,parents:[...new Set(parents)].sort(),dataHash:hash(data)};return {id:hash(value),...value};}
function validateGraph(id,graph,head) {
  if(!Array.isArray(graph)||graph.length>10000||!graph.length)throw new Error('接续版本关系缺失或过大。');
  const map=new Map();
  for(const n of graph) {
    if(n?.objectId!==id||!sha(n.id)||!sha(n.dataHash)||!Array.isArray(n.parents)||n.parents.length>2||n.parents.some(p=>!sha(p))||n.id!==hash({objectId:id,parents:n.parents,dataHash:n.dataHash})||map.has(n.id))throw new Error('接续版本关系校验失败。');
    map.set(n.id,n);
  }
  if(!map.has(head))throw new Error('接续当前节点缺失。');
  // Iterative topological validation: long legitimate histories cannot overflow the stack.
  const pending=new Map(),children=new Map(),ready=[];
  for(const n of map.values()) {
    if(n.parents.some(p=>!map.has(p)))throw new Error('接续版本关系断裂。');
    pending.set(n.id,n.parents.length);if(!n.parents.length)ready.push(n.id);
    for(const p of n.parents)children.set(p,[...(children.get(p)||[]),n.id]);
  }
  let visited=0;while(ready.length){const n=ready.pop();visited++;for(const child of children.get(n)||[]){pending.set(child,pending.get(child)-1);if(!pending.get(child))ready.push(child);}}
  if(visited!==map.size)throw new Error('接续版本关系循环。');
  return map;
}
function ancestor(id,head,map) {const todo=[head],seen=new Set();while(todo.length){const cur=todo.pop();if(cur===id)return true;if(seen.has(cur))continue;seen.add(cur);todo.push(...(map.get(cur)?.parents||[]));}return false;}
function checkpoint(root,id) {
  const data=readData(root,id),dir=objectDir(root,id),file=path.join(dir,'sync.json');
  const saved=readJson(file,{schema:1,head:null,nodes:[],epoch:null});
  if(saved.schema!==1||!Array.isArray(saved.nodes))throw new Error('本机接续关系损坏，未重建或覆盖。');
  if(saved.head)validateGraph(id,saved.nodes,saved.head);
  let state=saved;
  if(!saved.head||saved.nodes.find(n=>n.id===saved.head)?.dataHash!==hash(data)) {
    const next=node(id,saved.head?[saved.head]:[],data);
    state={...saved,head:next.id,nodes:[...saved.nodes,next]};
    validateGraph(id,state.nodes,state.head);writeSyncJson(file,state);
  }
  // Empty legacy commit history participates in the recoverable object swap.
  if(!fs.existsSync(path.join(dir,'commits.jsonl')))fs.writeFileSync(path.join(dir,'commits.jsonl'),'');
  return {data,state};
}
export function exportWorkingObject(root,id,{machine=os.hostname()}={}) {
  if(!isSafeObjectId(id))throw new Error('请先选择要带走的业务对象。');
  if(!listObjects(root).some(o=>o.id===id))throw new Error('业务对象不存在。');
  const {data,state}=checkpoint(root,id);
  const bundle={format:FORMAT,objectId:id,sourceMachine:String(machine),exportedAt:new Date().toISOString(),head:state.head,nodes:state.nodes,data};
  bundle.integrity=hash(bundle);
  return validateWorkingBundle(bundle);
}
export function validateWorkingBundle(raw) {
  if(!raw||raw.format!==FORMAT||typeof raw.integrity!=='string')throw new Error('不是本产品的工作认识接续包。');
  if(Buffer.byteLength(JSON.stringify(raw))>LIMIT)throw new Error('接续包过大，原件未改写。');
  const {integrity,...body}=raw;if(hash(body)!==integrity)throw new Error('接续包校验失败，未读取为当前认识。');
  assertData(raw.data);if(raw.objectId!==raw.data.meta.id)throw new Error('接续业务对象不一致。');
  const graph=validateGraph(raw.objectId,raw.nodes,raw.head);if(graph.get(raw.head).dataHash!==hash(raw.data))throw new Error('接续内容与版本节点不一致。');
  return clone(raw);
}
function incomingPath(root,token) {if(!/^[a-f0-9-]{36}$/.test(token||''))throw new Error('无效的接续记录。');return path.join(resolveKnowledgeRoot(root),'transfer-incoming',token+'.json');}
export function stageWorkingBundle(root,bundle) {
  ensureStore(root);bundle=validateWorkingBundle(bundle);const token=randomUUID();writeSyncJson(incomingPath(root,token),{bundle,state:'pending'});return previewWorkingBundle(root,token);
}
export function listPendingWorkingBundles(root) {
  const dir=path.join(resolveKnowledgeRoot(root),'transfer-incoming');if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>{const token=name.slice(0,-5);const row=readJson(path.join(dir,name),null);return row?.state==='pending'?{token,objectId:row.bundle?.objectId,title:row.bundle?.data?.meta?.title,sourceMachine:row.bundle?.sourceMachine}:null;}).filter(Boolean);
}
function pendingCount(rows) {return [...new Map(rows.map(r=>[r.id,r])).values()].filter(r=>r.status==='pending'&&!r.test).length;}
function differences(local,other) {
  const left=new Map((local?.current.items||[]).map(r=>[r.id,r])),right=new Map(other.current.items.map(r=>[r.id,r]));
  return [...new Set([...left.keys(),...right.keys()])].filter(id=>hash(left.get(id)||null)!==hash(right.get(id)||null)).map(id=>({id,local:left.get(id)||null,incoming:right.get(id)||null}));
}
export function previewWorkingBundle(root,token) {
  const incoming=readJson(incomingPath(root,token),null);if(incoming?.state!=='pending')throw new Error('这份接续已处理或不存在。');
  const b=validateWorkingBundle(incoming.bundle),id=b.objectId;
  const found=listObjects(root).some(o=>o.id===id),local=found?checkpoint(root,id):null;
  const combined=new Map([...(local?.state.nodes||[]),...b.nodes].map(n=>[n.id,n]));
  const kind=!local?'new':local.state.head===b.head?'equal':ancestor(b.head,local.state.head,combined)?'local-ahead':ancestor(local.state.head,b.head,combined)?'incoming-ahead':'conflict';
  return {token,objectId:id,title:b.data.meta.title,localTitle:local?.data.meta.title||null,sourceMachine:b.sourceMachine,kind,localHead:local?.state.head||null,incomingHead:b.head,changes:differences(local?.data,b.data),localPending:local?pendingCount(local.data.inbox):0,incomingPending:pendingCount(b.data.inbox),exportedAt:b.exportedAt};
}
export function acceptWorkingBundle(root,{token,localHead,choice},{afterBackup}={}) {
  const plan=previewWorkingBundle(root,token);
  if(localHead!==plan.localHead)throw new Error('预览后本机认识又有更新，请重新查看差异；两版都还在。');
  if(!['keep-local','use-incoming','continue'].includes(choice))throw new Error('请明确选择接续版本。');
  if(plan.kind==='conflict'&&choice==='continue')throw new Error('两台都有独立更新，请先选择保留哪一版，不能自动覆盖。');
  if(plan.kind==='local-ahead'&&choice!=='keep-local')throw new Error('带来的版本已经包含在本机历史中，不能回退当前纠正。');
  const file=incomingPath(root,token),staged=readJson(file,null),b=validateWorkingBundle(staged.bundle),id=b.objectId;
  if(['equal','local-ahead'].includes(plan.kind)||(!plan.localHead&&choice==='keep-local')) {
    writeSyncJson(file,{...staged,state:'resolved',choice});return {ok:true,changed:false,objectId:id};
  }
  const local=plan.localHead?checkpoint(root,id):null;
  let data=choice==='keep-local'?clone(local.data):clone(b.data);
  let nodes=[...new Map([...(local?.state.nodes||[]),...b.nodes].map(n=>[n.id,n])).values()],head=b.head;
  if(plan.kind==='conflict'||choice==='keep-local') {
    data.current.version=Math.max(local?.data.current.version||0,b.data.current.version)+1;
    const merged=node(id,[local.state.head,b.head],data);nodes.push(merged);head=merged.id;
  }
  const state={schema:1,nodes,head,epoch:randomUUID(),resolution:{choice,incoming:b.head,local:plan.localHead,at:new Date().toISOString()}};
  validateGraph(id,nodes,head);
  const result=replaceObject(root,id,{...dataFiles(data),'sync.json':json(state)},{afterBackup});
  writeSyncJson(file,{...staged,state:'resolved',choice,result});
  return {ok:true,changed:true,objectId:id,head,...result};
}
