'use strict';
const path=require('node:path');
const {EventEmitter}=require('node:events');
const electron=require('electron');
process.on('uncaughtException',error=>{console.error(error.stack);electron.app.exit(1);});
process.on('unhandledRejection',error=>{console.error(error?.stack||error);electron.app.exit(1);});
if(process.env.TOCCATA_DISABLE_CAPTURE!=='1'||!path.resolve(process.env.TOCCATA_DATA_DIR||'').includes(`${path.sep}.qa-temp${path.sep}`))throw Error('Isolated profile required');
const originalSpawn=require('node:child_process').spawn;
require('node:child_process').spawn=(...args)=>{throw Error('Settings test refuses real capture/notification helpers');};
let tray,notifications=0;
class FakeTray extends EventEmitter{
 constructor(){super();tray=this;}
 setToolTip(){}setContextMenu(menu){this.menu=menu;}getBounds(){return{x:100,y:100,width:20,height:20};}destroy(){}
}
class FakeNotification extends EventEmitter{
 static isSupported(){return true;}
 show(){notifications++;setImmediate(()=>this.emit('show'));}
 close(){this.emit('close');}
}
const Module=require('node:module'),load=Module._load,services=Object.create(electron);
Object.defineProperties(services,{Tray:{value:FakeTray},Notification:{value:FakeNotification}});
Module._load=function(request,parent,...rest){if(request==='electron'&&parent?.filename===path.resolve(__dirname,'../main.js'))return services;return load.call(this,request,parent,...rest);};
electron.app.on('browser-window-created',(_event,created)=>{
 const skipTaskbar=created.setSkipTaskbar.bind(created);created.setSkipTaskbar=value=>{created.__skipTaskbar=value;return skipTaskbar(value);};
 const send=created.webContents.send.bind(created.webContents);created.__events=[];
 created.webContents.send=(channel,value)=>{if(['tray-open','navigate'].includes(channel))created.__events.push({channel,value});return send(channel,value);};
 created.webContents.on('console-message',async(event,_level,message)=>{
  const line=typeof message==='string'?message:event.message;
  if(typeof line!=='string'||!line.startsWith('QA_SETTINGS '))return;
  const request=JSON.parse(line.slice('QA_SETTINGS '.length));let result,error;
  try{
   if(request.op==='tray-click'){tray.emit('click');result=true;}
   else if(request.op==='state'){const mainURL=require('node:url').pathToFileURL(path.resolve(__dirname,'../renderer/index.html')).href;const main=electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===mainURL);result={skipTaskbar:main.__skipTaskbar===true,events:main.__events,allEvents:electron.BrowserWindow.getAllWindows().flatMap(w=>w.__events),notifications};}
   else throw Error('Unknown settings test operation');
  }catch(e){error=e.message;}
  if(!created.isDestroyed())await created.webContents.executeJavaScript(`window.__settingsReply=${JSON.stringify({id:request.id,result,error})}`);
 });
});
require('../main.js');
