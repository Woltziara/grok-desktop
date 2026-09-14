// Real Electron, React, production preload + IPC router + durable dispatcher.
// Only the agent replies and intentional timing gates are test fixtures.
import {app,BrowserWindow,ipcMain} from 'electron';
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createSessionDelivery} from '../../electron/session-delivery.mjs';
import {registerDeliveryIpc} from '../../electron/delivery-ipc.mjs';
import {importAttachmentFile} from '../../electron/attachments.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),tmp=process.env.DESKTOP_DELIVERY_TEST_ROOT || fs.mkdtempSync(path.join(os.tmpdir(),'delivery-electron-'));
fs.mkdirSync(path.join(tmp,'profile'),{recursive:true});app.setPath('userData',path.join(tmp,'profile'));app.setPath('sessionData',path.join(tmp,'profile'));process.env.GROK_HOME=path.join(tmp,'grok');
const {enablePreviewRemoteDebugging}=await import('../../electron/preview-cdp.mjs');enablePreviewRemoteDebugging();
class Peer extends EventEmitter{
  constructor(sessionId,cwd){super();this.sessionId=sessionId;this.cwd=cwd;this.ready=true;this.calls=[];this.turnOpen=false;this._activeTurn=null;}
  async prompt(text,opts){this.calls.push({text,images:opts.images,origin:opts.origin});this.turnOpen=true;const turn=this._activeTurn={id:`t${this.calls.length}`};let ok=false;
    try{return await new Promise((resolve,reject)=>{this.complete=()=>{ok=true;resolve({stopReason:'end_turn'});};this.reject=reject;});}
    finally{this.turnOpen=false;this._activeTurn=null;this.emit('turn-settled',{sessionId:this.sessionId,turnId:turn.id,ok,cancelled:!ok});}}
  async interject(){return {ok:false,reason:'unsupported'};}
  cancel(){this.reject?.(new Error('cancelled'));}
}
const ids=['delivery-session-A','delivery-session-B'],paths=Object.fromEntries(ids.map(id=>[id,path.join(tmp,id)]));for(const cwd of Object.values(paths))fs.mkdirSync(cwd,{recursive:true});
const clients=Object.fromEntries(ids.map(id=>[id,new Peer(id,paths[id])])),ws={agent:clients[ids[0]],lastSessionId:ids[0],parkedAgents:new Map(ids.map(id=>[id,clients[id]]))};
const gates=new Map(),blocked=new Map();let win,server;
const wait=async kind=>{if(gates.get(kind))await new Promise(resolve=>{blocked.set(kind,resolve);});};
const service=createSessionDelivery(path.join(tmp,'outbox'),{notify:e=>win?.webContents.send('agent:delivery',e)});
const agentForSession=(w,id)=>w.agent?.sessionId===id?w.agent:w.parkedAgents.get(id);
registerDeliveryIpc({handle(name,handler){ipcMain.handle(name,async(...args)=>{const result=await handler(...args);if(name==='agent:submit-delivery')await wait('receipt');return result;});}},{sessionFromEvent:()=>ws,agentForSession,delivery:()=>service});
ipcMain.handle('agent:cancel',(_e,id)=>{service.bind(agentForSession(ws,id));return service.stop(id);});
ipcMain.handle('attachments:import',async(_e,file,id)=>{const agent=agentForSession(ws,id);if(!agent)throw new Error('missing owner');await wait('import');return importAttachmentFile(file,{cwd:agent.cwd,sessionId:id});});
ipcMain.handle('test:info',()=>paths);ipcMain.handle('test:switch',(_e,id)=>{ws.agent=clients[id];ws.lastSessionId=id;return true;});
ipcMain.handle('test:calls',()=>Object.fromEntries(ids.map(id=>[id,clients[id].calls])));ipcMain.handle('test:complete',(_e,id)=>{clients[id].complete?.();return true;});
ipcMain.handle('test:delay',(_e,kind)=>{gates.set(kind,true);return true;});ipcMain.handle('test:release',(_e,kind)=>{gates.delete(kind);blocked.get(kind)?.();blocked.delete(kind);return true;});ipcMain.handle('test:pending',()=>[...blocked.keys()]);
const originalFile=path.join(tmp,'source-note.md');fs.writeFileSync(originalFile,'original attachment text');ipcMain.handle('test:fixture-path',()=>originalFile);
app.whenReady().then(async()=>{
  const checks=[];
  try{
    const bundle=path.join(tmp,'ui.js');await build({entryPoints:[path.join(root,'test/ui/delivery-harness.tsx')],outfile:bundle,bundle:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
    server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/ui.js'?'text/javascript':'text/html');res.end(req.url==='/ui.js'?fs.readFileSync(bundle):'<style>textarea{width:650px}.prompt-queue{max-height:160px;overflow:auto}#transcript{max-height:100px;overflow:auto}body{margin:24px}</style><div id="root"></div><script type="module" src="/ui.js"></script>');});const savedPort=path.join(tmp,'port');const port=process.env.DESKTOP_DELIVERY_PHASE==='restore'?Number(fs.readFileSync(savedPort,'utf8')):0;await new Promise(r=>server.listen(port,'127.0.0.1',r));fs.writeFileSync(savedPort,String(server.address().port));
    win=new BrowserWindow({width:1000,height:950,show:true,webPreferences:{preload:path.join(root,'test/electron/delivery-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const {connectPreviewPlaywright,listPlaywrightPages}=await import('../../electron/preview-playwright.mjs');await connectPreviewPlaywright();const page=listPlaywrightPages().find(p=>p.url().startsWith('http://127.0.0.1:'));
    page.on('pageerror',error=>console.error('renderer:',error));const composer=page.locator('textarea');await composer.waitFor();
    if(process.env.DESKTOP_DELIVERY_PHASE==='restore') {
      await page.waitForFunction(()=>document.querySelectorAll('.composer-images img').length>0);
      assert.equal(await composer.inputValue(),'encoded request A');
      await page.getByText('结果待核对',{exact:true}).waitFor();
      assert.equal(clients[ids[0]].calls.length,0);
      await page.getByRole('button',{name:'继续尚未发送的内容',exact:true}).click();
      await page.waitForFunction(async()=> (await window.deliveryTest.calls())['delivery-session-A'].length===1);
      assert.equal(clients[ids[0]].calls[0].text,'queued after restart');
      console.log(JSON.stringify({ok:true,electron:process.versions.electron,checks:['original image and draft survive a separate Electron process','unacknowledged send shown uncertain and never automatically replayed','explicit resume executes only never-sent FIFO']}));
      return;
    }
    // An accepted main-process send whose IPC receipt arrives after newer typing.
    await page.evaluate(()=>window.deliveryTest.delay('receipt'));await composer.fill('first turn');await composer.press('Enter');
    await page.waitForFunction(async()=> (await window.deliveryTest.pending()).includes('receipt'));
    await composer.fill('later draft');await page.evaluate(()=>window.deliveryTest.release('receipt'));
    await page.waitForFunction(()=>window.deliveryHarness.draft('delivery-session-A')?.text==='later draft');assert.equal(await composer.inputValue(),'later draft');
    checks.push('late durable acceptance preserves newer typed draft in the production Composer');
    // Queue while A runs, then work in B. A drains without an A renderer.
    await composer.fill('queued A');await page.getByRole('button',{name:'稍后',exact:true}).click();
    await page.getByRole('button',{name:'会话 B',exact:true}).click();await page.waitForFunction(()=>window.deliveryHarness.selected==='delivery-session-B');
    await composer.fill('B turn');await composer.press('Enter');await page.waitForFunction(async()=> (await window.deliveryTest.calls())['delivery-session-B'].length===1);
    await page.evaluate(()=>window.deliveryTest.complete('delivery-session-A'));await page.waitForFunction(async()=> (await window.deliveryTest.calls())['delivery-session-A'].length===2);
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='busy');assert.equal(await page.locator('#connection').textContent(),'busy');assert.doesNotMatch(await page.locator('#transcript').textContent(),/queued A/);
    checks.push('parked A FIFO proceeds while B busy flag and B timeline remain untouched');
    // Native attachment preparation stays pinned to A after the view changes.
    await page.getByRole('button',{name:'会话 A',exact:true}).click();await page.waitForFunction(()=>window.deliveryHarness.selected==='delivery-session-A');
    await page.evaluate(async()=>{await window.deliveryTest.delay('import');window.dispatchEvent(new CustomEvent('grok-import-attachments',{detail:{paths:[await window.deliveryTest.fixturePath()]}}));});
    await page.waitForFunction(async()=> (await window.deliveryTest.pending()).includes('import'));
    await page.getByRole('button',{name:'会话 B',exact:true}).click();await page.waitForFunction(()=>window.deliveryHarness.selected==='delivery-session-B');await composer.fill('B draft remains');
    await page.evaluate(()=>window.deliveryTest.release('import'));await page.waitForFunction(()=>window.deliveryHarness.draft('delivery-session-A')?.files.some(f=>f.name==='source-note.md'));
    assert.equal(await composer.inputValue(),'B draft remains');assert.equal(await page.locator('.composer-files').count(),0);
    await page.getByRole('button',{name:'会话 A',exact:true}).click();await page.getByText('source-note.md',{exact:true}).waitFor();
    checks.push('actual native file import finishing after a switch returns to A draft, not B');
    // Original image bytes persist in IndexedDB and rehydrate after a real reload.
    await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=2800;canvas.height=1800;canvas.getContext('2d').fillRect(0,0,2800,1800);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const data=new DataTransfer();data.items.add(new File([blob],'large-image.png',{type:'image/png'}));document.querySelector('textarea').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));});
    await page.waitForFunction(()=>window.deliveryHarness.draft('delivery-session-A')?.files.some(f=>f.kind==='image'));
    const bytes=await page.evaluate(async()=>{const draft=window.deliveryHarness.draft('delivery-session-A');return (await window.deliveryHarness.blob(draft.files.find(f=>f.kind==='image').blobId)).size;});assert.ok(bytes>1000);
    await page.reload();await page.getByText('source-note.md',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.composer-images img').length>0);
    checks.push('large original image Blob plus native file and draft survive renderer reload');
    // Slow encoding belongs to the original mounted composer, even after A -> B.
    await page.evaluate(()=>{const original=window.createImageBitmap;window.encodeReached=false;window.createImageBitmap=async(...args)=>{window.encodeReached=true;await new Promise(r=>window.releaseEncoding=r);return original(...args);};});
    await composer.fill('encoded request A');await composer.press('Enter');await page.waitForFunction(()=>window.encodeReached);
    const before=await page.evaluate(()=>window.deliveryTest.calls());await page.getByRole('button',{name:'会话 B',exact:true}).click();await page.waitForFunction(()=>window.deliveryHarness.selected==='delivery-session-B');
    await page.evaluate(()=>window.releaseEncoding());await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(()=>window.deliveryTest.calls()),before);assert.equal(await composer.inputValue(),'B draft remains');
    await page.getByRole('button',{name:'会话 A',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea').value==='encoded request A');
    checks.push('switch during actual image encoding does not submit to either new view or clear original draft');
    await page.evaluate(async()=>{await window.deliveryTest.complete('delivery-session-A');await window.deliveryTest.complete('delivery-session-B');});
    await page.waitForFunction(()=>document.querySelector('#connection').textContent==='online');
    await page.evaluate(async()=>{const paths=await window.deliveryTest.info();await window.grokDesktop.submitDelivery({id:'restart-held',cwd:paths['delivery-session-A'],sessionId:'delivery-session-A',text:'unknown before restart',images:[],mode:'auto'});});
    await page.waitForFunction(async()=> (await window.deliveryTest.calls())['delivery-session-A'].some(c=>c.text==='unknown before restart'));
    await page.evaluate(async()=>{const paths=await window.deliveryTest.info();await window.grokDesktop.submitDelivery({id:'restart-queued',cwd:paths['delivery-session-A'],sessionId:'delivery-session-A',text:'queued after restart',images:[],mode:'queue'});window.dispatchEvent(new Event('grok-flush-draft'));});
    console.log(JSON.stringify({ok:true,electron:process.versions.electron,checks}));
  }catch(error){console.error(error.stack);process.exitCode=1;}
  finally{win?.destroy();server?.close();if(!process.env.DESKTOP_DELIVERY_TEST_ROOT)fs.rmSync(tmp,{recursive:true,force:true});app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error);app.exit(1);});
