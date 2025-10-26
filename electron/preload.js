const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 打开文件
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  
  // 打开文件选择对话框
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  
  // 渲染帧
  renderFrame: (frameIndex, targetSize) => ipcRenderer.invoke('render-frame', frameIndex, targetSize),
  
  // 获取当前文件
  getCurrentFile: () => ipcRenderer.invoke('get-current-file'),
  
  // 启动文件监控
  startFileWatch: (filePath) => ipcRenderer.invoke('startFileWatch', filePath),
  
  // 停止文件监控
  stopFileWatch: () => ipcRenderer.invoke('stopFileWatch'),
  
  // 监听文件更新事件
  onFileUpdated: (callback) => ipcRenderer.on('file-updated', callback),
  onFileUpdateError: (callback) => ipcRenderer.on('file-update-error', callback),
  onFileWatchError: (callback) => ipcRenderer.on('file-watch-error', callback),
  
  // 监听强制刷新事件
  onForceRefresh: (callback) => ipcRenderer.on('force-refresh', callback),
  
  // 移除事件监听器
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
