'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {HydrationReminder,countTodayKeys,localDay}=require('../data/hydration');
const {KeyStore}=require('../data/keyboard');

function fixture(options={}){
 let now=new Date(2026,10,2,12).getTime(),count=0,saved=null,fail=false;
 const sent=[];
 const service={readCount:async()=>count,readProgress:()=>saved,saveProgress:value=>{saved=structuredClone(value);},notify:async value=>{if(fail)throw Error('Rejected');sent.push(value);},now:()=>now,...options};
 let reminder=new HydrationReminder(service);
 return{get reminder(){return reminder},sent,set count(value){count=value},get saved(){return saved},set now(value){now=value},set fail(value){fail=value},restart(){reminder.stop();reminder=new HydrationReminder({...service,enabled:true});return reminder;}};
}
test('disabled reminders never read counts, persist or send notifications',async()=>{
 const f=fixture({readCount:()=>{throw Error('must not read')}});await f.reminder.evaluate();assert.equal(f.saved,null);assert.equal(f.sent.length,0);assert.equal(f.reminder.status().enabled,false);await assert.rejects(f.reminder.test(),/Enable/);
});
test('enabling baselines current count and multiple crossed thresholds send only the latest',async()=>{
 const f=fixture();f.count=10000;await f.reminder.configure(true,8192);assert.equal(f.sent.length,0);assert.equal(f.saved.handledCount,10000);assert.equal(f.reminder.status().nextAt,16384);
 f.count=40000;await f.reminder.evaluate();assert.equal(f.sent.length,1);assert.equal(f.sent[0].milestone,32768);assert.equal(f.saved.handledCount,40000);
 await f.reminder.evaluate();assert.equal(f.sent.length,1);
});
test('restart and lower snapshots never replay already handled milestones',async()=>{
 const f=fixture();await f.reminder.configure(true,4096);f.count=5000;await f.reminder.evaluate();assert.equal(f.sent.length,1);
 f.restart();await f.reminder.evaluate();f.count=0;await f.reminder.evaluate();f.count=5000;await f.reminder.evaluate();assert.equal(f.sent.length,1);assert.equal(f.saved.handledCount,5000);
 f.count=8192;await f.reminder.evaluate();assert.equal(f.sent.length,2);
});
test('changing an interval resets baseline and changing day starts daily thresholds anew',async()=>{
 const f=fixture();await f.reminder.configure(true,8192);f.count=20000;await f.reminder.evaluate();assert.equal(f.sent.length,1);
 await f.reminder.configure(true,4096);assert.equal(f.sent.length,1);f.count=20480;await f.reminder.evaluate();assert.equal(f.sent.length,2);
 f.now=new Date(2026,10,3,12).getTime();f.count=4096;await f.reminder.evaluate();assert.equal(f.sent.length,3);assert.equal(f.saved.day,'2026-11-03');
});
test('notification rejection rolls back reservation for retry; test notifications do not advance milestones',async()=>{
 const f=fixture();await f.reminder.configure(true,4096);f.fail=true;f.count=4096;await f.reminder.evaluate();assert.equal(f.saved.handledCount,0);assert.ok(f.reminder.status().error);
 f.fail=false;await f.reminder.evaluate();assert.equal(f.saved.handledCount,4096);assert.equal(f.sent.length,1);assert.equal(f.reminder.status().error,null);
 const progress=structuredClone(f.saved);await f.reminder.test();assert.equal(f.sent[1].kind,'test');assert.deepEqual(f.saved,progress);
});
test('unavailable notifications do not crash or repeatedly replay old milestones',async()=>{
 const f=fixture({supported:()=>false});await f.reminder.configure(true,4096);f.count=4096;await f.reminder.evaluate();assert.equal(f.sent.length,0);assert.equal(f.saved.handledCount,4096);assert.ok(f.reminder.status().error);await assert.rejects(f.reminder.test(),/unavailable/);
});
test('concurrent count refreshes share one evaluation and stop prevents late sends',async()=>{
 let release;const f=fixture({enabled:true,readCount:()=>new Promise(resolve=>{release=resolve;})});
 const first=f.reminder.evaluate(),second=f.reminder.evaluate();assert.equal(first,second);f.reminder.stop();release(100000);await first;assert.equal(f.sent.length,0);assert.equal(f.saved,null);
});
test('daily counts include pending down events once, exclude repeats, up events and future data',()=>{
 const store=new KeyStore(':memory:');const now=new Date(2026,10,2,12).getTime();
 const add=(id,kind,time)=>store.add({type:'key',event_id:id,ts_ms:time,kind,scan:30,ext:0,vkey:65,hold_ms:kind==='up'?100:null,app:null});
 add('one','down',now-1000);add('one-up','up',now-900);store.flush();add('one','down',now-1000);add('two','down',now-500);add('two','down',now-500);add('tomorrow','down',now+86400000);
 assert.equal(countTodayKeys(store,now),2);assert.equal(localDay(now),'2026-11-02');store.pending=[];store.close();
});
test('invalid progress and settings cannot produce false notification counts',async()=>{
 const f=fixture({enabled:true,readCount:()=>-1,readProgress:()=>({day:'2026-11-02',handledCount:-2})});await f.reminder.evaluate();assert.equal(f.sent.length,0);assert.ok(f.reminder.status().error);await assert.rejects(f.reminder.configure(true,1));
});
