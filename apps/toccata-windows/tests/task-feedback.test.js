'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../renderer/task-feedback');

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function classes(){const set=new Set();return{add:(...names)=>names.forEach(n=>set.add(n)),remove:(...names)=>names.forEach(n=>set.delete(n)),contains:n=>set.has(n),values:()=>[...set]};}
function row(id,top=100){return{dataset:{id},classList:classes(),draggable:true,getBoundingClientRect:()=>({top,height:40}),closest(){return this.draggable?this:null;},contains(node){return node===this||node?.row===this;}};}
function surface(rows,reduced=false){
 const listeners=new Map();
 return{rows,listeners,documentElement:{classList:classes()},defaultView:{matchMedia:()=>({matches:reduced})},
  addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:(name,handler)=>{if(listeners.get(name)===handler)listeners.delete(name);},
  querySelectorAll(){return this.rows;},contains(node){return this.rows.includes(node);},
  async fire(name,target,y=110,extra={}){const event={target,clientY:y,prevented:false,preventDefault(){this.prevented=true;},dataTransfer:{effectAllowed:'uninitialized',dropEffect:'none',data:{},setData(type,value){this.data[type]=value;}},...extra};await listeners.get(name)?.(event);return event;}
 };
}
function fixture(options={}){
 const tasks=[{id:'a',parent_id:'p',completed_at:null},{id:'b',parent_id:'p',completed_at:null},{id:'other-parent',parent_id:'q',completed_at:null},{id:'done',parent_id:'p',completed_at:70},{id:'epoch',parent_id:'p',completed_at:0},{id:'root',parent_id:null,completed_at:null}];
 const rows=tasks.map((task,i)=>row(task.id,100+i*50)),root=surface(rows,options.reduced);
 const calls=[],errors=[];
 const feedback=create({getTask:id=>tasks.find(task=>task.id===id),move:async request=>{calls.push(request);return true;},onError:error=>errors.push(error),...options});
 feedback.install(root);
 return{tasks,rows,root,calls,errors,feedback};
}

test('completion playback is single-flight, uses one player at volume 0.6 and can replay after ending',async()=>{
 const instances=[];let resolvePlay;
 class Audio{constructor(src){this.src=src;this.events=new Map();this.plays=0;this.ended=false;instances.push(this);}addEventListener(n,h){this.events.set(n,h);}removeEventListener(n,h){if(this.events.get(n)===h)this.events.delete(n);}play(){this.plays++;return new Promise(resolve=>{resolvePlay=resolve;});}pause(){this.paused=true;}}
 const feedback=create({getTask:()=>null,move:()=>false,AudioCtor:Audio});
 assert.equal(feedback.playCompletion(),true);assert.equal(feedback.playCompletion(),false);
 const audio=instances[0];assert.equal(instances.length,1);assert.equal(audio.src,'./task-completed.wav');assert.equal(audio.volume,0.6);assert.equal(audio.plays,1);
 resolvePlay();await tick();assert.equal(feedback.playCompletion(),false,'settled play promise is still audible');
 audio.ended=true;audio.events.get('ended')();assert.equal(feedback.playCompletion(),true);assert.equal(audio.currentTime,0);assert.equal(audio.plays,2);assert.equal(instances.length,1);
 feedback.destroy();assert.equal(audio.paused,true);assert.equal(audio.events.size,0);assert.equal(feedback.playCompletion(),false);
});

test('audio rejection and synchronous errors never escape, and a later completion can retry',async()=>{
 let attempts=0,errors=0;
 class Audio{addEventListener(){}removeEventListener(){}pause(){}play(){attempts++;if(attempts===1)return Promise.reject(Error('not supported'));if(attempts===2)throw Error('not available');return Promise.resolve();}}
 const feedback=create({getTask:()=>null,move:()=>false,AudioCtor:Audio,onError:()=>errors++});
 assert.equal(feedback.playCompletion(),true);await tick();assert.equal(feedback.playCompletion(),false);assert.equal(feedback.playCompletion(),true);await tick();
 assert.equal(attempts,3);assert.equal(errors,0,'audio must not become a task-save error');feedback.destroy();
});

test('legal sibling drags show insertion placement and save only the selected before/after move',async()=>{
 const f=fixture(),[a,b]=f.rows;
 const start=await f.root.fire('dragstart',a);assert.equal(start.dataTransfer.effectAllowed,'move');assert.equal(start.dataTransfer.data['text/plain'],'a');assert.equal(a.classList.contains('dragging'),true);
 let over=await f.root.fire('dragover',b,155);assert.equal(over.prevented,true);assert.equal(over.dataTransfer.dropEffect,'move');assert.equal(b.classList.contains('drop-before'),true);
 over=await f.root.fire('dragover',b,185);assert.equal(b.classList.contains('drop-before'),false);assert.equal(b.classList.contains('drop-after'),true);
 const drop=await f.root.fire('drop',b,185);assert.equal(drop.prevented,true);assert.deepEqual(f.calls,[{sourceId:'a',targetId:'b',placement:'after'}]);
 assert.equal(a.classList.contains('dragging'),false);assert.equal(b.classList.contains('drop-after'),false);assert.equal(a.classList.contains('task-drop-settled'),true);
 await f.root.fire('dragstart',a);await f.root.fire('drop',b,155);assert.equal(f.calls[1].placement,'before');f.feedback.destroy();
});

test('same task, other parent, other completion group and root tasks cannot be drop targets',async()=>{
 const f=fixture(),[a,,other,done,epoch,root]=f.rows;
 for(const target of [a,other,done,epoch,root]){
  await f.root.fire('dragstart',a);
  const over=await f.root.fire('dragover',target);assert.equal(over.prevented,false,target.dataset.id);assert.equal(over.dataTransfer.dropEffect,'none');
  assert.equal(target.classList.contains('drop-before')||target.classList.contains('drop-after'),false);
  const drop=await f.root.fire('drop',target);assert.equal(drop.prevented,false);
 }
 assert.deepEqual(f.calls,[]);const start=await f.root.fire('dragstart',root);assert.equal(start.prevented,true);assert.equal(root.classList.contains('dragging'),false);
 // A completion at Unix epoch is completed, so it can be moved beside another completed task.
 await f.root.fire('dragstart',epoch);await f.root.fire('drop',done,255);assert.equal(f.calls.length,1);assert.equal(f.calls[0].sourceId,'epoch');f.feedback.destroy();
});

test('drag state uses live task data and never trusts an external text/plain payload',async()=>{
 const f=fixture(),[a,b]=f.rows;
 const external=await f.root.fire('dragover',b,155,{dataTransfer:{data:{'text/plain':'a'},dropEffect:'copy'}});assert.equal(external.prevented,false);await f.root.fire('drop',b);assert.equal(f.calls.length,0);
 await f.root.fire('dragstart',a);await f.root.fire('dragover',b,155);assert.equal(b.classList.contains('drop-before'),true);
 f.tasks[1].completed_at=10;
 const stale=await f.root.fire('dragover',b,155);assert.equal(stale.prevented,false);assert.equal(b.classList.contains('drop-before'),false);await f.root.fire('drop',b);assert.equal(f.calls.length,0);f.feedback.destroy();
});

test('leaving a target, invalid hover, drag end and destruction remove feedback',async()=>{
 const f=fixture(),[a,b,other]=f.rows;
 await f.root.fire('dragstart',a);await f.root.fire('dragover',b,155);
 await f.root.fire('dragleave',b,155,{relatedTarget:{row:b}});assert.equal(b.classList.contains('drop-before'),true,'moving between target children keeps marker');
 await f.root.fire('dragleave',b,155,{relatedTarget:null});assert.equal(b.classList.contains('drop-before'),false);
 await f.root.fire('dragover',b,155);await f.root.fire('dragover',other);assert.equal(b.classList.contains('drop-before'),false);
 await f.root.fire('dragover',b,155);await f.root.fire('dragend',a);assert.deepEqual(a.classList.values(),[]);assert.deepEqual(b.classList.values(),[]);assert.equal(f.root.documentElement.classList.contains('task-reordering'),false);
 await f.root.fire('dragstart',a);await f.root.fire('dragover',b,155);f.feedback.destroy();assert.equal(f.root.listeners.size,0);assert.deepEqual(a.classList.values(),[]);assert.deepEqual(b.classList.values(),[]);
});

test('failed moves do not animate, errors are reported once and saving blocks a second drag',async()=>{
 let release;
 const f=fixture({move:()=>new Promise(resolve=>{release=resolve;})}),[a,b]=f.rows;
 await f.root.fire('dragstart',a);
 const saving=f.root.fire('drop',b,155);await tick();
 const second=await f.root.fire('dragstart',a);assert.equal(second.prevented,true);
 release(false);await saving;assert.equal(a.classList.contains('task-drop-settled'),false);f.feedback.destroy();
 const error=Error('write failed'),g=fixture({move:async()=>{throw error;}});
 await g.root.fire('dragstart',g.rows[0]);await g.root.fire('drop',g.rows[1]);assert.deepEqual(g.errors,[error]);assert.deepEqual(g.rows[0].classList.values(),[]);g.feedback.destroy();
});

test('success highlights the re-rendered row, while reduced motion and destruction suppress animation',async()=>{
 let root;
 const f=fixture({move:async()=>{root.rows=root.rows.map(item=>row(item.dataset.id));return true;}});root=f.root;
 await root.fire('dragstart',f.rows[0]);await root.fire('drop',f.rows[1],155);assert.equal(root.rows[0].classList.contains('task-drop-settled'),true);assert.equal(f.rows[0].classList.contains('task-drop-settled'),false);f.feedback.destroy();assert.equal(root.rows[0].classList.contains('task-drop-settled'),false);
 const reduced=fixture({reduced:true});await reduced.root.fire('dragstart',reduced.rows[0]);await reduced.root.fire('drop',reduced.rows[1]);assert.equal(reduced.rows[0].classList.contains('task-drop-settled'),false);reduced.feedback.destroy();
});
