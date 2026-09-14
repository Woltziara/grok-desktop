import {readDraft,readReading,saveDraft,saveReading,addProjectToOrder,type SessionDraft} from './workspace-store';
import {getDraftBlob,putDraftBlob} from './draft-blobs';
export type CarriedFlow={draft:(SessionDraft & {files:Array<SessionDraft['files'][number]&{blobData?:string}>})|null;reading:number|null};
export async function captureContinuationFlow(cwd:string,id:string):Promise<CarriedFlow>{
  window.dispatchEvent(new Event('grok-flush-draft'));
  const draft=readDraft(cwd,id);const value:CarriedFlow={draft:draft?JSON.parse(JSON.stringify(draft)):null,reading:readReading(cwd,id)};
  for(const file of value.draft?.files||[]){if(file.kind!=='image')continue;const blob=await getDraftBlob(file.blobId||file.id);if(blob){file.blobData=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}else if(!file.dataUrl)throw Error('一张草稿原图暂时读不到，未导出不完整的接续包。');}
  return value;
}
export async function applyContinuationFlow(cwd:string,id:string,flow:CarriedFlow|null,expected:SessionDraft|null){
  if(!flow)return;const draft=flow.draft?JSON.parse(JSON.stringify(flow.draft)) as NonNullable<CarriedFlow['draft']>:null;
  for(const file of draft?.files||[]){if(!file.blobData)continue;const bytes=Uint8Array.from(atob(file.blobData),c=>c.charCodeAt(0)),blobId='carry-'+crypto.randomUUID();await putDraftBlob(blobId,new Blob([bytes],{type:file.mimeType}));file.blobId=blobId;file.id=blobId;delete file.blobData;}
  if(JSON.stringify(readDraft(cwd,id))!==JSON.stringify(expected))throw Error('接入期间本机草稿又有变化，没有覆盖；带来的草稿仍在接续原包中。');
  const saved=saveDraft(cwd,id,draft);if(!saved.ok)throw Error(saved.error||'草稿保存失败；原包仍保留。');
  if(flow.reading!==null)saveReading(cwd,id,flow.reading);addProjectToOrder(cwd);
}
