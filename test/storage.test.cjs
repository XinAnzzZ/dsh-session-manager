'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../storage.cjs');
const { initialState, createFolder, renameFolder, setExpanded, moveItems, deleteFolder } = require('../model.cjs');

const key = 'folders';
function fixture() {
  let state = initialState();
  for (const id of ['a', 'b', 'c']) state = createFolder(state, { id, workspaceId: 'w', name: id });
  return state;
}
function memory(raw = null) {
  return {
    raw, writes: 0, readError: null, writeError: null,
    getItem(requested) {
      assert.equal(requested, key);
      if (this.readError) throw this.readError;
      return this.raw;
    },
    setItem(requested, value) {
      assert.equal(requested, key);
      if (this.writeError) throw this.writeError;
      this.raw = value;
      this.writes++;
    },
  };
}
const moveSession = (store, folderId, id = 's') => store.update(state =>
  moveItems(state, [{ kind: 'session', id, workspaceId: 'w' }], { workspaceId: 'w', folderId }), { drag: true });

test('missing storage loads initial state without writing', () => {
  const storage = memory();
  const store = createStore(storage, key);
  assert.deepEqual(store.getSnapshot(), initialState());
  assert.equal(store.canUndo(), false);
  assert.equal(storage.writes, 0);
  store.undo();
  assert.equal(storage.writes, 0);
});

test('corrupt JSON and invalid schema throw without overwriting', () => {
  for (const raw of ['{broken', '{}', JSON.stringify({ ...fixture(), version: 2 })]) {
    const storage = memory(raw);
    const errors = [];
    assert.throws(() => createStore(storage, key, error => errors.push(error)));
    assert.equal(storage.raw, raw);
    assert.equal(storage.writes, 0);
    assert.equal(errors.length, 1);
  }
});

test('storage read errors propagate and reach onError', () => {
  const storage = memory();
  storage.readError = new Error('Storage blocked');
  const errors = [];
  assert.throws(() => createStore(storage, key, error => errors.push(error)), /Storage blocked/);
  assert.deepEqual(errors, [storage.readError]);
  assert.equal(storage.writes, 0);
});

test('update persists before notifying and unsubscribe detaches listener', () => {
  const storage = memory();
  const store = createStore(storage, key);
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls++;
    assert.deepEqual(JSON.parse(storage.raw), store.getSnapshot());
  });
  store.update(() => fixture());
  assert.equal(calls, 1);
  unsubscribe();
  store.update(state => renameFolder(state, 'a', 'renamed'));
  assert.equal(calls, 1);
});

test('equal updates and reordered record keys do not write or notify', () => {
  const state = { ...fixture(), expanded: { 'folder:a': true, 'folder:b': false } };
  const storage = memory(JSON.stringify(state));
  const store = createStore(storage, key);
  const before = store.getSnapshot();
  let calls = 0;
  store.subscribe(() => calls++);
  store.update(value => value);
  store.update(value => ({ ...value, expanded: { 'folder:b': false, 'folder:a': true } }));
  assert.equal(store.getSnapshot(), before);
  assert.equal(storage.writes, 0);
  assert.equal(calls, 0);
});

test('failed write leaves state, history and observers untouched', () => {
  const storage = memory(JSON.stringify(fixture()));
  const errors = [];
  const store = createStore(storage, key, error => errors.push(error));
  moveSession(store, 'a');
  const before = store.getSnapshot();
  const raw = storage.raw;
  let calls = 0;
  store.subscribe(() => calls++);
  storage.writeError = new Error('Quota exceeded');
  assert.throws(() => moveSession(store, 'b'), /Quota exceeded/);
  assert.equal(store.getSnapshot(), before);
  assert.equal(storage.raw, raw);
  assert.equal(store.canUndo(), true);
  assert.equal(calls, 0);
  assert.throws(() => store.undo(), /Quota exceeded/);
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.canUndo(), true);
  assert.equal(errors.length, 2);
  storage.writeError = null;
  store.undo();
  assert.deepEqual(store.getSnapshot().sessionFolders, {});
  assert.equal(store.canUndo(), false);
});

test('snapshots are detached and frozen; invalid updates are atomic', () => {
  const storage = memory();
  const store = createStore(storage, key);
  const input = fixture();
  store.update(() => input);
  input.folders[0].name = 'mutated outside';
  assert.equal(store.getSnapshot().folders[0].name, 'a');
  const before = store.getSnapshot();
  assert.throws(() => store.update(state => { state.folders[0].name = 'mutated'; return state; }), TypeError);
  assert.throws(() => store.update(state => ({ ...state, sessionFolders: { s: 'missing' } })), /mapping/);
  assert.equal(store.getSnapshot(), before);
  assert.equal(storage.writes, 1);
});

test('drag undo restores only parents and mappings, preserving latest expansion and names', () => {
  const store = createStore(memory(JSON.stringify(fixture())), key);
  store.update(state => moveItems(state, [
    { kind: 'folder', id: 'a', workspaceId: 'w' },
    { kind: 'session', id: 's', workspaceId: 'w' },
  ], { workspaceId: 'w', folderId: 'b' }), { drag: true });
  store.update(state => renameFolder(state, 'a', 'Latest name'));
  store.update(state => setExpanded(state, 'folder:b', false));
  store.undo();
  assert.equal(store.getSnapshot().folders.find(folder => folder.id === 'a').parentId, null);
  assert.equal(store.getSnapshot().folders.find(folder => folder.id === 'a').name, 'Latest name');
  assert.equal(store.getSnapshot().expanded['folder:b'], false);
  assert.deepEqual(store.getSnapshot().sessionFolders, {});
  assert.equal(store.canUndo(), false);
});

test('multiple drag undo steps retain later presentation edits', () => {
  const store = createStore(memory(JSON.stringify(fixture())), key);
  moveSession(store, 'a');
  moveSession(store, 'b');
  moveSession(store, 'c');
  store.update(state => renameFolder(state, 'b', 'Latest b'));
  for (const expected of ['b', 'a', undefined]) {
    store.undo();
    assert.equal(store.getSnapshot().sessionFolders.s, expected);
    assert.equal(store.getSnapshot().folders[1].name, 'Latest b');
  }
  assert.equal(store.canUndo(), false);
});

test('undo history is capped at thirty committed drags', () => {
  const store = createStore(memory(JSON.stringify(fixture())), key);
  for (let index = 0; index < 35; index++) moveSession(store, index % 2 === 0 ? 'a' : 'b');
  let undos = 0;
  while (store.canUndo()) { store.undo(); undos++; }
  assert.equal(undos, 30);
  assert.equal(store.getSnapshot().sessionFolders.s, 'a');
});

test('non-drag structural changes clear history; no-op drags preserve it', () => {
  const transforms = [
    state => createFolder(state, { id: 'new', workspaceId: 'w', name: 'new' }),
    state => deleteFolder(state, 'b'),
    state => moveItems(state, [{ kind: 'folder', id: 'a', workspaceId: 'w' }], { workspaceId: 'w', folderId: 'c' }),
    state => moveItems(state, [{ kind: 'session', id: 's', workspaceId: 'w' }], { workspaceId: 'w', folderId: 'c' }),
  ];
  for (const transform of transforms) {
    const storage = memory(JSON.stringify(fixture()));
    const store = createStore(storage, key);
    moveSession(store, 'a');
    moveSession(store, 'a');
    assert.equal(storage.writes, 1);
    assert.equal(store.canUndo(), true);
    store.update(transform);
    assert.equal(store.canUndo(), false);
  }
});

test('drag cannot introduce folder inventory changes', () => {
  const storage = memory(JSON.stringify(fixture()));
  const store = createStore(storage, key);
  assert.throws(() => store.update(state => deleteFolder(state, 'a'), { drag: true }), /Drag updates/);
  assert.equal(storage.writes, 0);
  assert.equal(store.getSnapshot().folders.length, 3);
});

test('valid external reload clears undo, notifies, and never writes', () => {
  const storage = memory(JSON.stringify(fixture()));
  const store = createStore(storage, key);
  moveSession(store, 'a');
  const before = store.getSnapshot();
  let calls = 0;
  store.subscribe(() => calls++);
  store.reload(storage.raw);
  assert.equal(store.canUndo(), false);
  assert.notEqual(store.getSnapshot(), before);
  assert.equal(calls, 1);
  store.reload(storage.raw);
  assert.equal(calls, 1);
  storage.raw = null;
  store.reload(null);
  assert.deepEqual(store.getSnapshot(), initialState());
  assert.equal(storage.writes, 1);
});

test('invalid reload preserves prior state and history without overwriting corrupt input', () => {
  const storage = memory(JSON.stringify(fixture()));
  const store = createStore(storage, key);
  moveSession(store, 'a');
  const before = store.getSnapshot();
  const validRaw = storage.raw;
  for (const raw of ['bad json', '{}']) {
    storage.raw = raw;
    assert.throws(() => store.reload(raw));
    assert.equal(store.getSnapshot(), before);
    assert.equal(store.canUndo(), true);
    assert.equal(storage.raw, raw);
  }
  storage.raw = validRaw;
  store.undo();
  assert.equal(store.canUndo(), false);
});

test('update and undo detect external changes before storage event and require retry', () => {
  for (const operation of [store => moveSession(store, 'b'), store => store.undo()]) {
    const storage = memory(JSON.stringify(fixture()));
    const store = createStore(storage, key);
    moveSession(store, 'a');
    const external = renameFolder(fixture(), 'b', 'Other tab');
    storage.raw = JSON.stringify(external);
    assert.throws(() => operation(store), /another tab.*retry/);
    assert.deepEqual(store.getSnapshot(), external);
    assert.equal(store.canUndo(), false);
    assert.equal(storage.writes, 1);
    moveSession(store, 'b');
    assert.equal(store.getSnapshot().folders[1].name, 'Other tab');
    assert.equal(store.getSnapshot().sessionFolders.s, 'b');
  }
});

test('corrupt external storage blocks stale update and preserves prior snapshot', () => {
  const storage = memory(JSON.stringify(fixture()));
  const store = createStore(storage, key);
  moveSession(store, 'a');
  const before = store.getSnapshot();
  storage.raw = '{bad';
  assert.throws(() => moveSession(store, 'b'));
  assert.throws(() => store.undo());
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.canUndo(), true);
  assert.equal(storage.raw, '{bad');
  assert.equal(storage.writes, 1);
});
