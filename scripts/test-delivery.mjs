/** Real renderer + main delivery checks, then cold-process recovery. No real account. */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const electron=createRequire(import.meta.url)('electron');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-delivery-processes-'));
try {
  for (const phase of ['operations','restore']) {
    const args=[...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[]),'test/electron/delivery-smoke.mjs'];
    const xvfb=process.platform==='linux'&&!process.env.DISPLAY;
    const result=spawnSync(xvfb?'xvfb-run':electron,xvfb?['-a',electron,...args]:args,{env:{...process.env,DESKTOP_DELIVERY_TEST_ROOT:root,DESKTOP_DELIVERY_PHASE:phase},encoding:'utf8',timeout:60000,killSignal:'SIGKILL',maxBuffer:8*1024*1024});
    const output=(result.stdout||'')+(result.stderr||'');process.stdout.write(output);
    if(process.env.DESKTOP_TEST_EVIDENCE_DIR){fs.mkdirSync(process.env.DESKTOP_TEST_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.DESKTOP_TEST_EVIDENCE_DIR,`delivery-${phase}.log`),output);}
    if(result.error||result.status!==0||!/'ok':true|"ok":true/.test(result.stdout||''))throw result.error||new Error(`Delivery ${phase} failed (${result.status})`);
  }
} catch(error) { console.error(error);process.exitCode=1; }
finally {fs.rmSync(root,{recursive:true,force:true});}
