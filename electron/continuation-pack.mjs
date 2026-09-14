/** One explicitly selected native conversation plus selected project materials.
 * No remote commands, credentials, blanket home copy, timestamp voting or auto-send.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {encodeSessionCwd,isSafeSessionId} from './sessions.mjs';
import {resolveMovedSessionCwd} from './session-move.mjs';
import {storedAliasSessions} from './session-paths.mjs';
import {atomicWrite,assertSessionOutbox} from './session-delivery.mjs';
const FORMAT='grok-desktop-continuation-v1', LIMIT=128*1024*1024;
const CORE=new Set(['summary.json','updates.jsonl','chat_history.jsonl','plan.json','rewind_points.jsonl','signals.json','feedback.jsonl','desktop-continuation.json','tasks.json']);
const NATIVE_DIRS=new Set(['attachments','compaction_checkpoints','subagents','mcp']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const exists=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export function safeMaterialPath(name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes('\0')||/^[A-Za-z]:/.test(name)||path.posix.isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('资料路径越界，原件未改动。');
  const parts=name.toLowerCase().split('/');
  if(parts.some(p=>p.startsWith('.env')||/^\.(git|ssh|aws|azure|grok|claude|cursor)$/.test(p)||/^(node_modules|target|release|dist|cookies|login data|keychains|auth\.json|mcp_credentials\.json|trusted_folders\.toml)$/.test(p)||/\.(pem|key|p12|pfx|keychain-db)$/.test(p)||/^id_(rsa|ed25519)/.test(p)))throw Error(`这类配置、凭据或依赖不参加资料接续：${name}`);
  return name;
}
function safeUnder(root,name){
  safeMaterialPath(name);let current=path.resolve(root);
  if(!fs.statSync(current).isDirectory())throw Error('资料根目录不存在。');
  for(const part of name.split('/')){current=path.join(current,part);if(exists(current)&&fs.lstatSync(current).isSymbolicLink())throw Error(`资料包含符号链接，未跟随：${name}`);}
  return current;
}
function fileRow(root,name){const file=safeUnder(root,name),stat=fs.statSync(file);if(!stat.isFile()||stat.size>LIMIT)throw Error(`资料不是普通文件或过大：${name}`);const bytes=fs.readFileSync(file);return {path:name,sha256:hash(bytes),data:bytes.toString('base64')};}
function walk(root,dir='',filter=()=>true){
  const rows=[];for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=dir?`${dir}/${e.name}`:e.name;if(!filter(name,e))continue;if(e.isSymbolicLink())throw Error(`接续范围含有符号链接，请另选原件：${name}`);if(e.isDirectory())rows.push(...walk(root,name,filter));else rows.push(fileRow(root,name));}return rows;
}
function nativeRows(dir){return walk(dir,'',(name)=>name.includes('/')?NATIVE_DIRS.has(name.split('/')[0]):CORE.has(name)||NATIVE_DIRS.has(name));}
function contentHash(rows){return hash(JSON.stringify(rows.map(r=>[r.path,r.sha256]).sort(([a],[b])=>a.localeCompare(b))));}
function activeOutbox(root,id){const f=path.join(root,'outbox',id+'.json');if(!exists(f))return null;const value=JSON.parse(fs.readFileSync(f,'utf8'));return assertSessionOutbox(value,id);}
function targetDir(home,cwd,id){if(!isSafeSessionId(id)||!path.isAbsolute(cwd||''))throw Error('对话和项目归属不完整。');return path.join(home,'sessions',encodeSessionCwd(cwd),id);}
export function exportContinuation({home,userData,cwd,sessionId,materials=[],flow=null,version=null}){
  cwd=resolveMovedSessionCwd(cwd,sessionId,home);const dir=targetDir(home,cwd,sessionId);
  if(!exists(dir)||fs.lstatSync(dir).isSymbolicLink())throw Error('找不到原生会话，未生成空的接续包。');
  const native=nativeRows(dir),files=[];
  if(!native.some(r=>r.path==='summary.json')||!native.some(r=>r.path==='updates.jsonl'))throw Error('原生会话记录不完整。');
  // Selecting a folder explicitly includes its ordinary descendants, never a symlink target.
  for(const rel of materials){const file=safeUnder(cwd,rel);if(fs.statSync(file).isDirectory())files.push(...walk(cwd,rel));else files.push(fileRow(cwd,rel));}
  const unique=[...new Map(files.map(f=>[f.path,f])).values()];
  assertNotProductSource(cwd,unique);
  const outbox=activeOutbox(userData,sessionId);
  const bundle={format:FORMAT,transferId:randomUUID(),sourceCwd:cwd,sourceNative:dir,sessionId,version,native,materials:unique,flow:clone(flow),outbox,createdAt:new Date().toISOString()};
  // A live CLI title/tool write during capture invalidates this snapshot rather than truncating history.
  if(contentHash(nativeRows(dir))!==contentHash(native))throw Error('原生会话正在变化，请结束本轮后重新导出。');
  bundle.integrity=hash(JSON.stringify(bundle));return validateContinuation(bundle);
}
function validateRows(rows,native=false){
  if(!Array.isArray(rows)||rows.length>20000)throw Error('接续文件列表不完整或过多。');const names=new Set();
  for(const row of rows){safeMaterialPath(row?.path);if(names.has(row.path))throw Error('接续包有重复路径。');names.add(row.path);
    if(native&&!CORE.has(row.path)&&!NATIVE_DIRS.has(row.path.split('/')[0]))throw Error('不是受支持的原生会话文件。');
    if(typeof row.data!=='string'||Buffer.from(row.data,'base64').toString('base64')!==row.data||hash(Buffer.from(row.data,'base64'))!==row.sha256)throw Error('接续文件内容校验失败。');
  }
}
export function validateContinuation(input){
  if(!input||input.format!==FORMAT||!isSafeSessionId(input.sessionId)||!path.isAbsolute(input.sourceCwd||'')||!path.isAbsolute(input.sourceNative||''))throw Error('不是兼容的会话接续包。');
  const {integrity,...body}=input;if(Buffer.byteLength(JSON.stringify(input))>LIMIT||hash(JSON.stringify(body))!==integrity)throw Error('接续包过大或完整性校验失败。');
  validateRows(input.native,true);validateRows(input.materials);
  const summary=input.native.find(r=>r.path==='summary.json');const meta=summary&&JSON.parse(Buffer.from(summary.data,'base64').toString());
  if(!meta?.info||typeof meta.info.cwd!=='string'||!input.native.some(r=>r.path==='updates.jsonl'))throw Error('原生摘要或历史缺失。');
  if(input.flow!==null&&(typeof input.flow!=='object'||Array.isArray(input.flow)))throw Error('草稿格式无效。');
  if(input.outbox)assertSessionOutbox(input.outbox,input.sessionId);
  return clone(input);
}
function carryRoot(userData){const root=path.join(userData,'continuation-packs');fs.mkdirSync(root,{recursive:true,mode:0o700});return root;}
function slot(userData,token){if(!/^[a-f0-9-]{36}$/.test(token||''))throw Error('无效接续标识。');return path.join(carryRoot(userData),token);}
function nativeCandidate(home,cwd,id){const rows=storedAliasSessions(home,cwd,id).filter(r=>!r.alias);if(rows.length>1)throw Error('同一项目别名下有多个同 ID 原件，请先核对。');return rows[0]||{cwd,file:targetDir(home,cwd,id)};}
function assertNotProductSource(cwd,rows){
  const p=path.join(cwd,'package.json');if(rows.length&&exists(p)){let meta;try{meta=JSON.parse(fs.readFileSync(p,'utf8'));}catch{}if(meta?.name==='grok-desktop')throw Error('Grok Desktop 源码只按 Git 提交接续，不能经资料包覆盖。');}
}
function actualHash(file){if(!exists(file))return null;if(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw Error('目标路径不是普通文件，未覆盖。');return hash(fs.readFileSync(file));}
function localSnapshot(home,userData,cwd,bundle){
  const target=nativeCandidate(home,cwd,bundle.sessionId),native=exists(target.file)?nativeRows(target.file):[];
  assertNotProductSource(cwd,bundle.materials);
  const root=path.join(home,'sessions');
  if(exists(root))for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(!entry.isDirectory())continue;const candidate=path.join(root,entry.name,bundle.sessionId);if(exists(candidate)&&!fs.lstatSync(candidate).isSymbolicLink()&&candidate!==target.file)throw Error('本机同 ID 对话已在另一个项目，未创建第二份原生身份；请选择它现有的项目。');}

  const materials=bundle.materials.map(row=>({path:row.path,sha256:actualHash(safeUnder(cwd,row.path))}));
  const outbox=activeOutbox(userData,bundle.sessionId);
  return {target,nativeHash:native.length?contentHash(native):null,materials,outboxHash:hash(JSON.stringify(outbox))};
}
export function stageContinuation({home,userData,bundle,cwd}){
  bundle=validateContinuation(bundle);cwd=path.resolve(cwd);if(!fs.statSync(cwd).isDirectory())throw Error('目标项目不存在。');
  const token=randomUUID(),dir=slot(userData,token);fs.mkdirSync(dir);atomicWrite(path.join(dir,'incoming.json'),bundle);atomicWrite(path.join(dir,'request.json'),{cwd});
  return previewContinuation({home,userData,token});
}
export function previewContinuation({home,userData,token}){
  const dir=slot(userData,token),bundle=validateContinuation(JSON.parse(fs.readFileSync(path.join(dir,'incoming.json'),'utf8'))),{cwd}=JSON.parse(fs.readFileSync(path.join(dir,'request.json'),'utf8'));
  const current=localSnapshot(home,userData,cwd,bundle);
  const conflicts=current.materials.filter(r=>r.sha256!==null&&r.sha256!==bundle.materials.find(b=>b.path===r.path).sha256).map(r=>r.path);
  const nativeConflict=current.nativeHash!==null&&current.nativeHash!==contentHash(bundle.native);
  return {token,cwd:current.target.cwd,sessionId:bundle.sessionId,title:JSON.parse(Buffer.from(bundle.native.find(r=>r.path==='summary.json').data,'base64').toString()).generated_title||'带来的对话',sourceCwd:bundle.sourceCwd,nativeFiles:bundle.native.length,materialFiles:bundle.materials.map(r=>r.path),nativeConflict,conflicts,hasDraft:Boolean(bundle.flow?.draft),pendingSends:bundle.outbox?.items.filter(r=>!['done','dismissed'].includes(r.status)).length||0,expected:hash(JSON.stringify(current)),version:bundle.version};
}
function writeRows(dir,rows){fs.mkdirSync(dir,{recursive:true});for(const row of rows){const file=safeUnder(dir,row.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(row.data,'base64'),{flag:'wx',mode:0o600});}}
function mapping(flow,maps,cwd){
  if(!flow)return null;flow=clone(flow);if(flow.draft){delete flow.draft.submission;flow.draft.cwd=cwd;for(const file of flow.draft.files||[]){if(typeof file.path==='string'){const match=maps.find(m=>file.path===m.from||file.path.startsWith(m.from+path.sep));if(match)file.path=match.to+file.path.slice(match.from.length);else if(file.kind==='folder'||(!file.text&&!file.dataUrl&&!file.blobData)){file.status='error';file.error='这个外部原件没有随包带来，请重新选择。';}}}}return flow;
}
export function acceptContinuation({home,userData,token,expected,choice,localFlow=null},{afterWrite}={}){
  const plan=previewContinuation({home,userData,token});if(plan.expected!==expected)throw Error('预览后目标发生了变化，未覆盖；请重新核对。');
  if(!['incoming','keep-local'].includes(choice))throw Error('请明确选择本轮采用哪份对话和资料。');
  const dir=slot(userData,token);if(exists(path.join(dir,'result.json')))throw Error('这份接续已处理，请返回已有对话。');
  if(exists(path.join(dir,'journal.json')))throw Error('此接续上次中断，请先检查并恢复原件，不能覆盖备份后再试。');
  if(choice==='keep-local'){atomicWrite(path.join(dir,'result.json'),{choice});return {ok:true,changed:false};}
  const bundle=validateContinuation(JSON.parse(fs.readFileSync(path.join(dir,'incoming.json'),'utf8'))),snap=localSnapshot(home,userData,plan.cwd,bundle),backup=path.join(dir,'before');
  const nativeStage=path.join(dir,'candidate');writeRows(nativeStage,bundle.native);
  const summaryFile=path.join(nativeStage,'summary.json'),summary=JSON.parse(fs.readFileSync(summaryFile,'utf8'));summary.info.cwd=plan.cwd;atomicWrite(summaryFile,summary);
  const maps=[{from:bundle.sourceCwd,to:plan.cwd},{from:bundle.sourceNative,to:snap.target.file}].sort((a,b)=>b.from.length-a.from.length);
  atomicWrite(path.join(nativeStage,'desktop-continuation.json'),{sourceCwd:bundle.sourceCwd,targetCwd:plan.cwd,pathMappings:maps,transferId:bundle.transferId,notice:'原话和历史未改写；旧绝对路径对应这里的新路径，未随包带来的外部资料必须重新选择。'});
  fs.mkdirSync(backup,{recursive:true});if(exists(snap.target.file))fs.cpSync(snap.target.file,path.join(backup,'native'),{recursive:true,dereference:false,verbatimSymlinks:true});
  const outboxFile=path.join(userData,'outbox',bundle.sessionId+'.json');if(exists(outboxFile))fs.copyFileSync(outboxFile,path.join(backup,'outbox.json'));
  atomicWrite(path.join(backup,'flow.json'),localFlow);
  const materialOps=bundle.materials.map(row=>{const target=safeUnder(plan.cwd,row.path),before=actualHash(target);if(before!==null){const saved=path.join(backup,'materials',row.path);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.copyFileSync(target,saved);}return {path:row.path,before,after:row.sha256};});
  const incomingOutbox=clone(bundle.outbox||{schema:1,sessionId:bundle.sessionId,items:[],revision:0});incomingOutbox.cwd=plan.cwd;incomingOutbox.revision=(activeOutbox(userData,bundle.sessionId)?.revision||0)+1;incomingOutbox.paused=true;
  for(const row of incomingOutbox.items){delete row.immediate;if(['sending','interjecting','interjected'].includes(row.status)){row.status='uncertain';row.error='来自另一台机器的未确认回执，先查历史再决定是否重试。';}}
  assertSessionOutbox(incomingOutbox,bundle.sessionId);
  const journal={incomingOutbox:hash(JSON.stringify(incomingOutbox)),originalNative:snap.nativeHash,incomingNative:contentHash(nativeRows(nativeStage)),originalOutbox:snap.outboxHash,phase:'prepared',sessionId:bundle.sessionId,cwd:plan.cwd,target:snap.target.file,materialOps,nativeExisted:exists(snap.target.file),outboxExisted:exists(outboxFile)};atomicWrite(path.join(dir,'journal.json'),journal);
  try{
    for(const row of bundle.materials){const target=safeUnder(plan.cwd,row.path);if(actualHash(target)!==materialOps.find(op=>op.path===row.path).before)throw Error('写入前资料又有修改，未覆盖');fs.mkdirSync(path.dirname(target),{recursive:true});const tmp=target+'.carry-'+randomUUID();fs.writeFileSync(tmp,Buffer.from(row.data,'base64'),{flag:'wx',mode:0o600});fs.renameSync(tmp,target);}
    if(exists(snap.target.file))fs.renameSync(snap.target.file,path.join(dir,'replaced-native'));
    fs.mkdirSync(path.dirname(snap.target.file),{recursive:true});fs.renameSync(nativeStage,snap.target.file);
    atomicWrite(outboxFile,incomingOutbox);
    afterWrite?.();
    const result={ok:true,changed:true,cwd:plan.cwd,sessionId:bundle.sessionId,backup,flow:mapping(bundle.flow,maps,plan.cwd)};atomicWrite(path.join(dir,'result.json'),result);journal.phase='committed';atomicWrite(path.join(dir,'journal.json'),journal);return result;
  }catch(error){throw Error(`${error.message}；接续尚未确认完成，原件备份保存在 ${backup}，请在接续入口检查恢复。`);}
}
/** An interrupted multi-file import is explicit: never silently continue on top of edits. */
export function continuationStatus(userData){const root=carryRoot(userData);return fs.readdirSync(root).filter(id=>/^[a-f0-9-]{36}$/.test(id)).map(token=>{const dir=slot(userData,token),j=path.join(dir,'journal.json'),r=path.join(dir,'result.json');return {token,phase:exists(r)?((JSON.parse(fs.readFileSync(r,'utf8')).changed&&!JSON.parse(fs.readFileSync(r,'utf8')).flowApplied)?'flow-pending':'complete'):exists(j)?JSON.parse(fs.readFileSync(j,'utf8')).phase:'pending',backup:path.join(dir,'before')};});}
export function rollbackContinuation({home,userData,token}){
  const dir=slot(userData,token),journal=JSON.parse(fs.readFileSync(path.join(dir,'journal.json'),'utf8')),bundle=validateContinuation(JSON.parse(fs.readFileSync(path.join(dir,'incoming.json'),'utf8'))),backup=path.join(dir,'before');
  if(journal.phase!=='prepared'||journal.sessionId!==bundle.sessionId)throw Error('此接续不处在待恢复状态。');
  const target=targetDir(home,journal.cwd,journal.sessionId);if(target!==journal.target)throw Error('恢复目标身份不同，原件保留。');
  for(const op of journal.materialOps){const current=actualHash(safeUnder(journal.cwd,op.path));if(current!==op.before&&current!==op.after)throw Error('中断后目标资料又有改动，未自动回退。');}
  const outboxNow=hash(JSON.stringify(activeOutbox(userData,journal.sessionId)));if(outboxNow!==journal.originalOutbox&&outboxNow!==journal.incomingOutbox)throw Error('中断后发送记录又有变化，未自动回退。');
  const replaced=path.join(dir,'replaced-native'),currentNative=exists(target)?contentHash(nativeRows(target)):null;
  if(currentNative!==null&&currentNative!==journal.originalNative&&currentNative!==journal.incomingNative)throw Error('中断后原生对话又有改动，未自动回退。');
  if(exists(replaced)&&contentHash(nativeRows(replaced))!==journal.originalNative)throw Error('回退原件校验失败，未覆盖。');
  const restoreNative=currentNative!==journal.originalNative;
  if(restoreNative&&journal.nativeExisted&&!exists(replaced))throw Error('回退原件缺失。');
  // Preserve the partially imported directory before restoring the original.
  if(restoreNative&&exists(target))fs.renameSync(target,path.join(dir,'interrupted-native'));
  if(restoreNative&&exists(replaced))fs.renameSync(replaced,target);
  for(const op of journal.materialOps){const file=safeUnder(journal.cwd,op.path);if(op.before===null){if(exists(file))fs.unlinkSync(file);}else fs.copyFileSync(path.join(backup,'materials',op.path),file);}
  const outbox=path.join(userData,'outbox',journal.sessionId+'.json');if(journal.outboxExisted)fs.copyFileSync(path.join(backup,'outbox.json'),outbox);else if(exists(outbox))fs.unlinkSync(outbox);
  atomicWrite(path.join(dir,'result.json'),{choice:'rollback'});return {ok:true,cwd:journal.cwd,sessionId:journal.sessionId,flow:JSON.parse(fs.readFileSync(path.join(backup,'flow.json'),'utf8')),backup};
}

export function assertContinuationSettled(userData,sessionId){
  if(!sessionId||!fs.existsSync(path.join(userData,'continuation-packs')))return;
  for(const row of continuationStatus(userData)){if(row.phase==='prepared'){const j=JSON.parse(fs.readFileSync(path.join(slot(userData,row.token),'journal.json'),'utf8'));if(j.sessionId===sessionId)throw Error('这段对话上次接入中断。请先在设置的接续入口检查并恢复原件，不要开始新的回合。');}}
}

export function continuationResult(userData,token){return JSON.parse(fs.readFileSync(path.join(slot(userData,token),'result.json'),'utf8'));}
export function acknowledgeContinuationFlow(userData,token){const value=continuationResult(userData,token);atomicWrite(path.join(slot(userData,token),'result.json'),{...value,flowApplied:true});return true;}
