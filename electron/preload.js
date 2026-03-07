const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Fetch any URL from main process (bypasses CORS)
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),
  // POST request (for Groq)
  fetchPost: (args) => ipcRenderer.invoke('fetch-post', args),
  // Platform info
  platform: process.platform,
});
