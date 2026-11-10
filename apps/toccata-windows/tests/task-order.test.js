'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compareChildren, compareRoots } = require('../renderer/task-order');

const task = (id, values = {}) => ({ id, title: id, created_at: 10, completed_at: null, subtask_order: null, ...values });
const ids = (tasks, comparator) => [...tasks].sort(comparator).map(item => item.id);

test('workspace uses the same chosen root order for pending and completed groups', () => {
  const tasks = [
    task('old-completed-late', { created_at: 1, completed_at: 90 }),
    task('new-completed-early', { created_at: 30, completed_at: 60 }),
    task('older-pending', { created_at: 5 }),
    task('newer-pending', { created_at: 20 }),
  ];
  assert.deepEqual(ids(tasks, compareRoots), ['newer-pending', 'older-pending', 'new-completed-early', 'old-completed-late']);
  assert.deepEqual(ids(tasks, (a, b) => compareRoots(a, b, { sort: 'asc' })), ['older-pending', 'newer-pending', 'old-completed-late', 'new-completed-early']);
});

test('pinned tasks precede ordinary tasks within a completion group; manual and planned modes keep stable ties', () => {
  const roots=[task('ordinary-new',{created_at:20}),task('pinned',{pinned:1,created_at:2,root_order:3}),task('unranked',{created_at:15}),task('rank-1',{root_order:1,planned_at:20}),task('rank-0',{root_order:0,planned_at:10}),task('done',{completed_at:1,pinned:1})];
  assert.deepEqual(ids(roots,(a,b)=>compareRoots(a,b,{sort:'manual'})),['pinned','ordinary-new','unranked','rank-0','rank-1','done']);
  assert.deepEqual(ids(roots,(a,b)=>compareRoots(a,b,{sort:'planned'})),['pinned','rank-0','rank-1','ordinary-new','unranked','done']);
});

test('equal root dates have deterministic ID order and epoch zero is completed', () => {
  const tasks = [task('pending-b'), task('epoch-b', { completed_at: 0 }), task('pending-a'), task('epoch-a', { completed_at: 0 })];
  assert.deepEqual(ids(tasks, compareRoots), ['pending-a', 'pending-b', 'epoch-a', 'epoch-b']);
  assert.deepEqual(ids(tasks, (a, b) => compareRoots(a, b, { mode: 'tray', sort: 'asc' })), ['pending-a', 'pending-b', 'epoch-a', 'epoch-b']);
  assert.equal(compareRoots(tasks[0], tasks[0]), 0);
});

test('tray root sort choices apply within pending and completed groups', () => {
  const tasks = [
    task('pending-old', { created_at: 1 }), task('pending-new', { created_at: 20 }),
    task('done-new', { created_at: 30, completed_at: 40 }), task('done-old', { created_at: 2, completed_at: 50 }),
  ];
  assert.deepEqual(ids(tasks, (a, b) => compareRoots(a, b, { mode: 'tray', sort: 'desc' })), ['pending-new', 'pending-old', 'done-new', 'done-old']);
  assert.deepEqual(ids(tasks, (a, b) => compareRoots(a, b, { mode: 'tray', sort: 'asc' })), ['pending-old', 'pending-new', 'done-old', 'done-new']);
});

test('tray title order is natural in Chinese and English with ID ties', () => {
  for (const [language, label] of [['zh', '任务'], ['en', 'Task ']]) {
    const tasks = [
      task('ten', { title: label + '10' }), task('two-b', { title: label + '2' }),
      task('done-two', { title: label + '2', completed_at: 0 }),
      task('two-a', { title: label + '2' }), task('done-ten', { title: label + '10', completed_at: 1 }),
    ];
    assert.deepEqual(ids(tasks, (a, b) => compareRoots(a, b, { mode: 'tray', sort: 'title', language })), ['two-a', 'two-b', 'ten', 'done-two', 'done-ten']);
  }
});

test('children use saved ranks, newest unranked first, then stable ID ties', () => {
  const tasks = [
    task('ranked-second', { created_at: 30, subtask_order: 1 }),
    task('legacy', { created_at: 5 }), task('new-child', { created_at: 40 }),
    task('ranked-first', { created_at: 1, subtask_order: 0 }),
    task('tie-b', { created_at: 10 }), task('tie-a', { created_at: 10 }),
    task('done', { created_at: 50, completed_at: 90 }),
  ];
  assert.deepEqual(ids(tasks, compareChildren), ['new-child', 'tie-a', 'tie-b', 'legacy', 'ranked-first', 'ranked-second', 'done']);
  assert.equal(compareChildren(tasks[0], tasks[0]), 0);
});

test('completed children retain sibling order rather than using completion dates', () => {
  const tasks = [
    task('rank-zero', { subtask_order: 0, created_at: 1, completed_at: 0 }),
    task('rank-one', { subtask_order: 1, created_at: 30, completed_at: 90 }),
    task('unranked-older', { created_at: 2, completed_at: 100 }),
    task('unranked-newer', { created_at: 40, completed_at: 50 }),
    task('pending', { subtask_order: 100 }),
  ];
  assert.deepEqual(ids(tasks, compareChildren), ['pending', 'unranked-newer', 'unranked-older', 'rank-zero', 'rank-one']);
});

test('completing and reopening a child preserves its manual rank and sibling order', () => {
  const a = task('a', { subtask_order: 0, created_at: 1 });
  const b = task('b', { subtask_order: 1, created_at: 2 });
  const c = task('c', { subtask_order: 2, created_at: 3 });
  assert.deepEqual(ids([c, a, b], compareChildren), ['a', 'b', 'c']);
  const completedA = { ...a, completed_at: 100 };
  assert.deepEqual(ids([c, completedA, b], compareChildren), ['b', 'c', 'a']);
  const reopenedA = { ...completedA, completed_at: null };
  assert.deepEqual(ids([c, reopenedA, b], compareChildren), ['a', 'b', 'c']);
  assert.equal(reopenedA.subtask_order, 0);
});

test('comparators ignore priority and update timestamps and never mutate records', () => {
  const tasks = [
    Object.freeze(task('b', { priority: 3, updated_at: 999, created_at: 10 })),
    Object.freeze(task('a', { priority: 0, updated_at: 1, created_at: 10 })),
  ];
  const before = JSON.stringify(tasks);
  assert.deepEqual(ids(tasks, compareRoots), ['a', 'b']);
  assert.deepEqual(ids(tasks, compareChildren), ['a', 'b']);
  assert.equal(JSON.stringify(tasks), before);
});

test('the browser global exports the same ordering contract without Node integration', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../renderer/task-order.js'), 'utf8'), { window, Intl });
  assert.equal(typeof window.ToccataTaskOrder.compareChildren, 'function');
  assert.equal(typeof window.ToccataTaskOrder.compareRoots, 'function');
  const records = [task('b'), task('a')];
  assert.deepEqual(ids(records, window.ToccataTaskOrder.compareChildren), ['a', 'b']);
  assert.deepEqual(ids(records, window.ToccataTaskOrder.compareRoots), ['a', 'b']);
});
