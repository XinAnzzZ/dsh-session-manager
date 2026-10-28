'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../model.cjs');

test('folder activity includes hidden descendants, deduplicates parents and excludes archived, subagent and foreign membership', () => {
  let state = model.initialState();
  for (const [id, parentId, workspaceId] of [['a', null, 'w'], ['b', 'a', 'w'], ['foreign', null, 'x']]) {
    state = model.createFolder(state, { id, parentId, workspaceId, name: id });
  }
  state = { ...state, sessionFolders: { pending: 'b', running: 'b', unread: 'a', idle: 'a', archived: 'b', child: 'b', foreign: 'foreign' }, expanded: { 'folder:a': false } };
  const sessions = { byId: Object.fromEntries(['pending', 'running', 'unread', 'idle', 'archived', 'child', 'foreign', 'loose', 'draft'].map(id => [id, { id }])),
    ids: ['pending', 'loose', 'draft'], projectionsBySession: { running: { values: { subagentCatalog: [{ id: 'child' }, { id: 'child2' }] } } } };
  sessions.byId.child.origin = 'subagent';
  sessions.byId.loose.running = true;
  sessions.byId.draft.blank = true;
  const statuses = new Map([
    ['pending', { pendingInteraction: { kind: 'approval' }, running: true, completionUnread: true }],
    ['running', { completionUnread: true }], ['child', { running: true }], ['child2', { running: true }],
    ['unread', { completionUnread: true }], ['archived', { running: true }],
  ]);
  const members = ['pending', 'running', 'unread', 'idle', 'archived', 'child', 'foreign', 'pending'];
  const workspaces = { items: [{ workspaceId: 'w', sessionIds: members }], archivedSessionIds: ['archived'] };
  const { folders, workspaces: byWorkspace, total } = model.treeActivity(state, workspaces, sessions, statuses);
  const plain = ({ ids, ...counts }) => counts;
  assert.deepEqual(plain(folders.get('a')), { pending: 1, running: 1, unread: 1, idle: 1, total: 4 });
  assert.deepEqual(folders.get('a').ids, { pending: ['pending'], running: ['running'], unread: ['unread'] });
  assert.deepEqual(plain(folders.get('b')), { pending: 1, running: 1, unread: 0, idle: 0, total: 2 });
  assert.equal(folders.get('foreign').total, 0);
  // Workspace counts its own members even when their folder belongs elsewhere; ungrouped skips blank drafts and sessions already counted.
  assert.deepEqual(plain(byWorkspace.get('w')), { pending: 1, running: 1, unread: 1, idle: 2, total: 5 });
  assert.deepEqual(plain(byWorkspace.get('')), { pending: 0, running: 1, unread: 0, idle: 0, total: 1 });
  assert.deepEqual(plain(total), { pending: 1, running: 2, unread: 1, idle: 2, total: 6 });
  assert.deepEqual(total.ids.running, ['running', 'loose']);
  assert.deepEqual(model.folderChain(state, 'running', 'w').map(folder => folder.id), ['b', 'a']);
  assert.deepEqual(model.folderChain(state, 'foreign', 'w'), []);
});

test('session activity respects live stopped state, summary fallback and pending precedence', () => {
  const session = { id: 's', running: true };
  const sessions = { byId: {} };
  assert.equal(model.sessionActivity(session, new Map(), sessions).state, 'running');
  assert.equal(model.sessionActivity(session, new Map([['s', { running: false }]]), sessions).state, 'idle');
  assert.equal(model.sessionActivity(session, new Map([['s', { pendingInteraction: { kind: 'input' }, running: true }]]), sessions).state, 'pending');
});
