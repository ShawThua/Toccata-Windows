'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const {checkForUpdates}=require('./updates');
const MAX_DOWNLOAD=1024*1024*1024;
function powershell(){return path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');}
function scriptCommand(){return Buffer.from(fs.readFileSync(path.join(__dirname,'install-update.ps1'),'utf8'),'utf16le').toString('base64');}
function runPreparation(request){return new Promise((resolve,reject)=>{
 const child=spawn(powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',scriptCommand()],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='';const timer=setTimeout(()=>{child.kill();reject(Error('Package preparation timed out'));},120000);
 child.on('error',e=>{clearTimeout(timer);reject(e)});child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
 child.stdout.on('data',bytes=>{output+=bytes;if(output.length>8192)child.kill()});
 child.on('close',code=>{clearTimeout(timer);try{const result=JSON.parse(output.trim());if(code!==0||!result.prepared)throw Error('Invalid Windows x64 package');resolve(result.prepared)}catch{reject(Error('Invalid Windows x64 package'))}});
 child.stdin.end(JSON.stringify(request));
});}
async function trustedFetch(url,{fetchImpl=fetch,signal}={}){
 for(let i=0;i<6;i++){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))throw Error('Untrusted update download');
  const response=await fetchImpl(url,{redirect:'manual',signal,headers:{'User-Agent':'Toccata-Windows-Updater'}});
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location)throw Error('Invalid download redirect');url=new URL(location,url).href;continue}
  if(!response.ok)throw Error('Download failed');return response;
 }
 throw Error('Too many download redirects');
}
function checksumFor(text,name){
 if(typeof text!=='string'||text.length>65536)throw Error('Invalid checksum file');
 for(const line of text.split(/\r?\n/)){const match=/^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());if(match&&match[2]===name)return match[1].toLowerCase()}
 if(/^[a-f0-9]{64}\s*$/i.test(text))return text.trim().toLowerCase();
 throw Error('Package checksum is missing');
}
class UpdateManager{
 constructor({dataDir,currentVersion,fetchImpl=globalThis.fetch,prepare=runPreparation,onProgress=()=>{}}){
  this.root=path.join(dataDir,'updates');this.version=currentVersion;this.fetch=fetchImpl;this.prepare=prepare;this.onProgress=onProgress;this.state={phase:'idle',received:0,total:0,percent:0,checkStatus:'idle',availableVersion:null,release_url:null,canDownload:false,checkReason:null,revision:0};this.release=null;this.controller=null;this.prepared=null;this.checkFlight=null;
 }
 status(){return {...this.state,canInstall:!!this.prepared};}
 publish(patch){Object.assign(this.state,patch);this.state.revision++;this.onProgress(this.status());return this.status();}
 check(){
  // Share one request between the silent startup check and any manual check.
  // Checking never changes the download/install phase or starts a download.
  if(this.checkFlight)return this.checkFlight;
  this.publish({checkStatus:'checking',checkReason:null});
  this.checkFlight=(async()=>{
   let result;
   try{result=await checkForUpdates({currentVersion:this.version,fetchImpl:this.fetch});}
   catch{result={status:'error',reason:'network-error'};}
   this.release=result;
   this.publish({checkStatus:result.status,availableVersion:result.version||null,release_url:result.release_url||null,canDownload:result.status==='update-available'&&!!result.can_download,checkReason:result.reason||null});
   return result;
  })().finally(()=>{this.checkFlight=null;});
  return this.checkFlight;
 }
 cancel(){this.controller?.abort();return this.status();}
 async download(){
  if(this.controller)throw Error('An update download is already active');
  if(this.release?.status!=='update-available'||!this.release.can_download)throw Error('No verified Windows ZIP update is available');
  const asset=this.release.assets.find(a=>a.name.toLowerCase().endsWith('.zip'));if(!asset||asset.size>MAX_DOWNLOAD)throw Error('Invalid update package size');
  const controller=new AbortController();this.controller=controller;this.prepared=null;
  this.publish({phase:'downloading',received:0,total:asset.size||0,percent:0,version:this.release.version,error:null});
  let fd,job,file;
  try{
   fs.mkdirSync(this.root,{recursive:true});job=fs.mkdtempSync(path.join(this.root,'package-'));file=path.join(job,'package.zip');
   let expected=asset.digest?.slice(7);
   if(!expected){const response=await trustedFetch(this.release.checksum.url,{fetchImpl:this.fetch,signal:controller.signal});const bytes=[];let size=0;for await(const part of response.body){size+=part.length;if(size>65536)throw Error('Checksum file is too large');bytes.push(Buffer.from(part))}expected=checksumFor(Buffer.concat(bytes).toString('utf8'),asset.name);}
   const response=await trustedFetch(asset.url,{fetchImpl:this.fetch,signal:controller.signal});const declared=Number(response.headers.get('content-length'));
   const total=asset.size||declared||0;if(total>MAX_DOWNLOAD)throw Error('Update package is too large');
   fd=fs.openSync(file,'wx');const hash=createHash('sha256');let received=0,lastProgress=0;
   for await(const chunk of response.body){if(controller.signal.aborted)throw Error('Cancelled');received+=chunk.length;if(received>MAX_DOWNLOAD)throw Error('Update package is too large');fs.writeSync(fd,chunk);hash.update(chunk);if(Date.now()-lastProgress>100){lastProgress=Date.now();this.publish({received,total,percent:total?Math.min(99,Math.floor(received/total*100)):0})}}
   fs.closeSync(fd);fd=undefined;
   if(controller.signal.aborted)throw Error('Cancelled');
   this.publish({phase:'verifying',received,total,percent:100});
   if(asset.size&&received!==asset.size)throw Error('Incomplete update package');
   if(hash.digest('hex')!==expected)throw Error('SHA256 verification failed');
   const destination=path.join(job,'program');const prepared=await this.prepare({mode:'prepare',archive:file,destination});
   if(controller.signal.aborted)throw Error('Cancelled');
   if(path.resolve(prepared)!==path.resolve(destination))throw Error('Invalid prepared directory');
   this.prepared=prepared;return this.publish({phase:'ready',error:null});
  }catch(error){this.publish({phase:controller.signal.aborted?'cancelled':'error',error:controller.signal.aborted?null:error.message});return this.status();}
  finally{if(fd!==undefined)fs.closeSync(fd);this.controller=null;if(!this.prepared&&job){const resolved=path.resolve(job);if(path.dirname(resolved).toLowerCase()===path.resolve(this.root).toLowerCase())await fs.promises.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:50});}}
 }
 stageInstall({target,pid}){
  if(!this.prepared||this.state.phase!=='ready')throw Error('No verified package is ready');
  const program=path.resolve(target);if(path.basename(program).toLowerCase()==='toccata-data'||!fs.existsSync(path.join(program,'Toccata.exe')))throw Error('Invalid installed application');
  const script=path.join(this.root,'install-'+randomUUID()+'.ps1');fs.writeFileSync(script,fs.readFileSync(path.join(__dirname,'install-update.ps1')));
  const request={mode:'install',target:program,source:this.prepared,pid,result:path.join(this.root,'last-install.json')};
  const child=spawn(powershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{detached:true,windowsHide:true,stdio:['pipe','ignore','ignore']});
  child.requestWritten=new Promise((resolve,reject)=>{child.once('error',reject);child.stdin.once('error',reject);child.stdin.end(JSON.stringify(request),resolve)});child.unref();this.publish({phase:'installing'});return child;
 }
}
module.exports={UpdateManager,checksumFor,trustedFetch,runPreparation};
