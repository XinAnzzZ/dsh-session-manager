'use strict';

const { initialState, validateState } = require('./model.cjs');

const sortedRecord = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

function snapshot(value) {
  validateState(value);
  return Object.freeze({
    version: 1,
    folders: Object.freeze(value.folders.map(({ id, workspaceId, parentId, name }) =>
      Object.freeze({ id, workspaceId, parentId, name }))),
    sessionFolders: Object.freeze(sortedRecord(value.sessionFolders)),
    expanded: Object.freeze(sortedRecord(value.expanded)),
  });
}

const placement = state => ({
  parents: state.folders.map(({ id, workspaceId, parentId }) => ({ id, workspaceId, parentId })),
  sessionFolders: state.sessionFolders,
});
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Storage succeeds before observers can see a change; history never persists across reloads.
function createStore(storage, key, onError) {
  const report = action => {
    try { return action(); }
    catch (error) { onError?.(error); throw error; }
  };
  const decode = raw => snapshot(raw === null ? initialState() : JSON.parse(raw));
  let lastRaw = report(() => storage.getItem(key));
  let state = report(() => decode(lastRaw));
  let history = [];
  const listeners = new Set();
  const publish = (next, nextHistory) => {
    state = next;
    history = nextHistory;
    for (const listener of listeners) listener();
  };
  const ensureCurrent = () => {
    const raw = storage.getItem(key);
    if (raw === lastRaw) return;
    const next = decode(raw);
    lastRaw = raw;
    publish(next, []);
    throw new Error('Session folders changed in another tab. Review the latest state and retry the action.');
  };
  const persist = (next, nextHistory) => {
    const raw = JSON.stringify(next);
    storage.setItem(key, raw);
    lastRaw = raw;
    publish(next, nextHistory);
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    canUndo: () => history.length > 0,
    update(transform, { drag = false } = {}) {
      report(() => {
        ensureCurrent();
        const next = snapshot(transform(state));
        if (same(state, next)) return;
        const before = placement(state);
        const after = placement(next);
        let nextHistory = history;
        if (!same(before, after)) {
          if (drag) {
            const inventory = value => value.parents.map(({ id, workspaceId }) => ({ id, workspaceId }));
            if (!same(inventory(before), inventory(after))) {
              throw new Error('Drag updates may only change folder parents and session mappings');
            }
            nextHistory = [...history, { before, after }].slice(-30);
          } else {
            nextHistory = [];
          }
        }
        persist(next, nextHistory);
      });
    },
    undo() {
      report(() => {
        ensureCurrent();
        const previous = history[history.length - 1];
        if (!previous) return;
        if (!same(placement(state), previous.after)) throw new Error('Drag undo conflicts with current folder placement');
        const parents = new Map(previous.before.parents.map(folder => [folder.id, folder.parentId]));
        const next = snapshot({
          ...state,
          folders: state.folders.map(folder => ({ ...folder, parentId: parents.get(folder.id) })),
          sessionFolders: previous.before.sessionFolders,
        });
        persist(next, history.slice(0, -1));
      });
    },
    reload(raw) {
      report(() => {
        const next = decode(raw);
        lastRaw = raw;
        if (same(state, next) && history.length === 0) return;
        publish(next, []);
      });
    },
  };
}

module.exports = { createStore };
