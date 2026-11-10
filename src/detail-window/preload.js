const { contextBridge, ipcRenderer } = require('electron');

// Expose only what the Detail window needs, under the same window.taskAPI name.
contextBridge.exposeInMainWorld('taskAPI', {
  // Ask main for one task's full details by id.
  getDetail: (taskId) => ipcRenderer.invoke('tasks:getDetail', taskId),

  // Run a callback whenever main pushes the updated task list.
  onTasksUpdated: (callback) => {
    const handler = (_event, tasks) => callback(tasks);
    ipcRenderer.on('tasks:updated', handler);
    return () => ipcRenderer.removeListener('tasks:updated', handler);
  },
});

console.log('[preload] Detail window — taskAPI exposed via contextBridge.');