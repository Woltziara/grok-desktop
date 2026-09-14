/** Preview-bound ChatGPT assignment records. Not a second agent or workflow engine. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from './session-delivery.mjs';

export const WEB_PRO_FORMAT = 'grok-desktop-web-pro-v1';
export const WEB_PRO_URL = 'https://chatgpt.com/';
const LIMIT = 4 * 1024 * 1024;

function slot(userData, id) {
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('无效的网页 Pro 交办标识。');
  return path.join(assignmentRoot(userData), `${id}.json`);
}
export function assignmentRoot(userData) {
  if (!userData || !path.isAbsolute(userData)) throw new Error('交办记录必须放在本应用用户数据目录。');
  const root = path.join(userData, 'web-pro-assignments');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}
export function webProPastePrompt(task) {
  const text = String(task || '').trim();
  if (!text) throw new Error('请先写清要交给网页 GPT Pro 的任务。');
  return [
    'Please complete this bounded development task. No secrets, no credentials, no extra files.',
    'Reply with the complete file contents only, each in a markdown code fence labeled with the exact relative path.',
    text,
  ].join('\n\n');
}
export function snapshotNeedsLogin(text) {
  const body = String(text || '');
  if (/Ask anything|Message ChatGPT|composer|prompt-textarea|What can I help/i.test(body) && !/\bLog in\b|\bSign up\b|验证码|Passkey/i.test(body)) return false;
  return /\bLog in\b|\bSign up\b|Continue with Google|验证码|Enter code|Passkey|登录|注册/.test(body);
}
export function snapshotHasComposer(text) {
  return /Ask anything|Message ChatGPT|prompt-textarea|What can I help|composer/i.test(String(text || ''));
}
function safeRel(cwd, rel) {
  const name = String(rel || '').replaceAll('\\', '/');
  if (!name || name.includes('\0') || path.posix.isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error(`交办产物路径越界：${rel}`);
  }
  const target = path.resolve(cwd, name);
  const root = path.resolve(cwd);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`交办产物路径越界：${rel}`);
  return { name, target };
}
export function createWebProAssignment(userData, { task, cwd, title } = {}) {
  const prompt = webProPastePrompt(task);
  if (!path.isAbsolute(cwd || '') || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('交办工作目录不存在。');
  const row = {
    format: WEB_PRO_FORMAT,
    id: randomUUID(),
    title: String(title || '网页 GPT Pro 交办'),
    task: String(task).trim(),
    prompt,
    cwd,
    url: WEB_PRO_URL,
    status: 'open',
    createdAt: new Date().toISOString(),
    snapshots: [],
    files: [],
    error: null,
  };
  atomicWrite(slot(userData, row.id), row);
  return row;
}
export function readWebProAssignment(userData, id) {
  const file = slot(userData, id);
  if (!fs.existsSync(file)) throw new Error('找不到这份网页 Pro 交办。');
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (row.format !== WEB_PRO_FORMAT || row.id !== id) throw new Error('交办记录不兼容。');
  return row;
}
export function listWebProAssignments(userData) {
  const root = assignmentRoot(userData);
  return fs.readdirSync(root).filter(name => name.endsWith('.json')).map(name => {
    try { return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); }
    catch { return null; }
  }).filter(row => row?.format === WEB_PRO_FORMAT).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
export function recordWebProSnapshot(userData, id, text) {
  const row = readWebProAssignment(userData, id);
  const body = String(text || '');
  if (Buffer.byteLength(body) > LIMIT) throw new Error('网页读回过长，未保存。');
  row.snapshots.push({ at: new Date().toISOString(), bytes: Buffer.byteLength(body), excerpt: body.slice(0, 4000) });
  if (snapshotNeedsLogin(body)) {
    row.status = 'needs-login';
    row.error = 'Preview 里的 ChatGPT 需要本人登录后才能交办。不要从其他浏览器拷贝登录。';
  } else if (snapshotHasComposer(body)) {
    row.status = 'ready';
    row.error = null;
  } else if (row.status === 'open' || row.status === 'needs-login') {
    row.status = 'waiting';
    row.error = null;
  }
  atomicWrite(slot(userData, id), row);
  return row;
}
export function recordWebProResult(userData, id, { files = [], note = '', apply = false } = {}) {
  const row = readWebProAssignment(userData, id);
  if (!Array.isArray(files) || files.length > 32) throw new Error('交办产物过多或不完整。');
  const written = [];
  for (const file of files) {
    const { name, target } = safeRel(row.cwd, file.path);
    const content = String(file.content || '');
    if (Buffer.byteLength(content) > LIMIT) throw new Error(`产物过大：${name}`);
    written.push({ path: name, sha256: null, bytes: Buffer.byteLength(content) });
    if (apply) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${randomUUID()}.tmp`;
      fs.writeFileSync(tmp, content, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tmp, target);
    }
  }
  row.files = written;
  row.note = String(note || '');
  row.status = apply ? 'applied' : 'received';
  row.error = null;
  row.finishedAt = new Date().toISOString();
  atomicWrite(slot(userData, id), row);
  return row;
}
export function extractFencedFiles(text) {
  const files = [];
  const body = String(text || '');
  const re = /```(?:[\w.-]+)?[ \t]+([\w./-]+)\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(body))) files.push({ path: match[1], content: match[2].replace(/\n$/, '') });
  return files;
}
