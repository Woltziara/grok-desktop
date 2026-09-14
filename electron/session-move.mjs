/** Move one idle native conversation, not project files. Originals and a journal are retained. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { sameProjectDirectory, sourceSessionCwd, assertNoAliasCollision } from './session-paths.mjs';
import { grokHomeDir } from './grok-home.mjs';
import { encodeSessionCwd, isSafeSessionId } from './sessions.mjs';

const moving = new Set();
export function assertSessionNotMoving(id) {
  if (moving.has(String(id))) throw new Error('这段对话正在移动，请稍后再操作。');
}
export async function withSessionMove(id, action) {
  if (!isSafeSessionId(id)) throw new Error('无效的对话标识');
  assertSessionNotMoving(id); moving.add(id);
  try { return await action(); } finally { moving.delete(id); }
}
const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const homeOf = home => path.resolve(home || grokHomeDir());
const journalRoot = home => path.join(homeOf(home), 'desktop-session-moves');
const nativePath = (home, cwd, id) => path.join(homeOf(home), 'sessions', encodeSessionCwd(cwd), id);
function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function validate(row) {
  if (!row || !isSafeSessionId(row.sessionId) || !path.isAbsolute(row.cwd || '') || !path.isAbsolute(row.targetCwd || '') || !/^[a-f0-9-]{36}$/.test(row.id || '')) throw new Error('移动记录损坏；保留原件，未继续移动。');
  return row;
}
export function readSessionMoves(home) {
  const root = journalRoot(home);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, {withFileTypes:true}).filter(e=>e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name)).map(e=> {
    const file=path.join(root,e.name,'journal.json');
    return fs.existsSync(file) ? validate(JSON.parse(fs.readFileSync(file,'utf8'))) : null;
  }).filter(Boolean).sort((a,b)=>a.sequence-b.sequence);
}
export function resolveMovedSessionCwd(cwd, sessionId, home) {
  let current=path.resolve(cwd);
  for (const row of readSessionMoves(home)) {
    if(row.phase==='committed' && row.sessionId===sessionId && sameProjectDirectory(row.cwd,current)) current=row.targetCwd;
  }
  return sourceSessionCwd(homeOf(home),current,sessionId);
}
function digest(root) {
  const hash=createHash('sha256');
  const walk=(dir,rel='')=> {
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file=path.join(dir,entry.name), key=path.join(rel,entry.name);
      hash.update(JSON.stringify([key,entry.isDirectory()?'d':entry.isSymbolicLink()?'l':'f']));
      if(entry.isDirectory()) walk(file,key);
      else if(entry.isSymbolicLink()) hash.update(fs.readlinkSync(file));
      else if(entry.isFile()) hash.update(fs.readFileSync(file));
      else throw new Error('对话目录包含不支持的特殊文件，未移动。');
    }
  };
  walk(root);return hash.digest('hex');
}
function finishMove(row, home) {
  const from=nativePath(home,row.cwd,row.sessionId), to=nativePath(home,row.targetCwd,row.sessionId);
  if(!exists(to) || !fs.lstatSync(to).isDirectory()) throw new Error('移动目标缺失，原件在移动备份中；未覆盖其他目录。');
  if(exists(from) && !fs.lstatSync(from).isSymbolicLink()) throw new Error('原目录和目标同时存在，已保留两边；不能自动裁决。');
  const summaryFile=path.join(to,'summary.json');
  if(fs.existsSync(summaryFile)) {
    const summary=JSON.parse(fs.readFileSync(summaryFile,'utf8'));
    if(!summary || typeof summary!=='object' || !summary.info || typeof summary.info!=='object') throw new Error('原生对话摘要格式不兼容，原件已保留。');
    if(summary.info.cwd!==row.targetCwd) write(summaryFile,{...summary,info:{...summary.info,cwd:row.targetCwd}});
  }
  // The official resolver skips symlink session entries. Keep old absolute
  // attachment/plan/result references without rewriting user speech or creating
  // a second native identity. Subsequent moves form a forward-only alias chain.
  if(!exists(from)) fs.symlinkSync(process.platform==='win32'?to:path.relative(path.dirname(from),to),from,process.platform==='win32'?'junction':'dir');
  else if(fs.realpathSync(from)!==fs.realpathSync(to)) throw new Error('原路径已被其他内容占用，未改写。');
  row.phase='committed';
  write(path.join(journalRoot(home),row.id,'journal.json'),row);
  return row;
}
export function recoverSessionMoves(home) {
  const recovered=[];
  for(const row of readSessionMoves(home)) {
    if(row.phase==='committed' || row.phase==='aborted') continue;
    const from=nativePath(home,row.cwd,row.sessionId), to=nativePath(home,row.targetCwd,row.sessionId);
    if(exists(to) && (!exists(from) || fs.lstatSync(from).isSymbolicLink())) recovered.push(finishMove(row,home));
    else if(exists(from) && !exists(to)) { if(row.targetAlias) fs.symlinkSync(row.targetAlias,to,process.platform==='win32'?'junction':'dir'); row.phase='aborted';write(path.join(journalRoot(home),row.id,'journal.json'),row); }
    else throw new Error(`移动中断，需核对备份：${path.join(journalRoot(home),row.id)}。两边均未覆盖。`);
  }
  return recovered;
}
export function moveSessionFiles({cwd,targetCwd,sessionId}, {home, afterRename, dryRun=false}={}) {
  if(!isSafeSessionId(sessionId)) throw new Error('无效的对话标识');
  if(!path.isAbsolute(cwd||'') || !path.isAbsolute(targetCwd||'')) throw new Error('请选择一个完整项目路径');
  recoverSessionMoves(home);
  cwd=resolveMovedSessionCwd(cwd,sessionId,home);
  // Keep the CLI storage key, summary, journal, IPC result and next ACP cwd identical.
  targetCwd=path.resolve(targetCwd);
  if(!fs.statSync(targetCwd).isDirectory()) throw new Error('目标不是文件夹');
  if(cwd===targetCwd) return {ok:true,unchanged:true,cwd,targetCwd,sessionId};
  const from=nativePath(home,cwd,sessionId),to=nativePath(home,targetCwd,sessionId);
  if(!exists(from) || !fs.lstatSync(from).isDirectory() || fs.lstatSync(from).isSymbolicLink()) throw new Error('找不到原生对话目录，原草稿未删除。');
  assertNoAliasCollision(homeOf(home),targetCwd,sessionId,from);
  if(sameProjectDirectory(cwd,targetCwd)) return {ok:true,unchanged:true,cwd,targetCwd:cwd,sessionId};
  const targetAlias = exists(to) && fs.lstatSync(to).isSymbolicLink() && fs.realpathSync(to)===fs.realpathSync(from) ? fs.readlinkSync(to) : null;
  if(exists(to) && !targetAlias) throw new Error('目标已有同标识对话，未覆盖。');
  const summary=path.join(from,'summary.json');
  if(fs.existsSync(summary)) { const s=JSON.parse(fs.readFileSync(summary,'utf8'));if(!s?.info || typeof s.info.cwd!=='string') throw new Error('原生摘要格式不兼容，未移动。'); }
  if(dryRun) return {ok:true,cwd,targetCwd,sessionId};
  const id=randomUUID(),backup=path.join(journalRoot(home),id,'original');
  const before=digest(from);
  fs.mkdirSync(path.dirname(backup),{recursive:true});
  fs.cpSync(from,backup,{recursive:true,dereference:false,verbatimSymlinks:true,errorOnExist:true,force:false});
  if(digest(backup)!==before || digest(from)!==before) throw new Error('对话仍在被其他进程写入，已保留备份，未移动。请先结束该原生会话。');
  const row={id,sequence:Math.max(0,...readSessionMoves(home).map(r=>r.sequence))+1,sessionId,cwd,targetCwd,phase:'prepared',backup,targetAlias,sourceHash:before,at:new Date().toISOString()};
  write(path.join(path.dirname(backup),'journal.json'),row);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  // Recheck after backup: a new target created meanwhile must not be replaced.
  assertNoAliasCollision(homeOf(home),targetCwd,sessionId,from);
  if(targetAlias) fs.unlinkSync(to);
  fs.renameSync(from,to);
  afterRename?.(); // injectable interruption point used only by tests
  finishMove(row,home);
  return {ok:true,...row};
}

/** Inspect every consumer before disposing any; unrelated conversations survive. */
export function movableSessionClients(windows, caller, sessionId) {
  const found=[];
  for(const ws of windows) {
    if(ws!==caller && (ws.agent?.sessionId===sessionId || (!ws.agent && ws.lastSessionId===sessionId))) throw new Error('这段对话正在另一个窗口显示。请先离开那个窗口中的对话，再移动。');
    for(const client of new Set([ws.agent,...(ws.parkedAgents?.values()||[])])) {
      if(client?.sessionId!==sessionId) continue;
      if(client.turnOpen || client._activeTurn || client._restartPromise || client._modeSyncPending || client._openPermissionGates?.size || [...(client.terminals?.terminals?.values()||[])].some(t=>!t.exited)) throw new Error('这段对话仍在执行或等待答复。请等这一轮结束，或先停止它，再移动。');
      found.push({ws,client});
    }
  }
  return found;
}
