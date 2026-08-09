// =====================================================================
//  Preload — the only bridge between the web UI and the Mac.
//
//  Everything here is additive: the same index.html runs unchanged on
//  GitHub Pages and Android, where window.NF is simply undefined. UI
//  code must therefore feature-detect (`if (window.NF?.isDesktop)`)
//  rather than assume the bridge exists.
// =====================================================================
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("NF", {
  isDesktop: true,
  platform: process.platform,

  tools: {
    list: () => ipcRenderer.invoke("tools:list"),
    run: id => ipcRenderer.invoke("tools:run", id),
    stop: id => ipcRenderer.invoke("tools:stop", id),
    reveal: () => ipcRenderer.invoke("tools:reveal"),

    // Return an unsubscribe function: the renderer re-renders on every data
    // refresh, and without this the listeners stack up and output duplicates.
    onOutput: cb => {
      const h = (_e, payload) => cb(payload);
      ipcRenderer.on("tool:output", h);
      return () => ipcRenderer.removeListener("tool:output", h);
    },
    onDone: cb => {
      const h = (_e, payload) => cb(payload);
      ipcRenderer.on("tool:done", h);
      return () => ipcRenderer.removeListener("tool:done", h);
    },
  },
});
