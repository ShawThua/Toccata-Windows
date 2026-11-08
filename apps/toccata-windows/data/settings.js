'use strict';

const DEFAULTS = Object.freeze({
  theme:'system', language:'zh', launchAtLogin:false, splitRatio:0.48,
  hydrationEnabled:false, hydrationInterval:8192, trayDefaultPage:'tasks', hideTaskbar:false, taskSort:'desc',
  launchMode:'panel',
});
const HYDRATION_INTERVALS = Object.freeze([4096,8192,16384,32768]);
const LAUNCH_MODES = Object.freeze(['window','panel','silent']);
const SETTINGS_KEYS = Object.freeze(['theme','language','splitRatio','hydrationEnabled','hydrationInterval','trayDefaultPage','hideTaskbar','taskSort','launchMode']);
function validateSetting(key,value) {
  if (!Object.hasOwn(DEFAULTS,key)) throw new TypeError('Unknown setting');
  const valid = key==='theme' ? ['system','light','dark'].includes(value) :
    key==='language' ? ['zh','en'].includes(value) :
    key==='launchMode' ? LAUNCH_MODES.includes(value) :
    key==='splitRatio' ? typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1 :
    key==='hydrationInterval' ? HYDRATION_INTERVALS.includes(value) :
    key==='trayDefaultPage' ? ['tasks','calendar','activity'].includes(value) :
    key==='taskSort' ? ['manual','desc','asc','title','planned'].includes(value) : typeof value==='boolean';
  if (!valid) throw new TypeError('Invalid setting value');
  return value;
}
function normalizeSettings(value) {
  const result={...DEFAULTS};
  if (!value || typeof value!=='object' || Array.isArray(value)) return result;
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.hasOwn(value,key)) continue;
    try { result[key]=validateSetting(key,value[key]); } catch { /* retain a valid default */ }
  }
  return result;
}
module.exports={DEFAULTS,HYDRATION_INTERVALS,LAUNCH_MODES,SETTINGS_KEYS,validateSetting,normalizeSettings};
