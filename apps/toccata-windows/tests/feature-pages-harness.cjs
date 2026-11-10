'use strict';
// Do not contact GitHub during UI inspection. Only the Windows-channel metadata
// endpoint is accepted; the test never triggers a download or installation.
const current=require('../package.json').version.match(/^(\d+)\.(\d+)\.(\d+)/);const version=`v${current[1]}.${current[2]}.${Number(current[3])+1}-win.1`,base='https://github.com/WenNinghan/Toccata-Windows/releases/';
globalThis.fetch=async url=>{
 if(String(url)!=='https://api.github.com/repos/WenNinghan/Toccata-Windows/releases?per_page=30')throw Error('Unexpected update channel');
 return {ok:true,json:async()=>[{tag_name:version,html_url:base+'tag/'+version,prerelease:true,assets:[{name:'Toccata-Windows-preview-x64.zip',state:'uploaded',size:100,browser_download_url:base+'download/'+version+'/Toccata-Windows-preview-x64.zip',digest:'sha256:'+'a'.repeat(64)}]}]};
};
require('./features-harness.cjs');
