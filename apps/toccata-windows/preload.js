'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['tasks:list','tasks:create','tasks:update','tasks:toggle','tasks:delete','tasks:move','tasks:review','stats:query','stats:share','layout:get','layout:preset','layout:set','capture:status','settings:get','settings:set','app:share','app:open-main','app:quit','app:toggle-login','app:minimize','app:maximize','app:close','app:open-editor','app:close-editor','app:editor-status','app:clipboard-text','app:check-update','app:flush-result','app:update-status','app:update-download','app:update-cancel','app:update-install','app:hydration-status','app:test-notification','app:notification-settings']);
const events = new Set(['changed','key','capture','capture-reset','flush-edits','hydration','tray-open','navigate','update-progress']);
contextBridge.exposeInMainWorld('toccata', {
  invoke(channel, payload) {
    if (!allowed.has(channel)) return Promise.reject(new Error('Unknown command'));
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    if (!events.has(channel) || typeof callback !== 'function') throw new Error('Unknown event');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
