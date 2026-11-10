'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'..','..','.qa-temp');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(read,label){const end=Date.now()+10000;let last;while(Date.now()<end){try{const v=await read();if(v)return v;}catch(e){last=e;}await delay(50);}throw Error(label+': '+last?.message);}
async function launch(dir,updateCase='available'){
 const env={...process.env,TOCCATA_DATA_DIR:dir,TOCCATA_DISABLE_CAPTURE:'1',TOCCATA_UPDATE_FIXTURE:path.join(dir,'package.zip'),TOCCATA_UPDATE_CASE:updateCase,TEMP:dir,TMP:dir};delete env.ELECTRON_RUN_AS_NODE;
 const proc=spawn(path.join(project,'node_modules/electron/dist/electron.exe'),['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',path.join(__dirname,'update-harness.cjs')],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
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

test('update UI checks Windows channel, cancels, rejects corruption and prepares verified retry',{timeout:30000},async t=>{
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'update-ui-'));let x;
 t.after(async()=>{if(x&&x.proc.exitCode===null){x.proc.kill();await x.done}if(x)x.ws.close();fs.rmSync(dir,{recursive:true,force:true})});
 const pe=Buffer.alloc(128);pe.writeUInt16LE(0x5a4d);pe.writeUInt32LE(64,60);pe.writeUInt32LE(0x4550,64);pe.writeUInt16LE(0x8664,68);
 const entries=path.join(dir,'entries.json');fs.writeFileSync(entries,JSON.stringify({'Preview/Toccata/Toccata.exe':pe.toString('base64'),'Preview/Toccata/resources/app.asar':Buffer.from('fake fixture asar').toString('base64')}));
 require('node:child_process').execFileSync('python',['-c',"import sys,json,zipfile,base64;x=json.load(open(sys.argv[1],encoding='utf8'));z=zipfile.ZipFile(sys.argv[2],'w');[(z.writestr(k,base64.b64decode(v))) for k,v in x.items()];z.close()",entries,path.join(dir,'package.zip')],{windowsHide:true});
 x=await launch(dir);
 const click=selector=>x.evalJS(`document.querySelector(${JSON.stringify(selector)}).click();true`);
 const startup=await until(async()=>{const s=await x.invoke('app:update-status');return s.checkStatus==='update-available'&&s;},'silent startup check');
 await until(()=>x.evalJS('Boolean(document.querySelector("#about .update-beacon"))'),'startup update beacon');
 assert.equal(startup.phase,'idle');assert.equal(startup.canInstall,false);assert.equal(fs.existsSync(path.join(dir,'updates')),false,'startup check does not download');
 await click('#about');await until(()=>x.evalJS(`document.querySelector('#update-result')?.textContent.includes(${JSON.stringify(startup.availableVersion)})`),'about shared startup result');
 await click('[data-action=check-update]');
 await until(()=>x.evalJS('Boolean(document.querySelector("[data-action=download-update]"))'),'verified ZIP offered');
 await click('[data-action=download-update]');await until(async()=>(await x.invoke('app:update-status')).phase==='downloading','downloading');
 await click('[data-action=cancel-update]');await until(async()=>(await x.invoke('app:update-status')).phase==='cancelled','cancelled');
 await x.evalJS("console.log('QA_UPDATE_MODE corrupt');true");await delay(30);await click('[data-action=download-update]');
 await until(async()=>(await x.invoke('app:update-status')).phase==='error','corrupt rejected');assert.match((await x.invoke('app:update-status')).error,/SHA256/);
 await x.evalJS("console.log('QA_UPDATE_MODE good');true");await delay(30);await click('[data-action=download-update]');
 await until(async()=>(await x.invoke('app:update-status')).phase==='ready','verified package prepared');
 assert.equal(await x.evalJS('document.querySelector("[data-action=install-update]").disabled'),true,'development runner must not install over itself');
 await assert.rejects(x.invoke('app:update-install'),/已打包/);
 await quit(x);x=null;
});

for(const [updateCase,expected] of [['offline','error'],['incompatible','no-windows-asset']])test(`startup ${updateCase} leaves app usable and never shows update beacon`,{timeout:25000},async t=>{
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'update-silent-'));fs.writeFileSync(path.join(dir,'package.zip'),'isolated synthetic fixture');let x;
 t.after(async()=>{if(x&&x.proc.exitCode===null){x.proc.kill();await x.done}if(x)x.ws.close();fs.rmSync(dir,{recursive:true,force:true})});
 x=await launch(dir,updateCase);await until(async()=>(await x.invoke('app:update-status')).checkStatus===expected,`startup ${updateCase}`);
 assert.equal(await x.evalJS('Boolean(document.querySelector("#about .update-beacon"))'),false);
 await x.evalJS('document.querySelector("#about").click();true');await until(()=>x.evalJS('Boolean(document.querySelector("#update-result .update-status"))'),'about visible');
 assert.equal(await x.evalJS('Boolean(document.querySelector("[data-action=download-update]"))'),false);
 assert.equal((await x.invoke('app:update-status')).phase,'idle');await quit(x);x=null;
});
