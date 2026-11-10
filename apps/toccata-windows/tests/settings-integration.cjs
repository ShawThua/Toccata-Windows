'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'..','..','.qa-temp');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(read,label){const end=Date.now()+10000;let last;while(Date.now()<end){try{const v=await read();if(v)return v;}catch(e){last=e;}await delay(50);}throw Error(label+': '+last?.message);}
async function launch(dir){
 const env={...process.env,TOCCATA_DATA_DIR:dir,TOCCATA_DISABLE_CAPTURE:'1',TEMP:dir,TMP:dir};delete env.ELECTRON_RUN_AS_NODE;
 const proc=spawn(path.join(project,'node_modules/electron/dist/electron.exe'),['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',path.join(__dirname,'settings-harness.cjs')],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>output+=x);const done=new Promise(resolve=>proc.once('close',code=>resolve(code)));
 try{
  const port=await until(()=>{const m=output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(m)return +m[1];if(proc.exitCode!==null)throw Error(output.slice(-2000));},'startup');
  const page=await until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();return pages.find(p=>p.type==='page'&&p.url.includes('/renderer/index.html')&&!p.url.includes('?'));},'main');
  const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let serial=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const evalJS=async expression=>{const id=++serial;const r=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const invoke=(channel,value={})=>evalJS(`window.toccata.invoke(${JSON.stringify(channel)},${JSON.stringify(value)})`);
  await until(()=>evalJS('Boolean(document.querySelector("#main h1")&&window.toccata?.invoke)'),'ready');let controlSerial=0;
  const control=async op=>{const id=++controlSerial;await evalJS(`console.log('QA_SETTINGS '+JSON.stringify(${JSON.stringify({id,op})}));true`);const reply=await until(()=>evalJS(`window.__settingsReply?.id===${id}?window.__settingsReply:null`),'control');if(reply.error)throw Error(reply.error);return reply.result;};
  return{proc,done,invoke,control,evalJS,ws,output:()=>output};
 }catch(e){proc.kill();await done;throw Error(e.message+'\n'+output.slice(-2500));}
}
async function quit(x){await x.evalJS(`window.toccata.invoke('app:quit').catch(()=>{});true`);const result=await Promise.race([x.done,delay(10000).then(()=>null)]);assert.equal(result,0,x.output().slice(-2000));x.ws.close();}
test('general settings persist, taskbar remains recoverable, tray routes defaults and notifications are explicit',{timeout:40000},async t=>{
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'general-settings-'));let x;
 t.after(async()=>{if(x&&x.proc.exitCode===null)x.proc.kill();if(x)x.ws.close();});
 x=await launch(dir);const defaults=await x.invoke('settings:get');assert.equal(defaults.hydrationEnabled,false);assert.equal(defaults.hideTaskbar,false);assert.equal(defaults.trayDefaultPage,'tasks');assert.equal(defaults.upstreamVersion,'0.1.5');
 await assert.rejects(x.invoke('settings:set',{key:'theme',value:'arbitrary'}));assert.equal((await x.invoke('settings:get')).theme,'system');
 await x.invoke('settings:set',{key:'hideTaskbar',value:true});assert.equal((await x.control('state')).skipTaskbar,true);
 await x.invoke('settings:set',{key:'hideTaskbar',value:false});assert.equal((await x.control('state')).skipTaskbar,false);
 await x.invoke('settings:set',{key:'trayDefaultPage',value:'activity'});await x.control('tray-click');const state=await x.control('state');assert.ok(state.allEvents.some(e=>e.channel==='tray-open'&&e.value.page==='activity'));
 await assert.rejects(x.invoke('app:open-main',{page:'unexpected'}));await x.invoke('app:open-main',{page:'calendar'});assert.ok((await x.control('state')).events.some(e=>e.channel==='navigate'&&e.value.page==='calendar'));
 assert.equal((await x.control('state')).notifications,0);await assert.rejects(x.invoke('app:test-notification'));assert.equal((await x.control('state')).notifications,0);
 await x.invoke('settings:set',{key:'hydrationEnabled',value:true});await x.invoke('settings:set',{key:'hydrationInterval',value:4096});const status=await x.invoke('app:hydration-status');assert.equal(status.enabled,true);assert.equal(status.interval,4096);assert.equal(status.count,0);assert.equal(status.nextAt,4096);assert.equal((await x.control('state')).notifications,0);
 await x.invoke('app:test-notification');assert.equal((await x.control('state')).notifications,1);
 await quit(x);x=null;x=await launch(dir);const saved=await x.invoke('settings:get');assert.equal(saved.hydrationEnabled,true);assert.equal(saved.hydrationInterval,4096);assert.equal(saved.trayDefaultPage,'activity');assert.equal(saved.hideTaskbar,false);assert.equal((await x.control('state')).notifications,0);
 await quit(x);x=null;
});
