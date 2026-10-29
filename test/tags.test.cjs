'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../model.cjs');

const base = () => ({ version: 1, sessions: {}, tags: [
  { id: 'todo', name: 'TODO', color: '#6366f1', once: false },
  { id: 'revisit', name: 'Revisit', color: '#0ea5e9', once: true },
] });

test('saveTag creates and updates, rejects duplicate names case-insensitively and invalid colors', () => {
  let state = model.saveTag(base(), { id: 'x', name: '  Later ', color: '#123456', once: false });
  assert.deepEqual(state.tags.at(-1), { id: 'x', name: 'Later', color: '#123456', once: false });
  state = model.saveTag(state, { id: 'x', name: 'Later', color: '#654321', once: true });
  assert.equal(state.tags.length, 3);
  assert.deepEqual(state.tags.at(-1), { id: 'x', name: 'Later', color: '#654321', once: true });
  assert.throws(() => model.saveTag(state, { id: 'y', name: 'todo', color: '#000000', once: false }), /Duplicate tag: todo/);
  assert.throws(() => model.saveTag(state, { id: 'y', name: 'Ok', color: 'red', once: false }), /Invalid or duplicate tag/);
  assert.throws(() => model.saveTag(state, { id: 'y', name: 'x'.repeat(41), color: '#000000', once: false }), /at most 40/);
});

test('setSessionTag toggles for several sessions; deleteTag and clearOnceTags drop empty mappings', () => {
  let state = model.setSessionTag(base(), ['s1', 's2'], 'todo', true);
  state = model.setSessionTag(state, ['s1'], 'revisit', true);
  assert.deepEqual(state.sessions, { s1: ['todo', 'revisit'], s2: ['todo'] });
  assert.throws(() => model.setSessionTag(state, ['s1'], 'missing', true), /Unknown tag: missing/);
  const cleared = model.clearOnceTags(state, 's1');
  assert.deepEqual(cleared.sessions, { s1: ['todo'], s2: ['todo'] });
  assert.equal(model.clearOnceTags(cleared, 's1'), cleared);
  const removed = model.deleteTag(state, 'todo');
  assert.deepEqual(removed.sessions, { s1: ['revisit'] });
  assert.deepEqual(removed.tags.map(tag => tag.id), ['revisit']);
  assert.deepEqual(model.setSessionTag(removed, ['s1'], 'revisit', false).sessions, {});
});

test('validateTags rejects mappings to unknown or duplicated tags', () => {
  assert.throws(() => model.validateTags({ ...base(), sessions: { s1: ['nope'] } }), /Invalid session-tag mapping/);
  assert.throws(() => model.validateTags({ ...base(), sessions: { s1: ['todo', 'todo'] } }), /Invalid session-tag mapping/);
  assert.throws(() => model.validateTags({ ...base(), version: 2 }), /Invalid session-tag state/);
});

test('rowsForWorkspace with only shows matching sessions and the folders on their paths, expanded', () => {
  let state = model.initialState();
  for (const [id, parentId] of [['a', null], ['b', 'a'], ['c', null]]) state = model.createFolder(state, { id, parentId, workspaceId: 'w', name: id });
  state = { ...state, sessionFolders: { s1: 'b', s2: 'c' }, expanded: { 'folder:a': false, 'folder:b': false } };
  const sessions = ['s1', 's2', 's3'].map(id => ({ id, updatedAt: 0 }));
  const rows = model.rowsForWorkspace(state, 'w', sessions, { only: new Set(['s1']) });
  assert.deepEqual(rows.map(row => row.kind + ':' + row.id), ['folder:a', 'folder:b', 'session:s1']);
  assert.deepEqual(rows.map(row => row.depth), [0, 1, 2]);
});
