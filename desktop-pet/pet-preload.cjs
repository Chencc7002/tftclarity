const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  snapshot: () => ipcRenderer.invoke('pet:snapshot'),
  interact: kind => ipcRenderer.invoke('pet:interact', kind),
  action: name => ipcRenderer.send('pet:action', name),
  hit: hit => ipcRenderer.send('pet:hit', hit),
  onState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('pet:state', listener); return () => ipcRenderer.removeListener('pet:state', listener); },
});
