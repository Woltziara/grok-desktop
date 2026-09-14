import fs from 'node:fs';
import path from 'node:path';
import {exportContinuation,stageContinuation,previewContinuation,acceptContinuation,continuationStatus,rollbackContinuation,safeMaterialPath,continuationResult,acknowledgeContinuationFlow} from './continuation-pack.mjs';
import {listSessionsForCwd,isSafeSessionId} from './sessions.mjs';
export function registerContinuationIpc(ipc,{home,userData,dialog,windowFromEvent,assertIdle,remember=()=>{},identity=()=>null}){
  const owner=e=>{const w=windowFromEvent(e);if(!w||w.isDestroyed?.())throw Error('原窗口已关闭。');return w;};
  ipc.handle('continuation:list',e=>{owner(e);const root=path.join(home(),'sessions');if(!fs.existsSync(root))return [];const result=[];for(const d of fs.readdirSync(root,{withFileTypes:true})){if(!d.isDirectory())continue;let cwd;try{cwd=decodeURIComponent(d.name);}catch{continue;}if(path.isAbsolute(cwd))result.push(...listSessionsForCwd(cwd));}return result;});
  ipc.handle('continuation:select-materials',async(e,cwd)=>{const w=owner(e);const r=await dialog.showOpenDialog(w,{title:'选择要一起带走的项目资料',defaultPath:cwd,properties:['openFile','openDirectory','multiSelections']});if(r.canceled)return [];return r.filePaths.map(file=>{const rel=path.relative(cwd,file).split(path.sep).join('/');return safeMaterialPath(rel);});});
  ipc.handle('continuation:export',async(e,input)=>{
    owner(e);if(!isSafeSessionId(input?.sessionId))throw Error('请选择一段对话。');await assertIdle(input.sessionId,false);
    const chosen=await dialog.showSaveDialog(owner(e),{title:'带走选定对话、草稿及资料',defaultPath:`${input.sessionId}.grok-session.json`,filters:[{name:'会话接续包',extensions:['json']}]});
    if(chosen.canceled)return {cancelled:true};owner(e);await assertIdle(input.sessionId,false);
    const bundle=exportContinuation({home:home(),userData:userData(),...input,version:identity()});
    if(fs.existsSync(chosen.filePath))throw Error('目标文件已存在，未覆盖。请另取文件名。');
    fs.writeFileSync(chosen.filePath,JSON.stringify(bundle),{flag:'wx',mode:0o600});return {ok:true,path:chosen.filePath,nativeFiles:bundle.native.length,materials:bundle.materials.length};
  });
  ipc.handle('continuation:import',async e=>{
    const input=await dialog.showOpenDialog(owner(e),{title:'选择另一台带来的会话接续包',properties:['openFile'],filters:[{name:'会话接续包',extensions:['json']}]});if(input.canceled)return {cancelled:true};
    const file=input.filePaths[0],stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw Error('接续包必须是 128 MB 以内的普通文件。');
    const target=await dialog.showOpenDialog(owner(e),{title:'选择这台机器上接着工作的项目目录',properties:['openDirectory','createDirectory']});if(target.canceled)return {cancelled:true};owner(e);
    return {plan:stageContinuation({home:home(),userData:userData(),bundle:JSON.parse(fs.readFileSync(file,'utf8')),cwd:target.filePaths[0]})};
  });
  ipc.handle('continuation:result',async(e,token)=>{owner(e);const r=continuationResult(userData(),token);await assertIdle(r.sessionId,true);return r;});
  ipc.handle('continuation:flow-applied',(e,token)=>{owner(e);return acknowledgeContinuationFlow(userData(),token);});
  ipc.handle('continuation:pending',e=>{owner(e);return continuationStatus(userData());});
  ipc.handle('continuation:preview',(e,token)=>{owner(e);return previewContinuation({home:home(),userData:userData(),token});});
  ipc.handle('continuation:accept',async(e,input)=>{owner(e);const plan=previewContinuation({home:home(),userData:userData(),token:input?.token});await assertIdle(plan.sessionId,true);const r=acceptContinuation({home:home(),userData:userData(),...input});if(r.changed)remember(r.cwd,r.sessionId);return r;});
  ipc.handle('continuation:rollback',async(e,token)=>{owner(e);const plan=previewContinuation({home:home(),userData:userData(),token});await assertIdle(plan.sessionId,true);return rollbackContinuation({home:home(),userData:userData(),token});});
}
