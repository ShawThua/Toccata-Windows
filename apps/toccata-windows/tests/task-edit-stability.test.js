'use strict';
// Synthetic-only Electron regression. No real capture or production database.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {TaskStore}=require('../data/tasks');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'..','..','.qa-temp');
const electron=path.join(project,'node_modules','electron','dist','electron.exe');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function timeout(work,ms){let timer;try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms);})]);}finally{clearTimeout(timer);}}
async function until(fn,ms=10000,label='condition'){const end=Date.now()+ms;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(error){last=error;}await delay(60);}throw Error(`${label} timed out${last?': '+last.message:''}`);}
class CDP{
 constructor(ws){this.ws=ws;this.next=0;this.pending=new Map();ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=this.pending.get(r.id);if(!p)return;this.pending.delete(r.id);if(r.error)p.reject(Error(r.error.message));else p.resolve(r.result);});ws.addEventListener('close',()=>{for(const p of this.pending.values())p.reject(Error('CDP closed'));this.pending.clear();});}
 static async connect(url){const ws=new WebSocket(url);await timeout(new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('CDP failed')),{once:true});}),5000);return new CDP(ws);}
 send(method,params={}){const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
 close(){this.ws.close();}
}
async function launch(dataDir){
 const tmp=path.join(dataDir,'temp');fs.mkdirSync(tmp,{recursive:true});
 const env={...process.env,TOCCATA_DATA_DIR:dataDir,TOCCATA_DISABLE_CAPTURE:'1',TEMP:tmp,TMP:tmp};
 for(const key of ['ELECTRON_RUN_AS_NODE','TOCCATA_QA_HELPER_EXE','TOCCATA_QA_HELPER_SCRIPT','TOCCATA_QA_MEMORY','TOCCATA_QA_SCREENSHOT'])delete env[key];
 const proc=spawn(electron,['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',path.join(__dirname,'task-edit-harness.cjs')],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='',exited=false;proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>output+=x);const done=new Promise(resolve=>proc.once('close',(code,signal)=>{exited=true;resolve({code,signal});}));
 try{
 const port=await until(()=>{const m=output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(m)return +m[1];if(exited)throw Error(output.slice(-1500));},20000,'Electron startup');
 const target=async predicate=>until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();return pages.find(p=>p.webSocketDebuggerUrl&&p.type==='page'&&predicate(p.url));},10000,'renderer target');
 const main=await CDP.connect((await target(url=>url.includes('/renderer/index.html')&&!url.includes('?'))).webSocketDebuggerUrl);
 await until(()=>main.evaluate('Boolean(document.querySelector("#new-task")&&window.toccata?.invoke)'),10000,'main ready');
 assert.equal((await invoke(main,'capture:status')).state,'disabled');
 return{proc,done,main,target,getOutput:()=>output};
 }catch(error){if(proc.exitCode===null)proc.kill();await timeout(done,3000);throw error;}
}
const invoke=(client,name,payload={})=>client.evaluate(`window.toccata.invoke(${JSON.stringify(name)},${JSON.stringify(payload)})`);
let commandId=0;
async function control(client,op){const id=++commandId;await client.evaluate(`console.log('QA_EDIT_COMMAND '+JSON.stringify(${JSON.stringify({id,op})}));true`);const reply=await until(()=>client.evaluate(`window.__editReply?.id===${id}?window.__editReply:null`),5000,'harness '+op);if(reply.error)throw Error(reply.error);return reply.result;}
async function select(client,id){await client.evaluate(`document.querySelector('.task-row[data-id="${id}"]').click();true`);await until(()=>client.evaluate(`document.querySelector('#details-frame')?.dataset.task===${JSON.stringify(id)}&&Boolean(document.querySelector('#details-frame')?.contentDocument?.querySelector('#editor'))`),10000,'selected task');await delay(80);}
async function click(client,selector){return client.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);}
async function setInput(client,id,value,dispatch=true){return client.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('Missing input');e.focus();e.value=${JSON.stringify(value)};${dispatch?"e.dispatchEvent(new Event('input',{bubbles:true}));":''}return true})()`);}
async function frameText(client,text){return client.evaluate(`(()=>{const doc=document.querySelector('#details-frame').contentDocument,e=doc.querySelector('#editor');e.focus();e.textContent=${JSON.stringify(text)};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)}}));return true})()`);}
async function blur(client){await client.evaluate(`document.activeElement?.blur();document.querySelector('#details-frame')?.contentDocument?.activeElement?.blur();true`);}
async function cleanExit(app){await control(app.main,'stop-noise');await app.main.evaluate(`window.toccata.invoke('app:quit').catch(()=>{});true`);const result=await timeout(app.done,10000);assert.ok(result,'Electron did not exit');assert.equal(result.code,0,app.getOutput().slice(-1800));app.main.close();}
function fixture(t,{details='初始详情'}={}){fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'task-edit-'));assert.equal(path.dirname(dir),tempRoot);const store=new TaskStore(path.join(dir,'tasks.sqlite'));const first=store.create({title:'持续编辑任务',details}),second=store.create({title:'其他窗口任务',details:'其他详情'});store.close();let app;const clients=[];t.after(async()=>{for(const client of clients)try{client.close();}catch{}if(app&&app.proc.exitCode===null){app.proc.kill();await timeout(app.done,3000);}if(app)try{app.main.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});return{dir,first,second,clients,get app(){return app;},set app(value){app=value;}};}

test('idle task detail never enters an autosave and refresh feedback loop',{timeout:25000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);await select(f.app.main,f.first.id);await control(f.app.main,'reset');await control(f.app.main,'pulse');await delay(4000);
 const counts=await control(f.app.main,'counts');assert.equal(counts.writes,0,`idle refresh caused ${counts.writes} task writes`);
 await cleanExit(f.app);f.app=null;
});

test('opening existing noncanonical Markdown never rewrites it as a new draft',{timeout:25000},async t=>{
 const details='* 列表\r\n* 条目',f=fixture(t,{details});f.app=await launch(f.dir);await select(f.app.main,f.first.id);await control(f.app.main,'reset');await control(f.app.main,'pulse');await delay(2000);
 const counts=await control(f.app.main,'counts');assert.equal(counts.writes,0,'clean existing Markdown was marked dirty by canonicalization');assert.equal((await invoke(f.app.main,'tasks:list')).tasks.find(x=>x.id===f.first.id).details,details);
 await cleanExit(f.app);f.app=null;
});

test('new task, child and date controls keep drafts and focus during background changes',{timeout:45000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.first.id);
 await control(main,'start-noise');
 for(const [id,text]of[['new-task','持续输入一个新任务'],['new-child','持续输入一个子任务']]){
  await setInput(main,id,'',false);await main.evaluate(`window.__typingNode=document.getElementById(${JSON.stringify(id)});true`);
  let current='';for(const char of text){current+=char;await setInput(main,id,current);await delay(150);}
  await delay(1200);const actual=await main.evaluate(`({value:document.getElementById(${JSON.stringify(id)}).value,same:window.__typingNode===document.getElementById(${JSON.stringify(id)}),focus:document.activeElement.id})`);
  assert.deepEqual(actual,{value:text,same:true,focus:id},id+' lost draft/focus');
 }
 await click(main,'[data-page="calendar"]');await until(()=>main.evaluate('Boolean(document.querySelector("#planned-task"))'));await setInput(main,'planned-task','日历里未提交的草稿');await delay(2000);assert.equal(await main.evaluate('document.querySelector("#planned-task").value'),'日历里未提交的草稿');
 await control(main,'stop-noise');await cleanExit(f.app);f.app=null;
});

test('date, clearing date and priority survive autosave, refresh and restart',{timeout:35000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const main=f.app.main;await select(main,f.first.id);await control(main,'start-noise');
 const picker=await main.send('Runtime.evaluate',{expression:`window.__dateNode=document.querySelector('#plan-date');window.__dateNode.focus();window.__dateNode.showPicker();true`,userGesture:true,returnByValue:true});assert.equal(picker.exceptionDetails,undefined,'native date picker could not open');await delay(1600);
 assert.equal(await main.evaluate(`window.__dateNode===document.querySelector('#plan-date')&&document.activeElement.id==='plan-date'`),true,'background change replaced the focused native date input');
 await main.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await main.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await setInput(main,'detail-title','修改标题后调整计划日期');
 const date='2031-12-27',stamp=new Date(date+'T00:00:00').getTime()/1000;
 await main.evaluate(`(()=>{const e=document.querySelector('#plan-date');e.focus();e.value=${JSON.stringify(date)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
 await until(async()=>{const item=(await invoke(main,'tasks:list')).tasks.find(x=>x.id===f.first.id);return item.planned_at===stamp&&item.title==='修改标题后调整计划日期';},8000,'planned date persisted');
 await delay(1800);assert.equal(await main.evaluate('document.querySelector("#plan-date").value'),date);
 await main.evaluate(`(()=>{const e=document.querySelector('#priority');e.focus();e.value='3';e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
 await until(async()=>(await invoke(main,'tasks:list')).tasks.find(x=>x.id===f.first.id).priority===3,8000,'priority persisted');
 await click(main,'[data-action="clear-date"]');await until(async()=>(await invoke(main,'tasks:list')).tasks.find(x=>x.id===f.first.id).planned_at===null,8000,'date cleared');
 await control(main,'stop-noise');await cleanExit(f.app);f.app=null;
 const store=new TaskStore(path.join(f.dir,'tasks.sqlite'));const item=store.get(f.first.id);store.close();assert.equal(item.planned_at,null);assert.equal(item.priority,3);assert.equal(item.title,'修改标题后调整计划日期');
});

test('tray quick draft and floating editor composition survive repeated background notifications',{timeout:45000},async t=>{
 const f=fixture(t);f.app=await launch(f.dir);const tray=await CDP.connect((await f.app.target(url=>url.includes('view=tray'))).webSocketDebuggerUrl);f.clients.push(tray);await until(()=>tray.evaluate('Boolean(document.querySelector("#new-task"))'));
 await control(f.app.main,'start-noise');await setInput(tray,'new-task','托盘创建任务的未提交草稿');await delay(2500);assert.equal(await tray.evaluate('document.querySelector("#new-task").value'),'托盘创建任务的未提交草稿');
 await invoke(f.app.main,'app:open-editor',{id:f.first.id});const editor=await CDP.connect((await f.app.target(url=>url.includes('view=editor')&&url.includes(f.first.id))).webSocketDebuggerUrl);f.clients.push(editor);await until(()=>editor.evaluate('Boolean(document.querySelector("#details-frame")?.contentDocument?.querySelector("#editor"))'));
 await editor.evaluate(`(()=>{const e=document.querySelector('#detail-title');e.focus();e.value='输入前缀后取消组词';e.dispatchEvent(new InputEvent('input',{bubbles:true,data:e.value}));e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));return true})()`);await delay(800);
 assert.equal((await invoke(f.app.main,'tasks:list')).tasks.find(x=>x.id===f.first.id).title,'输入前缀后取消组词','cancelled IME composition must resume a pending autosave');
 await editor.evaluate(`(()=>{const e=document.querySelector('#detail-title');e.focus();e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));e.value='中文输入法组词中';e.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'中文输入法组词中'}));window.__composingTitle=e;return true})()`);
 await delay(1500);assert.equal(await editor.evaluate('window.__composingTitle===document.querySelector("#detail-title")'),true);assert.equal(await editor.evaluate('document.querySelector("#detail-title").value'),'中文输入法组词中');
 assert.equal((await invoke(f.app.main,'tasks:list')).tasks.find(x=>x.id===f.first.id).title,'输入前缀后取消组词','IME provisional text must not be persisted');
 await editor.evaluate(`(()=>{const e=document.querySelector('#detail-title');e.value='中文输入法最终标题';e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:e.value}));e.dispatchEvent(new InputEvent('input',{bubbles:true,data:e.value}));return true})()`);
 const markdown='逐字输入并跨过保存间隔的中文正文';
 await editor.evaluate(`(()=>{const frame=document.querySelector('#details-frame'),doc=frame.contentDocument,e=doc.querySelector('#editor');window.__typingMarkdownFrame=frame;e.focus();e.textContent='';const range=doc.createRange();range.selectNodeContents(e);range.collapse(false);const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);return true})()`);
 let typed=0;for(const char of markdown){await editor.evaluate(`document.querySelector('#details-frame').contentDocument.execCommand('insertText',false,${JSON.stringify(char)});true`);await delay(++typed%4===0?500:90);}
 await delay(1100);const actual=await editor.evaluate(`(()=>{const frame=document.querySelector('#details-frame'),doc=frame.contentDocument;return {same:frame===window.__typingMarkdownFrame,focus:doc.activeElement.id,text:doc.querySelector('#editor').innerText}})()`);assert.deepEqual(actual,{same:true,focus:'editor',text:markdown});
 await blur(editor);await control(f.app.main,'stop-noise');await cleanExit(f.app);f.app=null;
 const store=new TaskStore(path.join(f.dir,'tasks.sqlite')),item=store.get(f.first.id);store.close();assert.equal(item.title,'中文输入法最终标题');assert.equal(item.details.trim(),markdown);
});

test('clean stale editor cannot overwrite a newer update from another window',{timeout:30000},async t=>{
 const f=fixture(t,{details:'* 列表\r\n* 条目'});f.app=await launch(f.dir);const main=f.app.main;await select(main,f.first.id);
 await invoke(main,'app:open-editor',{id:f.first.id});const editor=await CDP.connect((await f.app.target(url=>url.includes('view=editor')&&url.includes(f.first.id))).webSocketDebuggerUrl);f.clients.push(editor);await until(()=>editor.evaluate('Boolean(document.querySelector("#details-frame")?.contentDocument?.querySelector("#editor"))'));await delay(300);
 await invoke(main,'tasks:update',{id:f.first.id,details:'其他窗口保存的新详情'});await delay(2800);
 const item=(await invoke(main,'tasks:list')).tasks.find(x=>x.id===f.first.id);assert.equal(item.details,'其他窗口保存的新详情');
 await cleanExit(f.app);f.app=null;
});
