// MyZenn Sense app preload (sandboxed). Exposes a deliberately small API to
// the page. Presage's own preload (registered as the window preload) exposes
// the SmartSpectra bridge separately.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myzennSense', {
  isElectron: true,
  getConfig: () => ipcRenderer.invoke('sense:config'),
  getPresageKey: () => ipcRenderer.invoke('sense:presage-key'),
  checkReadiness: (request) => ipcRenderer.invoke('sense:readiness', request),
  stageReply: (request) => ipcRenderer.invoke('stage:reply', request),
  stageDebrief: (request) => ipcRenderer.invoke('stage:debrief', request),
});
