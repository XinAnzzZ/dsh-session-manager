'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initialState, validateState, createFolder, renameFolder, setExpanded, moveItems,
  deleteFolder, folderSessionIds, rowsForWorkspace, pageRows, selectItems,
} = require('../model.cjs');

const folderItem = id => ({ kind: 'folder', id, workspaceId: 'w' });
const sessionItem = id => ({ kind: 'session', id, workspaceId: 'w' });
const target = folderId => ({ workspaceId: 'w', folderId });
const session = (id, updatedAt = 1, extra = {}) => ({ id, updatedAt, ...extra });
const keys = rows => rows.map(row => `${row.kind}:${row.id}`);

function tree() {
  let state = initialState();
  for (const [id, parentId, workspaceId = 'w'] of [
    ['a', null], ['b', 'a'], ['c', 'b'], ['d', null], ['other', null, 'other-w'],
  ]) state = createFolder(state, { id, parentId, workspaceId, name: id.toUpperCase() });
  return moveItems(moveItems(state, [sessionItem('nested'), sessionItem('archived')], target('c')),
    [sessionItem('direct')], target('a'));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

test('initial state is fresh, valid, and has the exact persistence shape', () => {
  const state = initialState();
  assert.deepEqual(state, { version: 1, folders: [], sessionFolders: {}, expanded: {} });
  assert.equal(validateState(state), state);
  assert.notEqual(initialState().folders, state.folders);
  assert.notEqual(initialState().sessionFolders, state.sessionFolders);
  assert.equal(validateState(JSON.parse(JSON.stringify(tree()))).folders.length, 5);
});

test('persisted state rejects corrupt structure, fields, references and cycles without resetting', () => {
  const invalid = [null, [], {}, { ...initialState(), version: 2 }, { ...initialState(), surprise: true },
    { ...initialState(), folders: {} }, { ...initialState(), sessionFolders: [] },
    { ...initialState(), expanded: [] }, { ...initialState(), expanded: { 'folder:a': 'false' } },
    { ...initialState(), expanded: { a: true } }, { ...initialState(), expanded: { 'folder:': true } },
    { ...initialState(), expanded: { 'folder:missing': false } },
    { ...initialState(), sessionFolders: { s: 'missing' } },
    { ...initialState(), sessionFolders: { '': 'a' } },
  ];
  const state = tree();
  invalid.push({ ...state, folders: [...state.folders, state.folders[0]] });
  for (const patch of [
    { id: '' }, { name: '  ' }, { workspaceId: null }, { parentId: 'missing' },
    { parentId: 'other' }, { parentId: 'a' }, { parentId: 'c' }, { extra: true },
  ]) invalid.push({ ...state, folders: state.folders.map((folder, index) => index === 0 ? { ...folder, ...patch } : folder) });
  for (const value of invalid) {
    const before = JSON.stringify(value);
    assert.throws(() => validateState(value));
    assert.equal(JSON.stringify(value), before);
  }
});

test('create, rename and expansion are immutable and validate input', () => {
  const state = freeze(tree());
  const created = createFolder(state, { id: 'new', workspaceId: 'w', parentId: 'b', name: ' New ' });
  assert.deepEqual(created.folders.at(-1), { id: 'new', workspaceId: 'w', parentId: 'b', name: 'New' });
  const renamed = renameFolder(state, 'b', ' Renamed ');
  assert.equal(renamed.folders.find(folder => folder.id === 'b').name, 'Renamed');
  assert.equal(state.folders.find(folder => folder.id === 'b').name, 'B');
  const collapsed = setExpanded(state, 'folder:a', false);
  assert.equal(collapsed.expanded['folder:a'], false);
  assert.deepEqual(state.expanded, {});
  assert.equal(setExpanded(state, 'workspace:w', false).expanded['workspace:w'], false);
  for (const options of [
    { id: 'a', workspaceId: 'w', name: 'duplicate' },
    { id: 'new', workspaceId: 'w', parentId: 'missing', name: 'new' },
    { id: 'new', workspaceId: 'w', parentId: 'other', name: 'new' },
    { id: '', workspaceId: 'w', name: 'new' },
    { id: 'new', workspaceId: '', name: 'new' },
    { id: 'new', workspaceId: 'w', name: '' },
  ]) assert.throws(() => createFolder(state, options));
  assert.throws(() => renameFolder(state, 'missing', 'new'));
  assert.throws(() => renameFolder(state, 'a', ' '));
  assert.throws(() => setExpanded(state, 'folder:missing', false));
  assert.throws(() => setExpanded(state, 'folder:a', 0));
  assert.throws(() => setExpanded(state, 'a', true));
});

test('folder names have a 120-character limit at creation, rename, and persistence boundaries', () => {
  const state = initialState();
  const options = { id: 'a', workspaceId: 'w', name: 'x'.repeat(120) };
  const created = createFolder(state, options);
  assert.equal(created.folders[0].name.length, 120);
  assert.equal(validateState(created), created);
  assert.throws(() => createFolder(state, { ...options, name: 'x'.repeat(121) }));
  assert.throws(() => renameFolder(created, 'a', 'x'.repeat(121)));
  assert.throws(() => validateState({ ...created, folders: [{ ...created.folders[0], name: 'x'.repeat(121) }] }));
});

test('nested multi-selection moves the ancestor and leaves selected descendant folders and sessions attached', () => {
  const state = freeze(tree());
  const moved = moveItems(state, [folderItem('a'), folderItem('b'), folderItem('c'),
    sessionItem('nested'), sessionItem('direct'), sessionItem('loose')], target('d'));
  assert.equal(moved.folders.find(folder => folder.id === 'a').parentId, 'd');
  assert.equal(moved.folders.find(folder => folder.id === 'b').parentId, 'a');
  assert.equal(moved.folders.find(folder => folder.id === 'c').parentId, 'b');
  assert.equal(moved.sessionFolders.nested, 'c');
  assert.equal(moved.sessionFolders.direct, 'a');
  assert.equal(moved.sessionFolders.loose, 'd');
  assert.equal(state.folders[0].parentId, null);
  assert.equal(state.sessionFolders.loose, undefined);
  assert.equal(validateState(moved), moved);
  const reversed = moveItems(state, [sessionItem('direct'), sessionItem('nested'), folderItem('b'), folderItem('a')], target('d'));
  assert.equal(reversed.sessionFolders.nested, 'c');
  assert.equal(reversed.sessionFolders.direct, 'a');
  assert.equal(reversed.folders.find(folder => folder.id === 'b').parentId, 'a');
});

test('sibling folders and sessions move together and sessions can return to root', () => {
  const state = freeze(tree());
  const moved = moveItems(state, [folderItem('b'), folderItem('d'), sessionItem('direct')], target('a'));
  assert.equal(moved.folders.find(folder => folder.id === 'd').parentId, 'a');
  assert.equal(moved.sessionFolders.direct, 'a');
  const root = moveItems(moved, [folderItem('b'), sessionItem('direct')], target(null));
  assert.equal(root.folders.find(folder => folder.id === 'b').parentId, null);
  assert.equal(Object.hasOwn(root.sessionFolders, 'direct'), false);
  assert.equal(root.sessionFolders.nested, 'c');
});

test('moves reject self targets, cycles, cross-workspace and malformed items atomically', () => {
  const state = freeze(tree());
  const invalid = [
    [[folderItem('a')], target('a')], [[folderItem('a')], target('c')],
    [[folderItem('a'), folderItem('b')], target('c')],
    [[folderItem('missing')], target(null)], [[sessionItem('s')], target('missing')],
    [[folderItem('other')], target(null)], [[sessionItem('s')], target('other')],
    [[{ kind: 'session', id: 's', workspaceId: 'other-w' }], target(null)],
    [[sessionItem('nested')], { workspaceId: 'other-w', folderId: 'other' }],
    [[{ kind: 'unexpected', id: 's', workspaceId: 'w' }], target(null)],
    [[{ kind: 'session', id: '', workspaceId: 'w' }], target(null)],
    [[sessionItem('s')], { workspaceId: 'w' }],
    [[sessionItem('s')], { workspaceId: '', folderId: null }],
    [[sessionItem('s'), folderItem('missing')], target('d')],
  ];
  const before = JSON.stringify(state);
  for (const [items, destination] of invalid) assert.throws(() => moveItems(state, items, destination));
  assert.throws(() => moveItems(state, null, target(null)));
  assert.throws(() => moveItems(state, [], null));
  assert.equal(JSON.stringify(state), before);
});

test('id dictionary keys cannot alter object prototypes', () => {
  let state = createFolder(initialState(), { id: '__proto__', workspaceId: 'w', name: 'safe' });
  state = moveItems(state, [sessionItem('__proto__'), sessionItem('constructor')], target('__proto__'));
  assert.equal(Object.getPrototypeOf(state.sessionFolders), Object.prototype);
  assert.equal(Object.hasOwn(state.sessionFolders, '__proto__'), true);
  assert.equal(state.sessionFolders.__proto__, '__proto__');
  assert.equal(state.sessionFolders.constructor, '__proto__');
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).folders.length, 1);
  assert.deepEqual(keys(rowsForWorkspace(state, 'w', [session('__proto__'), session('constructor')])) ,
    ['folder:__proto__', 'session:__proto__', 'session:constructor']);
});

test('archive is projection-only: hidden descendants retain mapping and recover in the same folder', () => {
  const state = freeze(tree());
  const sessions = [session('nested'), session('archived'), session('direct')];
  const hidden = rowsForWorkspace(state, 'w', sessions, { archivedIds: ['archived'] });
  assert.equal(keys(hidden).includes('session:archived'), false);
  assert.deepEqual(folderSessionIds(state, 'a'), ['nested', 'archived', 'direct']);
  assert.deepEqual(folderSessionIds(state, 'c'), ['nested', 'archived']);
  const recovered = rowsForWorkspace(state, 'w', sessions).find(row => row.id === 'archived');
  assert.equal(recovered.parentId, 'c');
  assert.equal(recovered.depth, 3);
  assert.equal(state.sessionFolders.archived, 'c');
});

test('showArchived mixes archived sessions by timestamp and retains their folders without changing the default', () => {
  const state = freeze(tree());
  const sessions = freeze([session('nested', 30), session('archived', 20), session('older', 10),
    session('root-active', 15), session('root-archived', 25)]);
  const mapped = freeze(moveItems(state, [sessionItem('older')], target('c')));
  const options = { archivedIds: ['archived', 'root-archived'] };
  const hidden = rowsForWorkspace(mapped, 'w', sessions, options);
  assert.equal(hidden.some(row => options.archivedIds.includes(row.id)), false);
  assert.deepEqual(rowsForWorkspace(mapped, 'w', sessions, { ...options, showArchived: false }), hidden);
  assert.equal(hidden.filter(row => row.kind === 'session').every(row => row.archived === false), true);
  const rows = rowsForWorkspace(mapped, 'w', sessions, { ...options, showArchived: true });
  assert.deepEqual(keys(rows), ['folder:a', 'folder:b', 'folder:c', 'session:nested',
    'session:archived', 'session:older', 'folder:d', 'session:root-archived', 'session:root-active']);
  assert.deepEqual(rows.filter(row => row.kind === 'session').map(row => row.archived), [false, true, false, true, false]);
  const archived = rows.find(row => row.id === 'archived');
  assert.equal(archived.parentId, 'c');
  assert.equal(archived.depth, 3);
  assert.equal(mapped.sessionFolders.archived, 'c');
});

test('showArchived ignores archived native pins while preserving active pin priority', () => {
  const sessions = freeze([session('archived-old', 1), session('active-pinned', 2),
    session('active-new', 4), session('archived-new', 5)]);
  const rows = rowsForWorkspace(initialState(), 'w', sessions, {
    archivedIds: ['archived-old', 'archived-new'],
    pinnedIds: ['archived-old', 'active-pinned', 'archived-new'],
    showArchived: true,
  });
  assert.deepEqual(keys(rows), ['session:active-pinned', 'session:archived-new', 'session:active-new', 'session:archived-old']);
});

test('rows are depth-first, folders precede sessions, with pinned sorting scoped to each sibling list', () => {
  let state = tree();
  state = moveItems(state, [sessionItem('z'), sessionItem('a'), sessionItem('fresh')], target('b'));
  const sessions = [session('root-old', 1), session('root-new', 100), session('z', 2), session('a', 2),
    session('fresh', 200), session('nested', 3), session('direct', 4)];
  const rows = rowsForWorkspace(freeze(state), 'w', freeze(sessions), { pinnedIds: ['root-old', 'z', 'a'] });
  assert.deepEqual(keys(rows), ['folder:a', 'folder:b', 'folder:c', 'session:nested',
    'session:a', 'session:z', 'session:fresh', 'session:direct', 'folder:d', 'session:root-old', 'session:root-new']);
  assert.deepEqual(rows.map(row => row.depth), [0, 1, 2, 3, 2, 2, 2, 1, 0, 0, 0]);
  assert.equal(rows.find(row => row.id === 'fresh').parentId, 'b');
  assert.equal(rows.every(row => row.workspaceId === 'w'), true);
  assert.equal(rows.some(row => row.id === 'other'), false);
  const dates = rowsForWorkspace(initialState(), 'w', [session('older', '2025-01-01'), session('newer', '2026-01-01')]);
  assert.deepEqual(keys(dates), ['session:newer', 'session:older']);
});

test('collapsed expansion persists and hiding children does not destroy their mappings', () => {
  const state = setExpanded(setExpanded(tree(), 'folder:b', false), 'folder:d', false);
  const persisted = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(keys(rowsForWorkspace(persisted, 'w', [session('nested'), session('direct')])),
    ['folder:a', 'folder:b', 'session:direct', 'folder:d']);
  assert.equal(persisted.sessionFolders.nested, 'c');
  assert.equal(keys(rowsForWorkspace(setExpanded(persisted, 'folder:b', true), 'w', [session('nested')])).includes('session:nested'), true);
});

test('projection hides subagents and inactive blanks, preserves active main-view blanks, and falls back to root', () => {
  const state = tree();
  state.sessionFolders.stale = 'missing';
  const rows = rowsForWorkspace(state, 'w', [
    session('subagent', 1, { origin: 'subagent' }), session('blank', 1, { blank: true }),
    session('other-retention', 1, { blank: true, retainedBy: { draft: 1, mainView: 0 } }),
    session('active', 1, { blank: true, retainedBy: { mainView: 1 } }),
    session('foreign'), session('stale'), session('unknown'),
  ]);
  state.sessionFolders.foreign = 'other';
  const projected = rowsForWorkspace(state, 'w', [session('foreign')]);
  assert.equal(projected.find(row => row.id === 'foreign').parentId, null);
  assert.deepEqual(rows.filter(row => row.kind === 'session').map(row => row.id), ['active', 'foreign', 'stale', 'unknown']);
  assert.equal(rows.filter(row => row.kind === 'session').every(row => row.depth === 0 && row.parentId === null), true);
});

test('deleting a subtree removes folder expansion and all mappings including archived sessions, not host sessions', () => {
  let state = tree();
  state = setExpanded(setExpanded(setExpanded(state, 'folder:b', false), 'folder:c', true), 'workspace:w', false);
  const deleted = deleteFolder(freeze(state), 'b');
  assert.deepEqual(deleted.folders.map(folder => folder.id), ['a', 'd', 'other']);
  assert.deepEqual(deleted.sessionFolders, { direct: 'a' });
  assert.deepEqual(deleted.expanded, { 'workspace:w': false });
  const sessions = [session('nested'), session('archived'), session('direct')];
  assert.equal(rowsForWorkspace(deleted, 'w', sessions).find(row => row.id === 'nested').parentId, null);
  assert.equal(rowsForWorkspace(deleted, 'w', sessions).find(row => row.id === 'archived').parentId, null);
  assert.equal(state.sessionFolders.archived, 'c');
  assert.equal(validateState(deleted), deleted);
  assert.throws(() => deleteFolder(state, 'missing'));
  assert.throws(() => folderSessionIds(state, 'missing'));
});

test('selection supports replacement, toggle, anchored visible ranges and ctrl-range union immutably', () => {
  const visible = freeze(['folder:a', 'folder:b', 'session:c', 'session:d', 'session:e']);
  const selection = freeze(['session:e']);
  assert.deepEqual(selectItems(selection, 'session:e', 'folder:b', visible), { selection: ['folder:b'], anchor: 'folder:b' });
  assert.deepEqual(selectItems(selection, 'session:e', 'folder:b', visible, { ctrl: true }),
    { selection: ['session:e', 'folder:b'], anchor: 'folder:b' });
  assert.deepEqual(selectItems(selection, 'session:e', 'session:e', visible, { ctrl: true }), { selection: [], anchor: 'session:e' });
  assert.deepEqual(selectItems(selection, 'folder:b', 'session:d', visible, { shift: true }),
    { selection: ['folder:b', 'session:c', 'session:d'], anchor: 'folder:b' });
  assert.deepEqual(selectItems(selection, 'session:d', 'folder:b', visible, { shift: true }),
    { selection: ['folder:b', 'session:c', 'session:d'], anchor: 'session:d' });
  assert.deepEqual(selectItems(selection, 'folder:b', 'session:d', visible, { shift: true, ctrl: true }),
    { selection: ['session:e', 'folder:b', 'session:c', 'session:d'], anchor: 'folder:b' });
  assert.deepEqual(selectItems(selection, 'session:hidden', 'folder:b', visible, { shift: true }),
    { selection: ['folder:b'], anchor: 'folder:b' });
  assert.throws(() => selectItems(selection, null, 'session:hidden', visible));
  assert.throws(() => selectItems(selection, null, 'invalid', visible));
  assert.deepEqual(selection, ['session:e']);
});

test('snapshot undo restores a move exactly because no prior state was mutated', () => {
  const before = freeze(tree());
  const snapshot = JSON.stringify(before);
  const after = moveItems(before, [folderItem('a'), sessionItem('direct')], target('d'));
  assert.notDeepEqual(after, before);
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(JSON.parse(snapshot), before);
});

test('pagination shows five nonblank sessions per sibling list and grows by five', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ kind: 'session', id: 's' + i, parentId: null, workspaceId: 'w', depth: 0 }));
  let result = pageRows(rows);
  assert.equal(result.filter(row => row.kind === 'session').length, 5);
  assert.equal(result.at(-1).hidden, 7);
  result = pageRows(rows, { root: 10 });
  assert.equal(result.filter(row => row.kind === 'session').length, 10);
  assert.equal(result.at(-1).hidden, 2);
  result = pageRows(rows, { root: 15 });
  assert.equal(result.filter(row => row.kind === 'session').length, 12);
  assert.equal(result.at(-1).hidden, 0);
  assert.equal(rows.length, 12);
});

test('pagination preserves folders and blanks, isolates nested limits and reveals attention', () => {
  const folder = { kind: 'folder', id: 'a', parentId: null, depth: 0 };
  const nested = Array.from({ length: 8 }, (_, i) => ({ kind: 'session', id: 'n' + i, parentId: 'a', depth: 1 }));
  const roots = Array.from({ length: 9 }, (_, i) => ({ kind: 'session', id: 'r' + i, parentId: null, depth: 0 }));
  const blank = { kind: 'session', id: 'blank', parentId: null, blank: true, depth: 0 };
  const result = pageRows([folder, ...nested, blank, ...roots], { 'folder:a': 10 }, row => row.id === 'r6');
  assert.ok(result.includes(folder));
  assert.ok(result.includes(blank));
  assert.equal(result.filter(row => row.kind === 'session' && row.parentId === 'a').length, 8);
  assert.equal(result.filter(row => row.kind === 'session' && row.parentId === null && !row.blank).length, 7);
  assert.equal(result.at(-1).hidden, 2);
});
