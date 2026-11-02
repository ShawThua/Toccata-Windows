'use strict';
// Real Electron controls and SQLite, with invented tasks and capture disabled.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {TaskStore}=require('../data/tasks');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'../../.qa-temp');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function timeout(work,ms){let timer;try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]);}finally{clearTimeout(timer);}}
async function until(fn,ms=10000,label='condition'){
 const end=Date.now()+ms;let last;
 while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(error){last=error;}await delay(50);}
 throw Error(`${label} timed out${last?': '+last.message:''}`);
}
class CDP{
 constructor(ws){
  this.ws=ws;this.id=0;this.pending=new Map();
  ws.addEventListener('message',event=>{const value=JSON.parse(event.data),pending=this.pending.get(value.id);if(!pending)return;this.pending.delete(value.id);value.error?pending.reject(Error(value.error.message)):pending.resolve(value.result);});
  ws.addEventListener('close',()=>{for(const value of this.pending.values())value.reject(Error('CDP closed'));this.pending.clear();});
 }
 static async connect(url){
  const ws=new WebSocket(url);
  const ready=await timeout(new Promise((resolve,reject)=>{ws.addEventListener('open',()=>resolve(true),{once:true});ws.addEventListener('error',()=>reject(Error('CDP failed')),{once:true});}),5000);
  if(!ready)throw Error('CDP connection timed out');
  return new CDP(ws);
 }
 send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
 close(){this.ws.close();}
}
async function launch(dir){
 const temp=path.join(dir,'temp');fs.mkdirSync(temp,{recursive:true});
 const env={...process.env,TOCCATA_DATA_DIR:dir,TOCCATA_DISABLE_CAPTURE:'1',TEMP:temp,TMP:temp};
 for(const key of ['ELECTRON_RUN_AS_NODE','TOCCATA_QA_HELPER_EXE','TOCCATA_QA_HELPER_SCRIPT','TOCCATA_QA_MEMORY','TOCCATA_QA_SCREENSHOT'])delete env[key];
 const proc=spawn(path.join(project,'node_modules/electron/dist/electron.exe'),['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',path.join(__dirname,'task-interactions-harness.cjs')],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';proc.stdout.on('data',value=>output+=value);proc.stderr.on('data',value=>output+=value);
 const done=new Promise(resolve=>proc.once('close',(code,signal)=>resolve({code,signal})));
 try{
  const port=await until(()=>{const match=output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(match)return +match[1];if(proc.exitCode!==null)throw Error(output.slice(-2000));},20000,'Electron startup');
  const target=predicate=>until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();return pages.find(page=>page.type==='page'&&page.webSocketDebuggerUrl&&predicate(page.url));},10000,'renderer target');
  const main=await CDP.connect((await target(url=>url.includes('/renderer/index.html')&&!url.includes('?'))).webSocketDebuggerUrl);
  await until(()=>main.evaluate('Boolean(document.querySelector("#new-task")&&window.toccata?.invoke)'),10000,'main ready');
  assert.equal((await invoke(main,'capture:status')).state,'disabled');
  return{proc,done,main,target,getOutput:()=>output};
 }catch(error){if(proc.exitCode===null)proc.kill();await timeout(done,3000);throw Error(error.message+'\n'+output.slice(-2500));}
}
const invoke=(client,name,payload={})=>client.evaluate(`window.toccata.invoke(${JSON.stringify(name)},${JSON.stringify(payload)})`);
const click=(client,selector)=>client.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing '+${JSON.stringify(selector)});element.click();return true})()`);
let commandId=0;
async function control(client,op){const id=++commandId;await client.evaluate(`console.log('QA_INTERACTIONS '+JSON.stringify(${JSON.stringify({id,op})}));true`);const reply=await until(()=>client.evaluate(`window.__interactionReply?.id===${id}?window.__interactionReply:null`),5000,'harness '+op);if(reply.error)throw Error(reply.error);return reply.result;}
async function select(client,id){await click(client,`.task-row[data-id="${id}"]`);await selected(client,id);}
async function selected(client,id){await until(()=>client.evaluate(`document.querySelector('#details-frame')?.dataset.task===${JSON.stringify(id)}&&Boolean(document.querySelector('#details-frame')?.contentDocument?.querySelector('#editor'))`),10000,'selected task');await delay(80);}
async function setTitle(client,value){await client.evaluate(`(()=>{const e=document.querySelector('#detail-title');e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:e.value}));return true})()`);}
async function setBody(client,value){await client.evaluate(`(()=>{const e=document.querySelector('#details-frame').contentDocument.querySelector('#editor');e.focus();e.textContent=${JSON.stringify(value)};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:e.textContent}));return true})()`);}
async function ctrlS(client,field='title'){
 await client.send('Page.bringToFront');
 await client.evaluate(field==='body'?`document.querySelector('#details-frame').contentDocument.querySelector('#editor').focus();true`:`document.querySelector('#detail-title').focus();true`);
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83,modifiers:2});
 await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'s',code:'KeyS',windowsVirtualKeyCode:83,modifiers:2});
 await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:0});
}
async function task(client,id){return(await invoke(client,'tasks:list')).tasks.find(item=>item.id===id);}
async function saved(client){return until(()=>client.evaluate(`/已保存|Saved/.test(document.querySelector('#save-status')?.textContent||'')`),10000,'saved status');}
async function quit(app){await control(app.main,'stop-noise');await control(app.main,'release-controls');await control(app.main,'release-lists');await app.main.evaluate(`window.toccata.invoke('app:quit').catch(()=>{});true`);const result=await timeout(app.done,10000);assert.ok(result,'Electron did not exit');assert.equal(result.code,0,app.getOutput().slice(-2000));app.main.close();}
function fixture(t){
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'task-interactions-'));
 assert.equal(path.dirname(dir),tempRoot);
 const store=new TaskStore(path.join(dir,'tasks.sqlite'));
 const parent=store.create({title:'交互测试父任务',details:'父任务原始正文'}),child=store.create({title:'交互测试子任务',details:'子任务原始正文',parent_id:parent.id}),other=store.create({title:'独立任务',details:'原始正文'});store.close();
 let app;const clients=[];
 t.after(async()=>{for(const client of clients)try{client.close();}catch{}if(app&&app.proc.exitCode===null){app.proc.kill();await timeout(app.done,3000);}try{app?.main.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
 return{dir,parent,child,other,clients,get app(){return app;},set app(value){app=value;}};
}
function rejectWrites(dir){
 const db=new DatabaseSync(path.join(dir,'tasks.sqlite'));db.exec("CREATE TRIGGER reject_interaction_write BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'synthetic task write failure'); END");
 return()=>{db.exec('DROP TRIGGER IF EXISTS reject_interaction_write');db.close();};
}

test('manual save and Ctrl+S in title and Markdown preserve the iframe, skip clean writes and survive restart',{timeout:35000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.other.id);
 assert.ok(await main.evaluate('Boolean(document.querySelector("[data-action=save-task]"))'),'main save button');
 await main.evaluate('window.__savedFrame=document.querySelector("#details-frame");true');await control(main,'start-noise');
 await setTitle(main,'Ctrl+S 即时保存标题');await ctrlS(main);await until(async()=>(await task(main,f.other.id)).title==='Ctrl+S 即时保存标题');await saved(main);
 await setBody(main,'正文还在输入时按 Ctrl+S');await ctrlS(main,'body');await until(async()=>(await task(main,f.other.id)).details.trim()==='正文还在输入时按 Ctrl+S');await saved(main);
 await setTitle(main,'按钮保存最终标题');await setBody(main,'按钮保存最终正文');await click(main,'[data-action=save-task]');
 await until(async()=>{const item=await task(main,f.other.id);return item.title==='按钮保存最终标题'&&item.details.trim()==='按钮保存最终正文';});await saved(main);
 const before=await task(main,f.other.id),writes=(await control(main,'counts')).writes;
 await ctrlS(main);await ctrlS(main,'body');await click(main,'[data-action=save-task]');await delay(400);
 assert.equal((await task(main,f.other.id)).updated_at,before.updated_at,'clean saves must not alter the modification time');
 assert.equal((await control(main,'counts')).writes,writes,'clean saves must not send another write');
 assert.equal(await main.evaluate('window.__savedFrame===document.querySelector("#details-frame")'),true,'save/background refresh replaced Markdown frame');
 await quit(f.app);f.app=null;f.app=await launch(f.dir);
 const restored=await task(f.app.main,f.other.id);assert.equal(restored.title,'按钮保存最终标题');assert.equal(restored.details.trim(),'按钮保存最终正文');await quit(f.app);f.app=null;
});

test('manual save waits for pending date and priority updates instead of reporting a premature saved state',{timeout:30000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.other.id);await control(main,'hold-controls');
 const date='2032-10-19',stamp=new Date(date+'T00:00:00').getTime()/1000;
 await main.evaluate(`(()=>{const date=document.querySelector('#plan-date');date.value=${JSON.stringify(date)};date.dispatchEvent(new Event('change',{bubbles:true}));const priority=document.querySelector('#priority');priority.value='3';priority.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
 await until(async()=>(await control(main,'counts')).pendingControls>0,10000,'held control write');
 await ctrlS(main);await delay(250);
 assert.equal((await task(main,f.other.id)).planned_at,null,'date fixture must remain blocked');
 assert.equal(await main.evaluate(`/已保存|Saved/.test(document.querySelector('#save-status')?.textContent||'')`),false,'save cannot finish before queued controls');
 await control(main,'release-controls');
 await until(async()=>{const item=await task(main,f.other.id);return item.planned_at===stamp&&item.priority===3;},10000,'both controls persisted');await saved(main);
 assert.equal(await main.evaluate('document.querySelector("#plan-date").value'),date);await quit(f.app);f.app=null;
});

test('a failed explicit save retains title and Markdown drafts and can be retried without replacing controls',{timeout:30000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.other.id);await main.evaluate('window.__failureFrame=document.querySelector("#details-frame");true');
 const restore=rejectWrites(f.dir);
 try{
  await setTitle(main,'写入失败时保留的标题');await setBody(main,'写入失败时保留的正文');await click(main,'[data-action=save-task]');
  await until(()=>main.evaluate(`/失败|failed/i.test(document.querySelector('#save-status')?.textContent||'')`),10000,'failed save status');
  assert.equal((await task(main,f.other.id)).title,f.other.title);assert.equal((await task(main,f.other.id)).details,f.other.details);
  assert.equal(await main.evaluate('document.querySelector("#detail-title").value'),'写入失败时保留的标题');
  assert.equal(await main.evaluate('document.querySelector("#details-frame").contentDocument.querySelector("#editor").innerText'),'写入失败时保留的正文');
  assert.equal(await main.evaluate('window.__failureFrame===document.querySelector("#details-frame")'),true);
 }finally{restore();}
 await click(main,'[data-action=save-task]');await until(async()=>{const item=await task(main,f.other.id);return item.title==='写入失败时保留的标题'&&item.details.trim()==='写入失败时保留的正文';});await saved(main);await quit(f.app);f.app=null;
});

test('Ctrl+S during title and Markdown composition never stores provisional text and saves the committed result',{timeout:30000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.other.id);
 await main.evaluate(`(()=>{const e=document.querySelector('#detail-title');e.focus();e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.value='标题临时组词';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:e.value}));return true})()`);
 await ctrlS(main);await delay(700);assert.equal((await task(main,f.other.id)).title,f.other.title,'provisional title leaked into storage');
 await main.evaluate(`(()=>{const e=document.querySelector('#detail-title');e.value='标题最终组词';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:e.value}));e.dispatchEvent(new InputEvent('input',{bubbles:true,data:e.value}));return true})()`);
 await until(async()=>(await task(main,f.other.id)).title==='标题最终组词');
 await main.evaluate(`(()=>{const e=document.querySelector('#details-frame').contentDocument.querySelector('#editor');e.focus();e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.textContent='正文临时组词';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:e.textContent}));return true})()`);
 await ctrlS(main,'body');await delay(700);assert.equal((await task(main,f.other.id)).details,f.other.details,'provisional Markdown leaked into storage');
 await main.evaluate(`(()=>{const e=document.querySelector('#details-frame').contentDocument.querySelector('#editor');e.textContent='正文最终组词';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:e.textContent}));e.dispatchEvent(new InputEvent('input',{bubbles:true,data:e.textContent}));return true})()`);
 await until(async()=>(await task(main,f.other.id)).details.trim()==='正文最终组词');await saved(main);await quit(f.app);f.app=null;
});

test('returning to a parent saves the child in main and floating views and synchronizes the host editor identity',{timeout:35000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.child.id);
 assert.equal(await main.evaluate(`document.querySelector('[data-action=parent-task]')?.dataset.id`),f.parent.id);
 await setTitle(main,'返回前保存子任务');await setBody(main,'主窗口返回前保存的正文');await click(main,'[data-action=parent-task]');await selected(main,f.parent.id);
 let child=await task(main,f.child.id);assert.equal(child.title,'返回前保存子任务');assert.equal(child.details.trim(),'主窗口返回前保存的正文');
 assert.equal(await main.evaluate('Boolean(document.querySelector("[data-action=parent-task]"))'),false,'root task should not show a parent action');
 await invoke(main,'app:open-editor',{id:f.child.id});const editor=await CDP.connect((await f.app.target(url=>url.includes('view=editor')&&url.includes(f.child.id))).webSocketDebuggerUrl);f.clients.push(editor);await selected(editor,f.child.id);
 assert.ok(await editor.evaluate('Boolean(document.querySelector("[data-action=save-task]")&&document.querySelector("#save-status"))'),'floating save button/status');
 await setTitle(editor,'浮窗 Ctrl+S 标题');await ctrlS(editor);await until(async()=>(await task(main,f.child.id)).title==='浮窗 Ctrl+S 标题');await saved(editor);
 await setBody(editor,'浮窗按钮保存正文');await click(editor,'[data-action=save-task]');await until(async()=>(await task(main,f.child.id)).details.trim()==='浮窗按钮保存正文');await saved(editor);
 await setBody(editor,'浮窗返回父任务前的最新正文');await click(editor,'[data-action=parent-task]');await selected(editor,f.parent.id);
 assert.equal(await editor.evaluate(`new URLSearchParams(location.search).get('id')`),f.parent.id,'floating URL must identify the parent');
 const status=await invoke(main,'app:editor-status');assert.equal(status.id,f.parent.id,'main process editorTaskId must identify the parent');assert.equal(status.visible,true);
 child=await task(main,f.child.id);assert.equal(child.details.trim(),'浮窗返回父任务前的最新正文');
 const tray=await CDP.connect((await f.app.target(url=>url.includes('view=tray'))).webSocketDebuggerUrl);f.clients.push(tray);await until(()=>tray.evaluate(`Boolean(document.querySelector('.task-row[data-id="${f.parent.id}"]'))`));
 await click(tray,`.task-row[data-id="${f.parent.id}"]`);await until(async()=>(await invoke(main,'app:editor-status')).visible===false,10000,'clicking the active parent toggles the existing editor');
 await quit(f.app);f.app=null;
});

test('parent navigation refuses failed saves and a deleted parent while retaining the unsaved child draft',{timeout:30000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.child.id);await main.evaluate('window.__childFrame=document.querySelector("#details-frame");true');
 const restore=rejectWrites(f.dir);
 try{
  await setTitle(main,'失败时不得离开的子任务草稿');await setBody(main,'失败时保留子任务正文');await click(main,'[data-action=parent-task]');
  await until(()=>main.evaluate(`/失败|failed/i.test(document.querySelector('#save-status')?.textContent||'')`));
  assert.equal(await main.evaluate('document.querySelector("#details-frame").dataset.task'),f.child.id);
  assert.equal(await main.evaluate('document.querySelector("#detail-title").value'),'失败时不得离开的子任务草稿');
  assert.equal(await main.evaluate('window.__childFrame===document.querySelector("#details-frame")'),true);
 }finally{restore();}
 await click(main,'[data-action=save-task]');await until(async()=>(await task(main,f.child.id)).title==='失败时不得离开的子任务草稿');await saved(main);
 await setTitle(main,'父任务删除后仍保留的本地草稿');
 const db=new DatabaseSync(path.join(f.dir,'tasks.sqlite'));try{db.exec('PRAGMA foreign_keys=ON');db.prepare('DELETE FROM tasks WHERE id=?').run(f.parent.id);}finally{db.close();}
 await click(main,'[data-action=parent-task]');await delay(700);
 assert.equal(await main.evaluate('document.querySelector("#details-frame")?.dataset.task'),f.child.id,'deleted parent must not trigger navigation');
 assert.equal(await main.evaluate('document.querySelector("#detail-title")?.value'),'父任务删除后仍保留的本地草稿','deleted task draft must remain available to copy');
 assert.equal(await main.evaluate('window.__childFrame===document.querySelector("#details-frame")'),true);
 // The intentionally orphaned draft cannot be saved; fixture cleanup closes only this test process.
});

test('an empty title blocks Ctrl+S and parent navigation without losing input, then recovers after correction',{timeout:25000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.child.id);
 await main.evaluate('window.__invalidTitleFrame=document.querySelector("#details-frame");true');
 await setTitle(main,'   ');await setBody(main,'空标题时需要保留的正文');await ctrlS(main);
 await until(()=>main.evaluate(`/标题不能为空|Title cannot be empty/i.test(document.querySelector('.error-banner')?.textContent||'')`),10000,'invalid title is reported');
 await until(()=>main.evaluate(`/标题不能为空|Title cannot be empty/i.test(document.querySelector('#save-status')?.textContent||'')`),10000,'invalid title has a final validation status');
 assert.equal((await task(main,f.child.id)).title,f.child.title,'Ctrl+S must never persist an empty title');
 assert.equal(await main.evaluate('document.querySelector("#detail-title").value'),'   ','invalid input must remain available for correction');
 await click(main,'[data-action=parent-task]');await delay(650);
 assert.match(await main.evaluate('document.querySelector("#save-status").textContent'),/标题不能为空|Title cannot be empty/i,'invalid input must not remain stuck in a saving state');
 assert.equal(await main.evaluate('document.querySelector("#details-frame").dataset.task'),f.child.id,'invalid title must block navigation');
 assert.equal(await main.evaluate('document.querySelector("#detail-title").value'),'   ');
 assert.equal(await main.evaluate('document.querySelector("#details-frame").contentDocument.querySelector("#editor").innerText'),'空标题时需要保留的正文');
 assert.equal(await main.evaluate('window.__invalidTitleFrame===document.querySelector("#details-frame")'),true,'validation must not rebuild the editor');
 await setTitle(main,'修正后可保存并返回父任务');await ctrlS(main);
 await until(async()=>{const child=await task(main,f.child.id);return child.title==='修正后可保存并返回父任务'&&child.details.trim()==='空标题时需要保留的正文';});await saved(main);
 await click(main,'[data-action=parent-task]');await selected(main,f.parent.id);
 assert.equal((await task(main,f.child.id)).title,'修正后可保存并返回父任务');await quit(f.app);f.app=null;
});

test('composition that begins while an explicit save awaits iframe flush is deferred without persisting provisional text',{timeout:35000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.other.id);
 await main.evaluate('window.__compositionRaceFrame=document.querySelector("#details-frame");true');
 for(const field of ['title','body']){
  const before=await task(main,f.other.id),original=field==='title'?before.title:before.details;
  await main.evaluate(`(()=>{const target=document.querySelector('#details-frame').contentWindow,original=target.postMessage.bind(target);window.__heldFlush={target,original,messages:[]};target.postMessage=function(message,...args){if(message?.type==='toccata-flush'){window.__heldFlush.messages.push([message,args]);return}return original(message,...args)};return true})()`);
  await ctrlS(main,field);
  await until(()=>main.evaluate('window.__heldFlush.messages.length>0'),10000,'save is waiting for its iframe snapshot');
  const provisional=field==='title'?'保存途中开始的标题组词':'保存途中开始的正文组词',committed=field==='title'?'保存途中的标题最终文本':'保存途中的正文最终文本';
  await main.evaluate(`(()=>{const e=${field==='title'?"document.querySelector('#detail-title')":"document.querySelector('#details-frame').contentDocument.querySelector('#editor')"};e.focus();e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));${field==='title'?'e.value':'e.textContent'}=${JSON.stringify(provisional)};e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:${JSON.stringify(provisional)}}));return true})()`);
  await main.evaluate(`(()=>{const held=window.__heldFlush;held.target.postMessage=held.original;for(const [message,args]of held.messages.splice(0))held.original(message,...args);return true})()`);
  await delay(650);
  const during=await task(main,f.other.id);assert.equal(field==='title'?during.title:during.details,original,field+' provisional text escaped from an in-flight save');
  assert.equal(await main.evaluate('window.__compositionRaceFrame===document.querySelector("#details-frame")'),true);
  await main.evaluate(`(()=>{const e=${field==='title'?"document.querySelector('#detail-title')":"document.querySelector('#details-frame').contentDocument.querySelector('#editor')"};${field==='title'?'e.value':'e.textContent'}=${JSON.stringify(committed)};e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:${JSON.stringify(committed)}}));e.dispatchEvent(new InputEvent('input',{bubbles:true,data:${JSON.stringify(committed)}}));return true})()`);
  await until(async()=>{const after=await task(main,f.other.id);return(field==='title'?after.title:after.details.trim())===committed;},10000,'committed '+field+' saved');await saved(main);
 }
 await quit(f.app);f.app=null;
});

test('returning to a parent cannot steal selection after another task was selected during its list refresh',{timeout:25000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.child.id);
 await control(main,'hold-next-list');await click(main,'[data-action=parent-task]');
 await until(async()=>(await control(main,'counts')).pendingLists===1,10000,'parent navigation list refresh is held');
 await select(main,f.other.id);await control(main,'release-lists');await delay(250);
 assert.equal(await main.evaluate('document.querySelector("#details-frame").dataset.task'),f.other.id,'a stale parent action stole the newer selection');
 assert.equal(await main.evaluate('document.querySelector("#detail-title").value'),f.other.title);
 await quit(f.app);f.app=null;
});

test('floating child-parent-child navigation and context editing keep URL and host identity aligned with tray toggling',{timeout:35000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;
 await invoke(main,'app:open-editor',{id:f.child.id});const editor=await CDP.connect((await f.app.target(url=>url.includes('view=editor')&&url.includes(f.child.id))).webSocketDebuggerUrl);f.clients.push(editor);await selected(editor,f.child.id);
 const aligned=async id=>{await selected(editor,id);assert.equal(await editor.evaluate(`new URLSearchParams(location.search).get('id')`),id);const status=await invoke(main,'app:editor-status');assert.equal(status.id,id);assert.equal(status.visible,true);};
 await click(editor,'[data-action=parent-task]');await aligned(f.parent.id);
 await click(editor,`.task-row[data-id="${f.child.id}"]`);await aligned(f.child.id);
 await click(editor,'[data-action=parent-task]');await aligned(f.parent.id);
 await editor.evaluate(`(()=>{const row=document.querySelector('.task-row[data-id="${f.child.id}"]'),rect=row.getBoundingClientRect();row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+8,clientY:rect.top+8}));return true})()`);
 await until(()=>editor.evaluate('Boolean(document.querySelector("#task-context-root [data-action=ctx-edit]"))'));
 await click(editor,'#task-context-root [data-action=ctx-edit]');await aligned(f.child.id);
 const tray=await CDP.connect((await f.app.target(url=>url.includes('view=tray'))).webSocketDebuggerUrl);f.clients.push(tray);await until(()=>tray.evaluate(`Boolean(document.querySelector('.task-row[data-id="${f.child.id}"]'))`));
 await click(tray,`.task-row[data-id="${f.child.id}"]`);await until(async()=>(await invoke(main,'app:editor-status')).visible===false,10000,'tray toggles the same child editor');
 await quit(f.app);f.app=null;
});
