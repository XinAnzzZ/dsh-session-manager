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

// Plugin data lives on the DSH host (one JSON file under the DSH home), so every shell on this machine shares it.
// Reads come from the loaded copy; writes update it at once and reach the host in order. A rejected write
// (another shell changed the key first, or the host failed) restores the host copy and is passed to subscribers.
async function openHostStorage(url, request = (...args) => fetch(...args)) {
  const call = async (body) => {
    const headers = { 'x-dsh-plugin': 'dsh-session-manager' };
    const response = await request(url, body
      ? { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { cache: 'no-store', headers });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw Object.assign(new Error(result?.error || 'HTTP ' + response.status), { data: result?.data });
    return result.data;
  };
  let data = await call();
  let queue = Promise.resolve();
  const listeners = new Set();
  const emit = (key, failure) => { for (const listener of [...listeners]) listener(key, failure); };
  const settle = (fresh) => {
    const changed = [...new Set([...Object.keys(data), ...Object.keys(fresh)])].filter((key) => data[key] !== fresh[key]);
    data = fresh;
    return changed;
  };
  const write = (key, value) => {
    const previous = data[key] ?? null;
    if (previous === value) return;
    data = { ...data };
    if (value === null) delete data[key]; else data[key] = value;
    queue = queue.then(() => call({ key, value, previous })).catch(async (error) => {
      try { settle(error.data ?? await call()); } catch (reason) { emit(key, reason); }
      emit(key, error);
    });
  };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => write(key, String(value)),
    removeItem: (key) => write(key, null),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Picks up changes made by another shell; queued behind pending writes so it never undoes them.
    refresh() {
      queue = queue.then(async () => { for (const key of settle(await call())) emit(key, null); })
        .catch((error) => emit(null, error));
      return queue;
    },
  };
}

module.exports = { createStore, openHostStorage };
