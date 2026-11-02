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

  // Workspace includes main lists and calendars. Tray mode is only for its task
  // list, whose user-selected ordering applies within both completion groups.
  function compareRoots(a, b, { mode = 'workspace', sort = 'desc', language = 'zh' } = {}) {
    const state = compareState(a, b);
    if (state) return state;
    if (mode === 'tray') {
      const order = sort === 'title'
        ? (collators[language] || collators.zh).compare(a.title, b.title)
        : sort === 'asc' ? a.created_at - b.created_at : newestFirst(a, b);
      return order || compareIds(a, b);
    }
    return (a.completed_at != null ? b.completed_at - a.completed_at : newestFirst(a, b)) || compareIds(a, b);
  }

  return { compareChildren, compareRoots };
});
