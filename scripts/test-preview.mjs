/** Run real Preview/Playwright checks in an isolated profile, then restart it. */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const electron = require('electron');
const root = fileURLToPath(new URL('../',import.meta.url));
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'desktop-preview-verification-'));
const logDir = process.env.DESKTOP_TEST_EVIDENCE_DIR;
let code = 0;
try {
  for (const phase of ['operations','restore']) {
    const args = [];
    // Only the isolated Linux test process needs this in root-owned CI.
    if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
    args.push(path.join(root,'test/electron/preview-owner-smoke.mjs'));
    const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
    const result = spawnSync(useXvfb ? 'xvfb-run' : electron, useXvfb ? ['-a',electron,...args] : args, {
      cwd: root,
      env: {...process.env,DESKTOP_TEST_PREVIEW_PROFILE:profile,DESKTOP_TEST_PREVIEW_PHASE:phase},
      encoding:'utf8',timeout:45000,killSignal:'SIGKILL',maxBuffer:8*1024*1024,
    });
    const output = `${result.stdout||''}${result.stderr||''}`;
    process.stdout.write(output);
    if (logDir) { fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,`preview-${phase}.log`),output); }
    if (result.error || result.status !== 0 || !/"ok"\s*:\s*true/.test(result.stdout||'')) {
      throw result.error || new Error(`Preview ${phase} failed (status ${result.status}, signal ${result.signal})`);
    }
  }
} catch(err) { console.error(err);code=1; }
finally { fs.rmSync(profile,{recursive:true,force:true}); }
process.exitCode=code;
