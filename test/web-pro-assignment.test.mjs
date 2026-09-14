import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createWebProAssignment,
  recordWebProSnapshot,
  recordWebProResult,
  extractFencedFiles,
  snapshotNeedsLogin,
  snapshotHasComposer,
  webProPastePrompt,
} from '../electron/web-pro-assignment.mjs';
import { installDesktopPreviewSkill } from '../electron/preview-mcp.mjs';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-pro-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'work');
  fs.mkdirSync(cwd);
  return { root, cwd, userData: path.join(root, 'ui') };
}

test('assignment records login walls, composer, and refuses path escape', t => {
  const { cwd, userData } = tmp(t);
  const row = createWebProAssignment(userData, { task: 'write add.mjs only', cwd, title: 'tiny' });
  assert.match(webProPastePrompt(row.task), /add\.mjs/);
  assert.equal(snapshotNeedsLogin('Log in\nContinue with Google'), true);
  assert.equal(snapshotHasComposer('Ask anything\ncombobox'), true);
  const login = recordWebProSnapshot(userData, row.id, 'Log in\nSign up');
  assert.equal(login.status, 'needs-login');
  const ready = recordWebProSnapshot(userData, row.id, 'Ask anything\nWhat can I help with?');
  assert.equal(ready.status, 'ready');
  assert.throws(() => recordWebProResult(userData, row.id, { files: [{ path: '../escape.mjs', content: 'no' }], apply: true }), /越界/);
  const applied = recordWebProResult(userData, row.id, {
    files: [{ path: 'add.mjs', content: 'export function add(a,b){return a+b}' }],
    apply: true,
    note: 'from synthetic page text',
  });
  assert.equal(applied.status, 'applied');
  assert.equal(fs.readFileSync(path.join(cwd, 'add.mjs'), 'utf8'), 'export function add(a,b){return a+b}');
});

test('fenced files are taken from page text, not from a helper writing the product', () => {
  const files = extractFencedFiles('```js add.mjs\nexport const n=1\n```\n```js add.test.mjs\nassert.equal(1,1)\n```');
  assert.deepEqual(files.map(f => f.path), ['add.mjs', 'add.test.mjs']);
  assert.match(files[0].content, /export const n=1/);
});

test('Desktop installs Preview and web-pro skills into GROK_HOME without touching a user copy', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const old = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    installDesktopPreviewSkill();
    const preview = fs.readFileSync(path.join(home, 'skills', 'desktop-preview', 'SKILL.md'), 'utf8');
    const web = fs.readFileSync(path.join(home, 'skills', 'web-pro-handoff', 'SKILL.md'), 'utf8');
    assert.match(preview, /desktop-preview__preview_open/);
    assert.match(web, /chatgpt.com/);
    assert.match(web, /Restart agent/);
    assert.match(web, /Do not write the answer yourself/);
    fs.writeFileSync(path.join(home, 'skills', 'web-pro-handoff', 'SKILL.md'), 'user copy');
    installDesktopPreviewSkill();
    assert.equal(fs.readFileSync(path.join(home, 'skills', 'web-pro-handoff', 'SKILL.md'), 'utf8'), 'user copy');
  } finally {
    if (old === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = old;
  }
});
