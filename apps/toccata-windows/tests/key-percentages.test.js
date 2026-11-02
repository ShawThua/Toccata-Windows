'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const window={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/share-card.js'),'utf8'),{window});
const {keyUsagePercent}=window.ToccataShareCard;

test('key percentages match upstream rounding and omit trailing zeros',()=>{
  for(const [count,total,wanted]of[[54,485,'11.1%'],[9,485,'1.9%'],[1,16,'6.3%'],[1,4,'25%'],[485,485,'100%'],[1,10000,'0%']]){
    assert.equal(keyUsagePercent(count,total),wanted);
    assert.equal(keyUsagePercent(count,total,'en'),wanted);
  }
});

test('key percentage denominator is total range presses rather than visible keys',()=>{
  assert.equal(keyUsagePercent(10,100),'10%');
  assert.notEqual(keyUsagePercent(10,100),keyUsagePercent(10,20));
  assert.equal(keyUsagePercent(0,100),'0%');
});

test('key percentages handle invalid totals, large values and impossible counts safely',()=>{
  for(const [count,total]of[[0,0],[5,0],[-1,10],[1,-10],[Infinity,5],[1,Infinity],[NaN,5],['5',10],[5,'10'],[null,10]])assert.equal(keyUsagePercent(count,total),'0%');
  assert.equal(keyUsagePercent(20,10),'100%');
  assert.equal(keyUsagePercent(Number.MAX_VALUE,Number.MAX_VALUE),'100%');
  assert.equal(keyUsagePercent(Number.MAX_VALUE/2,Number.MAX_VALUE),'50%');
});
