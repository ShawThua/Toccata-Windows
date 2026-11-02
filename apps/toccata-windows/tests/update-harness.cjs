'use strict';
// Local update assets only. No network, actual capture, or production install.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const electron=require('electron');
if(process.env.TOCCATA_DISABLE_CAPTURE!=='1'||!process.env.TOCCATA_UPDATE_FIXTURE)throw Error('Isolated update fixture required');
const bytes=fs.readFileSync(process.env.TOCCATA_UPDATE_FIXTURE),digest=createHash('sha256').update(bytes).digest('hex');
const tag='v0.1.3-win.2',name='Toccata-Windows-preview-0.1.3-x64.zip',base='https://github.com/WenNinghan/Toccata-Windows/releases/';let mode='slow';
globalThis.fetch=async(url,options={})=>{
 if(String(url).startsWith('https://api.github.com/repos/WenNinghan/Toccata-Windows/releases'))return new Response(JSON.stringify([{tag_name:tag,prerelease:true,html_url:base+'tag/'+tag,assets:[{name,size:bytes.length,state:'uploaded',digest:'sha256:'+digest,browser_download_url:base+'download/'+tag+'/'+name}]}]));
 if(url!==base+'download/'+tag+'/'+name)throw Error('Unexpected test request');
 if(mode==='good')return new Response(bytes);
 if(mode==='corrupt'){const changed=Buffer.from(bytes);changed[0]^=255;return new Response(changed);}
 return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,10));options.signal?.addEventListener('abort',()=>controller.error(new DOMException('Cancelled','AbortError')),{once:true})}}));
};
electron.app.on('browser-window-created',(_event,window)=>window.webContents.on('console-message',event=>{if(event.message?.startsWith('QA_UPDATE_MODE '))mode=event.message.slice('QA_UPDATE_MODE '.length);}));
require('../main.js');
