import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  snapshotNeedsLogin,
  snapshotHasComposer,
  snapshotShowsGptPro,
  snapshotReplyFinished,
  snapshotStage,
} from '../electron/web-pro-page.mjs';
import { installDesktopPreviewSkill } from '../electron/preview-mcp.mjs';

const loginZh = `URL: https://chatgpt.com/auth/login
Title: 开始使用 | ChatGPT
Snapshot:
- heading "登录或注册" [level=2] [ref=e18]
- form "登录或注册" [ref=e19]:
  - button "使用 Google 账户继续" [ref=e21]
  - button "使用 Apple 账户继续" [ref=e27]
  - textbox "Email address" [ref=e48]
  - button "继续" [ref=e49]`;

const loginEn = `URL: https://chatgpt.com/auth/login
- heading "Log in or sign up" [level=1]
- form "Log in":
  - button "Continue with Google"
  - textbox "Email address"`;

const composerNotPro = `URL: https://chatgpt.com/
- combobox "GPT-5" [ref=e8]
- textbox "Ask anything" [ref=e20]`;

const composerProEn = `URL: https://chatgpt.com/
- combobox "GPT-5 Pro" [ref=e8]
- textbox "Ask anything" [ref=e20]
- button "Copy" [ref=e40]`;

const composerProZh = `URL: https://chatgpt.com/
- combobox "GPT-5 专业版" [ref=e8]
- textbox "有什么可以帮忙的" [ref=e20]
- button "复制" [ref=e40]`;

const upgradeNoise = `URL: https://chatgpt.com/
- combobox "GPT-5" [ref=e8]
- link "升级到 ChatGPT Pro" [ref=e9]
- button "Upgrade to Go" [ref=e10]
- textbox "Ask anything" [ref=e20]`;

const streaming = `URL: https://chatgpt.com/
- combobox "ChatGPT Pro" [ref=e8]
- textbox "Ask anything" [ref=e20]
- button "Stop generating" [ref=e30]`;

test('login walls are stage needs-login in Chinese and English', () => {
  assert.equal(snapshotNeedsLogin(loginZh), true);
  assert.equal(snapshotHasComposer(loginZh), false);
  assert.equal(snapshotStage(loginZh), 'needs-login');
  assert.equal(snapshotStage(loginEn), 'needs-login');
});

test('subscription or upgrade copy is not the selected GPT Pro model', () => {
  assert.equal(snapshotHasComposer(composerNotPro), true);
  assert.equal(snapshotShowsGptPro(composerNotPro), false);
  assert.equal(snapshotStage(composerNotPro), 'needs-pro');
  assert.equal(snapshotShowsGptPro(upgradeNoise), false);
  assert.equal(snapshotStage(upgradeNoise), 'needs-pro');
});

test('selected picker names with Pro or 专业版 count; streaming is not finished', () => {
  assert.equal(snapshotShowsGptPro(composerProEn), true);
  assert.equal(snapshotShowsGptPro(composerProZh), true);
  assert.equal(snapshotReplyFinished(composerProEn), true);
  assert.equal(snapshotReplyFinished(streaming), false);
  assert.equal(snapshotStage(streaming), 'composer');
  assert.equal(snapshotStage(composerProZh), 'reply-ready');
});

test('web-pro skill requires bound Preview, live Pro picker, and finished replies', () => {
  const skill = fs.readFileSync(new URL('../electron/web-pro/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /desktop-preview__preview_open/);
  assert.match(skill, /专业版/);
  assert.match(skill, /Stop generating|停止生成/);
  assert.match(skill, /file tools/);
  assert.doesNotMatch(skill, /web-pro:create|recordWebProResult/);
  assert.doesNotMatch(skill, /12 second|12秒/);
});

test('Desktop still installs the Preview and web-pro skills without overwriting a user copy', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const old = process.env.GROK_HOME;
  process.env.GROK_HOME = home;
  try {
    installDesktopPreviewSkill();
    const web = fs.readFileSync(path.join(home, 'skills', 'web-pro-handoff', 'SKILL.md'), 'utf8');
    assert.match(web, /currently selected model/);
    fs.writeFileSync(path.join(home, 'skills', 'web-pro-handoff', 'SKILL.md'), 'user copy');
    installDesktopPreviewSkill();
    assert.equal(fs.readFileSync(path.join(home, 'skills', 'web-pro-handoff', 'SKILL.md'), 'utf8'), 'user copy');
  } finally {
    if (old === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = old;
  }
});
