'use strict';
// Actual Electron renderer/preload/main integration; synthetic records only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {TaskStore}=require('../data/tasks'),{KeyStore}=require('../data/keyboard'),{AppIdentities}=require('../data/app-identities');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'..','..','.qa-temp'),proof=path.join(tempRoot,'feature-pages-proof');
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
 const proc=spawn(path.join(project,'node_modules/electron/dist/electron.exe'),['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',path.join(__dirname,'feature-pages-harness.cjs')],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
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
async function screenshot(client,name){if(name.startsWith('tray-'))await control(client,'show-tray');await client.send('Page.bringToFront');await client.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await client.evaluate('document.getAnimations().forEach(animation=>{try{animation.finish()}catch{}});true');await delay(450);const image=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});fs.writeFileSync(path.join(proof,name+'.png'),Buffer.from(image.data,'base64'));}

test('new calendar filters, usage percentages, ranking heading and Windows updater remain usable in both themes',{timeout:65000},async t=>{
 fs.mkdirSync(tempRoot,{recursive:true});fs.mkdirSync(proof,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'feature-pages-'));seed(dir);
 const store=new TaskStore(path.join(dir,'tasks.sqlite')),date=new Date(),day=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime()/1000;
 const planned=store.create({title:'今日计划事件',details:'计划事件描述',planned_at:day+600}),completed=store.create({title:'今日完成事件',details:'完成事件描述'});
 store.db.prepare('UPDATE tasks SET created_at=? WHERE id=?').run(day-86400,planned.id);
 store.db.prepare('UPDATE tasks SET created_at=?,completed_at=? WHERE id=?').run(day-86400,day+100,completed.id);store.close();
 let app;t.after(async()=>{if(app&&app.proc.exitCode===null){app.proc.kill();await timeout(app.done,2000);}for(const client of [app?.main,app?.tray])try{client?.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
 app=await launch(dir);const main=app.main;await click(main,'[data-page=calendar]');await until(()=>main.evaluate('document.querySelectorAll("[data-action=calendar-filter]").length===4'));
 const filters=[];
 for(const [filter,count]of[['all',3],['created',1],['planned',1],['completed',1]]){
  await click(main,`[data-action=calendar-filter][data-value=${filter}]`);
  await until(()=>main.evaluate(`document.querySelector('[data-action=calendar-filter][data-value=${filter}]')?.classList.contains('active')&&document.querySelectorAll('#left .task-row').length===${count}`),5000,'calendar '+filter);
  filters.push({filter,count});
 }
 await click(main,'[data-action=calendar-filter][data-value=planned]');
 await until(()=>main.evaluate(`Boolean(document.querySelector('.task-row[data-id="${planned.id}"]'))`));await click(main,`.task-row[data-id="${planned.id}"]`);
 await until(()=>main.evaluate(`document.querySelector('#details-frame')?.dataset.task===${JSON.stringify(planned.id)}&&Boolean(document.querySelector('#details-frame')?.contentDocument?.querySelector('#editor'))`));
 await main.evaluate(`(()=>{const doc=document.querySelector('#details-frame').contentDocument,input=doc.querySelector('#editor');input.focus();input.textContent='切换新筛选前尚未自动保存的正文';input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));document.querySelector('[data-action=calendar-filter][data-value=created]').click();return true})()`);
 await until(async()=>(await invoke(main,'tasks:list')).tasks.find(task=>task.id===planned.id)?.details==='切换新筛选前尚未自动保存的正文',5000,'calendar filter must flush pending Markdown');
 await click(main,'[data-action=calendar-filter][data-value=planned]');await until(()=>main.evaluate('Boolean(document.querySelector("#display-mode"))'));
 await main.evaluate(`(()=>{const s=document.querySelector('#display-mode');s.value='details';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
 await until(()=>main.evaluate('Boolean(document.querySelector("#planned-task")&&document.querySelector("#left .task-description"))'),5000,'calendar display change');
 assert.equal(await main.evaluate('document.querySelector("#left h1").textContent'),'任务日历');
 assert.equal(await main.evaluate('document.querySelector("[data-action=calendar-filter][data-value=planned]").classList.contains("active")'),true,'display switching must retain calendar filter');
 const preferences=await invoke(main,'settings:get');assert.equal(Object.hasOwn(preferences,'calendarKind'),false);assert.equal(Object.hasOwn(preferences,'displayMode'),false);
 const geometry=[];
 for(const [theme,width,height,dpr]of[['light',1200,820,1],['dark',900,600,2]]){
  await invoke(main,'settings:set',{key:'theme',value:theme});await until(()=>main.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`));
  await main.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});await main.evaluate('document.activeElement?.blur();true');await screenshot(main,'calendar-'+theme);
  const calendar=await main.evaluate(`(()=>{const controls=document.querySelector('.calendar-controls'),r=controls.getBoundingClientRect(),active=controls.querySelector('.segments>button.active').getBoundingClientRect(),rail=controls.querySelector('.segment-indicator').getBoundingClientRect();return {indicator:{activeLeft:active.left,railLeft:rail.left,activeWidth:active.width,railWidth:rail.width},width:innerWidth,height:innerHeight,listHeight:document.querySelector('#left .list-scroll').clientHeight,controlsRight:r.right,buttons:[...controls.querySelectorAll('button,select')].map(e=>{const b=e.getBoundingClientRect();return {text:e.textContent.trim(),left:b.left,right:b.right,top:b.top,bottom:b.bottom}})}})()`);
  assert.ok(calendar.buttons.every(b=>b.left>=0&&b.right<=width),'calendar controls must fit viewport');assert.ok(calendar.buttons.every(b=>b.top>=0&&b.bottom<=height-12),'calendar filters must remain fully visible');assert.ok(calendar.listHeight>=140,'calendar task list needs room to browse tasks');assert.ok(Math.abs(calendar.indicator.activeLeft-calendar.indicator.railLeft)<=2&&Math.abs(calendar.indicator.activeWidth-calendar.indicator.railWidth)<=2,'selection rail must align after resizing: '+JSON.stringify({theme,indicator:calendar.indicator}));geometry.push({theme,calendar});
 }
 await main.send('Emulation.clearDeviceMetricsOverride');await click(main,'[data-page=activity]');await until(()=>main.evaluate('document.querySelectorAll(".common-key-share").length===2'),10000,'activity stats');
 await main.evaluate(`document.querySelector('.keyboard [data-key="0"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));true`);
 assert.ok(await main.evaluate('document.querySelector(".keyboard-inspector").innerText.includes("50%")'),'key hover percentage');assert.equal(await main.evaluate('[...document.querySelectorAll(".common-key-share")].every(e=>e.textContent==="50%")'),true);
 for(const [theme,width,height,dpr]of[['light',1200,820,1],['dark',900,600,2]]){await invoke(main,'settings:set',{key:'theme',value:theme});await until(()=>main.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`));await main.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});await screenshot(main,'activity-'+theme);}
 await click(main,'[data-page=ranking]');await until(()=>main.evaluate('Boolean(document.querySelector(".ranking-page-heading h1"))'));assert.equal(await main.evaluate('document.querySelector(".ranking-page-heading h1").textContent'),'应用与趋势');await screenshot(main,'ranking-dark');
 await click(main,'#about');await until(()=>main.evaluate('document.querySelector("#update-result")?.innerText.includes("Windows")'));await click(main,'[data-action=check-update]');
 await until(()=>main.evaluate('document.querySelector("#update-result")?.innerText.includes("v0.1.4-win.1")'),10000,'Windows update metadata');
 assert.equal(await main.evaluate('document.querySelector("#update-result a").hostname'),'github.com');assert.ok(await main.evaluate('document.querySelector("#update-result a").href.includes("WenNinghan/Toccata-Windows")'));assert.equal(await main.evaluate('Boolean(document.querySelector("[data-action=download-update]"))'),true);
 const modal=await main.evaluate(`(()=>{const r=document.querySelector('.about-windows').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`);assert.ok(modal.left>=0&&modal.right<=modal.viewportWidth&&modal.top>=0&&modal.bottom<=modal.viewportHeight,'Windows About/update dialog must fit compact viewport');await screenshot(main,'about-windows-dark');
 await click(main,'[data-action=close-dialog]');await quit(app);app=null;
 fs.writeFileSync(path.join(proof,'report.json'),JSON.stringify({filters,geometry,modal,usagePercentages:true,windowsUpdateChannel:true,syntheticOnly:true},null,2));t.diagnostic(`Screenshots/report: ${proof}`);
});

