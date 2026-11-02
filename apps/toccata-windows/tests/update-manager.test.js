'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
const {UpdateManager,checksumFor,trustedFetch}=require('../data/update-manager');const {checkForUpdates,parseRelease}=require('../data/updates');
const tempRoot=path.resolve(__dirname,'../../../.qa-temp');fs.mkdirSync(tempRoot,{recursive:true});
const name='Toccata-Windows-preview-0.1.3-x64.zip',tag='v0.1.3-win.2';const prefix=`https://github.com/WenNinghan/Toccata-Windows/releases/`;
const bytes=Buffer.from('synthetic verified ZIP fixture');const digest=createHash('sha256').update(bytes).digest('hex');
function release(){return {tag_name:tag,prerelease:true,draft:false,html_url:prefix+'tag/'+tag,assets:[{name,size:bytes.length,state:'uploaded',browser_download_url:prefix+'download/'+tag+'/'+name},{name:'SHA256SUMS.txt',state:'uploaded',browser_download_url:prefix+'download/'+tag+'/SHA256SUMS.txt'}]};}
function fixture(t,options={}){const dir=fs.mkdtempSync(path.join(tempRoot,'update-manager-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const fetchImpl=async(url)=>url.includes('api.github.com')?{ok:true,json:async()=>[release()]}:new Response(url.endsWith('SHA256SUMS.txt')?digest+'  '+name+'\n':bytes);let prepared=0;const manager=new UpdateManager({dataDir:dir,currentVersion:'0.1.3-win.1',fetchImpl,prepare:async({destination})=>{prepared++;fs.mkdirSync(destination);return destination},...options});return {manager,dir,prepared:()=>prepared};}
test('Windows prerelease channel selects latest semver and supports legacy preview tag',async()=>{
 const legacy={...release(),tag_name:'windows-preview-20261029',html_url:prefix+'tag/windows-preview-20261029',assets:[]};assert.equal(parseRelease(legacy).version,'0.1.0');
 const result=await checkForUpdates({currentVersion:'0.1.3-win.1',fetchImpl:async()=>({ok:true,json:async()=>[release(),{...release(),tag_name:'v0.1.2',html_url:prefix+'tag/v0.1.2'}]})});assert.equal(result.version,tag);assert.equal(result.can_download,true);
});
test('download verifies SHA256 before preparing package and reports ready',async t=>{
 const f=fixture(t);await f.manager.check();const state=await f.manager.download();assert.equal(state.phase,'ready');assert.equal(state.canInstall,true);assert.equal(f.prepared(),1);assert.equal(state.received,bytes.length);
});
test('hash mismatch and truncated package never reach installer, retry succeeds',async t=>{
 const f=fixture(t);await f.manager.check();f.manager.release.assets[0].digest='sha256:'+'0'.repeat(64);
 assert.equal((await f.manager.download()).phase,'error');assert.equal(f.prepared(),0);assert.equal(f.manager.status().canInstall,false);
 f.manager.release.assets[0].digest='sha256:'+digest;assert.equal((await f.manager.download()).phase,'ready');assert.equal(f.prepared(),1);
});
test('unwritable update directory becomes a retryable error rather than a stuck download',async t=>{
 const f=fixture(t);await f.manager.check();fs.writeFileSync(path.join(f.dir,'updates'),'synthetic directory collision');
 assert.equal((await f.manager.download()).phase,'error');assert.equal(f.manager.controller,null);
 fs.unlinkSync(path.join(f.dir,'updates'));assert.equal((await f.manager.download()).phase,'ready');
});
test('cancel during streaming does not prepare or leave a partial package',async t=>{
 let fetched;const f=fixture(t,{fetchImpl:async(url,{signal}={})=>{
  if(url.includes('api.github.com'))return {ok:true,json:async()=>[release()]};
  if(url.endsWith('SHA256SUMS.txt'))return new Response(digest+'  '+name);
  fetched=true;return new Response(new ReadableStream({start(c){c.enqueue(bytes.subarray(0,3));signal.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')),{once:true});}}));
 }});
 await f.manager.check();const work=f.manager.download();while(!fetched)await new Promise(r=>setTimeout(r,5));f.manager.cancel();assert.equal((await work).phase,'cancelled');assert.equal(f.prepared(),0);assert.deepEqual(fs.readdirSync(path.join(f.dir,'updates')),[]);
});
test('rejects asset/path spoofing, missing checksum, and untrusted redirect',async()=>{
 const r=release();r.assets[0].browser_download_url='https://github.com/attacker/Toccata-Windows/releases/download/'+tag+'/'+name;assert.equal(parseRelease(r).assets.length,0);
 assert.throws(()=>checksumFor(digest+'  other.zip',name),/missing/);
 await assert.rejects(trustedFetch(prefix+'download/'+tag+'/'+name,{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://example.org/evil.zip'}})}),/Untrusted/);
});
