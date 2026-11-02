'use strict';
// Native notification/login/tray services are replaced only for this isolated UI test.
const path=require('node:path'),{EventEmitter}=require('node:events'),Module=require('node:module');
const electron=require('electron');
process.on('uncaughtException',error=>{console.error(error.stack);electron.app.exit(1);});
process.on('unhandledRejection',error=>{console.error(error?.stack||error);electron.app.exit(1);});
if(process.env.TOCCATA_DISABLE_CAPTURE!=='1'||!path.resolve(process.env.TOCCATA_DATA_DIR||'').includes(`${path.sep}.qa-temp${path.sep}`))throw Error('Features test requires isolated profile and disabled capture');
require('node:child_process').spawn=()=>{throw Error('Features test refuses real capture/installer helpers');};
let tray,notifications=0,loginEnabled=false;
class FakeTray extends EventEmitter{constructor(){super();tray=this;}setToolTip(){}setContextMenu(menu){this.menu=menu;}getBounds(){return{x:500,y:700,width:20,height:20};}destroy(){}}
class FakeNotification extends EventEmitter{static isSupported(){return true;}show(){notifications++;setImmediate(()=>this.emit('show'));}close(){this.emit('close');}}
// Treat only the login guard as packaged, while mocking all OS login access.
const mockApp=new Proxy(electron.app,{get(target,key){if(key==='isPackaged')return true;if(key==='getVersion')return()=>require('../package.json').version;if(key==='getLoginItemSettings')return()=>({openAtLogin:loginEnabled});if(key==='setLoginItemSettings')return value=>{loginEnabled=!!value.openAtLogin;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
const services=Object.create(electron);
Object.defineProperties(services,{Tray:{value:FakeTray},Notification:{value:FakeNotification},app:{value:mockApp}});
const load=Module._load;
Module._load=function(request,parent,...rest){if(request==='electron'&&parent?.filename===path.resolve(__dirname,'../main.js'))return services;return load.call(this,request,parent,...rest);};
electron.app.on('browser-window-created',(_event,created)=>{
  const skip=created.setSkipTaskbar.bind(created);created.setSkipTaskbar=value=>{created.__skipTaskbar=value;return skip(value);};
  created.webContents.on('console-message',async(event,_level,message)=>{
    const line=typeof message==='string'?message:event.message;
    if(typeof line!=='string'||!line.startsWith('QA_FEATURES '))return;
    let request;
    try{request=JSON.parse(line.slice('QA_FEATURES '.length));let result;
      if(request.op==='tray-click'){tray.emit('click');result=true;}
      else if(request.op==='show-tray'){const panel=electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=tray'));panel.show();panel.focus();result=true;}
      else if(request.op==='state'){const windows=electron.BrowserWindow.getAllWindows(),main=windows.find(w=>!w.webContents.getURL().includes('?')),panel=windows.find(w=>w.webContents.getURL().includes('view=tray'));result={notifications,loginEnabled,skipTaskbar:main.__skipTaskbar===true,trayVisible:panel.isVisible(),trayBounds:panel.getBounds()};}
      else throw Error('Unknown features test operation');
      if(!created.isDestroyed())await created.webContents.executeJavaScript(`window.__featuresReply=${JSON.stringify({id:request.id,result})}`);
    }catch(error){if(request&&!created.isDestroyed())await created.webContents.executeJavaScript(`window.__featuresReply=${JSON.stringify({id:request.id,error:error.message})}`);}
  });
});
require('../main.js');
