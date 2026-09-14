// Real Electron + real Playwright + local HTTP fixture. No model or account is simulated.
import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const profile = process.env.DESKTOP_TEST_PREVIEW_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-preview-smoke-'));
app.setPath('userData', profile);app.setPath('sessionData', profile);
app.on('window-all-closed', () => {});
const { enablePreviewRemoteDebugging } = await import('../../electron/preview-cdp.mjs');
enablePreviewRemoteDebugging();
app.whenReady().then(async () => {
const preview = await import('../../electron/preview-window.mjs');
if (process.env.DESKTOP_TEST_PREVIEW_PHASE === 'restore') {
  const saved = await session.fromPartition(preview.PREVIEW_PARTITION).cookies.get({url:'http://127.0.0.1/'});
  assert.equal(saved.find(c=>c.name==='preview_smoke')?.value,'local-fixture');
  console.log(JSON.stringify({ok:true,check:'Preview-only persistent cookie survived a real Electron process restart'}));
  app.exit(0);return;
}
const api = await import('../../electron/preview-api.mjs');
const { issuePreviewScope, revokePreviewScope } = await import('../../electron/preview-ownership.mjs');
const { previewMcpHttpServers } = await import('../../electron/preview-mcp-tools.mjs');
const { getGuestPage } = await import('../../electron/preview-playwright.mjs');
const server = http.createServer((req,res) => {
  res.setHeader('content-type','text/html');
  res.setHeader('Set-Cookie','preview_smoke=local-fixture; Max-Age=3600; Path=/; SameSite=Lax');
  res.end('<!doctype html><title>Preview fixture</title><h1>Owned page</h1><input aria-label="Message"><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Save</button><output></output><iframe srcdoc="<h2>Frame content</h2>"></iframe>');
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const href = `http://127.0.0.1:${server.address().port}/`;
const a = new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
const b = new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
await a.loadURL('about:blank');await b.loadURL('about:blank');
let aSession = 'A';
preview.registerPreviewIpc({loadState:()=>({theme:'light'}),savePatch:()=>{},broadcast:()=>{},getOwner:()=>a,getOwnerSessionId:w=>w===a?aSession:'B',ownerHasProject:()=>true});
const address = await api.startPreviewApi({windowById:id=>BrowserWindow.fromId(id)});
function client(w, s) {
  const scope = issuePreviewScope({windowId:w.id,getSessionId:()=>s,isLive:()=>!w.isDestroyed()});
  const headers = Object.fromEntries(previewMcpHttpServers(address,w.id,scope)[0].headers.map(h=>[h.name,h.value]));
  return {scope, async tool(name,args={}) { const r = await fetch(address.url+'/mcp',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return r.json(); }, headers };
}
const ca=client(a,'A'),cb=client(b,'B'),sameWindowB=client(a,'B');
const evidence=[];
try {
  const pending = client(a, null);
  for (const method of ['initialize','tools/list']) {
    const response = await fetch(address.url+'/mcp',{method:'POST',headers:{...pending.headers,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method})});
    const body = await response.json();assert.ok(body.result,JSON.stringify(body));
  }
  assert.ok((await pending.tool('preview_snapshot')).error);
  revokePreviewScope(pending.scope);
  evidence.push('MCP initialize and catalog work before native session id exists; tool calls wait for real identity');
  let r=await ca.tool('preview_open',{url:href});assert.equal(r.result.isError,undefined,JSON.stringify(r));
  assert.ok(getGuestPage(), 'real Preview guest must be Playwright-bound');
  const original=preview.previewPublicState();assert.equal(original.ownerSessionId,'A');
  for (const c of [cb,sameWindowB]) for (const name of ['preview_snapshot','preview_click','preview_close','preview_open']) {
    r=await c.tool(name,name==='preview_open'?{url:href}:{selector:'button'});
    assert.equal(r.result.isError,true,`${name} must reject other owner`);
    assert.equal(preview.previewPublicState().leaseId,original.leaseId);
  }
  evidence.push('different windows and same-window B cannot read, act, close, or silently claim A');
  r=await ca.tool('preview_fill',{selector:'input',value:'alpha-only'});assert.equal(r.result.isError,undefined,JSON.stringify(r));
  r=await ca.tool('preview_click',{selector:'button'});assert.equal(r.result.isError,undefined,JSON.stringify(r));
  assert.equal(await getGuestPage().locator('output').textContent(),'alpha-only');
  assert.match((await ca.tool('preview_snapshot')).result.content[0].text,/Frame content/);
  evidence.push('real Playwright fills/clicks owned DOM and snapshots iframe content');
  aSession='B';await assert.rejects(preview.sendPreviewCaptureToChat(),/原对话/);aSession='A';
  const captured=[];const send=a.webContents.send.bind(a.webContents);a.webContents.send=(channel,payload)=>{if(channel==='preview:viewport-capture')captured.push(payload);else send(channel,payload);};
  await preview.sendPreviewCaptureToChat();assert.equal(captured[0].sessionId,'A');assert.ok(captured[0].data.length>100);
  evidence.push('real viewport capture is attributed to A; visible B refuses delivery');
  const missing=await fetch(address.url+'/snapshot',{method:'POST',headers:{Authorization:'Bearer '+address.token},body:'{}'});assert.equal(missing.ok,false);
  const origin=await fetch(address.url+'/mcp',{method:'POST',headers:{...ca.headers,Origin:href},body:'{}'});assert.equal(origin.status,403);
  revokePreviewScope(cb.scope);r=await cb.tool('preview_snapshot');assert.ok(r.error);
  evidence.push('missing, expired scopes and browser Origin are rejected');
  await ca.tool('preview_close');assert.equal(preview.previewPublicState().open,false);
  await preview.openPreviewWindow({owner:a,sessionId:'A',url:href});
  assert.notEqual(preview.previewPublicState().leaseId,original.leaseId);
  r=await ca.tool('preview_snapshot');assert.equal(r.result.isError,true);
  r=await ca.tool('preview_open',{url:href});assert.equal(r.result.isError,undefined);
  evidence.push('close/reopen changes lease and rejects pre-close MCP operations until explicit reopen');
  await session.fromPartition(preview.PREVIEW_PARTITION).cookies.flushStore();
  console.log(JSON.stringify({ok:true,electron:process.versions.electron,chromium:process.versions.chrome,checks:evidence},null,2));
} catch(e) { console.error(e.stack);process.exitCode=1; }
finally { preview.closePreviewWindow();api.stopPreviewApi();a.destroy();b.destroy();server.close();app.exit(process.exitCode || 0); }

}).catch(err => { console.error(err.stack); app.exit(1); });
