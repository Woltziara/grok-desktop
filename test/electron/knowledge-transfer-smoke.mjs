// Native file-picking is replaced by deterministic choices; no fake transfer handlers.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
import {ensureStore,ensureObject,writeRecord,readCurrent} from '../../shared/working-knowledge/store.mjs';
import {uiCorrect} from '../../shared/working-knowledge/updates.mjs';
import {exportWorkingObject,stageWorkingBundle,acceptWorkingBundle,listPendingWorkingBundles} from '../../shared/working-knowledge/sync.mjs';
import {registerKnowledgeTransferIpc} from '../../electron/knowledge-transfer-ipc.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-electron-'));
fs.mkdirSync(path.join(tmp,'profile'));app.setPath('userData',path.join(tmp,'profile'));app.setPath('sessionData',path.join(tmp,'profile'));
const {enablePreviewRemoteDebugging}=await import('../../electron/preview-cdp.mjs');enablePreviewRemoteDebugging();
const a=path.join(tmp,'primary'),b=path.join(tmp,'companion');ensureStore(a);ensureStore(b);ensureObject(a,'sample',{title:'合成测试，不是业务原件'});writeRecord(a,{id:'decision',objectId:'sample',kind:'decision',text:'基线条件',epistemic:'user_said',source:{type:'user',sessionId:'A',quote:'基线条件'}});
const p=stageWorkingBundle(b,exportWorkingObject(a,'sample'));acceptWorkingBundle(b,{...p,choice:'continue'});
uiCorrect(a,{objectId:'sample',id:'decision',text:'本机保留条件',sessionId:'A'});uiCorrect(b,{objectId:'sample',id:'decision',text:'另一机器条件',sessionId:'B'});
const incoming=path.join(tmp,'incoming.json'),outgoing=path.join(tmp,'outgoing.json');fs.writeFileSync(incoming,JSON.stringify(exportWorkingObject(b,'sample')));
let win,server;
registerKnowledgeTransferIpc(ipcMain,{root:()=>a,windowFromEvent:e=>BrowserWindow.fromWebContents(e.sender),dialog:{showOpenDialog:async()=>({filePaths:[incoming]}),showSaveDialog:async()=>({filePath:outgoing})}});
app.whenReady().then(async()=>{
  try{
    const bundle=path.join(tmp,'ui.js');await build({entryPoints:[path.join(root,'test/ui/knowledge-transfer-harness.tsx')],outfile:bundle,bundle:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
    server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/ui.js'?'text/javascript':'text/html');res.end(req.url==='/ui.js'?fs.readFileSync(bundle):'<style>body{margin:20px}details{max-height:180px;overflow:auto}button{margin:5px}</style><div id="root"></div><script type="module" src="/ui.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    win=new BrowserWindow({width:1100,height:1100,webPreferences:{preload:path.join(root,'electron/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const {connectPreviewPlaywright,listPlaywrightPages}=await import('../../electron/preview-playwright.mjs');await connectPreviewPlaywright();const page=listPlaywrightPages().find(p=>p.url().startsWith('http://127.0.0.1:'));
    await page.getByRole('button',{name:'导出当前这件事',exact:true}).click();await page.getByRole('status').filter({hasText:'已导出'}).waitFor();assert.equal(JSON.parse(fs.readFileSync(outgoing)).objectId,'sample');
    await page.getByRole('button',{name:'接入另一台带来的版本',exact:true}).click();await page.getByRole('heading',{name:/两边都有独立修改/}).waitFor();
    const pending=listPendingWorkingBundles(a);assert.equal(pending.length,1);assert.ok(readCurrent(a,'sample').items.some(r=>r.text==='本机保留条件'));
    await page.reload();await page.getByRole('button',{name:/合成测试.*查看/}).click();await page.getByRole('heading',{name:/两边都有独立修改/}).waitFor();
    for(const summary of await page.locator('summary').all())await summary.click();
    assert.match(await page.locator('body').textContent(),/本机保留条件/);assert.match(await page.locator('body').textContent(),/另一机器条件/);
    await page.getByRole('button',{name:'这一轮采用带来的版',exact:true}).click();await page.getByRole('status').filter({hasText:'原件保存在'}).waitFor();
    assert.ok(readCurrent(a,'sample').items.some(r=>r.text==='另一机器条件'));assert.equal(listPendingWorkingBundles(a).length,0);
    assert.ok(fs.readdirSync(path.join(a,'transfer-backups')).length>0);
    const newObject=await page.evaluate(()=>window.grokDesktop.createWorkingKnowledgeObject('创建的合成对象'));assert.match(newObject.id,/^object-/);assert.equal(newObject.title,'创建的合成对象');
    console.log(JSON.stringify({ok:true,electron:process.versions.electron,checks:['production UI exports actual object bundle through preload/main','incoming conflict is staged, never silently applied','pending conflict survives renderer reload','both source versions displayed','explicit incoming choice saves original backup and reads back chosen current','actual object creation IPC']}));
  }catch(error){console.error(error.stack);process.exitCode=1;}finally{win?.destroy();server?.close();fs.rmSync(tmp,{recursive:true,force:true});app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error);app.exit(1);});
