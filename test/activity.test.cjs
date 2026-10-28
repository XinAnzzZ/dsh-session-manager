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
  const sessions = { byId: Object.fromEntries(['pending', 'running', 'unread', 'idle', 'archived', 'child', 'foreign'].map(id => [id, { id }])),
    projectionsBySession: { running: { values: { subagentCatalog: [{ id: 'child' }, { id: 'child2' }] } } } };
  sessions.byId.child.origin = 'subagent';
  const statuses = new Map([
    ['pending', { pendingInteraction: { kind: 'approval' }, running: true, completionUnread: true }],
    ['running', { completionUnread: true }], ['child', { running: true }], ['child2', { running: true }],
    ['unread', { completionUnread: true }], ['archived', { running: true }],
  ]);
  const workspaces = { items: [{ workspaceId: 'w', sessionIds: Object.keys(sessions.byId).concat('pending') }], archivedSessionIds: ['archived'] };
  const counts = model.folderActivity(state, workspaces, sessions, statuses);
  assert.deepEqual(counts.get('a'), { pending: 1, running: 1, unread: 1, idle: 1, total: 4 });
  assert.deepEqual(counts.get('b'), { pending: 1, running: 1, unread: 0, idle: 0, total: 2 });
  assert.equal(counts.get('foreign').total, 0);
});

test('session activity respects live stopped state, summary fallback and pending precedence', () => {
  const session = { id: 's', running: true };
  const sessions = { byId: {} };
  assert.equal(model.sessionActivity(session, new Map(), sessions).state, 'running');
  assert.equal(model.sessionActivity(session, new Map([['s', { running: false }]]), sessions).state, 'idle');
  assert.equal(model.sessionActivity(session, new Map([['s', { pendingInteraction: { kind: 'input' }, running: true }]]), sessions).state, 'pending');
});
