'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../renderer/windows-features');
const ui=globalThis.ToccataWindowsFeatures;
const layout={keys:[{code:0,label:'A',x:0,y:0,w:1,h:1},{code:49,label:'Space',x:0,y:1,w:2,h:1},{code:1581,label:'Pause',x:1,y:0,w:1,h:1,unavailable:true}]};

test('settings page exposes all host controls, selected preferences and native Windows wording',()=>{
  const html=ui.renderSettings({settings:{theme:'dark',hideTaskbar:true,hydrationEnabled:true,hydrationInterval:16384,trayDefaultPage:'activity'},hydration:{count:12000,nextAt:16384},version:'0.1.3-win.1',upstreamVersion:'0.1.3'});
  for(const id of ['feature-theme','feature-language','feature-tray-default','feature-login','feature-hide-taskbar','feature-hydration-enabled','feature-hydration-interval'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/value="dark" selected/);assert.match(html,/value="16384" selected/);assert.match(html,/value="activity" selected/);
  assert.match(html,/隐藏任务栏图标/);assert.match(html,/距下次提醒/);assert.match(html,/4,384/);
  assert.match(html,/data-action="notification-settings"/);assert.match(html,/data-action="about"/);
  assert.doesNotMatch(html,/Dock|macOS/);
});

test('settings content escapes version and errors, and disables unrequested notification tests',()=>{
  const html=ui.renderSettings({language:'en',version:'<script>bad</script>',hydration:{error:'<img src=x onerror=alert(1)>'}});
  assert.match(html,/General settings/);assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(html,/data-action="test-notification" disabled/);assert.doesNotMatch(html,/<script>|<img src=x/);
});

test('tray navigation contains exactly three mapped pages and keeps current state',()=>{
  const html=ui.renderTrayNav('calendar','en');
  assert.equal((html.match(/data-action="tray-page"/g)||[]).length,3);
  assert.match(html,/data-value="calendar" class="active" aria-pressed="true"/);assert.match(html,/>Calendar</);
});

test('tray keyboard shows total-based percentages, every physical key and local 15-minute buckets',()=>{
  const html=ui.renderTrayActivity({layout,stats:{key_count:10,active_ms:65000,keys:{0:3,49:2},days:[{date:'2026-11-02',buckets:[0,900000,1000]}]}});
  assert.equal((html.match(/data-tray-key=/g)||[]).length,3);assert.match(html,/A · 3 次 · 30%/);assert.match(html,/Space · 2 次 · 20%/);assert.match(html,/Pause · 暂不支持采集/);
  assert.equal((html.match(/class="wf-tray-bucket /g)||[]).length,3);assert.match(html,/每格 15 分钟/);assert.match(html,/1分/);
});

test('tray app list includes all rows, escapes names and rejects external image URLs',()=>{
  const apps=Array.from({length:30},(_,i)=>({id:String(i),name:i===0?'<unsafe & name>':`App ${i}`,key_count:i,active_ms:i*1000,icon_data_url:'https://private.example/icon.png'}));
  const html=ui.renderTrayActivity({layout,language:'en',range:'yesterday',tab:'apps',stats:{apps}});
  assert.equal((html.match(/role="listitem"/g)||[]).length,30);assert.ok(html.includes('&lt;unsafe &amp; name&gt;'));assert.doesNotMatch(html,/private\.example/);
  assert.match(html,/data-value="yesterday" class="active"/);assert.match(html,/App activity/);
});

test('empty and malformed activity inputs render a readable empty overview',()=>{
  assert.match(ui.renderTrayActivity({language:'en',tab:'apps'}),/No app activity/);
  assert.match(ui.renderTrayActivity({language:'en',layout:{keys:[]}}),/Keyboard layout is unavailable/);
  assert.doesNotMatch(ui.renderTrayActivity({layout,stats:{key_count:0,active_ms:null}}),/NaN|Infinity/);
});
