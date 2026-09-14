import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const electron=createRequire(import.meta.url)('electron');
const args=[...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[]),'test/electron/knowledge-transfer-smoke.mjs'];
const xvfb=process.platform==='linux'&&!process.env.DISPLAY;
const r=spawnSync(xvfb?'xvfb-run':electron,xvfb?['-a',electron,...args]:args,{stdio:'inherit',timeout:45000,killSignal:'SIGKILL'});
if(r.error) console.error(r.error);
process.exitCode=r.status===0?0:1;
