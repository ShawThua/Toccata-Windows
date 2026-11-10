'use strict';

// Real Electron UI with synthetic records only; global capture stays disabled.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {deflateSync}=require('node:zlib');
const {AppIdentities}=require('../data/app-identities');
const {KeyStore}=require('../data/keyboard');

const project=path.resolve(__dirname,'..');
const executable=path.join(project,'node_modules','electron','dist','electron.exe');
const tempRoot=process.env.TEMP||os.tmpdir();
const outputDir=process.env.TOCCATA_ICON_UI_OUTPUT;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function timeout(promise,ms){let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms)})])}finally{clearTimeout(timer)}}
async function until(fn,ms,label){const end=Date.now()+ms;let last;while(Date.now()<end){try{const result=await fn();if(result)return result}catch(error){last=error}await delay(75)}throw new Error(`${label} timed out${last?`: ${last.message}`:''}`)}

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function chunk(name,data){const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc])}
function transparentIcon(){
  const size=64,raw=Buffer.alloc(size*(1+size*4)),header=Buffer.alloc(13);
  header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const offset=y*(1+size*4)+1+x*4,distance=Math.hypot(x-31.5,y-31.5);
    raw[offset]=20;raw[offset+1]=160;raw[offset+2]=220;raw[offset+3]=distance>15&&distance<27?255:0;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
class CDP{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',e=>{const message=JSON.parse(e.data),pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result)});ws.addEventListener('close',()=>{for(const pending of this.pending.values())pending.reject(new Error('CDP closed'));this.pending.clear()})}
  static async connect(url){const ws=new WebSocket(url);const opened=await timeout(new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(new Error('CDP failed')),{once:true})}),5000);if(!opened)throw new Error('CDP timeout');return new CDP(ws)}
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}))})}
  async evaluate(expression){const result=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
  close(){this.ws.close()}
}
async function launch(dataDir){
  const temp=path.join(dataDir,'temp');fs.mkdirSync(temp,{recursive:true});
  const env={...process.env,TOCCATA_DATA_DIR:dataDir,TOCCATA_DISABLE_CAPTURE:'1',TEMP:temp,TMP:temp};
  for(const name of ['ELECTRON_RUN_AS_NODE','TOCCATA_QA_SCREENSHOT','TOCCATA_QA_MEMORY','TOCCATA_QA_HELPER_EXE','TOCCATA_QA_HELPER_SCRIPT'])delete env[name];
  const proc=spawn(executable,['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',project],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',exited=false,spawnError;proc.stdout.on('data',bytes=>{output+=bytes});proc.stderr.on('data',bytes=>{output+=bytes});proc.on('error',error=>{spawnError=error});
  const done=new Promise(resolve=>proc.once('close',(code,signal)=>{exited=true;resolve({code,signal})}));
  try{
    const port=await until(()=>{if(spawnError)throw spawnError;const match=output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(match)return Number(match[1]);if(exited)throw new Error('Electron exited')},20000,'startup');
    const target=await until(async()=>{const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();return pages.find(page=>page.type==='page'&&page.url.includes('/renderer/index.html')&&!page.url.includes('?')&&page.webSocketDebuggerUrl)},10000,'main page');
    const cdp=await CDP.connect(target.webSocketDebuggerUrl);
    await until(()=>cdp.evaluate('Boolean(window.toccata?.invoke && document.querySelector("#workspace-divider"))'),10000,'workspace');
    return{proc,done,cdp,getOutput:()=>output};
  }catch(error){if(!exited)proc.kill();await timeout(done,3000);throw error}
}
async function invoke(cdp,name,payload={}){return cdp.evaluate(`window.toccata.invoke(${JSON.stringify(name)},${JSON.stringify(payload)})`)}
async function closeApp(instance){try{await instance.cdp.evaluate("(()=>{window.toccata.invoke('app:quit').catch(()=>{});return true})()")}catch{}const result=await timeout(instance.done,10000);assert.ok(result,'Electron failed to quit');assert.equal(result.code,0,instance.getOutput().slice(-2000));instance.cdp.close()}

test('transparent, missing and undecodable app icons render correctly in both themes at 200% DPI',{timeout:50000},async t=>{
  assert.ok(fs.existsSync(executable));fs.mkdirSync(tempRoot,{recursive:true});
  const dir=fs.mkdtempSync(path.join(tempRoot,'toccata-icon-ui-'));
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(tempRoot));assert.ok(path.basename(dir).startsWith('toccata-icon-ui-'));
  let instance;t.after(async()=>{if(instance&&instance.proc.exitCode===null){instance.proc.kill();await timeout(instance.done,3000)}if(instance)try{instance.cdp.close()}catch{}fs.rmSync(dir,{recursive:true,force:true})});
  const png=transparentIcon(),identities=new AppIdentities(dir),keys=new KeyStore(path.join(dir,'toccata-windows.sqlite'));
  const names=['Transparent QA.exe','Missing QA.exe','Broken QA.exe'];
  for(let index=0;index<names.length;index++){
    const app=identities.identify(`G:\\SyntheticQA\\${names[index]}`,names[index]);
    if(index===0)identities.setIcon(app.id,png);
    if(index===2)identities.setIcon(app.id,png.subarray(0,33)); // Valid header, missing image data.
    const ts=Date.now()-10000+index*500;
    for(const [kind,time,hold_ms]of[['down',ts,null],['up',ts+100,100]])keys.add({type:'key',event_id:`icon-qa:${index}:${kind}`,ts_ms:time,kind,hold_ms,app:app.id,scan:30,ext:0,vkey:65});
  }
  keys.close();identities.close();
  instance=await launch(dir);assert.equal((await invoke(instance.cdp,'capture:status')).state,'disabled');
  await instance.cdp.send('Emulation.setDeviceMetricsOverride',{width:1200,height:820,deviceScaleFactor:2,mobile:false});
  assert.ok(Math.abs(await instance.cdp.evaluate('window.devicePixelRatio')-2)<0.001);
  await instance.cdp.evaluate("document.querySelector('[data-page=ranking]').click();true");
  const rowsExpression=`(()=>{const rows=[...document.querySelectorAll('.app-row')];return rows.map(row=>{const box=row.querySelector('.app-icon'),image=box?.querySelector('.app-image'),fallback=box?.querySelector('.app-icon-fallback');if(!box||!fallback)return null;const fallbackStyle=getComputedStyle(fallback);return {name:row.querySelector('.app-info').innerText.split('\\n')[0],loaded:box.classList.contains('icon-loaded'),image:!!image,naturalWidth:image?.naturalWidth||0,fallbackVisible:fallbackStyle.display!=='none'&&fallbackStyle.visibility!=='hidden'&&fallbackStyle.opacity!=='0',imageWidth:image?.getBoundingClientRect().width||0}})})()`;
  for(const theme of ['light','dark']){
    await invoke(instance.cdp,'settings:set',{key:'theme',value:theme});
    await until(()=>instance.cdp.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),5000,`${theme} theme`);
    const rows=await until(async()=>{const rows=await instance.cdp.evaluate(rowsExpression);return rows.length===3&&rows.every(Boolean)&&rows.find(row=>row.name===names[0])?.loaded&&rows.find(row=>row.name===names[2])?.image===false?rows:null},10000,`${theme} icon load/error handling`);
    const good=rows.find(row=>row.name===names[0]);assert.equal(good.naturalWidth,64);assert.equal(good.fallbackVisible,false);assert.ok(good.imageWidth>0&&good.imageWidth<=32);
    for(const name of names.slice(1)){const row=rows.find(row=>row.name===name);assert.equal(row.image,false);assert.equal(row.loaded,false);assert.equal(row.fallbackVisible,true)}
    // The transparent center is intentional: no duplicate fallback SVG may show through it.
    const transparency=await instance.cdp.evaluate(`(()=>{const image=[...document.querySelectorAll('.app-row')].find(row=>row.innerText.includes(${JSON.stringify(names[0])})).querySelector('.app-image');const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');context.drawImage(image,0,0);return {centerAlpha:context.getImageData(32,32,1,1).data[3],ringAlpha:context.getImageData(32,10,1,1).data[3]}})()`);
    assert.equal(transparency.centerAlpha,0);assert.equal(transparency.ringAlpha,255);
    if(outputDir){fs.mkdirSync(outputDir,{recursive:true});const screenshot=await instance.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});fs.writeFileSync(path.join(outputDir,`app-icons-${theme}-200.png`),Buffer.from(screenshot.data,'base64'))}
    t.diagnostic(`${theme}: transparent 64px icon at ${good.imageWidth}px CSS; missing/broken images show fallback; devicePixelRatio=2`);
  }
  await closeApp(instance);instance=null;
});
