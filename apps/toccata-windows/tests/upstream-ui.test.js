'use strict';
// Isolated UI fixture: no task data, capture helper, or production profile.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..'),tempRoot=path.resolve(project,'../..','.qa-temp');
const electron=path.join(project,'node_modules/electron/dist/electron.exe');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,ms=10000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch(error){last=error;}await delay(30);}throw Error('UI condition timed out'+(last?': '+last.message:''));}
class CDP{
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',event=>{const r=JSON.parse(event.data),p=this.pending.get(r.id);if(!p)return;this.pending.delete(r.id);if(r.error)p.reject(Error(r.error.message));else p.resolve(r.result);});}
 static async connect(url){const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('CDP failed')),{once:true});});return new CDP(ws);}
 send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async eval(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
 close(){this.ws.close();}
}
test('segmented controls preserve keyboard focus, themed geometry and reduced motion at 200% DPI',{timeout:30000},async t=>{
 fs.mkdirSync(tempRoot,{recursive:true});const dir=fs.mkdtempSync(path.join(tempRoot,'upstream-ui-'));
 const script=path.join(dir,'main.cjs'),html=path.join(dir,'index.html');
 const asset=name=>pathToFileURL(path.join(project,'renderer',name)).href;
 fs.writeFileSync(script,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1100,height:780,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});w.loadFile(${JSON.stringify(html)});});app.on('window-all-closed',()=>app.quit());`);
 fs.writeFileSync(html,`<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="${asset('styles.css')}"><link rel="stylesheet" href="${asset('upstream-ui.css')}"><style>body{padding:36px}#content{padding:24px;margin-top:20px;background:var(--section);border:1px solid var(--line);border-radius:16px}#draft{padding:12px;border:1px solid var(--line);width:320px}canvas{max-width:720px;display:block}</style></head><body><h1>任务回顾</h1><p class="subtitle">按所选时段查看任务，保留键盘导航与系统动画偏好。</p><div id="controls"></div><div id="content"><input id="draft" placeholder="未提交草稿"></div><script src="${asset('upstream-ui.js')}"></script><script src="${asset('share-card.js')}"></script><script>let value='week';function render(){document.querySelector('#controls').innerHTML='<div class="segments task-segments" data-segment-id="review">'+[['week','本周'],['seven','最近7天'],['custom','自定义时段']].map(([v,label])=>'<button data-action="review-range" data-value="'+v+'" class="'+(value===v?'active':'')+'">'+label+'</button>').join('')+'</div>'}render();document.addEventListener('click',event=>{const e=event.target.closest('[data-action="review-range"]');if(e){value=e.dataset.value;render()}});</script></body></html>`);
 const env={...process.env,TEMP:dir,TMP:dir};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electron,['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',script],{cwd:project,env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const done=new Promise(resolve=>child.once('close',resolve));let client;
 t.after(async()=>{client?.close();if(child.exitCode===null)child.kill();await Promise.race([done,delay(3000)]);assert.equal(path.dirname(dir),tempRoot);fs.rmSync(dir,{recursive:true,force:true});});
 const port=await until(()=>{if(child.exitCode!==null)throw Error(output);return output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];});
 const target=await until(async()=>{const pages=await(await fetch('http://127.0.0.1:'+port+'/json')).json();return pages.find(p=>p.type==='page'&&p.url===pathToFileURL(html).href);});client=await CDP.connect(target.webSocketDebuggerUrl);
 await until(()=>client.eval('Boolean(document.querySelector(".upstream-segments .segment-indicator"))'));
 await client.send('Emulation.setDeviceMetricsOverride',{width:1000,height:720,deviceScaleFactor:2,mobile:false});
 await client.eval(`window.ToccataUpstreamUI.init();window.ToccataUpstreamUI.init();document.querySelector('[data-value="week"]').focus();true`);
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
 await until(()=>client.eval(`document.querySelector('[data-value="seven"]').getAttribute('aria-checked')==='true'&&document.activeElement.dataset.value==='seven'`));
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
 await until(()=>client.eval(`document.activeElement.dataset.value==='custom'&&document.querySelector('[data-value="custom"]').tabIndex===0`));
 assert.equal(await client.eval('document.querySelector(".segments").getAttribute("role")'),'radiogroup');
 assert.equal(await client.eval(`Array.from(document.querySelectorAll('.segments button')).filter(button=>button.tabIndex===0).length`),1);
 // Child layout can change without a window resize (font arrival, localized
 // text, or a flex sibling changing size); the rail must remeasure itself.
 await client.eval(`document.querySelector('[data-value="week"]').style.paddingInline='31px';document.querySelector('[data-value="custom"]').style.paddingInline='24px';true`);
 await until(()=>client.eval(`(()=>{const a=document.querySelector('.segments .active').getBoundingClientRect(),b=document.querySelector('.segment-indicator').getBoundingClientRect();return Math.abs(a.x-b.x)<1&&Math.abs(a.width-b.width)<1})()`),5000);
 for(const theme of ['light','dark']){
  await client.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.ToccataUpstreamUI.init();true`);await delay(230);
  const rects=await client.eval(`(()=>{const a=document.querySelector('.segments .active').getBoundingClientRect(),b=document.querySelector('.segment-indicator').getBoundingClientRect();return {a:a.x,b:b.x,aw:a.width,bw:b.width,dpr:devicePixelRatio,visible:document.visibilityState,style:document.querySelector(".segment-indicator").style.cssText,animations:document.querySelector(".segment-indicator").getAnimations().map(x=>({play:x.playState,time:x.currentTime}))}})()`);
  assert.ok(Math.abs(rects.a-rects.b)<1,JSON.stringify(rects));assert.ok(Math.abs(rects.aw-rects.bw)<1);assert.ok(Math.abs(rects.dpr-2)<0.001);
  if(process.env.TOCCATA_UPSTREAM_UI_OUTPUT){const out=path.resolve(process.env.TOCCATA_UPSTREAM_UI_OUTPUT);fs.mkdirSync(out,{recursive:true});const screenshot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,`segments-${theme}-200.png`),Buffer.from(screenshot.data,'base64'));}
 }
 assert.equal(await client.eval(`!!window.ToccataUpstreamUI.transitionContent(document.querySelector('#content'))`),true);
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 assert.equal(await client.eval(`window.ToccataUpstreamUI.transitionContent(document.querySelector('#content'))`),null);
 await client.eval(`window.__draft=document.querySelector('#draft');window.__draft.value='持续输入的草稿';window.__draft.focus();window.ToccataUpstreamUI.init();true`);await delay(230);
 assert.deepEqual(await client.eval(`({same:window.__draft===document.querySelector('#draft'),value:document.querySelector('#draft').value,focus:document.activeElement.id})`),{same:true,value:'持续输入的草稿',focus:'draft'});
 if(process.env.TOCCATA_UPSTREAM_UI_OUTPUT){
  const layouts=require('../data/keyboard-layouts'),layout=layouts.toRendererLayout(layouts.getPreset('windows-100-104'));
  const stats={key_count:485,active_ms:60000,keys:{0:54,1:9,49:300,55:122},days:[],apps:[],fn_ms:null};
  const png=await client.eval(`window.ToccataShareCard.render(${JSON.stringify({stats,layout,language:'zh',rangeLabel:'2026/11/02 · 合成数据'})}).toDataURL('image/png')`);
  fs.writeFileSync(path.join(path.resolve(process.env.TOCCATA_UPSTREAM_UI_OUTPUT),'share-key-percentages.png'),Buffer.from(png.split(',')[1],'base64'));
 }
 t.diagnostic('200% DPI light/dark rail alignment verified; ArrowRight/End retained selection focus; reduced motion skipped content animation; unrelated input preserved.');
});
