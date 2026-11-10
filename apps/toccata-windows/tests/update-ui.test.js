'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const ui=require('../renderer/update-ui');
function fixture(){const attrs={};const button={node:null,querySelector(){return this.node},appendChild(node){this.node=node;node.parent=this},setAttribute(k,v){attrs[k]=v},removeAttribute(k){delete attrs[k]}};return {button,attrs,document:{querySelector:s=>s==='#about'?button:null,createElement:()=>({setAttribute(){},remove(){this.parent.node=null}})}};}
test('only a verified available Windows package shows the accessible sidebar beacon',()=>{
 const f=fixture(),u={checkStatus:'update-available',canDownload:true,availableVersion:'v0.1.4-win.1'};ui.syncBeacon(f.document,u,'zh');assert.equal(f.button.node.className,'update-beacon');assert.match(f.attrs['aria-label'],/v0.1.4-win.1/);ui.syncBeacon(f.document,u,'en');assert.match(f.attrs.title,/New Windows version/);ui.syncBeacon(f.document,{...u,canDownload:false},'en');assert.equal(f.button.node,null);assert.equal(f.attrs.title,undefined);
 for(const checkStatus of ['checking','up-to-date','no-windows-asset','error'])assert.equal(ui.available({checkStatus,canDownload:true}),false);
});
test('about state uses same release and preserves phase-specific controls',()=>{
 const base={phase:'idle',checkStatus:'update-available',canDownload:true,availableVersion:'v0.2.0',release_url:'https://github.com/WenNinghan/Toccata-Windows/releases/tag/v0.2.0'};const html=ui.renderStatus(base,'zh');assert.match(html,/v0\.2\.0/);assert.match(html,/data-action="download-update"/);assert.match(html,/发布说明/);
 const progress=ui.renderStatus({...base,phase:'downloading',percent:42},'en');assert.match(progress,/value="42"/);assert.match(progress,/cancel-update/);assert.doesNotMatch(progress,/data-action="download-update"/);
 assert.match(ui.renderStatus({...base,phase:'ready',packaged:false},'en'),/install-update" disabled/);assert.match(ui.renderStatus({phase:'idle',checkStatus:'error',checkReason:'<offline>'},'zh'),/&lt;offline&gt;/);
});
