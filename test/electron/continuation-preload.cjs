require('../../electron/preload.cjs');const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('continuationTest',{info:()=>ipcRenderer.invoke('test:info')});
