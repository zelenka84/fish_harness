const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fish", {
  desktop: true,
  pickFolder: (current) => ipcRenderer.invoke("fish:pick-folder", current),
});
