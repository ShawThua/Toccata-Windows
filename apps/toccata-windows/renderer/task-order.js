/* Shared presentation order. Sorting never changes task content or saved ranks. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ToccataTaskOrder = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const collators = {
    zh: new Intl.Collator('zh-CN', { numeric: true }),
    en: new Intl.Collator('en', { numeric: true }),
  };
  const compareIds = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const compareState = (a, b) => Number(a.completed_at != null) - Number(b.completed_at != null);
  const newestFirst = (a, b) => b.created_at - a.created_at;

  // Matches upstream SubtaskOrder: NULL/new children precede manually ranked ones.
  function compareChildren(a, b) {
    return compareState(a, b) ||
      (a.subtask_order ?? -1) - (b.subtask_order ?? -1) ||
      newestFirst(a, b) || compareIds(a, b);
  }

  // Workspace and tray use the same persisted order. Legacy unranked roots
  // appear before manually ranked roots, in newest-first order.
  function compareRoots(a, b, { mode = 'workspace', sort = 'desc', language = 'zh' } = {}) {
    const state = compareState(a, b);
    if (state) return state;
    const pinned = Number(!!b.pinned) - Number(!!a.pinned);
    if (pinned) return pinned;
    let order;
    if (sort === 'manual') {
      const left = a.root_order == null ? -1 : a.root_order;
      const right = b.root_order == null ? -1 : b.root_order;
      order = left - right || newestFirst(a, b);
    } else if (sort === 'title') {
      order = (collators[language] || collators.zh).compare(a.title, b.title);
    } else if (sort === 'asc') {
      order = a.created_at - b.created_at;
    } else if (sort === 'planned') {
      order = (a.planned_at == null) - (b.planned_at == null) ||
        (a.planned_at != null && b.planned_at != null ? a.planned_at - b.planned_at : 0);
    } else order = newestFirst(a, b);
    return order || compareIds(a, b);
  }

  return { compareChildren, compareRoots };
});
