const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Fetch any URL from main process (bypasses CORS)
  fetchUrl: (url) => ipcRenderer.invoke('fetch-url', url),
  // GET with custom headers (for Aletheia and other header-auth APIs)
  fetchGet: (args) => ipcRenderer.invoke('fetch-get', args),
  // POST request (for Groq)
  fetchPost: (args) => ipcRenderer.invoke('fetch-post', args),
  // Platform info
  platform: process.platform,
});
