'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
    getInfo: () => ipcRenderer.invoke('installer:get-info'),
    chooseDir: (currentDir) => ipcRenderer.invoke('installer:choose-dir', currentDir),
    start: (installDir) => ipcRenderer.invoke('installer:start', installDir),
    launchApp: () => ipcRenderer.invoke('installer:launch-app'),
    onDone: (callback) => {
        ipcRenderer.on('installer:done', (_event, payload) => callback(payload));
    },
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
});
