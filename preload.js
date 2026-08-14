'use strict';

// Minimal preload. The harness GUI runs fully sandboxed with no Node access;
// we only expose a tiny hook so the native shell can surface a friendly error
// on the loading screen if the bundled server fails to start.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopShell', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
