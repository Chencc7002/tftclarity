const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  snapshot: () => ipcRenderer.invoke('pet:snapshot'),
  interact: kind => ipcRenderer.invoke('pet:interact', kind),
  action: name => ipcRenderer.send('pet:action', name),
  hit: hit => ipcRenderer.send('pet:hit', hit),
  sendMessage: text => ipcRenderer.invoke('pet:send-message', text),
  onCompose: callback => { const listener = () => callback(); ipcRenderer.on('pet:compose', listener); return () => ipcRenderer.removeListener('pet:compose', listener); },
  onComposerBlur: callback => { const listener = () => callback(); ipcRenderer.on('pet:composer-blur', listener); return () => ipcRenderer.removeListener('pet:composer-blur', listener); },
  onInteraction: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('pet:interaction', listener); return () => ipcRenderer.removeListener('pet:interaction', listener); },
  onState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('pet:state', listener); return () => ipcRenderer.removeListener('pet:state', listener); },
});
