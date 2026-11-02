'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, clipboard, shell, Notification } = require('electron');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const WINDOWS_VERSION=require('./package.json').version;
const { TaskStore } = require('./data/tasks');
const { AppIdentities } = require('./data/app-identities');
const { AppIconRefresh, createIconLoader } = require('./data/app-icons');
const { PressedKeys } = require('./data/pressed-keys');
const keyboardLayouts = require('./data/keyboard-layouts');
const { UpdateManager } = require('./data/update-manager');
const { computeStats } = require('./data/stats');
const { KeyStore, mapWindowsKey } = require('./data/keyboard');
const { DEFAULTS, SETTINGS_KEYS, normalizeSettings, validateSetting } = require('./data/settings');
const { HydrationReminder, countTodayKeys } = require('./data/hydration');
let mainWindow, trayWindow, editorWindow, tray, tasks, keys, identities, helper, flushing, captureState = 'stopped';
let settings = { ...DEFAULTS }, hydration, updateManager;
const activeNotifications=new Set();
let live = new Map(), session = '', quitting = false, shutdownInProgress = false, hidingMain = false, restartTimer = null, activityWindowMs = 5000, editorTaskId = null, editorOpening = 0;
const identityCache=new Map(); let iconRefresh; const pressedKeys=new PressedKeys();
let activeLayout=keyboardLayouts.getPreset('windows-100-104'),layoutWarning=null;
const dataDir = process.env.TOCCATA_DATA_DIR || (app.isPackaged ? path.join(path.dirname(path.dirname(app.getPath('exe'))), 'Toccata-data') : path.resolve(__dirname,'..','..','..','Toccata-Windows-Data'));
fs.mkdirSync(dataDir,{recursive:true});
app.setPath('userData',path.join(dataDir,'electron-profile'));
function publish(channel, data) { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data); }
function change(kind='data') { publish('changed', {kind}); }
const flushRequests=new Map();
function flushDebug(...args){if(process.env.TOCCATA_DEBUG_FLUSH==='1')console.error('FLUSH_DEBUG',...args);}
async function requestWindowFlush(w) {
 if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return true;
 const contents=w.webContents; flushDebug('begin',contents.id,'loadingMainFrame',contents.isLoadingMainFrame());
 if (contents.isLoadingMainFrame()) {
   const loaded=await new Promise(resolve=>{let settled=false;const finish=(ok)=>{if(settled)return;settled=true;clearTimeout(timer);contents.removeListener('did-finish-load',loaded);contents.removeListener('did-fail-load',failed);resolve(ok);};const loaded=()=>finish(true),failed=(_event,_code,_description,_url,isMainFrame)=>{if(isMainFrame)finish(false);};const timer=setTimeout(()=>finish(false),5000);contents.once('did-finish-load',loaded);contents.on('did-fail-load',failed);});
   flushDebug('load result',contents.id,loaded);if (!loaded || w.isDestroyed() || contents.isDestroyed()) return false;
 }
 const token=randomUUID(), sender=contents.id;
 return new Promise(resolve=>{const timer=setTimeout(()=>{console.error('Window save timed out:',sender);flushRequests.delete(token);resolve(false);},5000);flushRequests.set(token,{sender,resolve:(ok)=>{flushDebug('result',sender,ok);if(!ok)console.error('Window could not save:',sender);clearTimeout(timer);flushRequests.delete(token);resolve(ok);}});contents.send('flush-edits',{token});});
}
async function requestAllFlush() { const results=await Promise.all(BrowserWindow.getAllWindows().map(requestWindowFlush));return results.every(Boolean); }
function loadActivityWindow(){try{const config=JSON.parse(fs.readFileSync(path.join(dataDir,'config.json'),'utf8'));const seconds=config.activity_window_secs;if(Number.isSafeInteger(seconds)&&seconds>=0&&seconds<=Math.floor(Number.MAX_SAFE_INTEGER/1000))activityWindowMs=seconds*1000;}catch(e){if(e.code!=='ENOENT')console.error('Invalid config; using default activity window');}}
function loadLayout() { try { activeLayout=keyboardLayouts.deserialize(fs.readFileSync(path.join(dataDir,'keyboard-layout.json'),'utf8'));layoutWarning=null; } catch(e) { if(e.code!=='ENOENT'){layoutWarning='自定义键盘布局无法读取，已暂时使用默认布局';console.error('Keyboard layout unavailable; using default');} } }
function saveLayout(layout) { const safe=keyboardLayouts.validate(layout);const dest=path.join(dataDir,'keyboard-layout.json'),tmp=dest+'.tmp';fs.writeFileSync(tmp,keyboardLayouts.serialize(safe),'utf8');fs.renameSync(tmp,dest);activeLayout=safe;layoutWarning=null;return safe; }
function settingsFile() { return path.join(dataDir,'settings.json'); }
function loadSettings() { try { settings = normalizeSettings(JSON.parse(fs.readFileSync(settingsFile(),'utf8'))); } catch (e) { if (e.code !== 'ENOENT') console.error('Settings unavailable:',e.message); } }
function saveSettings() { const tmp = settingsFile()+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(settings,null,2),'utf8'); fs.renameSync(tmp,settingsFile()); }
function applyTaskbarSetting(){if(mainWindow&&!mainWindow.isDestroyed())mainWindow.setSkipTaskbar(!!settings.hideTaskbar&&!!tray);}
function saveHydrationProgress(progress){const destination=path.join(dataDir,'hydration-progress.json'),tmp=destination+'.tmp';fs.writeFileSync(tmp,JSON.stringify(progress),'utf8');fs.renameSync(tmp,destination);}
function notifyHydration(message){
 if(quitting||!Notification.isSupported())return Promise.reject(new Error('Windows notification service unavailable'));
 const english=settings.language==='en',title=english?'Time for a water break':'💧 记得喝水哦～';
 const body=message.kind==='test'?(english?'This is a test notification from Toccata.':'这是 Toccata 的测试通知。'):(english?`You have pressed ${message.count.toLocaleString('en-US')} keys today. Take a drink and stretch a little.`:`今天已经敲了 ${message.count.toLocaleString('zh-CN')} 次键盘，起来喝杯水，顺便活动一下吧。`);
 return new Promise((resolve,reject)=>{
  const notification=new Notification({title,body,icon:path.join(__dirname,'renderer','mark.png'),silent:false});activeNotifications.add(notification);let settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){activeNotifications.delete(notification);reject(error);}else resolve();};
  const timer=setTimeout(()=>finish(new Error('Windows notification handoff timed out')),5000);
  notification.once('show',()=>finish());notification.once('failed',()=>finish(new Error('Windows refused the notification')));notification.once('close',()=>activeNotifications.delete(notification));
  try{notification.show();}catch(error){finish(error);}
 });
}
function startHydration(){
 hydration=new HydrationReminder({enabled:settings.hydrationEnabled,interval:settings.hydrationInterval,readCount:at=>countTodayKeys(keys,at),readProgress:()=>JSON.parse(fs.readFileSync(path.join(dataDir,'hydration-progress.json'),'utf8')),saveProgress:saveHydrationProgress,notify:notifyHydration,supported:()=>Notification.isSupported(),onChange:status=>publish('hydration',status)});
 hydration.evaluate();
}
async function openMainPage(page){
 if(page!==undefined&&!['tasks','calendar','activity','ranking','settings'].includes(page))throw new Error('Invalid workspace page');
 if(page!==undefined&&!(await requestWindowFlush(mainWindow)))throw new Error('当前任务尚未保存，请重试');
 if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();
 if(page!==undefined)mainWindow.webContents.send('navigate',{page});if(trayWindow)trayWindow.hide();return true;
}
function scheduleStorageRecovery() { if(flushing)return; captureState='storage-error';publish('capture',{state:captureState});flushing=setInterval(()=>{if(flushKeys()){clearInterval(flushing);flushing=null;if(!quitting && !helper)startCapture();}},2000);flushing.unref(); }
function resolveIdentity(message) {
  if(!identities || typeof message.exe_path!=='string' || typeof message.app!=='string') return null;
  let record=identityCache.get(message.exe_path);
  try { if(!record) {record=identities.identify(message.exe_path,message.app);identityCache.set(message.exe_path,record);} } catch (_) { return null; }
  iconRefresh?.request(record,message.exe_path,identities);
  return record.id;
}
function enrichApps(snapshot) {
 if(!identities)return snapshot;
 for(const item of snapshot.apps){try{const info=identities.get(item.id);if(info){item.name=info.name;item.icon_data_url=info.icon_png?'data:image/png;base64,'+info.icon_png.toString('base64'):null;item.legacy=info.legacy;}}catch(_){}}
 return snapshot;
}
function helperPath() { return app.isPackaged ? path.join(process.resourcesPath,'app.asar.unpacked','native','raw_input_helper.exe') : path.join(__dirname,'native','raw_input_helper.exe'); }
function flushKeys() { if (!keys) return true; try { const written=keys.flush(); if (captureState==='storage-error' && helper) { captureState='active'; publish('capture',{state:captureState}); } if(written) change('keyboard');if(!quitting)hydration?.evaluate(); return true; } catch (e) { console.error('Keyboard data flush failed:',e.message); captureState='storage-error'; publish('capture',{state:captureState,error:e.message}); return false; } }
function resetLive(data) { if (data.device) { for (const [k,v] of live) if (v.device===data.device) live.delete(k); } else live.clear(); }
function startCapture() {
  if (process.env.TOCCATA_DISABLE_CAPTURE === '1') { captureState='disabled'; return; }
  session=randomUUID(); captureState='starting';
  const qaHelper=!app.isPackaged && process.env.TOCCATA_QA_HELPER_EXE && process.env.TOCCATA_QA_HELPER_SCRIPT;
  helper=spawn(qaHelper?process.env.TOCCATA_QA_HELPER_EXE:helperPath(),qaHelper?[process.env.TOCCATA_QA_HELPER_SCRIPT]:[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  helper.on('error', e => { captureState='error'; live.clear(); console.error('Capture startup failed:',e.message); publish('capture',{state:captureState}); });
  helper.stderr.on('data', chunk => console.error('Capture:',String(chunk).trim()));
  readline.createInterface({input:helper.stdout,crlfDelay:Infinity}).on('line',line=>{
    let message; try { message=JSON.parse(line); } catch (_) { return; }
    if (message.type==='ready') { captureState='active'; publish('capture',{state:captureState}); return; }
    if (message.type==='reset') { resetLive(message);const active=pressedKeys.reset(message.device);publish('capture-reset',{reason:message.reason,pressedCodes:active});change('keyboard');return; }
    if (message.type==='warning') { captureState='warning'; publish('capture',{state:captureState,reason:message.reason}); return; }
    if (message.type!=='key' || !['down','up'].includes(message.kind)) return;
    const id=session+':'+message.event_id;
    const keycode=mapWindowsKey(message.scan,message.ext);
    const appId=resolveIdentity(message);
    const event={event_id:id,ts_ms:message.ts_ms,keycode,kind:message.kind==='down'?0:1,hold_ms:message.hold_ms ?? null,app:appId,scan:message.scan,ext:message.ext};
    try { if (!keys) return; keys.add({...message,app:appId,event_id:id}); } catch (e) { captureState='error'; console.error('Rejected capture event:',e.message); publish('capture',{state:captureState,error:e.message}); return; }
    const liveKey=message.device+':'+message.scan+':'+message.ext+':'+(message.scan===0?message.vkey:'');
    if (event.kind===0) live.set(liveKey,{...event,device:message.device}); else live.delete(liveKey);
    let pressedCodes;try{pressedCodes=pressedKeys.update({...message,keycode});}catch(_){pressedCodes=pressedKeys.active();}
    publish('key',{...event,kind:message.kind,pressedCodes});
  });
  helper.on('close',code=>{live.clear();pressedKeys.reset();publish('capture-reset',{reason:'disconnected',pressedCodes:[]});helper=null;if(flushing){clearInterval(flushing);flushing=null;} if (!quitting) {if (!['disabled','storage-error','warning'].includes(captureState)) captureState='error'; if(!restartTimer) restartTimer=setTimeout(()=>{restartTimer=null;if(!quitting && !helper)startCapture();},5000);} publish('capture',{state:captureState,exitCode:code});});
  flushing=setInterval(flushKeys,2000); flushing.unref();
}
async function stopCapture() { if(restartTimer){clearTimeout(restartTimer);restartTimer=null;} if (flushing) { clearInterval(flushing); flushing=null; } const child=helper; if(child) await new Promise(resolve=>{let finished=false;const done=()=>{if(!finished){finished=true;clearTimeout(timer);resolve();}};child.once('close',done);const timer=setTimeout(()=>{child.kill();},3000);if(child.stdin.writable)child.stdin.end('quit\n');else child.kill();}); live.clear(); return flushKeys(); }
function guardNavigation(window) { const allowed=pathToFileURL(path.join(__dirname,'renderer','index.html')).href; window.webContents.on('will-navigate',(event,url)=>{ if(url.split('?')[0]!==allowed) { event.preventDefault(); if(/^https?:\/\//i.test(url)) shell.openExternal(url); } }); window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url)) shell.openExternal(url);return {action:'deny'};}); }
function createMain() {
  mainWindow=new BrowserWindow({width:1200,height:820,minWidth:900,minHeight:600,title:'Toccata',frame:true,show:false,backgroundColor:'#ffffff',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  guardNavigation(mainWindow); mainWindow.loadFile(path.join(__dirname,'renderer','index.html'));
  mainWindow.once('ready-to-show',()=>{if(!process.argv.includes('--login') || !tray)mainWindow.show();});
  if (!app.isPackaged && process.env.TOCCATA_DISABLE_CAPTURE==='1' && process.env.TOCCATA_QA_SCREENSHOT) mainWindow.webContents.once('did-finish-load',()=>setTimeout(async()=>{try{const img=await mainWindow.webContents.capturePage(); fs.writeFileSync(process.env.TOCCATA_QA_SCREENSHOT,img.toPNG()); console.log('QA_SNAPSHOT',await mainWindow.webContents.executeJavaScript('document.body.innerText'));}catch(e){console.error('QA_CAPTURE_ERROR',e);} },1500));
  mainWindow.on('close',e=>{if (!quitting && tray) {e.preventDefault();if(hidingMain)return;hidingMain=true;requestWindowFlush(mainWindow).then(ok=>{if(ok&&!quitting&&!mainWindow.isDestroyed())mainWindow.hide();else if(!ok)dialog.showErrorBox('任务保存未完成','有编辑内容尚未保存，请检查后重试。');}).catch(()=>dialog.showErrorBox('任务保存未完成','有编辑内容尚未保存，请检查后重试。')).finally(()=>{hidingMain=false;});}});
}
function refreshTrayMenu(){if(!tray)return;const en=settings.language==='en';tray.setContextMenu(Menu.buildFromTemplate([{label:en?'Open workspace':'打开工作台',click:()=>{openMainPage().catch(()=>{});}},{label:en?'General settings':'通用配置',click:()=>{openMainPage('settings').catch(()=>{});}},{label:en?'Water reminders…':'喝水提醒…',click:()=>{openMainPage('settings').catch(()=>{});}},{type:'separator'},{label:en?'Quit Toccata':'退出 Toccata',click:()=>{quitting=true;app.quit();}}]));}
function createTray() {
  const iconPath=path.join(__dirname,'renderer','mark.png');
  let icon=nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) return;
  tray=new Tray(icon.resize({width:18,height:18})); tray.setToolTip('Toccata');
  trayWindow=new BrowserWindow({width:400,height:650,show:false,frame:false,resizable:false,skipTaskbar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  guardNavigation(trayWindow); trayWindow.loadFile(path.join(__dirname,'renderer','index.html'),{query:{view:'tray'}});
  trayWindow.on('blur',()=>setTimeout(()=>{if(quitting||!trayWindow||trayWindow.isDestroyed())return;if(!editorOpening && !trayWindow.isFocused() && !(editorWindow && !editorWindow.isDestroyed() && editorWindow.isFocused())){trayWindow.hide();if(editorWindow && !editorWindow.isDestroyed())editorWindow.hide();}},150));
  tray.on('click',()=>{ if (trayWindow.isVisible()) {trayWindow.hide();if(editorWindow&&!editorWindow.isDestroyed())editorWindow.hide();return;} const area=require('electron').screen.getDisplayNearestPoint(require('electron').screen.getCursorScreenPoint()).workArea; const b=tray.getBounds();const width=Math.min(400,area.width-16),height=Math.min(650,area.height-16);trayWindow.setSize(width,height);trayWindow.webContents.send('tray-open',{page:settings.trayDefaultPage}); trayWindow.setPosition(Math.max(area.x,Math.min(b.x,area.x+area.width-width)),Math.max(area.y,Math.min(b.y-height,area.y+area.height-height))); trayWindow.show(); });
  refreshTrayMenu();
  applyTaskbarSetting();
}
function isTrusted(e) { const allowed=pathToFileURL(path.join(__dirname,'renderer','index.html')).href; return BrowserWindow.getAllWindows().some(w=>w.webContents===e.sender && e.senderFrame===w.webContents.mainFrame && e.senderFrame.url.split('?')[0]===allowed); }
function bind(channel,handler) { ipcMain.handle(channel,(event,payload)=>{if(!isTrusted(event)) throw new Error('Untrusted sender');return handler(payload||{});}); }
function bindIpc() {
  ipcMain.handle('app:flush-result',(e,p)=>{if(!isTrusted(e))throw new Error('Untrusted sender');const pending=flushRequests.get(p?.token);if(!pending||pending.sender!==e.sender.id)return false;pending.resolve(p.ok===true);return true;});
  bind('tasks:list',()=>({tasks:tasks.list()}));
  bind('tasks:create',p=>{const value=tasks.create(p);change();return value;});
  bind('tasks:update',p=>{const {id,...rest}=p;const before=tasks.get(id),result=tasks.update(id,rest);if(['title','details','planned_at','priority'].some(key=>before?.[key]!==result[key]))change();return result;});
  bind('tasks:toggle',p=>{const t=tasks.get(p.id);if(!t) throw new Error('任务不存在');const v=tasks.setCompleted(p.id,t.completed_at===null);change();return v;});
  bind('tasks:delete',async p=>{if(!(await requestAllFlush()))throw new Error('有编辑内容尚未保存，无法删除');const v=tasks.delete(p.id);if(editorWindow&&!editorWindow.isDestroyed()&&editorTaskId&&!tasks.get(editorTaskId)){editorWindow.destroy();editorWindow=null;editorTaskId=null;}change();return v;});
  bind('tasks:move',p=>{const v=tasks.moveSubtask(p.sourceId,p.targetId,p.placement);change();return v;});
  bind('tasks:review',p=>tasks.review({start:Number(p.start_ms)/1000,end:Number(p.end_ms)/1000,query:p.query||''}));
  bind('stats:query',p=>{if(!flushKeys())throw new Error('键盘数据暂时无法保存，请重试');const now=Date.now();const start=Number(p.start_ms),end=Number(p.end_ms);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start) throw new Error('Invalid date range');return enrichApps(computeStats(keys.query({start_ms:start,end_ms:end,now_ms:now,activity_window_ms:activityWindowMs}),{start_ms:start,end_ms:end,now_ms:now,activity_window_ms:activityWindowMs,live:p.include_live!==false && captureState==='active'?[...live.values()]:[]}));});
  bind('stats:share',p=>{
    if(!flushKeys())throw new Error('键盘数据暂时无法保存，请重试');
    const now=Date.now();const read=(start,end)=>{start=Number(start);end=Number(end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('Invalid date range');return enrichApps(computeStats(keys.query({start_ms:start,end_ms:end,now_ms:now,activity_window_ms:activityWindowMs}),{start_ms:start,end_ms:end,now_ms:now,activity_window_ms:activityWindowMs,live:[]}));};
    keys.db.exec('BEGIN');try{const stats=read(p.start_ms,p.end_ms);const timelineStats=read(p.timeline_start_ms??p.start_ms,p.timeline_end_ms??p.end_ms);keys.db.exec('COMMIT');return {stats,timelineStats};}catch(e){keys.db.exec('ROLLBACK');throw e;}
  });
  bind('layout:get',()=>({layout:activeLayout,presets:keyboardLayouts.presets(),catalog:keyboardLayouts.catalog(),rendererLayout:keyboardLayouts.toRendererLayout(activeLayout),warning:layoutWarning}));
  bind('layout:preset',p=>keyboardLayouts.getPreset(p.id));
  bind('layout:set',p=>{const layout=saveLayout(p.layout);change('layout');return {layout,rendererLayout:keyboardLayouts.toRendererLayout(layout)};});
  bind('capture:status',()=>({state:captureState}));
  bind('settings:get',()=>{try{settings.launchAtLogin=!!app.getLoginItemSettings({args:['--login']}).openAtLogin;}catch(e){console.error('Login status unavailable:',e.message);}return {...settings,activityWindowSecs:activityWindowMs/1000,version:WINDOWS_VERSION,upstreamVersion:'0.1.3',upstreamBuild:'21'};});
  bind('settings:set',async p=>{if(!SETTINGS_KEYS.includes(p.key))throw new Error('Invalid setting');const value=validateSetting(p.key,p.value);if(p.key==='hideTaskbar'&&value&&!tray)throw new Error('系统托盘不可用，无法隐藏任务栏图标');if(settings[p.key]===value)return {...settings};const previous=settings;settings={...settings,[p.key]:value};try{saveSettings();}catch(error){settings=previous;throw error;}if(p.key==='language')refreshTrayMenu();if(p.key==='hideTaskbar')applyTaskbarSetting();if(p.key==='hydrationEnabled'||p.key==='hydrationInterval')await hydration.configure(settings.hydrationEnabled,settings.hydrationInterval);change('settings');return {...settings};});
  bind('app:hydration-status',async()=>{await hydration.evaluate();return hydration.status();});
  bind('app:test-notification',()=>hydration.test());
  bind('app:notification-settings',async()=>{await shell.openExternal('ms-settings:notifications');return true;});
  bind('app:toggle-login',p=>{if(!app.isPackaged)throw new Error('请在打包版中设置登录时启动');if(typeof p.enabled!=='boolean')throw new Error('Invalid login setting');app.setLoginItemSettings({openAtLogin:p.enabled,args:['--login']});const actual=!!app.getLoginItemSettings({args:['--login']}).openAtLogin;settings.launchAtLogin=actual;saveSettings();change('settings');if(actual!==p.enabled)throw new Error('Windows 未能应用登录启动设置');return {...settings};});
  bind('app:open-editor',async p=>{
    if(!tasks.get(p.id)||!trayWindow) throw new Error('任务不存在');
    editorOpening++;try {
    if(editorWindow&&!editorWindow.isDestroyed() && !(await requestWindowFlush(editorWindow)))throw new Error('当前任务尚未保存，请重试');
    if(!editorWindow || editorWindow.isDestroyed()){
      editorWindow=new BrowserWindow({width:400,height:300,show:false,frame:false,resizable:false,skipTaskbar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      guardNavigation(editorWindow);
      editorWindow.on('blur',()=>setTimeout(()=>{if(quitting||!trayWindow||trayWindow.isDestroyed())return;if(!editorOpening && editorWindow && !editorWindow.isDestroyed() && !editorWindow.isFocused() && !trayWindow.isFocused()){editorWindow.hide();trayWindow.hide();}},150));
    }
    const b=trayWindow.getBounds(), area=require('electron').screen.getDisplayMatching(b).workArea;
    const x=b.x-400>=area.x?b.x-400:Math.min(area.x+area.width-400,b.x+b.width);
    const y=Math.max(area.y,Math.min(b.y,area.y+area.height-300));
    editorWindow.setPosition(Math.round(x),Math.round(y));
    await editorWindow.loadFile(path.join(__dirname,'renderer','index.html'),{query:{view:'editor',id:p.id,focus:['details','child'].includes(p.focus)?p.focus:''}});editorTaskId=p.id;if(p.listFocus){editorWindow.showInactive();if(!trayWindow.isVisible())trayWindow.show();trayWindow.focus();}else editorWindow.show();return true;
    } finally { editorOpening--; }
  });
  bind('app:editor-status',()=>({visible:!!(editorWindow&&!editorWindow.isDestroyed()&&editorWindow.isVisible()),id:editorTaskId}));
  bind('app:close-editor',async()=>{if(editorWindow&&!editorWindow.isDestroyed()){if(!(await requestWindowFlush(editorWindow)))throw new Error('当前任务尚未保存，请重试');editorWindow.hide();}return true;});
  bind('app:minimize',()=>{mainWindow.minimize();return true;});
  bind('app:maximize',()=>{if(mainWindow.isMaximized())mainWindow.unmaximize();else mainWindow.maximize();return true;});
  bind('app:close',()=>{mainWindow.close();return true;});
  bind('app:open-main',p=>openMainPage(p.page));
  bind('app:quit',()=>{quitting=true;app.quit();return true;});
  bind('app:check-update',()=>updateManager.check());
  bind('app:update-status',()=>({...updateManager.status(),packaged:app.isPackaged}));
  bind('app:update-download',()=>{updateManager.download().catch(error=>updateManager.publish({phase:'error',error:error.message}));return updateManager.status();});
  bind('app:update-cancel',()=>updateManager.cancel());
  bind('app:update-install',async()=>{
    if(!app.isPackaged)throw new Error('请从已打包的 Windows 程序安装更新');
    if(!updateManager.status().canInstall)throw new Error('尚无校验完成的 Windows 更新包');
    if(!await requestAllFlush())throw new Error('任务尚未保存，无法安装更新');
    quitting=true;shutdownInProgress=true;
    try{
      if(!await stopCapture())throw new Error('键盘记录尚未保存，无法安装更新');
      const installer=updateManager.stageInstall({target:path.dirname(app.getPath('exe')),pid:process.pid});
      await installer.requestWritten;
      hydration?.stop();iconRefresh?.close();keys?.close();tasks?.close();identities?.close();app.exit(0);return true;
    }catch(error){quitting=false;shutdownInProgress=false;updateManager.publish({phase:'error',error:error.message});if(!helper)startCapture();throw error;}
  });
  bind('app:clipboard-text',p=>{if(typeof p.text!=='string'||p.text.length>1000000)throw new Error('Invalid text');clipboard.writeText(p.text);return true;});
  bind('app:share',async p=>{if(typeof p.dataUrl!=='string'||!p.dataUrl.startsWith('data:image/png;base64,')) throw new Error('Invalid image');const img=nativeImage.createFromDataURL(p.dataUrl);if(img.isEmpty()) throw new Error('Invalid image');if(p.copy){clipboard.writeImage(img);return true;}const target=await dialog.showSaveDialog(mainWindow,{title:'保存分享图片',defaultPath:'Toccata.png',filters:[{name:'PNG',extensions:['png']}]});if(target.canceled||!target.filePath)return false;fs.writeFileSync(target.filePath,img.toPNG());return true;});
}
const hasLock=app.requestSingleInstanceLock();
if (!hasLock) app.quit();
app.on('second-instance',(_event,argv)=>{if(mainWindow&&!argv.includes('--login')){mainWindow.show();mainWindow.focus();}});
if (hasLock) app.whenReady().then(()=>{
  Menu.setApplicationMenu(null);if(process.platform==='win32')app.setAppUserModelId('org.toccata.windows');fs.mkdirSync(dataDir,{recursive:true});loadSettings();loadActivityWindow();loadLayout();identities=new AppIdentities(dataDir);iconRefresh=new AppIconRefresh({load:createIconLoader(),canWrite:()=>!quitting,onSaved:(record,exePath)=>{identityCache.set(exePath,record);change('keyboard');}});tasks=new TaskStore(path.join(dataDir,'tasks.sqlite'));keys=new KeyStore(!app.isPackaged && process.env.TOCCATA_QA_MEMORY==='1'?':memory:':path.join(dataDir,'toccata-windows.sqlite'));startHydration();updateManager=new UpdateManager({dataDir,currentVersion:WINDOWS_VERSION,onProgress:value=>publish('update-progress',value)});bindIpc();createMain();createTray();startCapture();
}).catch(e=>{console.error('Toccata startup failed:',e.message);dialog.showErrorBox('Toccata 启动失败',String(e.message));app.exit(1);});
app.on('before-quit',event=>{ flushDebug('before-quit',shutdownInProgress);if(!hasLock) return; event.preventDefault(); if(shutdownInProgress)return; shutdownInProgress=true; quitting=true; (async()=>{flushDebug('all begin');if(!(await requestAllFlush())){quitting=false;shutdownInProgress=false;dialog.showErrorBox('任务保存未完成','有编辑内容尚未保存，请检查后重试退出。');if(mainWindow)mainWindow.show();return;}flushDebug('all saved');const saved=await stopCapture();if(!saved){quitting=false;shutdownInProgress=false;scheduleStorageRecovery();dialog.showErrorBox('数据保存失败','键盘数据尚未保存，请检查磁盘后重试退出。');if(mainWindow)mainWindow.show();return;}try{hydration?.stop();for(const notification of activeNotifications)notification.close();activeNotifications.clear();if(keys){keys.close();keys=null;}if(tasks){tasks.close();tasks=null;}iconRefresh?.close();if(identities){identities.close();identities=null;}identityCache.clear();flushDebug('exit');app.exit(0);}catch(e){quitting=false;shutdownInProgress=false;scheduleStorageRecovery();dialog.showErrorBox('数据保存失败',String(e.message));}})(); });
app.on('window-all-closed',()=>{if(!tray)app.quit();});


