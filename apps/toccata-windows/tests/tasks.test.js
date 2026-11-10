'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { TaskStore } = require('../data/tasks');

function fixture(t, start = 1700000000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toccata-tasks-'));
  let clock = start;
  const filename = path.join(dir, 'tasks.sqlite');
  const store = new TaskStore(filename, { now: () => clock });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, filename, setTime: time => { clock = time; } };
}

test('unchanged autosave preserves updated time and does not write another task row', t => {
  const {store,setTime}=fixture(t);
  const task=store.create({title:'稳定编辑',details:'正文',planned_at:1700100000});
  const before=store.db.prepare('SELECT total_changes() AS n').get().n;
  setTime(1700000100);
  const same=store.update(task.id,{title:task.title,details:task.details,planned_at:task.planned_at,priority:task.priority});
  assert.equal(same.updated_at,task.updated_at);
  assert.equal(store.db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(store.update(task.id,{details:'新的正文'}).updated_at,1700000100);
});

test('creates, persists and edits task without changing created time or priority', t => {
  const { store, filename, setTime } = fixture(t);
  const task = store.create({ title: '  任务  ', details: '# hello' });
  assert.equal(task.title, '任务');
  assert.equal(task.planned_at, null);
  assert.equal(task.completed_at, null);
  assert.equal(task.priority, 0);
  assert.equal(task.created_at, 1700000000);
  setTime(1700000005);
  store.setPriority(task.id, 3);
  const edited = store.update(task.id, { title: '编辑', details: 'new', planned_at: 1700100000 });
  assert.equal(edited.priority, 3);
  assert.equal(edited.created_at, 1700000000);
  assert.equal(edited.updated_at, 1700000005);
  const reader = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(reader.prepare('SELECT title FROM tasks WHERE id=?').get(task.id).title, '编辑');
    assert.equal(reader.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  } finally { reader.close(); }
  assert.throws(() => store.create({ title: '  ' }), /不能为空/);
  assert.throws(() => store.setPriority(task.id, 4), /0–3/);
});

test('completion cascades; reopening child restores ancestors but leaves siblings completed', t => {
  const { store, setTime } = fixture(t);
  const parent = store.create({ title: 'parent' });
  const a = store.create({ title: 'a', parent_id: parent.id });
  const b = store.create({ title: 'b', parent_id: parent.id });
  setTime(10);
  store.setCompleted(a.id, true);
  setTime(20);
  store.setCompleted(parent.id, true);
  assert.equal(store.get(a.id).completed_at, 10);
  assert.equal(store.get(b.id).completed_at, 20);
  assert.equal(store.get(parent.id).completed_at, 20);
  setTime(30);
  store.setCompleted(a.id, false);
  assert.equal(store.get(a.id).completed_at, null);
  assert.equal(store.get(parent.id).completed_at, null);
  assert.equal(store.get(b.id).completed_at, 20);
  store.setCompleted(parent.id, true);
  setTime(40);
  const c = store.create({ title: 'c', parent_id: parent.id });
  assert.equal(store.get(parent.id).completed_at, null);
  assert.equal(store.get(c.id).completed_at, null);
  assert.equal(store.get(a.id).completed_at, 30);
  assert.throws(() => store.create({ title: 'too deep', parent_id: c.id }), /不能再创建/);
});

test('subtask ordering includes hidden siblings and rejects crossing completion groups', t => {
  const { store, setTime } = fixture(t);
  const p = store.create({ title: 'parent' });
  setTime(1700000001); const a = store.create({ title: 'a', parent_id: p.id });
  setTime(1700000002); const b = store.create({ title: 'b', parent_id: p.id });
  setTime(1700000003); const c = store.create({ title: 'c', parent_id: p.id });
  assert.deepEqual(store.children(p.id).map(x => x.id), [c.id, b.id, a.id]);
  store.moveSubtask(a.id, c.id, 'before');
  assert.deepEqual(store.children(p.id).map(x => x.id), [a.id, c.id, b.id]);
  assert.deepEqual(store.children(p.id).map(x => x.subtask_order), [0, 1, 2]);
  store.setCompleted(c.id, true);
  assert.throws(() => store.moveSubtask(a.id, c.id, 'after'), /同一完成状态/);
  assert.deepEqual(store.children(p.id).map(x => x.id), [a.id, b.id, c.id]);
});

test('delete cascades both descendants and legacy progress rows', t => {
  const { store } = fixture(t);
  const p = store.create({ title: 'p' });
  const c = store.create({ title: 'c', parent_id: p.id });
  store.db.prepare('INSERT INTO task_progress(id,task_id,text,created_at) VALUES(?,?,?,?)')
    .run('legacy', c.id, 'past', 123);
  store.delete(p.id);
  assert.equal(store.get(c.id), null);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM task_progress').get().n, 0);
});

test('failed child insertion rolls back ancestor reopening', t => {
  const { store } = fixture(t);
  const p = store.create({ title: 'p' });
  store.setCompleted(p.id, true);
  const completedAt = store.get(p.id).completed_at;
  store.db.exec("CREATE TRIGGER reject_child BEFORE INSERT ON tasks WHEN NEW.parent_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'reject'); END");
  assert.throws(() => store.create({ title: 'child', parent_id: p.id }), /reject/);
  assert.equal(store.get(p.id).completed_at, completedAt);
  assert.equal(store.children(p.id).length, 0);
});

test('editing title, details, plan and priority is one atomic transaction', t => {
  const { store, setTime } = fixture(t);
  const task = store.create({ title: 'before', details: 'old' });
  setTime(1700000005);
  assert.throws(() => store.update(task.id, {
    title: 'after', details: 'new', planned_at: 1700000010, priority: 4,
  }), /0–3/);
  let persisted = store.get(task.id);
  assert.equal(persisted.title, 'before');
  assert.equal(persisted.details, 'old');
  assert.equal(persisted.planned_at, null);
  assert.equal(persisted.priority, 0);
  assert.equal(persisted.updated_at, task.updated_at);

  store.db.exec("CREATE TRIGGER reject_priority BEFORE UPDATE ON tasks WHEN NEW.priority=2 BEGIN SELECT RAISE(ABORT,'reject'); END");
  assert.throws(() => store.update(task.id, { title: 'after', priority: 2 }), /reject/);
  persisted = store.get(task.id);
  assert.equal(persisted.title, 'before');
  assert.equal(persisted.priority, 0);

  const updated = store.update(task.id, {
    title: 'after', details: 'new', planned_at: 1700000010, priority: 3,
  });
  assert.deepEqual([updated.title, updated.details, updated.planned_at, updated.priority],
    ['after', 'new', 1700000010, 3]);
});

test('review preserves pending tasks and filters completed timestamps and parent context', t => {
  const { store, setTime } = fixture(t, 1);
  const parent = store.create({ title: 'parent' });
  const child = store.create({ title: 'needle', parent_id: parent.id, details: 'notes' });
  const done = store.create({ title: 'done' });
  const insertProgress = store.db.prepare('INSERT INTO task_progress(id,task_id,text,created_at) VALUES(?,?,?,?)');
  insertProgress.run('p2', done.id, 'second', 9);
  insertProgress.run('p1', done.id, 'first', 7);
  insertProgress.run('pc', child.id, 'pending history', 8);
  setTime(12); store.setCompleted(done.id, true);
  setTime(30); const later = store.create({ title: 'future' });
  let result = store.review({ start: 10, end: 20, now: 25 });
  assert.deepEqual(result.completed.map(x => x.id), [done.id]);
  assert.deepEqual(result.completed[0].progress.map(x => [x.text, x.created_at]), [['first', 7], ['second', 9]]);
  assert.deepEqual(new Set(result.pending.map(x => x.id)), new Set([parent.id, child.id]));
  assert.deepEqual(result.pending.find(x => x.id === child.id).progress.map(x => x.text), ['pending history']);
  assert.deepEqual(result.pending.find(x => x.id === parent.id).progress, []);
  assert.ok(!result.pending.some(x => x.id === later.id));
  result = store.review({ start: 10, end: 20, now: 25, query: 'needle' });
  assert.deepEqual(new Set(result.pending.map(x => x.id)), new Set([parent.id, child.id]));
  assert.equal(result.completed.length, 0);
  result = store.review({ start: 12, end: 12, now: 25 });
  assert.deepEqual(result.completed.map(x => x.id), []);
});

test('review includes start and now but excludes the end boundary', () => {
  let now = 1;
  const store = new TaskStore(':memory:', { now: () => now });
  try {
    const before = store.create({ title: 'before' });
    const start = store.create({ title: 'start' });
    const present = store.create({ title: 'now' });
    const end = store.create({ title: 'end' });
    now = 9; store.setCompleted(before.id, true);
    now = 10; store.setCompleted(start.id, true);
    now = 15; store.setCompleted(present.id, true);
    now = 20; store.setCompleted(end.id, true);
    assert.deepEqual(store.review({ start: 10, end: 20, now: 20 }).completed.map(x => x.id), [present.id, start.id]);
    assert.deepEqual(store.review({ start: 10, end: 20, now: 15 }).completed.map(x => x.id), [present.id, start.id]);
    assert.deepEqual(store.review({ start: 20, end: 21, now: 20 }).completed.map(x => x.id), [end.id]);
  } finally { store.close(); }
});

test('old schema migrates missing columns safely and preserves legacy data', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toccata-old-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'tasks.sqlite');
  const old = new DatabaseSync(filename);
  old.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY NOT NULL,parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,details TEXT NOT NULL DEFAULT '',planned_at REAL,created_at REAL NOT NULL,
    updated_at REAL NOT NULL,completed_at REAL);
    INSERT INTO tasks(id,title,created_at,updated_at) VALUES('old','kept',10,10);`);
  old.close();
  const store = new TaskStore(filename);
  assert.equal(store.get('old').title, 'kept');
  assert.equal(store.get('old').priority, 0);
  assert.equal(store.get('old').subtask_order, null);
  assert.equal(store.get('old').pinned, 0);
  assert.equal(store.get('old').root_order, null);
  store.close();
  const reopened = new TaskStore(filename);
  assert.equal(reopened.get('old').title, 'kept');
  reopened.close();
});

test('pinning a child applies to its root and completion unpins only the completed root', t => {
  const { store } = fixture(t);
  const root = store.create({ title:'root' });
  const child = store.create({ title:'child', parent_id:root.id });
  store.setPriority(root.id, 3);
  assert.equal(store.setPinned(child.id, true).id, root.id);
  assert.equal(store.get(root.id).pinned, 1);
  assert.equal(store.get(child.id).pinned, 0);
  store.setCompleted(child.id, true);
  assert.equal(store.get(root.id).pinned, 1);
  store.setCompleted(root.id, true);
  assert.equal(store.get(root.id).pinned, 0);
  assert.equal(store.get(root.id).priority, 3);
  assert.throws(() => store.setPinned(root.id, true), /已完成/);
  store.setCompleted(root.id, false);
  assert.equal(store.get(root.id).pinned, 0);
  assert.throws(() => store.setPinned(root.id, 1), /布尔值/);
});

test('previous Windows schema migration preserves task contents and parent relationships across reopen', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'toccata-win-migrate-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename=path.join(dir,'tasks.sqlite');
  const old=new DatabaseSync(filename);
  old.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY NOT NULL,parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,details TEXT NOT NULL DEFAULT '',planned_at REAL,created_at REAL NOT NULL,
    updated_at REAL NOT NULL,completed_at REAL,priority INTEGER NOT NULL DEFAULT 0,subtask_order INTEGER);
    INSERT INTO tasks VALUES('p',NULL,'parent','body',12,1,2,NULL,3,NULL);
    INSERT INTO tasks VALUES('c','p','child','details',NULL,3,4,5,1,7);`);
  old.close();
  let store=new TaskStore(filename);
  const before=store.list();
  assert.deepEqual(before.map(x=>[x.id,x.parent_id,x.title,x.details,x.planned_at,x.created_at,x.updated_at,x.completed_at,x.priority,x.subtask_order,x.pinned,x.root_order]),[
    ['p',null,'parent','body',12,1,2,null,3,null,0,null],
    ['c','p','child','details',null,3,4,5,1,7,0,null],
  ]);
  store.close();
  store=new TaskStore(filename);
  assert.deepEqual(store.list(),before);
  store.close();
});

test('failure while unpinning rolls back completion for parent and children', t => {
  const {store}=fixture(t);
  const root=store.create({title:'root'});
  const child=store.create({title:'child',parent_id:root.id});
  store.setPinned(root.id,true);
  store.db.exec("CREATE TRIGGER reject_unpin BEFORE UPDATE OF pinned ON tasks WHEN OLD.pinned=1 AND NEW.pinned=0 BEGIN SELECT RAISE(ABORT,'unpin error'); END");
  assert.throws(()=>store.setCompleted(root.id,true),/unpin error/);
  assert.equal(store.get(root.id).pinned,1);
  assert.equal(store.get(root.id).completed_at,null);
  assert.equal(store.get(child.id).completed_at,null);
});

test('root moves include filtered-out tasks, preserve other roots and reject group crossings', t => {
  const { store, setTime } = fixture(t, 1);
  const a=store.create({title:'A'});
  setTime(2); const b=store.create({title:'B'});
  setTime(3); const c=store.create({title:'C'});
  setTime(4); const d=store.create({title:'D'});
  const child=store.create({title:'child',parent_id:a.id});
  store.moveRoot(a.id,c.id,'before',{sort:'asc',language:'en'});
  const ordered=()=>store.list().filter(x=>!x.parent_id).sort((x,y)=>x.root_order-y.root_order).map(x=>x.title);
  assert.deepEqual(ordered(), ['B','A','C','D']);
  assert.equal(store.get(child.id).root_order,null);
  store.moveRoot(d.id,b.id,'before',{sort:'manual',language:'en'});
  assert.deepEqual(ordered(), ['D','B','A','C']);
  store.setPinned(b.id,true);
  assert.throws(()=>store.moveRoot(a.id,b.id,'before',{sort:'manual'}),/置顶组/);
  store.setCompleted(c.id,true);
  assert.throws(()=>store.moveRoot(a.id,c.id,'before',{sort:'manual'}),/完成状态/);
  assert.throws(()=>store.moveRoot(child.id,a.id,'before'),/主任务/);
  assert.throws(()=>store.moveRoot(a.id,d.id,'before',{sort:'bad'}),/排序方式/);
});

test('failure during root reorder rolls back all rank changes', t => {
  const {store,setTime}=fixture(t,1);
  const a=store.create({title:'A'});
  setTime(2); const b=store.create({title:'B'});
  store.db.exec("CREATE TRIGGER reject_rank BEFORE UPDATE OF root_order ON tasks WHEN NEW.title='B' BEGIN SELECT RAISE(ABORT,'rank error'); END");
  assert.throws(()=>store.moveRoot(a.id,b.id,'after',{sort:'asc'}),/rank error/);
  assert.equal(store.get(a.id).root_order,null);
  assert.equal(store.get(b.id).root_order,null);
});
