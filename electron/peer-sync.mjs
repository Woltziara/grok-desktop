/** Peer transfer is an explicit, locally exported candidate, not a remote installer.
 * Historical SSH credentials stay untouched; this module never reads or copies them.
 */
import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readBuildIdentity} from './build-identity.mjs';
const exec=promisify(execFile);
const disabled=()=>({ok:false,error:'旧的整机时间覆盖及登录搬运已停用。请在设置中导出选定会话/资料；工作认识使用独立接续入口。'});
export async function peerStatus(){return {mode:'explicit-files',label:'另一台机器',online:false,paired:false,sshReady:false,credentialMigration:false};}
export const pairPeer=disabled,alignPeer=disabled,copyAuthToPeer=disabled,peerAccountSummary=async()=>({ok:false,account:null,reason:'per-machine-login'});
export async function exportApplicationCandidate({appPath,execPath,version,isPackaged,destination,platform=process.platform}){
  if(!isPackaged||platform!=='darwin')throw Error('这里只能导出当前正在运行的正式 macOS 候选包；开发源码不能回退复制旧安装。');
  const marker='.app/Contents/MacOS/',at=execPath.lastIndexOf(marker);if(at<0)throw Error('当前进程不是完整的 macOS 应用包。');
  const source=execPath.slice(0,at+4),identity=readBuildIdentity(appPath,version);
  if(identity.unverified||identity.dirty!==false||!identity.sourceCommit)throw Error('当前包没有干净源码提交标识，请从指定 Git 提交重新完整构建后再带走。');
  if(fs.existsSync(destination))throw Error('导出目录已经存在，未覆盖。请使用新目录。');
  fs.mkdirSync(destination,{recursive:true,mode:0o700});const tmp=path.join(destination,'candidate-'+randomUUID()+'.zip');
  try{await exec('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',source,tmp],{timeout:300000});const bytes=fs.readFileSync(tmp),sha256=createHash('sha256').update(bytes).digest('hex');const name=`Grok-Desktop-${version}-${identity.sourceDigest.slice(0,12)}.zip`;fs.renameSync(tmp,path.join(destination,name));const manifest={...identity,platform,arch:process.arch,archive:name,sha256,size:bytes.length};fs.writeFileSync(path.join(destination,'candidate-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return {ok:true,path:destination,manifest};}catch(error){try{fs.unlinkSync(tmp);}catch{}throw error;}
}
export const copyAppToPeer=disabled;
