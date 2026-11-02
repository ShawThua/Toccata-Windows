'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {runPreparation}=require('../data/update-manager');
const root=path.resolve(__dirname,'../../../.qa-temp');fs.mkdirSync(root,{recursive:true});
function dir(t){const d=fs.mkdtempSync(path.join(root,'installer-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
function zip(d,entries){const input=path.join(d,'entries.json'),output=path.join(d,'package.zip');fs.writeFileSync(input,JSON.stringify(entries));cp.execFileSync('python',['-c',"import sys,json,zipfile,base64;items=json.load(open(sys.argv[1],encoding='utf8'));z=zipfile.ZipFile(sys.argv[2],'w');[(z.writestr(k,base64.b64decode(v))) for k,v in items.items()];z.close()",input,output],{windowsHide:true});return output;}
function pe(){const b=Buffer.alloc(128);b.writeUInt16LE(0x5a4d);b.writeUInt32LE(64,60);b.writeUInt32LE(0x4550,64);b.writeUInt16LE(0x8664,68);return b;}
function entries(extra={}){return {'Preview/Toccata/Toccata.exe':pe().toString('base64'),'Preview/Toccata/resources/app.asar':Buffer.from('synthetic asar').toString('base64'),...extra};}
test('Windows package preparation accepts one x64 program and excludes outer documentation',async t=>{
 const d=dir(t),archive=zip(d,entries({'Preview/README.md':Buffer.from('docs').toString('base64')})),destination=path.join(d,'program');
 assert.equal(await runPreparation({mode:'prepare',archive,destination}),destination);assert.ok(fs.existsSync(path.join(destination,'Toccata.exe')));assert.ok(!fs.existsSync(path.join(destination,'README.md')));
});
test('preparation rejects traversal, user data, ambiguous executables and wrong architecture',async t=>{
 for(const [name,extra]of [['traversal',{'../escape.txt':''}],['userdata',{'Preview/Toccata-data/tasks.sqlite':''}],['ambiguous',{'Other/Toccata.exe':pe().toString('base64')}],['architecture',{'Preview/Toccata/Toccata.exe':Buffer.from('not PE').toString('base64')} ]]){
  const d=dir(t),archive=zip(d,entries(extra));await assert.rejects(runPreparation({mode:'prepare',archive,destination:path.join(d,'program')}),/Invalid/);
 }
});
test('portable installer replaces only the program, and failed startup restores the old program', {timeout:30000},async t=>{
 // MinGW's assembler requires an ASCII temporary path on this Windows toolchain.
 const build=fs.mkdtempSync('G:\\DevTools\\temp\\toccata-installer-stub-'),source=path.join(build,'stub.c'),stub=path.join(build,'stub.exe');
 t.after(()=>fs.rmSync(build,{recursive:true,force:true}));
 fs.writeFileSync(source,'#include <windows.h>\n#include <stdio.h>\nint main(){FILE*f=fopen("fail-start.txt","r");if(f){fclose(f);return 1;}f=fopen("test-pid.txt","w");if(f){fprintf(f,"%lu",GetCurrentProcessId());fclose(f);}Sleep(60000);return 0;}');
 cp.execFileSync('gcc',[source,'-o',stub,'-mwindows'],{windowsHide:true,env:{...process.env,TEMP:build,TMP:build}});
 for(const fail of [false,true]){
  const d=dir(t),target=path.join(d,'Toccata'),incoming=path.join(d,'verified'),data=path.join(d,'Toccata-data'),result=path.join(d,'result.json');
  for(const p of [target,incoming,data])fs.mkdirSync(p);for(const p of [target,incoming])fs.copyFileSync(stub,path.join(p,'Toccata.exe'));
  fs.writeFileSync(path.join(target,'version.txt'),'old');fs.writeFileSync(path.join(incoming,'version.txt'),'new');fs.writeFileSync(path.join(data,'keep.txt'),'private fixture');if(fail)fs.writeFileSync(path.join(incoming,'fail-start.txt'),'1');
  const script=path.resolve(__dirname,'../data/install-update.ps1');const run=cp.spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,TEMP:d,TMP:d}});
  run.stdin.end(JSON.stringify({mode:'install',target,source:incoming,result,pid:99999999}));
  let output='';run.stdout.on('data',b=>output+=b);run.stderr.on('data',b=>output+=b);await new Promise((resolve,reject)=>{run.on('error',reject);run.on('close',code=>code===0?resolve():reject(Error(output)))});
  const record=JSON.parse(fs.readFileSync(result));assert.equal(record.status,fail?'rolled-back':'installed');assert.equal(fs.readFileSync(path.join(target,'version.txt'),'utf8'),fail?'old':'new');assert.equal(fs.readFileSync(path.join(data,'keep.txt'),'utf8'),'private fixture');
  for(let i=0;i<30&&!fs.existsSync(path.join(target,'test-pid.txt'));i++)await new Promise(r=>setTimeout(r,50));
  if(fs.existsSync(path.join(target,'test-pid.txt'))){const pid=Number(fs.readFileSync(path.join(target,'test-pid.txt'),'utf8'));try{process.kill(pid)}catch{}await new Promise(r=>setTimeout(r,150));}
 }
});
