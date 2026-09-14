// Test-only controls. Production preload is loaded unchanged.
require('../../electron/preload.cjs');
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('deliveryTest',{
  info:()=>ipcRenderer.invoke('test:info'), switch:id=>ipcRenderer.invoke('test:switch',id),
  calls:()=>ipcRenderer.invoke('test:calls'), complete:id=>ipcRenderer.invoke('test:complete',id),
  delay:kind=>ipcRenderer.invoke('test:delay',kind), release:kind=>ipcRenderer.invoke('test:release',kind),
  pending:()=>ipcRenderer.invoke('test:pending'), fixturePath:()=>ipcRenderer.invoke('test:fixture-path'),
  foreignEvents:()=>ipcRenderer.invoke('test:foreign-events'),
});
