/** Build once from this source tree. Never infer a release from timestamps or an old installed app. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
export function sourceIdentity(root){
  const files=[];function walk(rel){const file=path.join(root,rel),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error(`Build source is a symlink: ${rel}`);if(stat.isDirectory()){for(const name of fs.readdirSync(file).sort())walk(`${rel}/${name}`);}else if(stat.isFile())files.push([rel,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);}
  for(const name of ['electron','shared','src','public','build','scripts','package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json'])if(fs.existsSync(path.join(root,name)))walk(name);
  const sourceDigest=createHash('sha256').update(JSON.stringify(files.sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
  let commit=null,dirty=null;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=Boolean(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim());}catch{}
  return {schema:1,version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,sourceCommit:commit,sourceDigest,dirty,sourceFileCount:files.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const root=process.cwd(),identity=sourceIdentity(root);fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.writeFileSync(path.join(root,'dist/build-identity.json'),JSON.stringify(identity,null,2)+'\n');console.log('Build identity:',JSON.stringify(identity));}
