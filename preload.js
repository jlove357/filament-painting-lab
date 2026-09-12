const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lab', {
  load: () => ipcRenderer.invoke('lab:load'),
  save: (data) => ipcRenderer.invoke('lab:save', data),
  dataPath: () => ipcRenderer.invoke('lab:path'),
  importImage: (payload) => ipcRenderer.invoke('lab:image-import', payload),
  readImage: (image) => ipcRenderer.invoke('lab:image-read', image),
  removeImage: (image) => ipcRenderer.invoke('lab:image-remove', image),
  exportHeightMap: (payload) => ipcRenderer.invoke('lab:heightmap-export', payload),
  exportColorSchedule: (payload) => ipcRenderer.invoke('lab:schedule-export', payload)
});
