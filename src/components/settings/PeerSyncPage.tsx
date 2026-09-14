import {useCallback,useEffect,useState} from 'react';
import {WorkingKnowledgeTransfer} from '../WorkingKnowledgeTransfer';
import {captureContinuationFlow,applyContinuationFlow} from '../../lib/continuation-flow';
import {readDraft} from '../../lib/workspace-store';
import type {ContinuationPlan,SessionSummary} from '../../vite-env';
export function PeerSyncPage({open}:{open:boolean;restarting?:boolean;onRestartAgent?:()=>void}){
  const [rows,setRows]=useState<SessionSummary[]>([]),[selected,setSelected]=useState(''),[materials,setMaterials]=useState<string[]>([]),[plan,setPlan]=useState<ContinuationPlan|null>(null),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[pending,setPending]=useState<Array<{token:string;phase:string;backup:string}>>([]),[identity,setIdentity]=useState('');
  const reload=useCallback(async()=>{setRows(await window.grokDesktop.listContinuations());setPending(await window.grokDesktop.pendingContinuations());const info=await window.grokDesktop.getInfo();setIdentity(JSON.stringify(info.buildIdentity||{version:info.version},null,2));},[]);
  useEffect(()=>{if(open)void reload().catch(e=>setNote(String(e.message||e)));},[open,reload]);
  async function run(fn:()=>Promise<void>){setBusy(true);setNote('');try{await fn();}catch(e){setNote(String((e as Error).message||e));}finally{setBusy(false);}}
  const current=rows.find(r=>`${r.cwd}::${r.id}`===selected);
  async function accept(choice:'incoming'|'keep-local'){
    if(!plan)return;const captured=plan;
    await run(async()=>{const expected=readDraft(captured.cwd,captured.sessionId),localFlow=await captureContinuationFlow(captured.cwd,captured.sessionId);const result=await window.grokDesktop.acceptContinuation({token:captured.token,expected:captured.expected,choice,localFlow});
      if(result.changed&&result.cwd&&result.sessionId)await applyContinuationFlow(result.cwd,result.sessionId,result.flow||null,expected);
      if(result.changed)await window.grokDesktop.acknowledgeContinuationFlow(captured.token);
      setPlan(null);setNote(result.backup?`已接续，原件备份：${result.backup}。从左边打开这段对话；未确认发送不会自动重发。`:'保留了当前版本，带来的原包仍在。');await reload();});
  }
  return <section className="settings-section">
    <h3>带到另一台机器接着做</h3>
    <p className="settings-desc settings-lead">默认从主机导出已确认的版本，在另一台接入。这里只处理你选定的一段对话、草稿、原生附件和资料，不按修改时间覆盖整台机器，不读取另一台登录，也不复制源码旧副本。每台机器分别正常登录。</p>
    <label className="settings-row settings-row-stack">选择一段已保存的对话<select className="settings-input" value={selected} onChange={e=>{setSelected(e.target.value);setMaterials([]);}}><option value="">请选择要带走的对话</option>{rows.map(r=><option key={`${r.cwd}::${r.id}`} value={`${r.cwd}::${r.id}`}>{r.title} · {r.cwd}</option>)}</select></label>
    <p>原生历史、附件、草稿和阅读位置一起带走。文件夹型附件的内容需在下面明确选入；没有带来的外部路径会标为需要重新选择。接续包含业务原文，请只通过可信通道交给自己的另一台机器。</p>
    <button className="btn ghost btn-sm" disabled={busy||!current} onClick={()=>void run(async()=>{if(current)setMaterials(await window.grokDesktop.selectContinuationMaterials(current.cwd));})}>选择一起带走的项目资料</button>
    {materials.length>0&&<pre>{materials.join('\n')}</pre>}
    <div className="wk-item-actions"><button className="btn btn-sm" disabled={busy||!current} onClick={()=>void run(async()=>{if(!current)return;const result=await window.grokDesktop.exportContinuation({cwd:current.cwd,sessionId:current.id,materials,flow:await captureContinuationFlow(current.cwd,current.id)});if(result.path)setNote(`已导出：${result.path}`);})}>导出选定对话和资料</button><button className="btn ghost btn-sm" disabled={busy} onClick={()=>void run(async()=>{const result=await window.grokDesktop.importContinuation();if(result.plan)setPlan(result.plan);await reload();})}>接入带来的对话</button></div>
    {pending.filter(p=>p.phase!=='complete').map(p=><div key={p.token}>{p.phase==='flow-pending'?<button className="btn ghost btn-sm" disabled={busy} onClick={()=>void run(async()=>{const r=await window.grokDesktop.continuationResult(p.token);const existing=readDraft(r.cwd,r.sessionId);if(existing&&!window.confirm('本机有草稿；确认用接续包的草稿替换吗？原包和接入前备份仍保留。'))return;await applyContinuationFlow(r.cwd,r.sessionId,r.flow,existing);await window.grokDesktop.acknowledgeContinuationFlow(p.token);setNote('草稿与阅读位置已恢复。');await reload();})}>恢复上次接入的草稿与阅读位置</button>:p.phase==='prepared'?<><p>上次接入中断，尚未确认完成。备份：{p.backup}</p><button disabled={busy} className="btn ghost btn-sm" onClick={()=>void run(async()=>{await window.grokDesktop.rollbackContinuation(p.token);setNote('已恢复接入前原件；中断状态也已保留。');await reload();})}>检查并恢复接入前原件</button></>:<button className="btn ghost btn-sm" disabled={busy} onClick={()=>void run(async()=>setPlan(await window.grokDesktop.previewContinuation(p.token)))}>查看一份待接入对话</button>}</div>)}
    {plan&&<div className="wk-item" role="region" aria-label="会话接续差异"><h4>{plan.title}</h4><p>目标项目：{plan.cwd}</p><p>{plan.nativeFiles} 份原生会话文件，{plan.materialFiles.length} 份选定资料；{plan.hasDraft?'有草稿':'无草稿'}，{plan.pendingSends} 条未完成发送。</p><p>{plan.nativeConflict?'目标已有同标识的不同对话内容，需要明确选择；不自动合并历史。':'没有发现不同的同标识历史。'}</p>{plan.conflicts.length>0&&<p>以下资料有不同内容：{plan.conflicts.join('、')}。选择采用带来的版本前，当前原件会备份。</p>}<button className="btn" disabled={busy} onClick={()=>void accept('incoming')}>确认采用带来的对话和选定资料</button><button className="btn ghost" disabled={busy} onClick={()=>void accept('keep-local')}>保留本机，不应用这份接续</button><button className="btn ghost" onClick={()=>setPlan(null)}>暂不处理</button></div>}
    <WorkingKnowledgeTransfer/>
    <h3>两台使用同一候选版本</h3><p>先核对下面的源码提交和内容摘要。只导出当前实际运行的完整 macOS 候选包，不停止或覆盖另一台应用。由本机验收后再安装；校验清单与应用归档一起传递。</p><pre>{identity}</pre>
    <button className="btn ghost" disabled={busy} onClick={()=>void run(async()=>{const result=await window.grokDesktop.exportApplicationCandidate();if(result.path)setNote(`候选和校验清单已保存：${result.path}`);})}>导出当前可校验候选包</button>
    {note&&<p role="status">{note}</p>}
  </section>;
}
