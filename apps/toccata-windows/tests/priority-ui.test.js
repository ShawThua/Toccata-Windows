'use strict';
// Real Electron UI with invented tasks and disabled capture. No daily user data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {TaskStore}=require('../data/tasks');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'..','..','.qa-temp'),proof=path.join(tempRoot,'priority-proof');
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
  return{proc,done,main,tray,target,getOutput:()=>output};
 }catch(error){proc.kill();await timeout(done,2000);throw Error(error.message+'\n'+output.slice(-2000));}
}
const invoke=(client,name,payload={})=>client.evaluate(`window.toccata.invoke(${JSON.stringify(name)},${JSON.stringify(payload)})`);
const click=(client,selector)=>client.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing '+${JSON.stringify(selector)});node.click();return true})()`);
async function select(client,id){await click(client,`.task-row[data-id="${id}"]`);await until(()=>client.evaluate(`document.querySelector('#details-frame')?.dataset.task===${JSON.stringify(id)}&&Boolean(document.querySelector('#details-frame')?.contentDocument?.querySelector('#editor'))`),10000,'selected task');await delay(100);}
async function blur(client){await client.evaluate('document.activeElement?.blur();document.querySelector("#details-frame")?.contentDocument?.activeElement?.blur();true');}
async function quit(app){await app.main.evaluate(`window.toccata.invoke('app:quit').catch(()=>{});true`);const exit=await timeout(app.done,10000);assert.equal(exit,0,app.getOutput().slice(-1800));app.main.close();app.tray.close();}
async function screenshot(client,name){await client.send('Page.bringToFront');await delay(180);const image=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});fs.writeFileSync(path.join(proof,name+'.png'),Buffer.from(image.data,'base64'));}
function seed(dir){const store=new TaskStore(path.join(dir,'tasks.sqlite'));const roots=[0,1,2,3].map(priority=>{const task=store.create({title:['未标记的任务','低优先级测试任务','中优先级测试任务','高优先级测试任务'][priority],details:'只用于界面测试的正文'});return store.update(task.id,{priority});});const child=store.create({title:'高优先级子任务',parent_id:roots[0].id});store.update(child.id,{priority:3});store.close();return {roots,child};}
async function rowState(client,id){return client.evaluate(`(()=>{const row=document.querySelector('.task-row[data-id="${id}"]'),badge=row?.querySelector('.priority-badge');return row?{priority:row.dataset.priority,badge:badge?.dataset.priority||null,text:badge?.textContent.trim()||'',title:row.querySelector('.task-title').textContent.trim()}:null})()`);}
async function changePriority(client,id,priority){
 await client.evaluate(`(()=>{const input=document.querySelector('#priority');window.__priorityFrame=document.querySelector('#details-frame');input.focus();input.value=${JSON.stringify(String(priority))};input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
 await until(async()=>{const task=(await invoke(client,'tasks:list')).tasks.find(task=>task.id===id);return task?.priority===priority;},10000,'priority persisted');
 await until(()=>client.evaluate(`document.querySelector('.priority-control')?.dataset.priority===${JSON.stringify(String(priority))}`),10000,'priority color updated');
 assert.equal(await client.evaluate('window.__priorityFrame===document.querySelector("#details-frame")'),true,'priority changes must not replace the editor iframe');
}
const appearanceExpression=`(()=>{
 const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');
 function rgba(value){ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const p=ctx.getImageData(0,0,1,1).data;return [p[0]/255,p[1]/255,p[2]/255,p[3]/255]}
 function overlay(top,bottom){const a=top[3]+bottom[3]*(1-top[3]);return [0,1,2].map(i=>(top[i]*top[3]+bottom[i]*bottom[3]*(1-top[3]))/a).concat(a)}
 function background(node){const chain=[];for(let e=node;e;e=e.parentElement)chain.unshift(e);let color=[1,1,1,1];for(const e of chain)color=overlay(rgba(getComputedStyle(e).backgroundColor),color);return color}
 function lum(c){return c.slice(0,3).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)}
 return [1,2,3].map(priority=>{const badge=document.querySelector('.task-row .priority-badge[data-priority="'+priority+'"]');if(!badge)return null;const style=getComputedStyle(badge),bg=background(badge),fg=overlay(rgba(style.color),bg),a=lum(fg),b=lum(bg),r=badge.getBoundingClientRect(),row=badge.closest('.task-row').getBoundingClientRect();return {priority,text:badge.textContent.trim(),color:style.color,background:style.backgroundColor,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),fits:r.left>=row.left&&r.right<=row.right&&r.top>=row.top&&r.bottom<=row.bottom}})
})()`;

test('priority colors stay readable and consistent across task views, live changes and restart',{timeout:100000},async t=>{
 fs.mkdirSync(tempRoot,{recursive:true});fs.mkdirSync(proof,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'priority-ui-')),fixture=seed(dir);let app,editor;const measurements=[];
 t.after(async()=>{editor?.close();if(app&&app.proc.exitCode===null){app.proc.kill();await timeout(app.done,2000);}for(const client of [app?.main,app?.tray])try{client?.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
 app=await launch(dir);const main=app.main,tray=app.tray;
 for(const [priority,task]of fixture.roots.entries()){const row=await until(()=>rowState(main,task.id),10000,'task row');assert.equal(row.priority,String(priority));assert.equal(row.badge,priority?String(priority):null);if(priority)assert.ok(row.text.includes(['','低','中','高'][priority]));}
 assert.equal((await rowState(main,fixture.child.id)).badge,'3','child must show its own priority');
 await main.send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:2,mobile:false});
 for(const theme of ['light','dark']){
  await invoke(main,'settings:set',{key:'theme',value:theme});await until(()=>main.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`));await blur(main);await delay(150);
  const levels=await main.evaluate(appearanceExpression);assert.ok(levels.every(Boolean));assert.equal(new Set(levels.map(level=>level.color)).size,3,'severity colors must differ');for(const level of levels){assert.ok(level.contrast>=4.5,`${theme} priority ${level.priority} contrast ${level.contrast}`);assert.ok(level.fits,'priority badge must fit its row')}measurements.push({theme,levels});
  await screenshot(main,'priority-'+theme+'-200');
 }
 await main.send('Emulation.clearDeviceMetricsOverride');
 await select(main,fixture.roots[1].id);assert.equal(await main.evaluate('document.querySelector(".priority-control").dataset.priority'),'1');
 const failingDatabase=new DatabaseSync(path.join(dir,'tasks.sqlite'));
 try{
  failingDatabase.exec("CREATE TRIGGER reject_priority BEFORE UPDATE OF priority ON tasks BEGIN SELECT RAISE(ABORT,'synthetic priority failure'); END");
  await main.evaluate(`(()=>{window.__priorityFrame=document.querySelector('#details-frame');const input=document.querySelector('#priority');input.value='3';input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await until(()=>main.evaluate(`document.querySelector('#save-status')?.textContent.includes('失败')&&document.querySelector('#priority')?.value==='1'`),10000,'failed priority save restores selection');
  assert.equal(await main.evaluate('document.querySelector(".priority-control").dataset.priority'),'1','failed save must retain previous color');
  assert.equal((await rowState(main,fixture.roots[1].id)).badge,'1');
  assert.equal((await invoke(main,'tasks:list')).tasks.find(task=>task.id===fixture.roots[1].id).priority,1,'failed save must not change persisted priority');
  assert.equal(await main.evaluate('window.__priorityFrame===document.querySelector("#details-frame")'),true);
 }finally{failingDatabase.exec('DROP TRIGGER IF EXISTS reject_priority');failingDatabase.close();}
 await changePriority(main,fixture.roots[1].id,3);assert.equal((await rowState(main,fixture.roots[1].id)).badge,'3');
 await changePriority(main,fixture.roots[1].id,0);assert.equal((await rowState(main,fixture.roots[1].id)).badge,null);
 await changePriority(main,fixture.roots[1].id,2);await blur(main);
 await click(main,'[data-page="calendar"]');await until(()=>main.evaluate('Boolean(document.querySelector(".calendar-controls"))'));assert.equal((await rowState(main,fixture.roots[3].id)).badge,'3');
 await click(tray,'[data-action="tray-page"][data-value="tasks"]');await until(async()=>(await rowState(tray,fixture.roots[1].id))?.badge==='2',10000,'tray priority');
 const trayRows=await tray.evaluate(`Array.from(document.querySelectorAll('.task-row')).map(row=>{const badge=row.querySelector('.priority-badge');if(!badge)return true;const a=badge.getBoundingClientRect(),b=row.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right})`);assert.ok(trayRows.every(Boolean));
 await invoke(main,'app:open-editor',{id:fixture.roots[0].id});editor=await CDP.connect((await app.target(url=>url.includes('view=editor')&&url.includes(fixture.roots[0].id))).webSocketDebuggerUrl);
 await until(()=>editor.evaluate('Boolean(document.querySelector("#priority")&&document.querySelector("#details-frame")?.contentDocument?.querySelector("#editor"))'));
 assert.equal((await rowState(editor,fixture.child.id)).badge,'3');await changePriority(editor,fixture.roots[0].id,1);await blur(editor);
 await quit(app);app=null;editor.close();editor=null;
 app=await launch(dir);const saved=(await invoke(app.main,'tasks:list')).tasks;assert.equal(saved.find(task=>task.id===fixture.roots[0].id).priority,1);assert.equal(saved.find(task=>task.id===fixture.roots[1].id).priority,2);assert.equal((await rowState(app.main,fixture.roots[0].id)).badge,'1');
 fs.writeFileSync(path.join(proof,'report.json'),JSON.stringify({measurements,views:['main','calendar','tray','child','floating-editor'],livePriorityChanges:true,failedSaveRetainsPreviousColor:true,iframePreserved:true,restartPersistence:true,syntheticOnly:true},null,2));
 await quit(app);app=null;t.diagnostic('Synthetic color/contrast screenshots: '+proof);
});
