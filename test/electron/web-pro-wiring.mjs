// Bound Preview window + production MCP HTTP. Opens real chatgpt.com. Does not copy other browsers' cookies.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WEB_PRO_URL,
  createWebProAssignment,
  extractFencedFiles,
  recordWebProResult,
  recordWebProSnapshot,
  snapshotHasComposer,
  snapshotNeedsLogin,
} from '../../electron/web-pro-assignment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profile = process.env.DESKTOP_WEB_PRO_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-web-pro-'));
const work = process.env.DESKTOP_WEB_PRO_WORK || fs.mkdtempSync(path.join(os.tmpdir(), 'web-pro-work-'));
const evidence = process.env.DESKTOP_WEB_PRO_EVIDENCE || path.join(work, 'WIRING.json');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
process.env.GROK_HOME = process.env.GROK_HOME || path.join(profile, 'grok');
app.on('window-all-closed', () => {});

const TASK = `Create exactly two files:

add.mjs
export function add(a, b) { return Number(a) + Number(b); }

add.test.mjs
Use node:test to assert add(2, 3) === 5 and add('2', '3') === 5.

Reply with those two files only, each in a markdown fence labeled with the file name. No secrets.`;

function snapshotText(result) {
  const content = result?.result?.content;
  if (Array.isArray(content)) return content.map(part => part.text || '').join('\n');
  return JSON.stringify(result);
}

const { enablePreviewRemoteDebugging } = await import('../../electron/preview-cdp.mjs');
enablePreviewRemoteDebugging();

app.whenReady().then(async () => {
  const preview = await import('../../electron/preview-window.mjs');
  const api = await import('../../electron/preview-api.mjs');
  const { issuePreviewScope } = await import('../../electron/preview-ownership.mjs');
  const { previewMcpHttpServers } = await import('../../electron/preview-mcp-tools.mjs');
  const { getGuestPage } = await import('../../electron/preview-playwright.mjs');
  const { installDesktopPreviewSkill } = await import('../../electron/preview-mcp.mjs');
  installDesktopPreviewSkill();
  const owner = new BrowserWindow({ show: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await owner.loadURL('about:blank');
  preview.registerPreviewIpc({
    loadState: () => ({ theme: 'light' }),
    savePatch: () => {},
    broadcast: () => {},
    getOwner: () => owner,
    getOwnerSessionId: () => 'web-pro-wiring',
    ownerHasProject: () => true,
  });
  const address = await api.startPreviewApi({ windowById: id => BrowserWindow.fromId(id) });
  const scope = issuePreviewScope({ windowId: owner.id, getSessionId: () => 'web-pro-wiring', isLive: () => !owner.isDestroyed() });
  const headers = Object.fromEntries(previewMcpHttpServers(address, owner.id, scope)[0].headers.map(h => [h.name, h.value]));
  async function tool(name, args = {}) {
    const r = await fetch(address.url + '/mcp', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return r.json();
  }
  const assignment = createWebProAssignment(profile, { task: TASK, cwd: work, title: 'tiny add()' });
  const report = { ok: false, assignmentId: assignment.id, url: WEB_PRO_URL, bound: false, login: false, composer: false, applied: false, files: [], note: '', snapshotExcerpt: '' };
  try {
    const opened = await tool('preview_open', { url: WEB_PRO_URL });
    if (opened.error || opened.result?.isError) throw new Error(opened.error?.message || opened.result?.content?.[0]?.text || 'preview_open failed');
    report.bound = Boolean(getGuestPage());
    if (!report.bound) throw new Error('Preview guest was not Playwright-bound to this window');
    await new Promise(r => setTimeout(r, 4000));
    const snap = snapshotText(await tool('preview_snapshot'));
    recordWebProSnapshot(profile, assignment.id, snap);
    report.snapshotExcerpt = snap.slice(0, 2000);
    report.login = snapshotNeedsLogin(snap);
    report.composer = snapshotHasComposer(snap);
    if (report.login) {
      report.note = 'ChatGPT in this isolated Preview profile needs the user to sign in. Do not copy cookies from other browsers.';
    } else if (report.composer) {
      const fill = await tool('preview_fill', { name: 'Ask anything', value: assignment.prompt });
      const filled = snapshotText(fill);
      if (/Ask anything|textbox|combobox|paragraph/i.test(filled) && !/not found|无法/i.test(JSON.stringify(fill))) {
        await tool('preview_press', { key: 'Enter' });
        await new Promise(r => setTimeout(r, 12000));
      }
      const later = snapshotText(await tool('preview_snapshot'));
      recordWebProSnapshot(profile, assignment.id, later);
      report.snapshotExcerpt = later.slice(0, 2000);
      const files = extractFencedFiles(later);
      if (files.length) {
        const applied = recordWebProResult(profile, assignment.id, { files, apply: true, note: 'extracted from bound Preview snapshot' });
        report.applied = applied.status === 'applied';
        report.files = applied.files.map(f => f.path);
        report.note = 'Read files back from the Preview page and wrote them under the isolated work directory.';
      } else {
        report.note = 'Composer was visible but the page did not return fenced files before this wait ended.';
      }
    } else {
      report.note = 'Opened chatgpt.com in the bound Preview window; snapshot was neither a clear composer nor a clear login wall.';
    }
    report.ok = report.bound;
  } catch (error) {
    report.note = String(error?.message || error);
  } finally {
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, JSON.stringify({ ...report, electron: process.versions.electron, profile, work }, null, 2) + '\n');
    console.log(JSON.stringify(report));
    try { await tool('preview_close'); } catch {}
    owner.destroy();
    app.exit(report.bound ? 0 : 1);
  }
}).catch(error => { console.error(error); app.exit(1); });
