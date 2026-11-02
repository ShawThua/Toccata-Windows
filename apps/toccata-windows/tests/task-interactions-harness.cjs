'use strict';
// Synthetic-only controls. The production preload does not expose these hooks.
const path=require('node:path');
const electron=require('electron');
const profile=path.resolve(process.env.TOCCATA_DATA_DIR||'');
const root=path.resolve(__dirname,'../../..','.qa-temp');
if(process.env.TOCCATA_DISABLE_CAPTURE!=='1'||!profile.startsWith(root+path.sep))throw Error('Task interaction test requires an isolated .qa-temp profile');
require('node:child_process').spawn=()=>{throw Error('Interaction test refuses capture and installer helpers');};
process.on('uncaughtException',error=>{console.error(error.stack);electron.app.exit(1);});
process.on('unhandledRejection',error=>{console.error(error?.stack||error);electron.app.exit(1);});
let writes=0,noise=null,holdControls=false,holdNextList=false;
const pendingControls=[],pendingLists=[];
const originalHandle=electron.ipcMain.handle.bind(electron.ipcMain);
electron.ipcMain.handle=(channel,listener)=>originalHandle(channel,async(event,payload,...rest)=>{
 if(channel==='tasks:list'&&holdNextList){holdNextList=false;await new Promise(resolve=>pendingLists.push(resolve));}
 if(channel==='tasks:update'){
  writes++;
  if(holdControls&&('planned_at' in (payload||{})||'priority' in (payload||{})))await new Promise(resolve=>pendingControls.push(resolve));
 }
 return listener(event,payload,...rest);
});
function publish(){for(const window of electron.BrowserWindow.getAllWindows())if(!window.isDestroyed())window.webContents.send('changed',{kind:'data'});}
function releaseControls(){holdControls=false;for(const resolve of pendingControls.splice(0))resolve();}
function releaseLists(){holdNextList=false;for(const resolve of pendingLists.splice(0))resolve();}
electron.app.on('before-quit',()=>{clearInterval(noise);releaseControls();releaseLists();});
electron.app.on('browser-window-created',(_event,created)=>created.webContents.on('console-message',async(event,_level,message)=>{
 const line=typeof message==='string'?message:event.message;
 if(typeof line!=='string'||!line.startsWith('QA_INTERACTIONS '))return;
 let request;
 try{
  request=JSON.parse(line.slice('QA_INTERACTIONS '.length));let result;
  switch(request.op){
   case 'counts':result={writes,pendingControls:pendingControls.length,pendingLists:pendingLists.length};break;
   case 'reset':writes=0;result=true;break;
   case 'start-noise':clearInterval(noise);noise=setInterval(publish,120);publish();result=true;break;
   case 'stop-noise':clearInterval(noise);noise=null;result=true;break;
   case 'pulse':publish();result=true;break;
   case 'hold-controls':holdControls=true;result=true;break;
   case 'release-controls':releaseControls();result=true;break;
   case 'hold-next-list':holdNextList=true;result=true;break;
   case 'release-lists':releaseLists();result=true;break;
   default:throw Error('Unknown interaction test command');
  }
  if(!created.isDestroyed())await created.webContents.executeJavaScript(`window.__interactionReply=${JSON.stringify({id:request.id,result})}`);
 }catch(error){if(request&&!created.isDestroyed())await created.webContents.executeJavaScript(`window.__interactionReply=${JSON.stringify({id:request.id,error:error.message})}`);}
}));
const requested=process.env.TOCCATA_INTERACTIONS_TEST_APP;
require(path.join(requested?path.resolve(requested):path.resolve(__dirname,'..'),'main.js'));
