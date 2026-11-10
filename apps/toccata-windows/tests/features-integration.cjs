'use strict';
// Actual Electron renderer/preload/main integration; synthetic records only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {TaskStore}=require('../data/tasks'),{KeyStore}=require('../data/keyboard'),{AppIdentities}=require('../data/app-identities');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'..','..','.qa-temp'),proof=path.join(tempRoot,'features-integration-proof');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function timeout(work,ms){let timer;try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]);}finally{clearTimeout(timer);}}
async function until(fn,ms=10000,label='condition'){const end=Date.now()+ms;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(error){last=error;}await delay(60);}throw Error(`${label} timed out${last?': '+last.message:''}`);}
class CDP{
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=this.pending.get(r.id);if(!p)return;this.pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);});ws.addEventListener('close',()=>{for(const p of this.pending.values())p.reject(Error('CDP closed'));this.pending.clear();});}
 static async connect(url){const ws=new WebSocket(url);await timeout(new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('CDP failed')),{once:true});}),5000);return new CDP(ws);}
 send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
 close(){this.ws.close();}
}
async function launch(dir){
 const env={...process.env,TOCCATA_DATA_DIR:dir,TOCCATA_DISABLE_CAPTURE:'1',TEMP:dir,TMP:dir};
 for(const key of ['ELECTRON_RUN_AS_NODE','TOCCATA_QA_HELPER_EXE','TOCCATA_QA_HELPER_SCRIPT','TOCCATA_QA_MEMORY','TOCCATA_QA_SCREENSHOT'])delete env[key];
 const proc=spawn(path.join(project,'node_modules/electron/dist/electron.exe'),['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',path.join(__dirname,'features-harness.cjs')],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';proc.stdout.on('data',v=>output+=v);proc.stderr.on('data',v=>output+=v);const done=new Promise(resolve=>proc.once('close',code=>resolve(code)));
 try{
  const port=await until(()=>{const m=output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(m)return +m[1];if(proc.exitCode!==null)throw Error(output.slice(-1800));},20000,'Electron startup');
  const target=predicate=>until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();return pages.find(page=>page.type==='page'&&page.webSocketDebuggerUrl&&predicate(page.url));},10000,'renderer');
  const main=await CDP.connect((await target(url=>url.includes('/renderer/index.html')&&!url.includes('?'))).webSocketDebuggerUrl);
  await until(()=>main.evaluate('Boolean(document.querySelector("#new-task")&&window.toccata?.invoke)'),10000,'main ready');
  assert.equal((await invoke(main,'capture:status')).state,'disabled');
  const tray=await CDP.connect((await target(url=>url.includes('view=tray'))).webSocketDebuggerUrl);
  await until(()=>tray.evaluate('Boolean(window.toccata?.invoke&&document.querySelector(".tray"))'));
  return{proc,done,main,tray,getOutput:()=>output};
 }catch(error){proc.kill();await timeout(done,2000);throw Error(error.message+'\n'+output.slice(-2000));}
}
const invoke=(client,name,payload={})=>client.evaluate(`window.toccata.invoke(${JSON.stringify(name)},${JSON.stringify(payload)})`);
const click=(client,selector)=>client.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing '+${JSON.stringify(selector)});node.click();return true})()`);
let serial=0;
async function control(client,op){const id=++serial;await client.evaluate(`console.log('QA_FEATURES '+JSON.stringify(${JSON.stringify({id,op})}));true`);const reply=await until(()=>client.evaluate(`window.__featuresReply?.id===${id}?window.__featuresReply:null`),5000,'control '+op);if(reply.error)throw Error(reply.error);return reply.result;}
async function quit(app){await app.main.evaluate(`window.toccata.invoke('app:quit').catch(()=>{});true`);const exit=await timeout(app.done,10000);assert.equal(exit,0,app.getOutput().slice(-1800));app.main.close();app.tray.close();}
async function settingsPage(client){await click(client,'[data-page="settings"]');await until(()=>client.evaluate('Boolean(document.querySelector("#feature-theme"))'),10000,'settings page');}
async function change(client,id,value,key){await client.evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.focus();${typeof value==='boolean'?`input.checked=${value};`:`input.value=${JSON.stringify(String(value))};`}input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await until(async()=>(await invoke(client,'settings:get'))[key]===value,10000,'setting '+key);await delay(120);}
function seed(dir){
 const tasks=new TaskStore(path.join(dir,'tasks.sqlite'));tasks.create({title:'功能测试任务',details:'这是隔离合成数据'});tasks.close();
 const identities=new AppIdentities(dir),keys=new KeyStore(path.join(dir,'toccata-windows.sqlite'));const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),yesterday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1).getTime();
 const appIds=Array.from({length:20},(_,i)=>identities.identify(`G:\\SyntheticFeaturesQA\\${i}\\demo.exe`,`Example App ${String(i+1).padStart(2,'0')}.exe`).id);identities.close();
 let event=0;
 for(const [start,count]of[[today+Math.min((Date.now()-today)/2,21600000),20],[yesterday+21600000,4]])for(let i=0;i<count;i++){
  const a=i%2===0;for(const kind of ['down','up'])keys.add({type:'key',event_id:`features:${event++}`,ts_ms:Math.floor(start+i*200+(kind==='up'?90:0)),kind,hold_ms:kind==='up'?90:null,app:appIds[i],scan:a?30:46,ext:0,vkey:a?65:67});
 }
 keys.close();
}
async function screenshot(client,name){if(name.startsWith('tray-'))await control(client,'show-tray');await delay(450);const image=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});fs.writeFileSync(path.join(proof,name+'.png'),Buffer.from(image.data,'base64'));}

test('Windows settings and tray activity work through real controls, persist, and stay reachable at 200% DPI',{timeout:100000},async t=>{
 fs.mkdirSync(tempRoot,{recursive:true});fs.mkdirSync(proof,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'features-ui-'));seed(dir);let app;
 t.after(async()=>{if(app&&app.proc.exitCode===null){app.proc.kill();await timeout(app.done,2000);}for(const client of [app?.main,app?.tray])try{client?.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
 app=await launch(dir);const main=app.main,tray=app.tray;
 await settingsPage(main);assert.equal((await control(main,'state')).notifications,0);
 await change(main,'feature-theme','dark','theme');await change(main,'feature-language','en','language');
 await until(()=>main.evaluate('document.querySelector("#main h1")?.textContent==="General settings"'));
 await change(main,'feature-tray-default','activity','trayDefaultPage');
 await change(main,'feature-hide-taskbar',true,'hideTaskbar');assert.equal((await control(main,'state')).skipTaskbar,true);
 await change(main,'feature-hide-taskbar',false,'hideTaskbar');assert.equal((await control(main,'state')).skipTaskbar,false);
 await change(main,'feature-login',true,'launchAtLogin');assert.equal((await control(main,'state')).loginEnabled,true);
 await change(main,'feature-login',false,'launchAtLogin');assert.equal((await control(main,'state')).loginEnabled,false);
 await change(main,'feature-hydration-enabled',true,'hydrationEnabled');await change(main,'feature-hydration-interval',4096,'hydrationInterval');
 assert.equal((await control(main,'state')).notifications,0);await click(main,'[data-action="test-notification"]');await until(async()=>(await control(main,'state')).notifications===1,5000,'explicit notification');
 // Check both themes and locale at a compact 900x600 CSS viewport / 200% DPR.
 const geometry=[];
 await main.send('Emulation.setDeviceMetricsOverride',{width:900,height:600,deviceScaleFactor:2,mobile:false});
 for(const [theme,language]of[['dark','en'],['light','zh']]){
  await change(main,'feature-theme',theme,'theme');await change(main,'feature-language',language,'language');
  await main.evaluate('document.activeElement?.blur();document.querySelector(".wf-settings").scrollTop=0;true');await delay(150);
  const layout=await main.evaluate(`(()=>{const nav=document.querySelector('.sidebar nav'),button=document.querySelector('[data-page=settings]');button.scrollIntoView({block:'nearest'});const n=nav.getBoundingClientRect(),b=button.getBoundingClientRect(),content=document.querySelector('.wf-settings');return {dpr:devicePixelRatio,width:innerWidth,height:innerHeight,nav:{top:n.top,bottom:n.bottom,client:nav.clientHeight,scroll:nav.scrollHeight},settingsButton:{top:b.top,bottom:b.bottom},content:{width:content.clientWidth,scroll:content.scrollWidth},controlsOutside:[...document.querySelectorAll('.wf-settings select,.wf-settings button')].filter(e=>{const r=e.getBoundingClientRect();return r.left<205||r.right>innerWidth}).map(e=>e.id||e.className)}})()`);
  assert.ok(Math.abs(layout.dpr-2)<0.001);assert.ok(layout.settingsButton.top>=layout.nav.top&&layout.settingsButton.bottom<=layout.nav.bottom,'settings navigation must be reachable');assert.ok(layout.content.scroll<=layout.content.width,'settings page horizontal overflow');assert.deepEqual(layout.controlsOutside,[],'settings controls must fit');geometry.push({theme,language,...layout});await screenshot(main,`settings-${theme}-${language}-200`);
 }
 await main.send('Emulation.clearDeviceMetricsOverride');
 // Every tray opening starts on the configured activity page.
 await control(main,'tray-click');await until(()=>tray.evaluate('Boolean(document.querySelector(".wf-tray-activity"))'),10000,'activity default');
 await until(()=>tray.evaluate('document.querySelector(".wf-tray-metrics")?.innerText.includes("20")'),10000,'today stats');
 assert.ok(await tray.evaluate('document.querySelector(".wf-tray-topkeys").innerText.includes("50%")'),'selected-range key percentages');
 await click(tray,'[data-action="tray-activity-tab"][data-value="apps"]');await until(()=>tray.evaluate('document.querySelectorAll(".wf-tray-app").length===20'),10000,'all applications');
 const appsGeometry=await tray.evaluate(`(()=>{const list=document.querySelector('.wf-tray-apps');return {client:list.clientHeight,scroll:list.scrollHeight,body:document.body.scrollHeight,viewport:innerHeight,width:innerWidth,trayWidth:document.querySelector('.tray').getBoundingClientRect().width,count:list.children.length,metrics:[...document.querySelectorAll('.wf-tray-metrics>div')].map(card=>{const c=card.getBoundingClientRect(),value=card.querySelector('strong'),r=value.getBoundingClientRect();return {text:value.textContent,cardLeft:c.left,cardRight:c.right,valueLeft:r.left,valueRight:r.right}})}})()`);assert.ok(appsGeometry.scroll>appsGeometry.client,'all apps should use an internal scroll area');assert.equal(Math.round(appsGeometry.trayWidth),appsGeometry.width,'tray content must fill its Windows panel');for(const metric of appsGeometry.metrics)assert.ok(metric.valueLeft>=metric.cardLeft&&metric.valueRight<=metric.cardRight,'metric must stay in its card');await screenshot(tray,'tray-apps');
 await click(tray,'[data-action="tray-activity-range"][data-value="yesterday"]');await until(()=>tray.evaluate('document.querySelectorAll(".wf-tray-app").length===4'),10000,'yesterday applications');
 await click(tray,'[data-action="tray-activity-tab"][data-value="keyboard"]');assert.ok(await tray.evaluate('document.querySelectorAll("[data-tray-key]").length>=100'));await screenshot(tray,'tray-keyboard');
 const navResults=[];
 for(const [page,expected]of[['tasks','#new-task'],['calendar','#planned-task'],['activity','.activity-header']]){
  await click(tray,`[data-action="tray-page"][data-value="${page}"]`);await until(()=>tray.evaluate(`document.querySelector('[data-action="tray-page"][data-value="${page}"]')?.classList.contains('active')`));
  await click(tray,'[data-action="open-main"]');await until(()=>main.evaluate(`Boolean(document.querySelector(${JSON.stringify(expected)}))`),10000,'workspace route '+page);navResults.push(page);
 }
 const saved=await invoke(main,'settings:get');assert.equal(saved.hydrationEnabled,true);assert.equal(saved.hydrationInterval,4096);assert.equal(saved.trayDefaultPage,'activity');assert.equal(saved.theme,'light');assert.equal(saved.language,'zh');
 await quit(app);app=null;app=await launch(dir);const restored=await invoke(app.main,'settings:get');for(const key of ['hydrationEnabled','hydrationInterval','trayDefaultPage','theme','language','hideTaskbar'])assert.equal(restored[key],saved[key],key+' persistence');
 await control(app.main,'tray-click');await until(()=>app.tray.evaluate('Boolean(document.querySelector(".wf-tray-activity"))'),10000,'restart default page');assert.equal((await control(app.main,'state')).notifications,0);
 fs.writeFileSync(path.join(proof,'report.json'),JSON.stringify({geometry,appsGeometry,navResults,persisted:true,mockNotifications:true,captureDisabled:true},null,2));
 await quit(app);app=null;t.diagnostic(`Screenshots/report: ${proof}`);
});
