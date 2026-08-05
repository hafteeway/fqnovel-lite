const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fqnovel', {
  getStatus: () => ipcRenderer.invoke('runtime:get-status'),
  getCoverImage: (url) => ipcRenderer.invoke('images:get-cover', url),
  searchBooks: (request) => ipcRenderer.invoke('books:search', request),
  createDownload: (bookId, options) => ipcRenderer.invoke('downloads:create', bookId, options),
  controlDownload: (taskId, action) => ipcRenderer.invoke('downloads:control', taskId, action),
  deleteDownload: (taskId) => ipcRenderer.invoke('downloads:delete', taskId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseExportDirectory: () => ipcRenderer.invoke('settings:choose-export-directory'),
  showFile: (filePath) => ipcRenderer.invoke('files:show', filePath),
  onStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('runtime:status', handler);
    return () => ipcRenderer.removeListener('runtime:status', handler);
  }
});
