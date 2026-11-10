const { contextBridge, ipcRenderer } = require('electron');

// Expose only what the Detail window needs, under the same window.taskAPI name.
contextBridge.exposeInMainWorld('taskAPI', {
  // Ask main for one task's full details by id.
  getDetail: (taskId) => ipcRenderer.invoke('tasks:getDetail', taskId),
});

console.log('[preload] Detail window — taskAPI exposed via contextBridge.');