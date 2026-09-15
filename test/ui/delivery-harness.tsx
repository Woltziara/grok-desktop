// Test-only shell around production Composer, persistence and delivery hook.
import React, {useState,useRef,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {Composer} from '../../src/components/Composer';
import {usePromptDelivery} from '../../src/hooks/usePromptDelivery';
import {readDraft} from '../../src/lib/workspace-store';
import {getDraftBlob} from '../../src/lib/draft-blobs';
import {AppTooltipProvider} from '../../src/components/ui/tooltip';
import type {ConnState} from '../../src/lib/conn';
import type {TimelineItem} from '../../src/vite-env';
const bridge=(window as any).deliveryTest;
function Harness({paths}:{paths:Record<string,string>}) {
  const [selected,setSelected]=useState('delivery-session-A'),[conn,setConn]=useState<ConnState>('online'),[error,setError]=useState<string|null>(null),[items,setItems]=useState<TimelineItem[]>([]);
  const sessionIdRef=useRef<string|null>(selected);sessionIdRef.current=selected;
  const busyRef=useRef(false);busyRef.current=conn==='busy';
  const openingRef=useRef(false);const noop=useCallback(()=>{},[]);
  const delivery=usePromptDelivery({project:paths[selected],sessionIdRef,conn,busyRef,openingRef,onPromptSent:noop,setConn,setError,setItems,refreshAuth:noop});
  const change=async (id:string)=>{window.dispatchEvent(new Event('grok-flush-draft'));await bridge.switch(id);delivery.clearPromptQueue();setItems([]);setConn('online');setError(null);setSelected(id);};
  (window as any).deliveryHarness={draft:(id:string)=>readDraft(paths[id],id),blob:(id:string)=>getDraftBlob(id),selected};
  return <AppTooltipProvider><div><button onClick={()=>change('delivery-session-A')}>会话 A</button><button onClick={()=>change('delivery-session-B')}>会话 B</button>
    <output id="selected">{selected}</output><output id="connection">{conn}</output><pre id="error">{error}</pre><pre id="transcript">{JSON.stringify(items)}</pre>
    <Composer key={selected} conn={conn} projectOpen={true} commands={[]} promptQueue={delivery.promptQueue} outboxPaused={delivery.outboxPaused} onResumeQueue={delivery.resumeQueue}
      onSubmit={delivery.submitFromComposer} onStop={delivery.stopTurn} onLocalCommand={noop} onSendQueuedNow={delivery.sendQueuedNow} onRemoveQueued={delivery.removeQueued} onQueueEdit={delivery.editQueued} onQueueMove={delivery.moveQueued} onQueueRefreshBrowserReference={delivery.refreshQueuedBrowserReference} onQueueRemoveBrowserReference={delivery.removeQueuedBrowserReference} onError={setError}
      sessionCwd={paths[selected]} sessionId={selected}/></div></AppTooltipProvider>;
}
bridge.info().then((paths:Record<string,string>)=>createRoot(document.getElementById('root')!).render(<Harness paths={paths}/>));
