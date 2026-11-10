'use strict';

// Exercises a real Electron renderer/preload/main/SQLite path using synthetic
// data only. Capture is disabled, and every run has a fresh temporary profile.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const path = require('node:path');

const project = path.resolve(__dirname, '..');
const requestedPackage = process.env.TOCCATA_TEST_PACKAGE;
if (requestedPackage !== undefined) {
  // A drive-less rooted path (e.g. \\foo.exe) depends on the current drive
  // and is therefore not a fully qualified Windows executable path.
  const fullyQualified = /^[a-zA-Z]:[\\/]/.test(requestedPackage) ||
    /^\\\\[^\\/]+[\\/][^\\/]+[\\/]/.test(requestedPackage);
  if (!fullyQualified || path.win32.extname(requestedPackage).toLowerCase() !== '.exe' ||
      /[\x00-\x1f]/.test(requestedPackage)) {
    throw new TypeError('TOCCATA_TEST_PACKAGE must be an absolute Windows .exe path');
  }
}
const electron = requestedPackage === undefined
  ? path.join(project, 'dist', 'win-unpacked', 'Toccata.exe')
  : requestedPackage;
const tempRoot = 'G:\\DevTools\\temp';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withTimeout(promise, ms, fallback) {
  let timer;
  try { return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })]); }
  finally { clearTimeout(timer); }
}

async function until(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    });
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'));
      this.pending.clear();
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    const opened = await withTimeout(new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once:true });
        ws.addEventListener('error', () => reject(new Error('CDP connection error')), { once:true });
      }), 5000, null);
    if (!opened) throw new Error('CDP connection timeout');
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

async function launch(dataDir) {
  const env = { ...process.env, TOCCATA_DATA_DIR:dataDir, TOCCATA_DISABLE_CAPTURE:'1', TEMP:tempRoot, TMP:tempRoot, TMPDIR:tempRoot, APPDATA:dataDir, LOCALAPPDATA:dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TOCCATA_QA_SCREENSHOT;
  const proc = spawn(electron, ['--remote-debugging-port=0', '--remote-allow-origins=*', '--disable-gpu'], {
    cwd: project, env, stdio:['ignore','pipe','pipe'], windowsHide:true,
  });
  let output = '', exited = false, spawnError;
  proc.stdout.on('data', chunk => { output += chunk; });
  proc.stderr.on('data', chunk => { output += chunk; });
  proc.on('error', error => { spawnError = error; });
  const exitedPromise = new Promise(resolve => proc.once('close', (code, signal) => { exited = true; resolve({code,signal}); }));
  try {
    const port = await until(() => {
      if (spawnError) throw spawnError;
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) return Number(match[1]);
      if (exited) throw new Error(`Electron exited early: ${output.slice(-3000)}`);
    }, 20000, 'DevTools startup');
    const target = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      return targets.find(t => t.type === 'page' && t.url.startsWith('file:') &&
        t.url.includes('/renderer/index.html') && !t.url.includes('?view=tray') && t.webSocketDebuggerUrl);
    }, 15000, 'main renderer');
    const client = await CDP.connect(target.webSocketDebuggerUrl);
    await until(() => client.evaluate('Boolean(window.toccata && window.toccata.invoke)'), 10000, 'preload bridge');
    return { proc, client, exitedPromise, getOutput:() => output };
  } catch (error) {
    if (!exited) proc.kill();
    await withTimeout(exitedPromise, 3000, null);
    throw error;
  }
}

async function invoke(client, channel, payload = {}) {
  return client.evaluate(`window.toccata.invoke(${JSON.stringify(channel)}, ${JSON.stringify(payload)})`);
}

async function closeApp(instance) {
  // The main process may destroy the renderer before its invoke response comes back.
  try { await instance.client.evaluate("(()=>{window.toccata.invoke('app:quit').catch(()=>{});return true})()"); } catch (_) {}
  const exit = await withTimeout(instance.exitedPromise, 8000, null);
  instance.client.close();
  if (!exit) {
    instance.proc.kill();
    await withTimeout(instance.exitedPromise, 3000, null);
    throw new Error('Electron did not exit gracefully');
  }
  assert.equal(exit.code, 0, `Electron exit failure: ${instance.getOutput().slice(-3000)}`);
}

test('packaged executable bridge writes tasks, reads stats, exits and preserves data after restart', { timeout:60000 }, async t => {
  assert.ok(fs.existsSync(electron), 'Packaged executable missing; run npm run pack');
  fs.mkdirSync(tempRoot, { recursive:true });
  const dataDir = fs.mkdtempSync(path.join(tempRoot, 'toccata-packaged-smoke-'));
  const safeRoot = path.resolve(tempRoot) + path.sep;
  assert.ok(path.resolve(dataDir).startsWith(safeRoot), 'temporary directory must remain inside the G: test root');
  let instance;
  t.after(async () => {
    if (instance) {
      try { instance.client.close(); } catch (_) {}
      instance.proc.kill();
      await withTimeout(instance.exitedPromise, 3000, null);
    }
    fs.rmSync(dataDir, { recursive:true, force:true });
  });
  instance = await launch(dataDir);
  assert.equal((await invoke(instance.client, 'capture:status')).state, 'disabled');
  assert.deepEqual((await invoke(instance.client, 'tasks:list')).tasks, []);
  const created = await invoke(instance.client, 'tasks:create', { title:'测试任务', details:'original' });
  assert.ok(created.id);
  const edited = await invoke(instance.client, 'tasks:update', {
    id:created.id, title:'更新后的任务', details:'synthetic', priority:2,
  });
  assert.equal(edited.title, '更新后的任务');
  assert.equal(edited.priority, 2);
  const child = await invoke(instance.client, 'tasks:create', { title:'测试子任务', parent_id:created.id });
  const pinned = await invoke(instance.client, 'tasks:pin', { id:child.id, pinned:true });
  assert.equal(pinned.id, created.id);
  assert.equal(pinned.pinned, 1);
  assert.equal(pinned.priority, 2);
  const completed = await invoke(instance.client, 'tasks:toggle', { id:created.id });
  assert.ok(Number.isFinite(completed.completed_at));
  assert.equal(completed.pinned, 0);
  const now = Date.now();
  const stats = await invoke(instance.client, 'stats:query', { start_ms:now-86400000, end_ms:now+86400000 });
  assert.equal(stats.key_count, 0);
  assert.equal(stats.active_ms, 0);
  await closeApp(instance);
  instance = null;

  instance = await launch(dataDir);
  assert.equal((await invoke(instance.client, 'capture:status')).state, 'disabled');
  const restored = (await invoke(instance.client, 'tasks:list')).tasks.find(task => task.id === created.id);
  assert.ok(restored, 'task missing after application restart');
  assert.equal(restored.title, '更新后的任务');
  assert.equal(restored.details, 'synthetic');
  assert.equal(restored.priority, 2);
  assert.equal(restored.completed_at, completed.completed_at);
  const reopened = await invoke(instance.client, 'tasks:toggle', { id:created.id });
  assert.equal(reopened.completed_at, null);
  const other = await invoke(instance.client, 'tasks:create', { title:'另一测试任务' });
  await invoke(instance.client, 'tasks:move', { sourceId:other.id, targetId:created.id, placement:'before', sort:'desc', language:'zh' });
  const roots = (await invoke(instance.client, 'tasks:list')).tasks.filter(task=>task.parent_id===null);
  assert.ok(roots.find(task=>task.id===other.id).root_order < roots.find(task=>task.id===created.id).root_order);
  await closeApp(instance);
  instance = null;
});


