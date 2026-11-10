'use strict';

// Task timestamps are Unix seconds, matching the upstream tasks.sqlite contract.
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { compareRoots } = require('../renderer/task-order');

const TASK_COLUMNS = 'id,parent_id,title,details,planned_at,created_at,updated_at,completed_at,priority,subtask_order,pinned,root_order';

function validatedTitle(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('任务名称不能为空');
  return value.trim();
}

function timestamp(value, name, nullable = false) {
  if (nullable && value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} 必须为 Unix 秒`);
  return value;
}

// Upstream's NULL order sorts ahead of all explicitly ordered children.
function compareChildren(a, b) {
  const completion = Number(a.completed_at !== null) - Number(b.completed_at !== null);
  if (completion) return completion;
  const order = (a.subtask_order ?? -1) - (b.subtask_order ?? -1);
  if (order) return order;
  if (a.created_at !== b.created_at) return b.created_at - a.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

class TaskStore {
  constructor(filename, { now = () => Date.now() / 1000 } = {}) {
    if (typeof filename !== 'string' || !filename) throw new TypeError('缺少任务数据库路径');
    if (typeof now !== 'function') throw new TypeError('now 必须是函数');
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.now = now;
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec('PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
      this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY NOT NULL,
          parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
          title TEXT NOT NULL CHECK(length(trim(title)) > 0),
          details TEXT NOT NULL DEFAULT '', planned_at REAL, created_at REAL NOT NULL,
          updated_at REAL NOT NULL, completed_at REAL, priority INTEGER NOT NULL DEFAULT 0,
          subtask_order INTEGER, pinned INTEGER NOT NULL DEFAULT 0, root_order INTEGER
        )`);
        const columns = new Set(this.db.prepare('PRAGMA table_info(tasks)').all().map(x => x.name));
        if (!columns.has('priority')) this.db.exec('ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
        if (!columns.has('subtask_order')) this.db.exec('ALTER TABLE tasks ADD COLUMN subtask_order INTEGER');
        if (!columns.has('pinned')) this.db.exec('ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
        if (!columns.has('root_order')) this.db.exec('ALTER TABLE tasks ADD COLUMN root_order INTEGER');
        this.db.exec(`CREATE INDEX IF NOT EXISTS task_parent ON tasks(parent_id);
          CREATE INDEX IF NOT EXISTS task_completed ON tasks(completed_at);
          CREATE TABLE IF NOT EXISTS task_progress (
            id TEXT PRIMARY KEY NOT NULL,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            text TEXT NOT NULL CHECK(length(trim(text)) > 0), created_at REAL NOT NULL
          );
          CREATE INDEX IF NOT EXISTS progress_task ON task_progress(task_id,created_at);`);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* preserve original error */ }
      throw error;
    }
  }

  currentTime() { return timestamp(this.now(), 'now'); }
  list() { return this.db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY created_at ASC,rowid ASC`).all(); }
  get(id) { return this.db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id=?`).get(id) ?? null; }
  children(parentId) { return this.list().filter(task => task.parent_id === parentId).sort(compareChildren); }
  requireTask(id) {
    const task = this.get(id);
    if (!task) throw new Error('任务不存在');
    return task;
  }
  reopenAncestors(id, at) {
    this.db.prepare(`WITH RECURSIVE ancestors(id,parent_id) AS (
      SELECT id,parent_id FROM tasks WHERE id=?
      UNION ALL SELECT tasks.id,tasks.parent_id FROM tasks JOIN ancestors ON tasks.id=ancestors.parent_id
    ) UPDATE tasks SET completed_at=NULL,updated_at=?
      WHERE id IN (SELECT id FROM ancestors) AND completed_at IS NOT NULL`).run(id, at);
  }

  create({ title, details = '', planned_at = null, parent_id = null } = {}) {
    title = validatedTitle(title);
    if (typeof details !== 'string') throw new TypeError('详情必须是文本');
    planned_at = timestamp(planned_at, 'planned_at', true);
    const id = randomUUID();
    const at = this.currentTime();
    return this.transaction(() => {
      if (parent_id !== null) {
        const parent = this.requireTask(parent_id);
        if (parent.parent_id !== null) throw new Error('子任务下不能再创建子任务');
        this.reopenAncestors(parent_id, at);
      }
      this.db.prepare(`INSERT INTO tasks(id,parent_id,title,details,planned_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`).run(id, parent_id, title, details, planned_at, at, at);
      return this.requireTask(id);
    });
  }

  update(id, { title, details, planned_at, priority } = {}) {
    return this.transaction(() => {
      const task = this.requireTask(id);
      const nextTitle = title === undefined ? task.title : validatedTitle(title);
      const nextDetails = details === undefined ? task.details : details;
      if (typeof nextDetails !== 'string') throw new TypeError('详情必须是文本');
      const nextPlan = planned_at === undefined ? task.planned_at : timestamp(planned_at, 'planned_at', true);
      const nextPriority = priority === undefined ? task.priority : priority;
      if (!Number.isInteger(nextPriority) || nextPriority < 0 || nextPriority > 3)
        throw new RangeError('优先级必须为 0–3');
      if (task.title === nextTitle && task.details === nextDetails &&
          task.planned_at === nextPlan && task.priority === nextPriority) return task;
      this.db.prepare('UPDATE tasks SET title=?,details=?,planned_at=?,priority=?,updated_at=? WHERE id=?')
        .run(nextTitle, nextDetails, nextPlan, nextPriority, this.currentTime(), id);
      return this.requireTask(id);
    });
  }

  setPriority(id, priority) {
    if (!Number.isInteger(priority) || priority < 0 || priority > 3) throw new RangeError('优先级必须为 0–3');
    return this.transaction(() => {
      this.requireTask(id);
      this.db.prepare('UPDATE tasks SET priority=?,updated_at=? WHERE id=?').run(priority, this.currentTime(), id);
      return this.requireTask(id);
    });
  }

  setPinned(id, pinned) {
    if (typeof pinned !== 'boolean') throw new TypeError('置顶状态必须是布尔值');
    return this.transaction(() => {
      let task = this.requireTask(id);
      const visited = new Set();
      while (task.parent_id !== null) {
        if (visited.has(task.id)) throw new Error('任务父级关系异常');
        visited.add(task.id);
        task = this.requireTask(task.parent_id);
      }
      if (pinned && task.completed_at !== null) throw new Error('已完成的主任务不能置顶');
      if (Boolean(task.pinned) !== pinned) {
        this.db.prepare('UPDATE tasks SET pinned=?,updated_at=? WHERE id=?')
          .run(Number(pinned), this.currentTime(), task.id);
      }
      return this.requireTask(task.id);
    });
  }

  setCompleted(id, completed) {
    if (typeof completed !== 'boolean') throw new TypeError('完成状态必须是布尔值');
    return this.transaction(() => {
      const task = this.requireTask(id);
      const at = this.currentTime();
      if (completed) {
        this.db.prepare(`WITH RECURSIVE descendants(id) AS (
          SELECT id FROM tasks WHERE id=? UNION ALL
          SELECT tasks.id FROM tasks JOIN descendants ON tasks.parent_id=descendants.id
        ) UPDATE tasks SET completed_at=?,updated_at=?
          WHERE id IN (SELECT id FROM descendants) AND completed_at IS NULL`).run(id, at, at);
        // Only completing the root unpins its group; completing a child does
        // not change the still-pending parent's pin.
        if (task.parent_id === null && task.pinned) {
          this.db.prepare('UPDATE tasks SET pinned=0,updated_at=? WHERE id=?').run(at, id);
        }
      } else this.reopenAncestors(id, at);
      return this.requireTask(id);
    });
  }

  delete(id) {
    return this.transaction(() => {
      this.requireTask(id);
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      return true;
    });
  }

  moveSubtask(sourceId, targetId, placement) {
    if (!['before', 'after'].includes(placement)) throw new Error('位置必须是 before 或 after');
    return this.transaction(() => {
      const source = this.requireTask(sourceId);
      const target = this.requireTask(targetId);
      if (source.id === target.id || source.parent_id === null || source.parent_id !== target.parent_id ||
          (source.completed_at === null) !== (target.completed_at === null)) {
        throw new Error('只能在同一主任务、同一完成状态的子任务之间排序');
      }
      const siblings = this.children(source.parent_id)
        .filter(x => (x.completed_at === null) === (source.completed_at === null) && x.id !== source.id);
      const index = siblings.findIndex(x => x.id === target.id);
      siblings.splice(index + (placement === 'after' ? 1 : 0), 0, source);
      const update = this.db.prepare('UPDATE tasks SET subtask_order=? WHERE id=?');
      siblings.forEach((task, order) => update.run(order, task.id));
      return siblings.map(task => this.requireTask(task.id));
    });
  }

  moveRoot(sourceId, targetId, placement, { sort = 'desc', language = 'zh' } = {}) {
    if (!['before', 'after'].includes(placement)) throw new Error('位置必须是 before 或 after');
    if (!['manual', 'desc', 'asc', 'title', 'planned'].includes(sort)) throw new Error('无效的排序方式');
    if (!['zh', 'en'].includes(language)) throw new Error('无效的语言');
    return this.transaction(() => {
      const source = this.requireTask(sourceId), target = this.requireTask(targetId);
      if (source.id === target.id || source.parent_id !== null || target.parent_id !== null ||
          (source.completed_at === null) !== (target.completed_at === null) || Boolean(source.pinned) !== Boolean(target.pinned)) {
        throw new Error('只能在同一完成状态、同一置顶组的主任务之间排序');
      }
      // Include rows hidden by the current filter before changing to manual order.
      const roots = this.list().filter(task => task.parent_id === null)
        .sort((a, b) => compareRoots(a, b, { mode: 'tray', sort, language }));
      const from = roots.findIndex(task => task.id === source.id);
      roots.splice(from, 1);
      const index = roots.findIndex(task => task.id === target.id);
      roots.splice(index + Number(placement === 'after'), 0, source);
      const update = this.db.prepare('UPDATE tasks SET root_order=? WHERE id=?');
      roots.forEach((task, order) => update.run(order, task.id));
      return roots.map(task => this.requireTask(task.id));
    });
  }

  // All pending tasks remain in a review; completed tasks use [start,end).
  // Search includes parent context and reveals a parent if a child matches.
  review({ start, end, now = this.currentTime(), query = '' } = {}) {
    timestamp(start, 'start'); timestamp(end, 'end'); timestamp(now, 'now');
    if (end < start) throw new RangeError('结束时间早于开始时间');
    if (typeof query !== 'string') throw new TypeError('搜索词必须是文本');
    const known = this.list().filter(task => task.created_at <= now);
    const byId = new Map(known.map(task => [task.id, task]));
    const eligible = known.filter(task => task.completed_at === null ||
      (task.completed_at >= start && task.completed_at < end && task.completed_at <= now));
    const needle = query.trim().toLocaleLowerCase();
    const matches = task => !!task && (!needle || task.title.toLocaleLowerCase().includes(needle) ||
      task.details.toLocaleLowerCase().includes(needle));
    const parentMatches = new Set(eligible.filter(matches).map(task => task.parent_id).filter(Boolean));
    const visible = eligible.filter(task => matches(task) || parentMatches.has(task.id) || matches(byId.get(task.parent_id)));
    const byIdTie = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    const completed = visible.filter(task => task.completed_at !== null)
      .sort((a, b) => b.completed_at - a.completed_at || byIdTie(a, b));
    const pending = visible.filter(task => task.completed_at === null)
      .sort((a, b) => b.created_at - a.created_at || byIdTie(a, b));
    // Legacy task_progress remains read-only in the upstream UI but must be
    // available to review/export; don't silently drop historical entries.
    const progress = this.db.prepare('SELECT id,task_id,text,created_at FROM task_progress WHERE task_id=? ORDER BY created_at ASC,id ASC');
    const attachProgress = tasks => tasks.map(task => ({ ...task, progress:progress.all(task.id).map(item => ({ ...item })) }));
    return { completed:attachProgress(completed), pending:attachProgress(pending) };
  }

  close() { this.db.close(); }
}

module.exports = { TaskStore, compareChildren };
