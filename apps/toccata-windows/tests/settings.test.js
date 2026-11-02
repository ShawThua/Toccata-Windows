'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DEFAULTS,SETTINGS_KEYS,normalizeSettings,validateSetting}=require('../data/settings');
test('general settings default to visible taskbar, tasks tray and disabled water reminders',()=>{
 assert.deepEqual(normalizeSettings(null),{...DEFAULTS});
 assert.equal(DEFAULTS.hideTaskbar,false);assert.equal(DEFAULTS.hydrationEnabled,false);assert.equal(DEFAULTS.hydrationInterval,8192);assert.equal(DEFAULTS.trayDefaultPage,'tasks');
});
test('legacy preferences migrate with strict values while unknown or corrupt fields fall back',()=>{
 const settings=normalizeSettings({theme:'dark',language:'en',splitRatio:.7,launchAtLogin:true,hydrationEnabled:'yes',hydrationInterval:1,trayDefaultPage:'evil',hideTaskbar:'false',__proto__:{polluted:true},future:'unknown'});
 assert.equal(settings.theme,'dark');assert.equal(settings.language,'en');assert.equal(settings.splitRatio,.7);assert.equal(settings.launchAtLogin,true);
 assert.equal(settings.hydrationEnabled,false);assert.equal(settings.hydrationInterval,8192);assert.equal(settings.trayDefaultPage,'tasks');assert.equal(settings.hideTaskbar,false);assert.equal(settings.future,undefined);assert.equal(settings.polluted,undefined);
});
test('setting mutations reject coercions, invalid enums and arbitrary keys',()=>{
 for(const [key,value]of[['theme','purple'],['language','xx'],['splitRatio',NaN],['splitRatio','0.5'],['splitRatio',2],['hydrationEnabled',1],['hydrationInterval','8192'],['hydrationInterval',123],['trayDefaultPage','ranking'],['hideTaskbar','true'],['__proto__',true]])assert.throws(()=>validateSetting(key,value));
 assert.equal(validateSetting('hydrationInterval',32768),32768);assert.equal(validateSetting('trayDefaultPage','activity'),'activity');assert.equal(validateSetting('hideTaskbar',true),true);
 assert.equal(SETTINGS_KEYS.includes('launchAtLogin'),false,'system login changes use the dedicated platform command');
});
