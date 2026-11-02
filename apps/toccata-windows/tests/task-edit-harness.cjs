'use strict';
// Isolated regression harness only: production code has no QA message handlers.
const path=require('node:path');
const electron=require('electron');
const child=require('node:child_process');
if(process.env.TOCCATA_DISABLE_CAPTURE!=='1'||!path.resolve(process.env.TOCCATA_DATA_DIR||'').includes(`${path.sep}.qa-temp${path.sep}`))throw Error('Isolated profile and disabled capture required');
child.spawn=()=>{throw Error('Edit regression refuses to spawn a capture helper');};
let writes=0,dataEvents=0,noise;
const originalHandle=electron.ipcMain.handle.bind(electron.ipcMain);
electron.ipcMain.handle=(channel,listener)=>originalHandle(channel,async(event,...args)=>{if(channel==='tasks:update')writes++;return listener(event,...args);});
function publish(){for(const window of electron.BrowserWindow.getAllWindows())if(!window.isDestroyed()){window.webContents.send('changed',{kind:'data'});window.webContents.send('changed',{kind:'keyboard'});}dataEvents++;}
electron.app.on('before-quit',()=>clearInterval(noise));
electron.app.on('browser-window-created',(_event,created)=>created.webContents.on('console-message',async(event,_level,message)=>{
 const line=typeof message==='string'?message:event.message;
 if(typeof line!=='string'||!line.startsWith('QA_EDIT_COMMAND '))return;
 let request;
 try{
  request=JSON.parse(line.slice('QA_EDIT_COMMAND '.length));let result;
  switch(request.op){
   case 'counts':result={writes,dataEvents};break;
   case 'reset':writes=0;dataEvents=0;result=true;break;
   case 'pulse':publish();result=true;break;
   case 'start-noise':clearInterval(noise);publish();noise=setInterval(publish,900);result=true;break;
   case 'stop-noise':clearInterval(noise);noise=null;result=true;break;
   default:throw Error('Unknown edit test operation');
  }
  await created.webContents.executeJavaScript(`window.__editReply=${JSON.stringify({id:request.id,result})}`);
 }catch(error){if(request&&!created.isDestroyed())await created.webContents.executeJavaScript(`window.__editReply=${JSON.stringify({id:request.id,error:error.message})}`);}
}));
require(path.join(process.env.TOCCATA_EDIT_TEST_APP||path.resolve(__dirname,'..'),'main.js'));
