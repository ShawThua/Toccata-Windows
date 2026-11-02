'use strict';
// Real renderer/preload/IPC/SQLite; invented records, disabled capture and mocked
// OS services. DragEvent/DataTransfer exercise renderer handlers, not a physical drag.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { TaskStore } = require('../data/tasks');
const project = path.resolve(__dirname, '..');
const tempRoot = path.resolve(project, '..', '..', '.qa-temp');
const proof = path.join(tempRoot, 'task-order-ui-proof');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function timeout(work, ms) {
  let timer;
  try { return await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}
async function until(fn, ms = 10000, label = 'condition') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(60);
  }
  throw Error(`${label} timed out${last ? ': ' + last.message : ''}`);
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', event => {
      const result = JSON.parse(event.data), pending = this.pending.get(result.id);
      if (!pending) return;
      this.pending.delete(result.id);
      result.error ? pending.reject(Error(result.error.message)) : pending.resolve(result.result);
    });
    ws.addEventListener('close', () => { for (const pending of this.pending.values()) pending.reject(Error('CDP closed')); this.pending.clear(); });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    const opened = await timeout(new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(true), { once: true });
      ws.addEventListener('error', () => reject(Error('CDP failed')), { once: true });
    }), 5000);
    if (!opened) throw Error('CDP connection timeout');
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}
const invoke = (client, channel, payload = {}) => client.evaluate(`window.toccata.invoke(${JSON.stringify(channel)},${JSON.stringify(payload)})`);
const click = (client, selector) => client.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing '+${JSON.stringify(selector)});node.click();return true})()`);
async function launch(dir) {
  const env = { ...process.env, TOCCATA_DATA_DIR: dir, TOCCATA_DISABLE_CAPTURE: '1', TEMP: dir, TMP: dir, APPDATA: dir, LOCALAPPDATA: dir };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'TOCCATA_QA_HELPER_EXE', 'TOCCATA_QA_HELPER_SCRIPT', 'TOCCATA_QA_MEMORY', 'TOCCATA_QA_SCREENSHOT']) delete env[key];
  const proc = spawn(path.join(project, 'node_modules/electron/dist/electron.exe'), ['--remote-debugging-port=0', '--remote-allow-origins=*', '--disable-gpu', path.join(__dirname, 'task-order-harness.cjs')], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  proc.stdout.on('data', value => { output += value; }); proc.stderr.on('data', value => { output += value; });
  const done = new Promise(resolve => proc.once('close', code => resolve(code)));
  try {
    const port = await until(() => {
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) return Number(match[1]);
      if (proc.exitCode !== null) throw Error(output.slice(-2000));
    }, 20000, 'Electron startup');
    const target = predicate => until(async () => {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl && predicate(page.url));
    }, 10000, 'renderer');
    const main = await CDP.connect((await target(url => url.includes('/renderer/index.html') && !url.includes('?'))).webSocketDebuggerUrl);
    await until(() => main.evaluate('Boolean(document.querySelector("#new-task")&&window.toccata?.invoke)'), 10000, 'main ready');
    assert.equal((await invoke(main, 'capture:status')).state, 'disabled');
    const tray = await CDP.connect((await target(url => url.includes('view=tray'))).webSocketDebuggerUrl);
    await until(() => tray.evaluate('Boolean(document.querySelector(".tray")&&window.toccata?.invoke)'));
    return { proc, done, main, tray, target, getOutput: () => output };
  } catch (error) {
    proc.kill(); await timeout(done, 2500);
    throw Error(error.message + '\n' + output.slice(-2000));
  }
}
async function quit(app) {
  await app.main.evaluate("window.toccata.invoke('app:quit').catch(()=>{});true");
  assert.equal(await timeout(app.done, 10000), 0, app.getOutput().slice(-2000));
  app.main.close(); app.tray.close();
}
function seed(dir) {
  const store = new TaskStore(path.join(dir, 'tasks.sqlite'));
  const today = new Date(), start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1000;
  const elapsed = Date.now() / 1000 - start, at = fraction => start + elapsed * fraction;
  const insert = store.db.prepare('INSERT INTO tasks(id,parent_id,title,details,planned_at,created_at,updated_at,completed_at,priority,subtask_order) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const add = (id, title, fraction, { parent = null, done = null, rank = null, priority = 0 } = {}) => insert.run(id, parent, title, '隔离排序测试正文', at(.5), at(fraction), at(fraction), done === null ? null : at(done), priority, rank);
  add('root-old', '完成任务10', .10, { done: .90 }); add('root-new', '完成任务2', .40, { done: .70 });
  add('parent', '用于检查返回父任务按钮的很长父任务名称：合成任务与日期、排序和保存验证'.repeat(3), .20);
  add('other-parent', '其他主任务', .30);
  add('child-old', '可见 较早子任务', .22, { parent: 'parent' });
  add('child-hidden', '隐藏兄弟任务', .23, { parent: 'parent' });
  add('child-new', '可见 较新子任务', .24, { parent: 'parent', priority: 3 });
  add('child-b', '同时间子任务B', .25, { parent: 'parent' }); add('child-a', '同时间子任务A', .25, { parent: 'parent' });
  add('child-rank0', '手动排第一', .26, { parent: 'parent', rank: 0 }); add('child-rank1', '手动排第二', .27, { parent: 'parent', rank: 1 });
  add('child-done', '已完成子任务', .28, { parent: 'parent', done: .80 });
  add('outsider', '其他父任务的子任务', .31, { parent: 'other-parent' });
  store.db.exec('CREATE TABLE qa_order_writes(task_id TEXT); CREATE TRIGGER qa_order_update AFTER UPDATE ON tasks BEGIN INSERT INTO qa_order_writes VALUES(NEW.id); END');
  store.close();
  return { children: ['child-a', 'child-b', 'child-new', 'child-hidden', 'child-old', 'child-rank0', 'child-rank1', 'child-done'], reordered: ['child-a', 'child-b', 'child-old', 'child-new', 'child-hidden', 'child-rank0', 'child-rank1', 'child-done'] };
}
function writeCount(dir) {
  const db = new DatabaseSync(path.join(dir, 'tasks.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT COUNT(*) AS count FROM qa_order_writes').get().count; } finally { db.close(); }
}
async function roots(client, scope) {
  return client.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' .task-row')})).filter(row=>!row.classList.contains('child')).map(row=>row.dataset.id)`);
}
async function rows(client, scope, wanted) {
  return client.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' .task-row')})).map(row=>row.dataset.id).filter(id=>${JSON.stringify(wanted)}.includes(id))`);
}
async function assertOrder(client, scope, wanted, label) {
  await until(async () => JSON.stringify(await rows(client, scope, wanted)) === JSON.stringify(wanted), 10000, label);
}
async function navigate(client, page) {
  await click(client, `[data-page="${page}"]`);
  await until(() => client.evaluate(`document.querySelector('[data-page="${page}"]')?.classList.contains('selected')&&Boolean(document.querySelector('#left'))`), 10000, page + ' page');
}
async function select(client, id) {
  await click(client, `#left .task-row[data-id="${id}"]`);
  await until(() => client.evaluate(`document.querySelector('#details-frame')?.dataset.task===${JSON.stringify(id)}&&Boolean(document.querySelector('#details-frame')?.contentDocument?.querySelector('#editor'))`), 10000, 'selected ' + id);
  await delay(100);
}
async function change(client, selector, value) {
  await client.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing control');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await delay(80);
}
async function search(client, value) {
  await client.evaluate(`(()=>{const input=document.querySelector('#search');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();return true})()`);
  await delay(120);
}
async function openEditor(app, id) {
  await invoke(app.main, 'app:open-editor', { id });
  const editor = await CDP.connect((await app.target(url => url.includes('view=editor') && new URL(url).searchParams.get('id') === id)).webSocketDebuggerUrl);
  await until(() => editor.evaluate(`document.querySelector('#details-frame')?.dataset.task===${JSON.stringify(id)}&&Boolean(document.querySelector('#details-frame')?.contentDocument?.querySelector('#editor'))`));
  return editor;
}
async function screenshot(client, name) {
  await client.send('Page.bringToFront'); await delay(180);
  const image = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  fs.writeFileSync(path.join(proof, name + '.png'), Buffer.from(image.data, 'base64'));
}
async function measureControls(client, floating) {
  return client.evaluate(`(()=>{const floating=${floating},bar=document.querySelector(floating?'.floating-bar':'.detail-bar'),pane=document.querySelector(floating?'.floating-editor':'#detail');const toRect=node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};const controls=[...bar.querySelectorAll('.priority-control,.task-save-button,[data-action="delete"]')].map(node=>({name:node.classList.contains('priority-control')?'priority':node.dataset.action,...toRect(node)}));const parent=document.querySelector('.task-parent-link'),status=document.querySelector('#save-status');return{dpr:devicePixelRatio,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,pane:toRect(pane),bar:toRect(bar),parent:parent?toRect(parent):null,status:status?{text:status.textContent.trim(),clientWidth:status.clientWidth,scrollWidth:status.scrollWidth,...toRect(status)}:null,controls}})()`);
}
function assertControls(layout) {
  assert.equal(layout.dpr, 2); assert.ok(layout.documentWidth <= layout.width + 1, 'horizontal page overflow');
  assert.equal(layout.status?.text, '已保存', 'save status must show its complete saved message');
  assert.ok(layout.status.width > 0 && layout.status.scrollWidth <= layout.status.clientWidth, 'save status text must fit without truncation');
  assert.equal(layout.controls.length, 3, 'priority, save and delete controls must be visible');
  for (const control of layout.controls) {
    assert.ok(control.width > 0 && control.height > 0);
    assert.ok(control.left >= layout.bar.left - 1 && control.right <= layout.bar.right + 1, control.name + ' must fit header');
    assert.ok(control.top >= layout.bar.top - 1 && control.bottom <= layout.bar.bottom + 1, control.name + ' must fit vertically');
  }
  for (let i = 0; i < layout.controls.length; i++) for (let j = i + 1; j < layout.controls.length; j++) {
    const a = layout.controls[i], b = layout.controls[j];
    assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1, 'header controls must not overlap');
  }
  assert.ok(layout.parent && layout.parent.width > 0, 'child needs its parent link');
  assert.ok(layout.parent.left >= layout.pane.left - 1 && layout.parent.right <= layout.pane.right + 1, 'long parent link must fit pane');
  assert.ok(layout.parent.top >= 0 && layout.parent.bottom <= layout.height, 'parent link must be reachable');
}
async function drag(client, sourceId, targetId, { valid, drop = true } = {}) {
  const result = await client.evaluate(`(()=>{const source=document.querySelector('#left .task-row[data-id="${sourceId}"]'),target=document.querySelector('#left .task-row[data-id="${targetId}"]');if(!source||!target)throw Error('Missing drag row');const transfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));const rect=target.getBoundingClientRect(),event=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+rect.height*.25});target.dispatchEvent(event);window.__orderDrag={source,target,transfer,y:rect.top+rect.height*.25};return{sourceMarked:source.classList.contains('dragging'),accepted:event.defaultPrevented,before:target.classList.contains('drop-before'),after:target.classList.contains('drop-after')}})()`);
  assert.equal(result.sourceMarked, true); assert.equal(result.accepted, valid); assert.equal(result.before, valid); assert.equal(result.after, false);
  if (drop) await client.evaluate(`(()=>{const d=window.__orderDrag;d.target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d.transfer,clientY:d.y}));return true})()`);
  return result;
}

test('task ordering, synthetic drag persistence and compact editor controls agree across real Electron views', { timeout: 180000 }, async t => {
  fs.mkdirSync(tempRoot, { recursive: true }); fs.mkdirSync(proof, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tempRoot, 'task-order-ui-'));
  assert.equal(path.dirname(dir), tempRoot);
  const fixture = seed(dir), report = { syntheticOnly: true, captureDisabled: true, physicalDragTested: false, views: [], geometry: [] };
  let app, editor;
  t.after(async () => {
    try { editor?.close(); } catch (_) {}
    if (app?.proc.exitCode === null) { app.proc.kill(); await timeout(app.done, 2500); }
    for (const client of [app?.main, app?.tray]) try { client?.close(); } catch (_) {}
    assert.equal(path.dirname(path.resolve(dir)), tempRoot); fs.rmSync(dir, { recursive: true, force: true });
  });
  app = await launch(dir); let main = app.main, tray = app.tray;
  for (const page of ['tasks', 'inbox', 'calendar']) {
    await navigate(main, page); await assertOrder(main, '#left', ['root-old', 'root-new'], page + ' completed roots');
    report.views.push({ page, completedRoots: await rows(main, '#left', ['root-old', 'root-new']) });
  }
  await click(tray, '[data-action="tray-page"][data-value="tasks"]');
  await change(tray, '#tray-sort', 'asc');
  await assertOrder(tray, '.tray-scroll', ['parent', 'other-parent'], 'tray ascending pending roots');
  await assertOrder(tray, '.tray-scroll', ['root-old', 'root-new'], 'tray ascending completed roots');
  await change(tray, '#tray-sort', 'title');
  await assertOrder(tray, '.tray-scroll', ['root-new', 'root-old'], 'tray natural title completed roots');
  await click(tray, '[data-action="tray-page"][data-value="calendar"]');
  await assertOrder(tray, '.tray-scroll', ['root-old', 'root-new'], 'tray calendar ignores title sort');
  await assertOrder(tray, '.tray-scroll', ['other-parent', 'parent'], 'tray calendar default pending order');
  report.views.push({ page: 'tray-calendar-after-title', completedRoots: await rows(tray, '.tray-scroll', ['root-old', 'root-new']) });
  await click(tray, '[data-action="tray-page"][data-value="tasks"]');
  assert.equal(await tray.evaluate('document.querySelector("#tray-sort").value'), 'title');
  await change(tray, '#tray-sort', 'asc'); await click(tray, '[data-action="tray-page"][data-value="calendar"]');
  await assertOrder(tray, '.tray-scroll', ['other-parent', 'parent'], 'tray calendar ignores ascending sort');
  await navigate(main, 'inbox'); await select(main, 'parent');
  await assertOrder(main, '#left', fixture.children, 'main child order'); await assertOrder(main, '#detail', fixture.children, 'detail child order');
  editor = await openEditor(app, 'parent'); await assertOrder(editor, '.floating-content', fixture.children, 'floating child order');
  report.views.push({ page: 'detail-and-floating', children: fixture.children });
  editor.close(); editor = null; await invoke(main, 'app:close-editor');
  await select(main, 'child-new'); editor = await openEditor(app, 'child-new');
  await main.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 2, mobile: false });
  await editor.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 2, mobile: false });
  for (const theme of ['light', 'dark']) {
    await invoke(main, 'settings:set', { key: 'theme', value: theme });
    await until(() => main.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`));
    await until(() => editor.evaluate(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`));
    await delay(150);
    for (const [client, floating, name] of [[main, false, 'main-narrow'], [editor, true, 'floating-400']]) {
      const layout = await measureControls(client, floating); assertControls(layout);
      report.geometry.push({ theme, name, ...layout }); await screenshot(client, name + '-' + theme + '-200');
    }
  }
  await main.send('Emulation.clearDeviceMetricsOverride');
  editor.close(); editor = null; await invoke(main, 'app:close-editor');
  await search(main, '可见');
  await assertOrder(main, '#left', ['child-new', 'child-old'], 'filtered children');
  assert.equal(await main.evaluate('Boolean(document.querySelector("#left .task-row[data-id=child-hidden]"))'), false);
  const beforeMove = (await invoke(main, 'tasks:list')).tasks;
  report.drag = await drag(main, 'child-old', 'child-new', { valid: true });
  await until(async () => (await invoke(main, 'tasks:list')).tasks.find(task => task.id === 'child-old')?.subtask_order === 2, 10000, 'real move IPC persisted');
  await search(main, ''); await assertOrder(main, '#left', fixture.reordered, 'all siblings preserved after filtered drag');
  const afterMove = (await invoke(main, 'tasks:list')).tasks, originalById = new Map(beforeMove.map(task => [task.id, task]));
  for (const task of afterMove) {
    const { subtask_order: ignored, ...unchanged } = task, { subtask_order: previous, ...original } = originalById.get(task.id);
    assert.deepEqual(unchanged, original, 'move must only change sibling ranks');
  }
  const validWrites = writeCount(dir); assert.equal(validWrites, 7, 'all seven same-group siblings, including hidden ones, must receive ranks');
  for (const target of ['outsider', 'child-done']) {
    await drag(main, 'child-old', target, { valid: false }); await delay(180);
    assert.equal(await main.evaluate('document.querySelectorAll(".drop-before,.drop-after,.dragging").length'), 0, 'invalid drop must clear visual markers');
    assert.equal(writeCount(dir), validWrites, 'invalid renderer move must not write');
    await assert.rejects(invoke(main, 'tasks:move', { sourceId: 'child-old', targetId: target, placement: 'before' }), /同一主任务|同一完成状态/);
    assert.equal(writeCount(dir), validWrites, 'backend must reject the same invalid move without writes');
  }
  assert.deepEqual((await invoke(main, 'tasks:list')).tasks, afterMove);
  report.drag = { ...report.drag, validWrites, hiddenSiblingIncluded: true, invalidParentAndStatusNoMarkerOrWrites: true };
  await quit(app); app = null;
  app = await launch(dir); main = app.main; tray = app.tray;
  await navigate(main, 'inbox'); await select(main, 'parent');
  await assertOrder(main, '#left', fixture.reordered, 'main order after restart'); await assertOrder(main, '#detail', fixture.reordered, 'detail order after restart');
  editor = await openEditor(app, 'parent'); await assertOrder(editor, '.floating-content', fixture.reordered, 'floating order after restart');
  assert.equal(writeCount(dir), validWrites, 'restart and clean render must not rewrite tasks');
  report.restartPersistence = true; report.appUnderTest = process.env.TOCCATA_ORDER_TEST_APP ? 'specified ASAR/application' : 'source';
  fs.writeFileSync(path.join(proof, 'report.json'), JSON.stringify(report, null, 2));
  editor.close(); editor = null; await quit(app); app = null;
  t.diagnostic('Synthetic drag and DPI screenshots: ' + proof);
});
