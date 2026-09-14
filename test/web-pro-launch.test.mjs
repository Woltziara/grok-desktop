import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('main launch flags open Preview after a real session and never register a second assignment API', () => {
  const main = readFileSync(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /open-preview/);
  assert.match(main, /handoff-prompt/);
  assert.match(main, /afterLaunchSession/);
  assert.match(main, /preview-launch\.json/);
  assert.doesNotMatch(main, /registerWebProIpc|web-pro:create|recordWebProResult/);
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(preload, /web-pro:/);
});
