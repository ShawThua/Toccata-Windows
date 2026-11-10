'use strict';

// Reproducible Electron UI regression using synthetic tasks and disabled capture.
// Its isolated profile and temporary files live under G:\DevTools\temp.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const workspace = path.resolve(project, '..', '..', '..');
const executable = path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function timeout(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}
async function until(fn, ms, label) {
  const end = Date.now() + ms;
  let lastError;
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result; } catch (error) { lastError = error; }
    await delay(75);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.next = 0; this.pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data), request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    });
    ws.addEventListener('close', () => {
      for (const request of this.pending.values()) request.reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    const opened = await timeout(new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once:true });
      ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once:true });
    }), 5000);
    if (!opened) throw new Error('CDP connection timeout');
    return new CDP(ws);
  }
  async evaluate(expression) {
    const id = ++this.next;
    const value = await new Promise((resolve, reject) => {
      this.pending.set(id, {resolve,reject});
      this.ws.send(JSON.stringify({ id, method:'Runtime.evaluate', params:{ expression, awaitPromise:true, returnByValue:true } }));
    });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  }
  close() { this.ws.close(); }
}
async function launch(dataDir) {
  const tempDir = path.join(dataDir, 'temp');
  fs.mkdirSync(tempDir, { recursive:true });
  const env = { ...process.env, TOCCATA_DATA_DIR:dataDir, TOCCATA_DISABLE_CAPTURE:'1', TEMP:tempDir, TMP:tempDir };
  delete env.ELECTRON_RUN_AS_NODE; delete env.TOCCATA_QA_SCREENSHOT; delete env.TOCCATA_QA_MEMORY;
  const proc = spawn(executable, ['--remote-debugging-port=0','--remote-allow-origins=*','--disable-gpu',project], {
    cwd:project, env, stdio:['ignore','pipe','pipe'], windowsHide:true,
  });
  let output = '', exited = false, spawnError;
  proc.stdout.on('data', bytes => { output += bytes; });
  proc.stderr.on('data', bytes => { output += bytes; });
  proc.on('error', error => { spawnError = error; });
  const done = new Promise(resolve => proc.once('close', (code, signal) => { exited = true; resolve({code,signal}); }));
  try {
    const port = await until(() => {
      if (spawnError) throw spawnError;
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) return Number(match[1]);
      if (exited) throw new Error('Electron exited during startup');
    }, 20000, 'Electron startup');
    async function target(predicate) {
      return until(async () => {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        return pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl && predicate(page.url));
      }, 10000, 'renderer target');
    }
    const main = await CDP.connect((await target(url => url.includes('/renderer/index.html') && !url.includes('?'))).webSocketDebuggerUrl);
    await until(() => main.evaluate('Boolean(window.toccata?.invoke && document.querySelector("#main h1"))'), 10000, 'main ready');
    assert.equal((await main.evaluate('window.toccata.invoke("capture:status")')).state, 'disabled');
    return { proc, done, port, main, target, getOutput:() => output };
  } catch (error) {
    if (!exited) proc.kill();
    await timeout(done, 3000);
    throw error;
  }
}
async function invoke(cdp, channel, payload = {}) {
  return cdp.evaluate(`window.toccata.invoke(${JSON.stringify(channel)}, ${JSON.stringify(payload)})`);
}

const { TaskStore } = require('../data/tasks');

function taskFixture(dataDir) {
  const store = new TaskStore(path.join(dataDir, 'tasks.sqlite'));
  const parent = store.create({title:'测试父任务'});
  const child = store.create({title:'未安排的子任务',parent_id:parent.id});
  const all = store.create({title:'今日全部事件'});
  const later = store.create({title:'较晚完成'});
  const earlier = store.create({title:'较早完成'});
  const now = Date.now()/1000, date = new Date();
  const dayStart = new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime()/1000;
  const span = now-dayStart;
  const update = store.db.prepare('UPDATE tasks SET created_at=?,planned_at=?,completed_at=? WHERE id=?');
  update.run(now-20*86400, now+3*86400, null, parent.id);
  update.run(dayStart+span*.3, null, null, child.id);
  update.run(dayStart+span*.1, dayStart+span*.2, dayStart+span*.8, all.id);
  update.run(now-100000, null, dayStart+span*.6, later.id);
  update.run(now-50000, null, dayStart+span*.4, earlier.id);
  store.db.close();
  return {parent,child,all,later,earlier};
}
async function click(client, selector) {
  return client.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.click();return true})()`);
}
async function present(client, expression, label) { return until(()=>client.evaluate(expression),10000,label); }
async function editorStatus(client) { return invoke(client,'app:editor-status'); }

test('Electron: clickable task add controls share Enter behavior in every view', {timeout:120000}, async t => {
  const dataDir=fs.mkdtempSync(path.join('G:\\DevTools\\temp','toccata-task-add-'));
  t.diagnostic(`Synthetic profile: ${dataDir}`);
  let app,tray,editor;
  t.after(async()=>{
    for(const client of [editor,tray,app?.main])try{client?.close()}catch{}
    if(app&&app.proc.exitCode===null){app.proc.kill();await timeout(app.done,3000)}
  });
  app=await launch(dataDir);const main=app.main;
  const tasks=()=>invoke(main,'tasks:list').then(x=>x.tasks);
  const addSelector=(input,arrow=false)=>`button[data-action="create-task"][data-input="${input}"]${arrow?'.add-arrow':':not(.add-arrow)'}`;
  async function enterValue(client,input,value){
    await present(client,`Boolean(document.getElementById(${JSON.stringify(input)}))`,'add input');
    await client.evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(input)});input.value=${JSON.stringify(value)};return true})()`);
  }
  async function added(title,parent=null){
    const item=await until(async()=>{const rows=(await tasks()).filter(x=>x.title===title);assert.ok(rows.length<=1,'must not duplicate '+title);return rows[0]},10000,'created '+title);
    assert.equal(item.parent_id,parent);
    // Allow the cross-window changed event to settle before entering another draft.
    await delay(700);return item;
  }
  await enterValue(main,'new-task','   ');
  await click(main,addSelector('new-task'));
  await delay(100);assert.equal((await tasks()).length,0);
  assert.equal(await main.evaluate('document.activeElement.id'),'new-task');
  assert.ok(await main.evaluate(`document.querySelector(${JSON.stringify(addSelector('new-task'))}).getAttribute('aria-label')`));

  await enterValue(main,'new-task','主任务加号');
  await main.evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(addSelector('new-task'))});button.click();button.click();document.getElementById('new-task').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true})()`);
  const parent=await added('主任务加号');
  assert.equal((await tasks()).length,1);
  await enterValue(main,'new-task','主任务箭头');await click(main,addSelector('new-task',true));await added('主任务箭头');
  await enterValue(main,'new-task','主任务回车');
  await main.evaluate(`document.getElementById('new-task').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`);
  await added('主任务回车');

  await click(main,'[data-page="inbox"]');
  await enterValue(main,'new-task','收集箱加号');await click(main,addSelector('new-task'));await added('收集箱加号');
  await click(main,`#left .task-row[data-id="${parent.id}"]`);
  await present(main,`document.querySelector('#details-frame')?.dataset.task===${JSON.stringify(parent.id)}`,'selected parent detail');
  await enterValue(main,'new-child','详情子任务加号');await click(main,addSelector('new-child'));await added('详情子任务加号',parent.id);
  await enterValue(main,'new-child','详情子任务箭头');await click(main,addSelector('new-child',true));await added('详情子任务箭头',parent.id);

  // An unsaved invalid parent must block creation without discarding the input.
  await main.evaluate(`(()=>{const input=document.getElementById('detail-title');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await enterValue(main,'new-task','保留未提交的草稿');await click(main,addSelector('new-task'));
  await present(main,`Boolean(document.querySelector('.error-banner'))`,'validation error');
  assert.equal((await tasks()).some(x=>x.title==='保留未提交的草稿'),false);
  assert.equal(await main.evaluate(`document.getElementById('new-task').value`),'保留未提交的草稿');
  await main.evaluate(`(()=>{const input=document.getElementById('detail-title');input.value='主任务加号';input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('new-task').value='';return true})()`);
  await delay(500);
  await click(main,'[data-page="calendar"]');
  await enterValue(main,'planned-task','日历加号');
  const selectedDay=await main.evaluate(`document.querySelector('.calendar-day-cell.selected').dataset.value`);
  await click(main,addSelector('planned-task'));const planned=await added('日历加号');
  assert.equal(planned.planned_at,new Date(selectedDay+'T00:00:00').getTime()/1000);

  tray=await CDP.connect((await app.target(url=>url.includes('?view=tray'))).webSocketDebuggerUrl);
  await enterValue(tray,'new-task','托盘加号');await click(tray,addSelector('new-task'));await added('托盘加号');
  await present(tray,`Boolean(document.querySelector('.tray-scroll .task-row[data-id="${parent.id}"]'))`,'tray parent');
  await click(tray,`.tray-scroll .task-row[data-id="${parent.id}"]`);
  await until(async()=>{const x=await editorStatus(tray);return x.visible&&x.id===parent.id},10000,'floating editor');
  editor=await CDP.connect((await app.target(url=>url.includes('view=editor'))).webSocketDebuggerUrl);
  await enterValue(editor,'new-child','浮窗子任务加号');await click(editor,addSelector('new-child'));await added('浮窗子任务加号',parent.id);
  await enterValue(editor,'new-child','浮窗子任务回车');
  await editor.evaluate(`document.getElementById('new-child').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`);
  await added('浮窗子任务回车',parent.id);
  assert.equal((await tasks()).length,10);
  await invoke(tray,'app:close-editor');
  await main.evaluate(`window.toccata.invoke('app:quit').catch(()=>{});true`).catch(()=>{});
  const exited=await timeout(app.done,12000);assert.ok(exited,'clean exit after adding');assert.equal(exited.code,0,app.getOutput().slice(-1500));
  const persisted=new TaskStore(path.join(dataDir,'tasks.sqlite'));
  try{assert.equal(persisted.list().length,10)}finally{persisted.db.close()}
});

test('Electron: task calendar, review order and tray selection and context menu', {timeout:90000}, async t => {
  assert.ok(fs.existsSync(executable));
  const tempRoot = 'G:\\DevTools\\temp';
  fs.mkdirSync(tempRoot,{recursive:true});
  const dataDir = fs.mkdtempSync(path.join(tempRoot,'toccata-task-ui-'));
  // Keep this synthetic profile for inspecting a failure; it contains no user data.
  t.diagnostic(`Synthetic profile: ${dataDir}`);
  const ids = taskFixture(dataDir);
  let app, tray;
  t.after(async()=>{
    if (tray) try { tray.close(); } catch (_) {}
    if (app && app.proc.exitCode===null) { app.proc.kill(); await timeout(app.done,3000); }
    if (app) try { app.main.close(); } catch (_) {}
  });
  app = await launch(dataDir);
  const main = app.main;
  await click(main,'[data-page="calendar"]');
  await present(main,`document.querySelectorAll('.task-month-grid .calendar-day-cell').length`,'calendar grid');
  const grid = await main.evaluate(`(()=>{const c=[...document.querySelectorAll('.task-month-grid .calendar-day-cell')];return {dates:c.map(x=>x.dataset.value),todayDots:document.querySelectorAll('.calendar-day-cell.today .calendar-dots .on').length}})()`);
  assert.ok([28,35,42].includes(grid.dates.length));
  assert.equal(new Date(grid.dates[0]+'T12:00:00').getDay(),1);
  assert.equal(new Date(grid.dates.at(-1)+'T12:00:00').getDay(),0);
  assert.equal(grid.todayDots,3);
  await click(main,'[data-action="toggle-unscheduled"]');
  assert.equal(await main.evaluate(`document.querySelectorAll('#left .task-row[data-id=${JSON.stringify(ids.child.id)}]').length`),2);
  assert.equal(await main.evaluate(`document.querySelectorAll('#left .task-row[data-id=${JSON.stringify(ids.parent.id)}]').length`),2);
  const adjacent = await main.evaluate(`document.querySelector('.calendar-day-cell.other-month')?.dataset.value||null`);
  if (adjacent) {
    await click(main,`.calendar-day-cell[data-value="${adjacent}"]`);
    await present(main,`document.querySelector('.calendar-day-cell.selected')?.dataset.value===${JSON.stringify(adjacent)}`,'adjacent month selection');
  }
  await click(main,'[data-page="review"]');
  await click(main,'[data-action="review-range"][data-value="seven"]');
  const review = await main.evaluate(`({ids:[...document.querySelectorAll('#left .task-row')].map(x=>x.dataset.id),groups:[...document.querySelectorAll('#left .group-label')].map(x=>x.textContent.trim())})`);
  assert.deepEqual(review.ids,[ids.all.id,ids.later.id,ids.earlier.id,ids.parent.id,ids.child.id]);
  assert.match(review.groups[0],/已完成主任务/);
  assert.match(review.groups[1],/待推进主任务/);

  tray = await CDP.connect((await app.target(url=>url.includes('?view=tray'))).webSocketDebuggerUrl);
  await present(tray,`Boolean(document.querySelector('[data-action="tray-page"][data-value="calendar"]'))`,'tray ready');
  await click(tray,'[data-action="tray-page"][data-value="calendar"]');
  await present(tray,`document.querySelectorAll('.task-month-grid .calendar-day-cell').length`,'tray calendar');
  assert.equal(await tray.evaluate(`document.querySelectorAll('.calendar-day-cell.today .calendar-dots .on').length`),3);
  assert.equal(await tray.evaluate(`document.querySelectorAll('.task-month-grid .calendar-day-cell').length`),grid.dates.length);
  await click(tray,'[data-action="tray-page"][data-value="tasks"]');
  const row=id=>`.tray-scroll .task-row[data-id="${id}"]`;
  await present(tray,`Boolean(document.querySelector(${JSON.stringify(row(ids.parent.id))}))`,'tray parent');
  await click(tray,row(ids.parent.id));
  await until(async()=>{const x=await editorStatus(tray);return x.visible&&x.id===ids.parent.id},10000,'open editor');
  await click(tray,row(ids.parent.id));
  await until(async()=>!(await editorStatus(tray)).visible,10000,'collapse editor');
  await click(tray,row(ids.parent.id));
  await until(async()=>{const x=await editorStatus(tray);return x.visible&&x.id===ids.parent.id},10000,'reopen editor');
  await tray.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row(ids.parent.id))});r.focus();r.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));return true})()`);
  await until(async()=>{const x=await editorStatus(tray);return x.visible&&x.id===ids.child.id},10000,'arrow selects child');
  await present(tray,`document.querySelector(${JSON.stringify(row(ids.child.id))})?.classList.contains('selected')`,'child highlight');
  await tray.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row(ids.child.id))});r.focus();r.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()`);
  await until(async()=>!(await editorStatus(tray)).visible,10000,'escape closes editor');
  const shiftPrevented = await tray.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row(ids.child.id))});r.focus();return !r.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}))})()`);
  assert.equal(shiftPrevented,false);
  assert.equal((await editorStatus(tray)).visible,false);

  await tray.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row(ids.parent.id))});r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:50,clientY:50}));return true})()`);
  const actions=await tray.evaluate(`[...document.querySelectorAll('#task-context-root [role="menuitem"]')].map(x=>x.dataset.action)`);
  assert.deepEqual(actions,['ctx-edit','ctx-add-child','ctx-toggle','ctx-pin','ctx-delete']);
  assert.match(await tray.evaluate("document.querySelector('[data-action=ctx-pin]').textContent"), /置顶/);
  await tray.evaluate(`HTMLMediaElement.prototype.play=()=>Promise.resolve();true`);
  await click(tray,'[data-action="ctx-toggle"]');
  await until(async()=>{const ts=(await invoke(tray,'tasks:list')).tasks;return ts.find(x=>x.id===ids.parent.id)?.completed_at&&ts.find(x=>x.id===ids.child.id)?.completed_at},10000,'context completion');
  await present(tray,`Boolean(document.querySelector('[data-action="show-completed"]'))`,'completed group');
  await present(tray,`Boolean(document.querySelector(${JSON.stringify(row(ids.parent.id))}))`,'completed parent');
  await click(tray,'[data-action="show-completed"]');
  await present(tray,`!document.querySelector(${JSON.stringify(row(ids.parent.id))})`,'collapsed completed tray group');
  await click(tray,'[data-action="show-completed"]');
  await present(tray,`Boolean(document.querySelector(${JSON.stringify(row(ids.parent.id))}))`,'expanded completed tray group');
  await tray.evaluate(`(()=>{window.confirm=()=>false;const r=document.querySelector(${JSON.stringify(row(ids.parent.id))});r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:50,clientY:50}));return true})()`);
  await click(tray,'[data-action="ctx-delete"]');
  await delay(200);
  assert.ok((await invoke(tray,'tasks:list')).tasks.some(x=>x.id===ids.parent.id));
  await tray.evaluate(`(()=>{window.confirm=()=>true;const r=document.querySelector(${JSON.stringify(row(ids.parent.id))});r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:50,clientY:50}));return true})()`);
  await click(tray,'[data-action="ctx-delete"]');
  await until(async()=>!(await invoke(tray,'tasks:list')).tasks.some(x=>x.id===ids.parent.id),10000,'confirmed context deletion');
  assert.ok(!(await invoke(tray,'tasks:list')).tasks.some(x=>x.id===ids.child.id));
  await main.evaluate(`window.toccata.invoke('app:quit').catch(()=>{});true`).catch(()=>{});
  const exited=await timeout(app.done,12000);
  if(!exited){ const pages=await (await fetch(`http://127.0.0.1:${app.port}/json`)).json(); const diagnostics=[]; for(const page of pages.filter(x=>x.url.includes('/renderer/index.html'))){try{const c=await CDP.connect(page.webSocketDebuggerUrl);diagnostics.push(await c.evaluate(`({url:location.href,error:document.querySelector('.error-banner')?.innerText,body:document.body.innerText.slice(0,250)})`));c.close()}catch(e){diagnostics.push(String(e))}} throw Error('application exit timed out '+JSON.stringify(diagnostics)+' '+app.getOutput().slice(-1500)); }
  assert.equal(exited.code,0,app.getOutput().slice(-2000));
});
