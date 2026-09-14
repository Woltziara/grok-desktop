import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppSidebar } from '../../src/components/AppSidebar';
import { AppTooltipProvider } from '../../src/components/ui/tooltip';
const moves: unknown[] = [];
(window as any).moveRequests = moves;
(window as any).grokDesktop = {getBilling: async()=>({})};
createRoot(document.getElementById('root')!).render(<AppTooltipProvider><AppSidebar
  infoVersion="test-only" auth={null} backbone={null} project="/A" sessionId="move-session-0001"
  sessions={[{id:'move-session-0001',cwd:'/A',title:'Move me',lastMessageAt:'2026-09-01T00:00:00Z'}] as any}
  recentProjects={['/A','/B']} projectOrder={['/A','/B']} conn="online" isOpening={false} authBusy={false}
  collapsed={false} onToggleCollapsed={()=>{}} onPickProject={()=>{}} onOpenProject={()=>{}} onOpenSession={()=>{}}
  onLogout={()=>{}} onMoveSession={row=>moves.push(row)}
/></AppTooltipProvider>);
