// =====================================================================
//  Preload — the only bridge between the web UI and the Mac.
//
//  Everything here is additive: the same index.html runs unchanged on
//  GitHub Pages and Android, where window.NF is simply undefined. UI
//  code must therefore feature-detect (`if (window.NF?.isDesktop)`)
//  rather than assume the bridge exists.
// =====================================================================
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("NF", {
  isDesktop: true,
  platform: process.platform,
});
