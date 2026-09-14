// Test-only renderer fixture mounts the production AppSidebar, not a copied component.
import {app,BrowserWindow} from 'electron';
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-sidebar-smoke-'));
app.setPath('userData',path.join(tmp,'profile'));
const {enablePreviewRemoteDebugging}=await import('../../electron/preview-cdp.mjs');enablePreviewRemoteDebugging();
app.whenReady().then(async()=>{
  let win,server;
  try {
    const bundle=path.join(tmp,'ui.js');
    await build({entryPoints:[path.join(root,'test/ui/sidebar-move-harness.tsx')],outfile:bundle,bundle:true,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'}});
    server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/ui.js'?'text/javascript':'text/html');res.end(req.url==='/ui.js'?fs.readFileSync(bundle):'<div id="root"></div><script type="module" src="/ui.js"></script>');});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    win=new BrowserWindow({width:800,height:900,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true}});
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const {connectPreviewPlaywright,listPlaywrightPages}=await import('../../electron/preview-playwright.mjs');
    await connectPreviewPlaywright();const page=listPlaywrightPages().find(p=>p.url().startsWith('http://127.0.0.1:'));
    assert.ok(page);await page.getByRole('button',{name:'Move me',exact:true}).first().waitFor();
    const drag=await page.evaluateHandle(()=>new DataTransfer());
    await page.getByRole('button',{name:'Move me',exact:true}).first().dispatchEvent('dragstart',{dataTransfer:drag});
    const target=page.locator('.project-folder').filter({has:page.locator('.project-folder-name',{hasText:'B'})});
    await target.dispatchEvent('dragover',{dataTransfer:drag});await target.dispatchEvent('drop',{dataTransfer:drag});
    assert.deepEqual(await page.evaluate(()=>window.moveRequests),[{cwd:'/A',sessionId:'move-session-0001',targetCwd:'/B'}]);
    await page.getByRole('button',{name:'选项：Move me'}).first().click();
    await page.getByRole('menuitem',{name:'移到「B」'}).click();
    assert.equal((await page.evaluate(()=>window.moveRequests)).length,2);
    console.log(JSON.stringify({ok:true,checks:['production sidebar HTML drag source to project drop target','accessible conversation menu targets the same move callback'],electron:process.versions.electron}));
  } catch(e) { console.error(e.stack);process.exitCode=1; }
  finally {win?.destroy();server?.close();fs.rmSync(tmp,{recursive:true,force:true});app.exit(process.exitCode||0);}
}).catch(e=>{console.error(e);app.exit(1);});
