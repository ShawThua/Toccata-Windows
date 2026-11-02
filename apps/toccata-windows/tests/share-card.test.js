'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname,'../renderer/share-card.js');
const source = fs.readFileSync(file,'utf8');
function harness() {
  const labels=[], positions=[]; let fills=0, canvas;
  const ctx = { scale(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){fills++},fillRect(){fills++},fillText(value,x,y){labels.push(String(value));positions.push({text:String(value),x,y})} };
  const window={};
  const document={createElement(type){ assert.equal(type,'canvas'); canvas={getContext(kind){assert.equal(kind,'2d');return ctx},toDataURL(){return 'data:image/png;base64,TEST'}};return canvas;}};
  vm.runInNewContext(source,{window,document});
  return {...window.ToccataShareCard, labels, positions, get fills(){return fills}, get canvas(){return canvas}};
}
const layout={unit:54,keyGap:6,rows:[[{code:0,label:'A'},{code:1,label:'S'},{code:63,label:'Fn'}],[{code:49,label:'',w:2}]]};
const stats={active_ms:123000,key_count:3,fn_ms:null,keys:{0:2,1:1},days:[{date:'2026-10-28',active_ms:123000,key_count:3,fn_ms:null,buckets:Array(96).fill(0).map((_,i)=>i===0?123000:0)}],apps:[{name:'notepad.exe',active_ms:123000,key_count:3}]};
test('renders the complete local share card and returns an exportable canvas',()=>{
  const h=harness();const canvas=h.render({stats,timelineStats:stats,rangeLabel:'2026-10-28',layout,language:'zh'});
  for(const label of ['我的键盘足迹','2026-10-28','键盘活跃时间','按键次数','平均击键频率','1 次/活跃分钟','键盘热力图','活跃时间线','常用应用','notepad.exe']) assert.ok(h.labels.includes(label),`missing ${label}`);
  assert.ok(h.labels.some(label=>label.includes('3 次按键')&&label.endsWith('1 次/活跃分钟')),'daily summary must use the same rate metric');
  assert.ok(h.labels.includes('占 66.7%'),'ranked share uses the selected range total');
  assert.ok(h.labels.includes('占 33.3%'),'ranked share rounds to at most one decimal');
  assert.ok(!h.labels.some(label=>label.includes('语音输出估算')||label.includes(' · Fn ')),'old Fn metric remains in export');
  assert.ok(h.fills>100,'missing geometry or timeline');
  assert.equal(canvas.width,1440);assert.ok(canvas.height>1300);assert.match(canvas.toDataURL('image/png'),/^data:image\/png/);
});
test('empty data and English interface remain legible',()=>{
  const h=harness();h.render({stats:{keys:{},days:[],apps:[],fn_ms:null},rangeLabel:'Today',layout,language:'en'});
  for(const label of ['My keyboard footprint','No recorded keys in this layout','No activity records','No app records','Keystroke rate','—'])assert.ok(h.labels.includes(label));
  assert.ok(!h.labels.includes('Voice estimate · Fn'));
});

test('keystroke rate uses key presses per active minute and formats the unit explicitly',()=>{
  const {keystrokeRate,formatKeystrokeRate}=harness();
  assert.equal(keystrokeRate({key_count:1200,active_ms:1200000}),60);
  assert.ok(Math.abs(keystrokeRate({key_count:3,active_ms:123000})-180000/123000)<1e-12);
  assert.equal(keystrokeRate({key_count:0,active_ms:60000}),0,'a hold entering the range may have time but no new press');
  const example={key_count:2551,active_ms:120000};
  assert.equal(formatKeystrokeRate(example),'1,276 次/活跃分钟');
  assert.equal(formatKeystrokeRate(example,'en'),'1,276/active min');
  assert.equal(formatKeystrokeRate(example,'zh',true),'1,276 次/分');
  assert.equal(formatKeystrokeRate(example,'en',true),'1,276/min');
  assert.equal(formatKeystrokeRate({key_count:0,active_ms:60000}),'0 次/活跃分钟');
});

test('keystroke rate rejects absent, invalid and zero-duration samples without Infinity',()=>{
  const {keystrokeRate,formatKeystrokeRate}=harness();
  const invalid=[undefined,null,{}, {key_count:1},{active_ms:60000},
    {key_count:0,active_ms:0},{key_count:1,active_ms:0},
    {key_count:-1,active_ms:60000},{key_count:1,active_ms:-1},
    {key_count:NaN,active_ms:60000},{key_count:Infinity,active_ms:60000},
    {key_count:1,active_ms:NaN},{key_count:1,active_ms:Infinity},
    {key_count:'120',active_ms:60000},{key_count:120,active_ms:'60000'},
    {key_count:Number.MAX_VALUE,active_ms:1}];
  for(const sample of invalid){
    assert.equal(keystrokeRate(sample),null);
    assert.equal(formatKeystrokeRate(sample),'—');
    assert.equal(formatKeystrokeRate(sample,'en',true),'—');
  }
  const balanced={key_count:Number.MAX_VALUE,active_ms:Number.MAX_VALUE};
  assert.equal(keystrokeRate(balanced),60000,'a finite ratio must not overflow at the intermediate multiplication');
});

test('multi-day rate weights active duration and share text keeps daily rates distinct',()=>{
  const days=[
    {date:'2026-10-27',key_count:100,active_ms:60000,buckets:[60000]},
    {date:'2026-10-28',key_count:100,active_ms:600000,buckets:[600000]},
  ];
  const aggregate={key_count:200,active_ms:660000,keys:{0:200},days,apps:[]};
  const zh=harness();
  assert.equal(zh.keystrokeRate(aggregate),200/11);
  assert.notEqual(zh.keystrokeRate(aggregate),55,'daily rates must not be averaged without duration weighting');
  zh.render({stats:aggregate,timelineStats:aggregate,layout,language:'zh'});
  assert.ok(zh.labels.includes('18 次/活跃分钟'),'top card uses aggregate totals');
  assert.ok(zh.labels.some(label=>label.endsWith('100 次/活跃分钟')));
  assert.ok(zh.labels.some(label=>label.endsWith('10 次/活跃分钟')));
  const en=harness();en.render({stats:aggregate,timelineStats:aggregate,layout,language:'en'});
  assert.ok(en.labels.includes('18/active min'));
  assert.ok(en.labels.some(label=>label.endsWith('100/active min')));
  assert.ok(en.labels.some(label=>label.endsWith('10/active min')));
});
test('long date ranges are rejected before allocating an oversized image',()=>{
  const h=harness();const many=Array.from({length:600},()=>({date:'2026-10-28',buckets:[]}));
  assert.throws(()=>h.render({stats:{...stats,days:many},layout}),/过长/);
  assert.equal(h.canvas,undefined);
});
test('invalid layout cannot silently generate a false heatmap',()=>{
  const h=harness();assert.throws(()=>h.render({stats,layout:{rows:[]}}),/layout/);
});

test('Windows fixed row step keeps tall keypad buttons aligned with following row',()=>{
  const h=harness(), full={id:'windows-test',unit:54,keyGap:6,rowStep:1,rows:[
    [{code:0,label:'A'},{code:1078,label:'NUMPLUS',h:2},{code:10,label:'X'},{code:11,label:'Y'}],
    [{code:1,label:'B'}],
  ]};
  h.render({stats:{keys:{},days:[],apps:[],fn_ms:null},layout:full});
  const plus=h.positions.find(p=>p.text==='NUMPLUS'), b=h.positions.find(p=>p.text==='B');
  assert.ok(plus&&b);
  // Width four units -> 164 px/unit; center of the next row is 0.5 units lower.
  assert.equal(Math.round(b.y-plus.y),82);
});

test('Windows modifier rankings use Windows names, not Apple glyphs',()=>{
  const h=harness(), full={id:'windows-test',rowStep:1,rows:[[{code:55,label:'Win'},{code:59,label:'Ctrl'}]]};
  h.render({stats:{keys:{55:2,59:1},days:[],apps:[],fn_ms:null},layout:full,language:'zh'});
  assert.ok(h.labels.includes('左 Win'));assert.ok(h.labels.includes('左 Ctrl'));
});

test('absolute layout hides unmapped keys and reports outside counts',()=>{
  const h=harness(),compact={id:'custom',keys:[{code:0,label:'A',x:1,y:0,w:1,h:1}]};
  h.render({stats:{keys:{0:3,999:12},days:[],apps:[],fn_ms:null},layout:compact,language:'zh'});
  assert.ok(h.labels.includes('已知按键布局外 12 次'));
  assert.ok(!h.labels.includes('999'));
});
