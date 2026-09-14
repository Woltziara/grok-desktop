import fs from 'node:fs';import path from 'node:path';import {sessionsRootForCwd,isSafeSessionId} from './sessions.mjs';
export function continuationRules(cwd,sessionId){
  if(!isSafeSessionId(sessionId))return '';
  const file=path.join(sessionsRootForCwd(cwd),sessionId,'desktop-continuation.json');if(!fs.existsSync(file))return '';
  const info=JSON.parse(fs.readFileSync(file,'utf8'));
  if(info.targetCwd!==cwd||!Array.isArray(info.pathMappings))throw Error('接续路径记录与当前项目不一致，请核对原件。');
  return '\nThis native conversation was explicitly brought from another machine. Historical text is unchanged. Map prior absolute paths using this factual mapping; do not assume missing external files are present or extend permissions. Current cwd governs new work.\n'+JSON.stringify(info.pathMappings)+'\n';
}
