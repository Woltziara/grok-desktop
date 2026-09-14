/** Human-initiated object transport through native file dialogs, never account migration. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolveKnowledgeRoot} from '../shared/working-knowledge/paths.mjs';
import {ensureObject,ensureStore,listObjects} from '../shared/working-knowledge/store.mjs';
import {exportWorkingObject,stageWorkingBundle,previewWorkingBundle,acceptWorkingBundle,listPendingWorkingBundles} from '../shared/working-knowledge/sync.mjs';
export function registerKnowledgeTransferIpc(ipc,{dialog,windowFromEvent,root=()=>resolveKnowledgeRoot()}) {
  const owner=event=>{const win=windowFromEvent(event);if(!win||win.isDestroyed?.())throw new Error('原窗口已经关闭，未接入或导出。');return win;};
  ipc.handle('working-knowledge:create', (event,title)=>{
    owner(event);title=String(title||'').trim();if(!title||title.length>200)throw new Error('请为这件事取一个不超过 200 字的名字。');
    const base=ensureStore(root()),id='object-'+randomUUID();ensureObject(base,id,{title});return {id,title};
  });
  ipc.handle('working-knowledge:export',async(event,objectId)=>{
    const win=owner(event),base=root();const meta=listObjects(base).find(o=>o.id===objectId);if(!meta)throw new Error('请先选要带走的业务对象。');
    const picked=await dialog.showSaveDialog(win,{title:'带走本机当前工作认识',defaultPath:`${objectId}.grok-wk.json`,filters:[{name:'工作认识接续包',extensions:['json']}]});
    if(picked.canceled||!picked.filePath)return {cancelled:true};owner(event);
    // Read after the dialog: pending turns may have changed the object while it was open.
    const bundle=exportWorkingObject(base,objectId),file=path.resolve(picked.filePath);
    // Refuse own store paths: a selected export path cannot destroy source records.
    const realParent=fs.realpathSync(path.dirname(file)),realRoot=fs.realpathSync(base);
    const rel=path.relative(realRoot,realParent);if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw new Error('请将接续包保存在工作认识数据目录之外。');
    if(fs.existsSync(file))throw new Error('这个文件已经存在，未覆盖；请另取一个名字。');
    fs.writeFileSync(file,JSON.stringify(bundle,null,2)+'\n',{flag:'wx',mode:0o600});
    return {ok:true,path:file,head:bundle.head,objectId};
  });
  ipc.handle('working-knowledge:import',async event=>{
    const win=owner(event),base=root();const picked=await dialog.showOpenDialog(win,{title:'查看另一台机器带来的工作认识',properties:['openFile'],filters:[{name:'工作认识接续包',extensions:['json']}]});
    if(picked.canceled||!picked.filePaths?.[0])return {cancelled:true};owner(event);
    const file=picked.filePaths[0],stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw new Error('请选择不超过 128 MB 的普通接续文件。');
    return {plan:stageWorkingBundle(base,JSON.parse(fs.readFileSync(file,'utf8')))};
  });
  ipc.handle('working-knowledge:transfers',event=>{owner(event);return listPendingWorkingBundles(root());});
  ipc.handle('working-knowledge:transfer-preview',(event,token)=>{owner(event);return previewWorkingBundle(root(),token);});
  ipc.handle('working-knowledge:transfer-accept',(event,input)=>{owner(event);return acceptWorkingBundle(root(),input);});
}
