'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {computeStats}=require('../data/stats');
// Exercise the actual renderer function without loading Electron or its profile.
const source=fs.readFileSync(path.join(__dirname,'../renderer/app.js'),'utf8');
const functionSource=source.slice(source.indexOf('function timeline(stats)'),source.indexOf('function captureLabel()'));
const context=vm.createContext({window:{},state:{language:'zh'},h:x=>String(x??''),t:x=>x,duration:x=>x==null?'unavailable':String(x),dateStart:s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/share-card.js'),'utf8'),context);
vm.runInContext(functionSource,context);
function renderDay(iso){const [y,m,d]=iso.split('-').map(Number),start=new Date(y,m-1,d).getTime(),end=new Date(y,m-1,d+1).getTime();const stats=computeStats([],{start_ms:start,end_ms:end,now_ms:end});const html=context.timeline(stats);return [...html.matchAll(/class="bucket [^"]*"[^>]*title="([^"]+)"/g)].map(x=>x[1].split(' · ')[0]);}
function inZone(zone,fn){const previous=process.env.TZ;process.env.TZ=zone;try{fn()}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}}
test('normal day labels preserve 96 local 15-minute intervals',()=>inZone('Asia/Shanghai',()=>{const labels=renderDay('2026-10-28');assert.equal(labels.length,96);assert.equal(labels[0],'00:00');assert.equal(labels[8],'02:00');assert.equal(labels[95],'23:45')}));
test('spring DST jump labels actual local times',()=>inZone('America/Los_Angeles',()=>{const labels=renderDay('2026-03-08');assert.equal(labels.length,92);assert.equal(labels[7],'01:45');assert.equal(labels[8],'03:00');assert.equal(labels[91],'23:45');assert.ok(!labels.some(x=>x.startsWith('02:')))}));
test('autumn repeated hour labels distinguish UTC offsets',()=>inZone('America/Los_Angeles',()=>{const labels=renderDay('2026-11-01');assert.equal(labels.length,100);assert.equal(labels[4],'01:00 UTC-07:00');assert.equal(labels[8],'01:00 UTC-08:00');assert.equal(labels[12],'02:00');assert.equal(labels[99],'23:45')}));
