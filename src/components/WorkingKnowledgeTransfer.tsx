import {useCallback,useEffect,useState} from 'react';
import type {WorkingKnowledgeItem,WorkingKnowledgeTransferPlan} from '../vite-env';
const labels:Record<string,string>={new:'本机还没有这件事',equal:'两边内容相同','incoming-ahead':'带来的版本接在本机之后','local-ahead':'本机已包含这份旧版本',conflict:'两边都有独立修改，需要你选择'};
function RecordView({record}:{record:WorkingKnowledgeItem|null}) {
  return record?<div><p>{record.text}</p><small>{record.epistemic==='model_inferred'?'模型推断':record.source?.type==='user'?'用户记录':record.epistemic||'来源待核'}{record.source?.quote?` · 原话：${record.source.quote}`:''}</small></div>:<p>这一版没有此条当前认识；历史仍在接续包或备份中。</p>;
}
export function WorkingKnowledgeTransfer({objectId='',onChanged=()=>{}}:{objectId?:string;onChanged?:()=>void}) {
  const [plan,setPlan]=useState<WorkingKnowledgeTransferPlan|null>(null),[pending,setPending]=useState<Array<{token:string;title:string;sourceMachine:string}>>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const reload=useCallback(async()=>setPending(await window.grokDesktop.listWorkingKnowledgeTransfers()),[]);
  useEffect(()=>{void reload().catch(e=>setNotice(String(e.message||e)));},[reload]);
  async function run(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(String((e as Error).message||e));}finally{setBusy(false);}}
  async function accept(choice:'continue'|'keep-local'|'use-incoming'){
    if(!plan)return;const captured=plan;
    await run(async()=>{const result=await window.grokDesktop.acceptWorkingKnowledgeTransfer({token:captured.token,localHead:captured.localHead,choice});setPlan(null);setNotice(result.backup?`已接续，接入前原件保存在：${result.backup}`:'已处理，未静默覆盖其他版本。');await reload();onChanged();});
  }
  return <section className="wk-group" aria-label="跨机器接续">
    <h3>带到另一台机器接着做</h3>
    <p className="settings-desc">先在主机导出已确认的这件事，再在另一台机器接入。同一份包带着当前认识、原话、来源和撤回历史，不含登录、凭据、其他项目或本机设置。文件本身可能含业务信息，请只交给可信的另一台机器。</p>
    <div className="wk-item-actions">
      <button className="btn ghost btn-sm" disabled={busy||!objectId} onClick={()=>void run(async()=>{const result=await window.grokDesktop.exportWorkingKnowledge(objectId);if(result.path)setNotice(`已导出：${result.path}`);})}>导出当前这件事</button>
      <button className="btn ghost btn-sm" disabled={busy} onClick={()=>void run(async()=>{const result=await window.grokDesktop.importWorkingKnowledge();if(result.plan)setPlan(result.plan);await reload();})}>接入另一台带来的版本</button>
    </div>
    {pending.length>0&&<div><p>尚未处理的接续包（关闭后仍保留）</p>{pending.map(p=><button className="btn ghost btn-sm" disabled={busy} key={p.token} onClick={()=>void run(async()=>setPlan(await window.grokDesktop.previewWorkingKnowledgeTransfer(p.token)))}>{p.title} · {p.sourceMachine} · 查看</button>)}</div>}
    {plan&&<div className="wk-item" role="region" aria-label="接续差异">
      <h4>{plan.title}：{labels[plan.kind]}</h4><p>来自 {plan.sourceMachine}。记录时间仅供辨认，不用于裁定哪一版正确。</p>
      {plan.localTitle&&plan.localTitle!==plan.title&&<p>本机名称：{plan.localTitle}</p>}
      <p>本机待处理原话 {plan.localPending} 条；带来的版本 {plan.incomingPending} 条。</p>
      {plan.changes.map(c=><details key={c.id} className="wk-item"><summary>查看一条变化</summary><strong>本机这一版</strong><RecordView record={c.local}/><strong>带来的这一版</strong><RecordView record={c.incoming}/></details>)}
      {plan.kind==='conflict'?<><p>选择按整件事生效，不会自动拼接两边互相矛盾的判断。两份原件都会保留；接入后可继续逐条纠正。</p><button className="btn btn-sm" disabled={busy} onClick={()=>void accept('keep-local')}>这一轮保留本机版</button><button className="btn ghost btn-sm" disabled={busy} onClick={()=>void accept('use-incoming')}>这一轮采用带来的版</button></>:<button className="btn btn-sm" disabled={busy} onClick={()=>void accept(plan.kind==='local-ahead'?'keep-local':'continue')}>{plan.kind==='equal'||plan.kind==='local-ahead'?'保留当前版并完成核对':'确认接续这份版本'}</button>}
      <button className="btn ghost btn-sm" disabled={busy} onClick={()=>setPlan(null)}>暂不处理</button>
    </div>}
    {notice&&<p role="status" className="wk-save-note">{notice}</p>}
  </section>;
}
