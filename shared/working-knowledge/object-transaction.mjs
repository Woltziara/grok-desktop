/** Crash-recoverable replacement of one WK object. No other objects/config/auth. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isSafeObjectId, resolveKnowledgeRoot } from './paths.mjs';
export const OBJECT_FILES = ['object.json','records.jsonl','inbox.jsonl','commits.jsonl','current.json'];
const FILES = [...OBJECT_FILES,'sync.json'];
const exists = p => { try { fs.lstatSync(p); return true; } catch(e) { if(e.code==='ENOENT')return false;throw e; } };
export function writeSyncJson(file, value) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  if(exists(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('工作认识路径是链接，未覆盖原件。');
  const tmp=`${file}.${randomUUID()}.tmp`,fd=fs.openSync(tmp,'wx',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  fs.renameSync(tmp,file);
}
function locations(root,id,tid) {
  if(!isSafeObjectId(id)||!/^[a-f0-9-]{36}$/.test(tid))throw new Error('工作认识恢复记录不兼容，原件保留。');
  root=resolveKnowledgeRoot(root);
  return {live:path.join(root,'objects',id),candidate:path.join(root,'transfer-staging',tid,'object'),backup:path.join(root,'transfer-backups',tid,'object'),journal:path.join(root,'transfer-journals',id+'.json')};
}
function hashFiles(dir) {
  const hash=createHash('sha256');
  for(const name of FILES) {
    const file=path.join(dir,name);if(!exists(file)||!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw new Error(`接续文件缺失或是链接：${name}`);
    hash.update(name+'\0');hash.update(fs.readFileSync(file));hash.update('\0');
  }
  return hash.digest('hex');
}
export function recoverObjectTransfer(root,id) {
  if(!isSafeObjectId(id))return;
  const journal=path.join(resolveKnowledgeRoot(root),'transfer-journals',id+'.json');
  if(!exists(journal))return;
  const row=JSON.parse(fs.readFileSync(journal,'utf8'));
  if(row.schema!==1||row.objectId!==id||!['prepared','committed'].includes(row.phase)||!/^[a-f0-9]{64}$/.test(row.candidateHash))throw new Error('接续恢复记录损坏；两版均保留。');
  if(row.phase==='committed')return;
  const paths=locations(root,id,row.id);
  if(exists(paths.candidate)) {
    if(hashFiles(paths.candidate)!==row.candidateHash)throw new Error('接续暂存数据校验失败，未覆盖原件。');
    if(exists(paths.live)) {
      if(exists(paths.backup))throw new Error('接续中断后又有本机修改，无法自动选择；请核对原件和备份。');
      if(!row.hadOriginal||fs.lstatSync(paths.live).isSymbolicLink())throw new Error('接续目标被其他内容占用，未覆盖。');
      // Only move the exact source that the user reviewed, not new writes.
      if(hashFiles(paths.live)!==row.originalHash)throw new Error('接续中断后本机内容已变化，未覆盖。');
      fs.mkdirSync(path.dirname(paths.backup),{recursive:true,mode:0o700});fs.renameSync(paths.live,paths.backup);
    } else if(row.hadOriginal&&!exists(paths.backup))throw new Error('原件及备份都缺失，停止恢复。');
    fs.mkdirSync(path.dirname(paths.live),{recursive:true});fs.renameSync(paths.candidate,paths.live);
  } else if(!exists(paths.live)||hashFiles(paths.live)!==row.candidateHash)throw new Error('接续未完成，原件备份已保留，请核对恢复记录。');
  row.phase='committed';writeSyncJson(paths.journal,row);
  return {...row,backup:row.hadOriginal?paths.backup:null};
}
export function replaceObject(root,id,files,{afterBackup}={}) {
  recoverObjectTransfer(root,id);
  const tid=randomUUID(),p=locations(root,id,tid),hadOriginal=exists(p.live);
  if(FILES.some(name=>typeof files[name]!=='string')||Object.keys(files).some(name=>!FILES.includes(name)))throw new Error('接续文件集合不完整或越界。');
  if(hadOriginal&&(!fs.lstatSync(p.live).isDirectory()||fs.lstatSync(p.live).isSymbolicLink()))throw new Error('业务对象目录不安全，未覆盖。');
  fs.mkdirSync(path.dirname(p.candidate),{recursive:true,mode:0o700});
  // Preserve unknown user-owned files locally, but never include them in export.
  if(hadOriginal)fs.cpSync(p.live,p.candidate,{recursive:true,dereference:false,verbatimSymlinks:true});else fs.mkdirSync(p.candidate);
  for(const name of FILES) {
    const file=path.join(p.candidate,name);
    if(exists(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error(`对象文件是链接，未覆盖：${name}`);
    const fd=fs.openSync(file,'w',0o600);try{fs.writeFileSync(fd,files[name]);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  // Known absent legacy commits/sync files are normalized before this boundary.
  const row={schema:1,id:tid,objectId:id,phase:'prepared',hadOriginal,originalHash:hadOriginal?hashFiles(p.live):null,candidateHash:hashFiles(p.candidate),at:new Date().toISOString()};
  writeSyncJson(p.journal,row);
  if(hadOriginal){fs.mkdirSync(path.dirname(p.backup),{recursive:true,mode:0o700});fs.renameSync(p.live,p.backup);}
  afterBackup?.(); // deterministic interruption injection, never enabled by the application
  fs.mkdirSync(path.dirname(p.live),{recursive:true});fs.renameSync(p.candidate,p.live);
  row.phase='committed';writeSyncJson(p.journal,row);
  return {backup:hadOriginal?p.backup:null,transactionId:tid};
}
export function objectEpoch(root,id) {
  if(!isSafeObjectId(id))return null;
  recoverObjectTransfer(root,id);
  const file=path.join(resolveKnowledgeRoot(root),'objects',id,'sync.json');
  if(!exists(file))return null;
  return JSON.parse(fs.readFileSync(file,'utf8')).epoch || null;
}
