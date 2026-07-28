const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('volputasDesktop', {
  chooseDataRepository: () => ipcRenderer.invoke('desktop:choose-data-repository'),
  openSetupScripts: () => ipcRenderer.invoke('desktop:open-setup-scripts'),
  platform: process.platform,
});
