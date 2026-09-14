/** Launch a bound Desktop Preview against chatgpt.com. Isolated profile, no other-browser cookies. */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const electron = require('electron');
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = process.env.DESKTOP_WEB_PRO_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-web-pro-'));
const work = process.env.DESKTOP_WEB_PRO_WORK || fs.mkdtempSync(path.join(os.tmpdir(), 'web-pro-work-'));
const evidence = process.env.DESKTOP_WEB_PRO_EVIDENCE || path.join(work, 'WIRING.json');
const args = [];
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
args.push(path.join(root, 'test/electron/web-pro-wiring.mjs'));
const result = spawnSync(electron, args, {
  cwd: root,
  env: {
    ...process.env,
    DESKTOP_WEB_PRO_PROFILE: profile,
    DESKTOP_WEB_PRO_WORK: work,
    DESKTOP_WEB_PRO_EVIDENCE: evidence,
  },
  encoding: 'utf8',
  timeout: 90000,
  killSignal: 'SIGKILL',
  maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error || result.status !== 0) {
  console.error(result.error || `web-pro wiring exited ${result.status} signal ${result.signal}`);
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
if (!process.env.DESKTOP_WEB_PRO_PROFILE) {
  /* keep evidence; isolated profile is disposable unless the caller retained it */
}
