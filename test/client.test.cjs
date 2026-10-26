'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createPlugin = require('../client-source.cjs');
const model = require('../model.cjs');
const persistence = require('../storage.cjs');

const KEY = 'dsh.session-manager.v1';
const WORKSPACES = 'sidebar.workspaces';
const MENU = WORKSPACES + '.session.menu.item';
const flush = () => new Promise(resolve => setImmediate(resolve));
const event = options => ({
  ctrlKey: false, metaKey: false, shiftKey: false, detail: 1,
  stopPropagation() {}, preventDefault() {},
  dataTransfer: { setData() {} }, ...options,
});

// This harness runs hook state/effect lifetimes, not browser layout or React reconciliation.
function renderer() {
  const instances = new Map();
  let current, index;
  const pending = [];
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...props, children }, children }; },
    useState(initial) {
      const owner = current, slot = index++;
      if (!(slot in owner)) owner[slot] = typeof initial === 'function' ? initial() : initial;
      return [owner[slot], value => { owner[slot] = typeof value === 'function' ? value(owner[slot]) : value; }];
    },
    useRef(initial) {
      const [ref] = React.useState(() => ({ current: initial }));
      return ref;
    },
    useEffect(effect, deps) {
      const owner = current, slot = index++, previous = owner[slot];
      if (previous && deps && deps.length === previous.deps?.length && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      pending.push(() => {
        previous?.cleanup?.();
        owner[slot] = { deps, cleanup: effect() };
      });
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      React.useEffect(() => subscribe(() => {}), [subscribe]);
      return getSnapshot();
    },
  };
  function resolve(node, path) {
    if (Array.isArray(node)) return node.flatMap((child, i) => resolve(child, path + '.' + i));
    if (node === null || node === undefined || typeof node === 'boolean') return [];
    if (typeof node !== 'object') return [node];
    if (typeof node.type === 'function') {
      const id = path + ':' + node.type.name + ':' + (node.props.key ?? '');
      if (!instances.has(id)) instances.set(id, []);
      const previous = current, previousIndex = index;
      current = instances.get(id); index = 0;
      const output = node.type(node.props);
      current = previous; index = previousIndex;
      return resolve(output, id);
    }
    const host = { ...node, children: resolve(node.children, path + '.children') };
    host.props.ref && (host.props.ref.current = {
      showModal() {}, close() {}, focus() {}, querySelectorAll() { return []; },
    });
    return [host];
  }
  return {
    React,
    render(component, props) {
      const result = resolve(React.createElement(component, props), 'root')[0];
      while (pending.length) pending.shift()();
      return result;
    },
    unmount() {
      for (const hooks of instances.values()) for (const hook of hooks) hook?.cleanup?.();
      instances.clear();
    },
  };
}

function nodes(root, predicate) {
  if (!root || typeof root !== 'object') return [];
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => nodes(child, predicate))];
}
const text = node => typeof node === 'object' && node ? node.children.map(text).join('') : String(node ?? '');
function button(root, label) {
  const match = nodes(root, node => node.type === 'button' && node.props['aria-label'] === label)[0];
  if (match) return match;
  const menu = nodes(root, node => node.type === 'native-menu' && node.props.items.some(item => item.label === label))[0];
  assert.ok(menu, `Expected button or native menu item ${label}`);
  const item = menu.props.items.find(item => item.label === label);
  return { props: { disabled: item.disabled, onClick: () => menu.props.onSelect(item.id) } };
}
function row(root, key) {
  const match = nodes(root, node => node.props['data-dsm-key'] === key)[0];
  assert.ok(match, `Expected row ${key}`);
  return match;
}
function source(value) {
  const listeners = new Set();
  return { value, listeners, list: {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => value,
  } };
}
function fixtureState() {
  let state = model.initialState();
  state = model.createFolder(state, { id: 'a', workspaceId: 'w', name: 'Alpha' });
  state = model.createFolder(state, { id: 'b', workspaceId: 'w', name: 'Beta' });
  return state;
}

function setup(t, { state = fixtureState(), raw = JSON.stringify(state), compatible = true, mode = null } = {}) {
  const previousWindow = global.window;
  const previousError = console.error, previousWarn = console.warn;
  const errors = [], warnings = [], calls = [], effects = [], windowListeners = new Map();
  console.error = (...args) => errors.push(args);
  console.warn = (...args) => warnings.push(args);
  const storage = { raw, writes: 0, mode, getItem: key => key === KEY ? storage.raw : storage.mode,
    setItem(key, value) { if (key !== KEY) { storage.mode = value; return; } storage.raw = value; storage.writes++; } };
  global.window = { localStorage: storage,
    addEventListener(name, callback) { if (!windowListeners.has(name)) windowListeners.set(name, new Set()); windowListeners.get(name).add(callback); },
    removeEventListener(name, callback) { windowListeners.get(name)?.delete(callback); },
  };
  const sessions = source({ phase: 'ready', ids: ['s1', 's2', 'blank', 'archived', 'orphan'], byId: {
    s1: { id: 's1', title: '  First  ', displayTitle: 'First', updatedAt: 20, running: false },
    s2: { id: 's2', title: 'Second', displayTitle: 'Second', updatedAt: 10, running: false },
    blank: { id: 'blank', displayTitle: 'New session', blank: true, retainedBy: { mainView: 1 }, updatedAt: 30 },
    archived: { id: 'archived', title: 'Old', updatedAt: 0 },
    orphan: { id: 'orphan', title: 'Ungrouped session', updatedAt: 0 },
  } });
  const workspaces = source({ phase: 'ready', items: [{ workspaceId: 'w', path: 'E:/work', title: 'Work', sessionIds: ['s1', 's2', 'blank', 'archived'] }],
    archivedSessionIds: ['archived'], pinnedSessionIds: ['s2'] });
  sessions.create = async input => { calls.push(['createSession', input]); return 'created'; };
  sessions.search = async (query, signal) => { calls.push(['searchContent', query, signal]); return { ok: true, value: { items: [], hasMore: false } }; };
  const shortcuts = source({ searchRequest: 0 });
  const requestSearch = () => { calls.push(['search']); shortcuts.value.searchRequest++; for (const listener of shortcuts.listeners) listener(); };
  const native = { options: { priority: 0 }, inject: () => ({ requestSessionRename: (...args) => calls.push(['rename', ...args]),
    requestSearch, hooks: { workspaceShortcuts: shortcuts.list } }) };
  const archive = { options: { id: 'archive' }, inject: () => ({ archiveSession: id => calls.push(['archive-native', id]) }) };
  const entries = new Map([[WORKSPACES, compatible ? [native] : []], [MENU, [archive]]]);
  const subscriptions = new Map();
  const emit = key => { for (const listener of [...(subscriptions.get(key) || [])]) listener(); };
  const slots = {
    inject: (key, action) => action(),
    entries: key => entries.get(key) || [],
    subscribe(key, listener) {
      if (!subscriptions.has(key)) subscriptions.set(key, new Set());
      subscriptions.get(key).add(listener);
      return () => subscriptions.get(key).delete(listener);
    },
    register(options, component) {
      const entry = { options, component };
      if (!entries.has(options.name)) entries.set(options.name, []);
      entries.get(options.name).push(entry); emit(options.name);
      calls.push(['register', options.name, options.priority]);
      return () => {
        entries.set(options.name, entries.get(options.name).filter(value => value !== entry));
        calls.push(['dispose', options.name, options.priority]); emit(options.name);
      };
    },
  };
  const uiWorkspace = Object.fromEntries(['openSession', 'pinSession', 'unpinSession', 'archiveSession', 'unarchiveSession']
    .map(name => [name, id => { calls.push([name, id]); }]));
  uiWorkspace.openWorkspace = async (workspaceId, beforeOpen) => {
    calls.push(['openWorkspace', workspaceId]); beforeOpen('created');
  };
  let dictionaries;
  const ctx = { slots, sessions, workspaces, uiWorkspace,
    locale: {
      register(namespace, value) { dictionaries = value; calls.push(['locale', namespace]); return () => calls.push(['locale-dispose', namespace]); },
      bind: () => (key, values = {}) => dictionaries.en[key]?.replace(/\{(\w+)\}/g, (_, name) => values[name]),
    },
    effect(action) { const cleanup = action(); if (typeof cleanup === 'function') effects.push(cleanup); },
  };
  const view = renderer();
  let tree;
  const ui = new Proxy({
    Modal: props => view.React.createElement('native-modal', props, props.children, props.footer),
    Button: props => view.React.createElement('button', props, props.children),
    Menu: props => view.React.createElement('native-menu', props, props.anchor),
    StateDot: props => view.React.createElement('native-state-dot', props),
    Switch: props => view.React.createElement('native-switch', props),
    relativeTime: () => ({ unit: 'minutes', n: 1 }),
  }, { get: (target, key) => target[key] || (props => view.React.createElement('native-icon', { ...props, name: key })) });
  const plugin = createPlugin(view.React, model, persistence, ui);
  plugin.apply(ctx);
  function render(props = {}) {
    const registered = entries.get(WORKSPACES).find(entry => entry.options.priority === -10);
    assert.ok(registered, 'Expected custom tree registration');
    tree = view.render(registered.component, { wide: true, expandSidebar() { calls.push(['expand']); },
      useSessionStatus: selector => { assert.equal(typeof selector, 'function'); return selector(new Map()); },
      usePanelInfo: selector => { assert.equal(typeof selector, 'function'); return selector({ activePanelId: null }); }, ...props });
    return tree;
  }
  async function click(target, options) { assert.notEqual(target.props.disabled, true); target.props.onClick(event(options)); await flush(); }
  const cleanup = () => { view.unmount(); while (effects.length) effects.pop()(); };
  t.after(() => { cleanup(); global.window = previousWindow; console.error = previousError; console.warn = previousWarn; });
  return { plugin, ctx, slots, entries, native, archive, calls, errors, warnings, storage, subscriptions, sessions, workspaces,
    windowListeners, render, click, emit, cleanup, renderToggle: () => nodes(view.render(entries.get('settings.section')[0].component, {}), node => node.type === 'native-switch')[0], get tree() { return tree; } };
}

test('factory declares dependencies and apply shadows native using options metadata, then cleans up', t => {
  const app = setup(t);
  assert.deepEqual(app.plugin.inject, ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale']);
  assert.deepEqual(app.calls.filter(call => call[0] === 'register' && call[1] === WORKSPACES), [['register', WORKSPACES, -10]]);
  assert.equal(app.entries.get(WORKSPACES).includes(app.native), true);
  app.render();
  assert.equal(app.windowListeners.get('storage').size, 2);
  assert.equal(app.sessions.listeners.size, 1);
  app.cleanup();
  assert.deepEqual(app.entries.get(WORKSPACES), [app.native]);
  assert.equal(app.subscriptions.get(WORKSPACES).size, 0);
  assert.equal(app.subscriptions.get(MENU).size, 0);
  assert.equal(app.windowListeners.get('storage').size, 0);
  assert.equal(app.sessions.listeners.size, 0);
  assert.ok(app.calls.some(call => call[0] === 'locale-dispose'));
});

test('incompatible native API retains original list and hot registration changes reconcile', t => {
  const app = setup(t, { compatible: false });
  assert.equal(app.entries.get(WORKSPACES).length, 0);
  app.entries.get(WORKSPACES).push(app.native); app.emit(WORKSPACES);
  assert.equal(app.entries.get(WORKSPACES).length, 2);
  app.entries.set(MENU, []); app.emit(MENU);
  assert.deepEqual(app.entries.get(WORKSPACES), [app.native]);
  assert.equal(app.warnings.length, 1);
  app.entries.set(MENU, [app.archive]); app.emit(MENU);
  assert.equal(app.entries.get(WORKSPACES).length, 2);
});

test('corrupt persistence preserves native list and bytes without writing', t => {
  const app = setup(t, { raw: '{broken' });
  assert.deepEqual(app.entries.get(WORKSPACES), [app.native]);
  assert.equal(app.storage.raw, '{broken');
  assert.equal(app.storage.writes, 0);
  assert.equal(app.errors.length, 1);
});

test('narrow sidebar expands instead of rendering tree', async t => {
  const app = setup(t);
  const tree = app.render({ wide: false });
  assert.equal(tree.type, 'button');
  tree.props.onClick();
  assert.deepEqual(app.calls.at(-1), ['expand']);
});

test('session opening, raw-title double-click rename, pin and native archive delegation', async t => {
  const app = setup(t);
  let tree = app.render();
  await app.click(row(tree, 'session:s1'));
  assert.deepEqual(app.calls.at(-1), ['openSession', 's1']);
  tree = app.render();
  row(tree, 'session:s1').props.onDoubleClick(event());
  assert.deepEqual(app.calls.at(-1), ['rename', 's1', 'First']);
  row(tree, 'session:blank').props.onDoubleClick(event());
  assert.equal(app.calls.filter(call => call[0] === 'rename').length, 1);
  await app.click(button(row(tree, 'session:s1'), 'Pin'));
  assert.deepEqual(app.calls.at(-1), ['pinSession', 's1']);
  tree = app.render();
  await app.click(button(row(tree, 'session:s2'), 'Unpin'));
  assert.deepEqual(app.calls.at(-1), ['unpinSession', 's2']);
  tree = app.render();
  await app.click(button(row(tree, 'session:s1'), 'Archive'));
  assert.deepEqual(app.calls.at(-1), ['archive-native', 's1']);
  assert.equal(app.storage.writes, 0);
});

test('archived list restores through uiWorkspace without opening or regrouping', async t => {
  const app = setup(t);
  let tree = app.render();
  assert.equal(nodes(tree, node => node.props['data-dsm-key'] === 'session:archived').length, 0);
  await app.click(button(tree, 'Archived'));
  tree = app.render();
  const archived = row(tree, 'session:archived');
  await app.click(button(archived, 'Restore'));
  assert.deepEqual(app.calls.at(-1), ['unarchiveSession', 'archived']);
  assert.equal(app.storage.writes, 0);
  assert.equal(nodes(tree, node => node.type === 'native-modal').length, 0);
  await app.click(button(tree, 'Hide archived'));
  tree = app.render();
  assert.equal(nodes(tree, node => node.props.className === 'dsm-archived-list').length, 0);
});

test('new session creates fresh identity and persists folder before native navigation', async t => {
  const app = setup(t);
  app.ctx.uiWorkspace.openSession = id => {
    assert.equal(JSON.parse(app.storage.raw).sessionFolders[id], 'a');
    app.calls.push(['openSession', id]);
  };
  const tree = app.render();
  await app.click(button(row(tree, 'folder:a'), 'New session'));
  assert.deepEqual(app.calls.slice(-2), [['createSession', { workspaceId: 'w' }], ['openSession', 'created']]);
  assert.equal(app.calls.some(call => call[0] === 'openWorkspace'), false);
  assert.equal(JSON.parse(app.storage.raw).sessionFolders.created, 'a');
  assert.equal(app.storage.writes, 1);
  assert.equal(app.errors.length, 0);
});

test('Ctrl multi-selection drags to folder atomically and undo restores mappings', async t => {
  const app = setup(t);
  let tree = app.render();
  await app.click(row(tree, 'session:s1'), { ctrlKey: true });
  tree = app.render();
  await app.click(row(tree, 'session:s2'), { ctrlKey: true });
  tree = app.render();
  assert.equal(row(tree, 'session:s1').props['aria-selected'], true);
  assert.equal(row(tree, 'session:s2').props['aria-selected'], true);
  row(tree, 'session:s1').props.onDragStart(event());
  row(tree, 'folder:a').props.onDrop(event());
  assert.deepEqual(JSON.parse(app.storage.raw).sessionFolders, { s1: 'a', s2: 'a' });
  assert.equal(app.storage.writes, 1);
  tree = app.render();
  tree.props.onKeyDown(event({ ctrlKey: true, key: 'z', target: { closest: () => null } }));
  await flush();
  assert.deepEqual(JSON.parse(app.storage.raw).sessionFolders, {});
  assert.equal(app.storage.writes, 2);
  tree = app.render();
  assert.match(text(tree), /Move undone/);
  assert.equal(nodes(tree, node => node.type === 'native-menu').flatMap(node => node.props.items).some(item => item.id === 'undo'), false);
});

test('Shift selection uses visible row order without opening native session', async t => {
  const app = setup(t);
  let tree = app.render();
  await app.click(row(tree, 'session:s2'), { ctrlKey: true });
  tree = app.render();
  await app.click(row(tree, 'session:s1'), { shiftKey: true });
  tree = app.render();
  for (const id of ['s1', 's2', 'blank']) assert.equal(row(tree, 'session:' + id).props['aria-selected'], true);
  assert.equal(app.calls.some(call => call[0] === 'openSession'), false);
});

test('folder move rejects descendant cycle without persistence change', t => {
  const state = model.createFolder(fixtureState(), { id: 'child', workspaceId: 'w', parentId: 'a', name: 'Child' });
  const app = setup(t, { state });
  const tree = app.render();
  row(tree, 'folder:a').props.onDragStart(event());
  row(tree, 'folder:child').props.onDrop(event());
  assert.equal(app.storage.writes, 0);
  assert.equal(app.errors.length, 1);
  assert.match(text(app.render()), /Cannot move a folder into itself/);
});

test('folder creation and rename dialog save through model and storage', async t => {
  const app = setup(t);
  let tree = app.render();
  const workspace = nodes(tree, node => node.props.className === 'dsm-row dsm-workspace')[0];
  await app.click(button(workspace, 'New folder'));
  tree = app.render();
  let input = nodes(tree, node => node.type === 'input')[0];
  input.props.onChange({ target: { value: '  Created folder  ' } });
  tree = app.render();
  nodes(tree, node => node.type === 'form')[0].props.onSubmit(event());
  const created = JSON.parse(app.storage.raw).folders.find(folder => folder.name === 'Created folder');
  assert.ok(created);
  assert.equal(created.parentId, null);
  tree = app.render();
  await app.click(button(row(tree, 'folder:' + created.id), 'Rename'));
  tree = app.render();
  input = nodes(tree, node => node.type === 'input')[0];
  input.props.onChange({ target: { value: 'Renamed folder' } });
  tree = app.render();
  nodes(tree, node => node.type === 'form')[0].props.onSubmit(event());
  assert.equal(JSON.parse(app.storage.raw).folders.find(folder => folder.id === created.id).name, 'Renamed folder');
});

test('folder delete-to-root removes subtree mappings without native archival', async t => {
  let state = model.createFolder(fixtureState(), { id: 'child', workspaceId: 'w', parentId: 'a', name: 'Child' });
  state = { ...state, sessionFolders: { s1: 'a', s2: 'child', archived: 'a' } };
  const app = setup(t, { state });
  let tree = app.render();
  await app.click(button(row(tree, 'folder:a'), 'Delete folder'));
  tree = app.render();
  await app.click(button(tree, 'Move sessions to workspace root'));
  const persisted = JSON.parse(app.storage.raw);
  assert.deepEqual(persisted.folders.map(folder => folder.id), ['b']);
  assert.deepEqual(persisted.sessionFolders, {});
  assert.equal(app.calls.some(call => call[0] === 'archiveSession' || call[0] === 'archive-native'), false);
});

test('archive-and-delete uses native safety controller, skips already archived sessions', async t => {
  const state = { ...fixtureState(), sessionFolders: { s1: 'a', archived: 'a' } };
  const app = setup(t, { state });
  let tree = app.render();
  await app.click(button(row(tree, 'folder:a'), 'Delete folder'));
  tree = app.render();
  await app.click(button(tree, 'Archive sessions and delete'));
  assert.deepEqual(app.calls.filter(call => call[0] === 'archiveSession'), [['archiveSession', 's1']]);
  assert.deepEqual(JSON.parse(app.storage.raw).folders.map(folder => folder.id), ['b']);
});

test('external storage event reloads folder state and clears drag undo', t => {
  const app = setup(t);
  let tree = app.render();
  row(tree, 'session:s1').props.onDragStart(event());
  row(tree, 'folder:a').props.onDrop(event());
  const external = model.renameFolder(fixtureState(), 'b', 'Other window');
  app.storage.raw = JSON.stringify(external);
  const dispatch = (overrides = {}) => {
    for (const listener of app.windowListeners.get('storage')) listener({ storageArea: window.localStorage, key: KEY, newValue: app.storage.raw, ...overrides });
  };
  dispatch({ key: 'unrelated' });
  assert.match(text(app.render()), /Moved/);
  dispatch();
  tree = app.render();
  assert.equal(nodes(tree, node => node.type === 'native-menu').flatMap(node => node.props.items).some(item => item.id === 'undo'), false);
  assert.match(text(row(tree, 'folder:b')), /Other window/);
  tree.props.onKeyDown(event({ ctrlKey: true, key: 'z', target: { closest: () => null } }));
  assert.equal(app.storage.writes, 1);
  assert.equal(app.storage.writes, 1);
});

test('corrupt storage event reports error and keeps rendered last-valid folders', t => {
  const app = setup(t);
  app.render();
  app.storage.raw = '{bad';
  for (const listener of app.windowListeners.get('storage')) listener({ storageArea: window.localStorage, key: KEY, newValue: app.storage.raw });
  const tree = app.render();
  assert.ok(row(tree, 'folder:a'));
  assert.equal(app.errors.length, 1);
  assert.equal(app.storage.raw, '{bad');
  assert.equal(app.storage.writes, 0);
});

test('ungrouped workspace can collapse with a valid persisted empty-id key', async t => {
  const app = setup(t);
  let tree = app.render();
  const ungrouped = nodes(tree, node => node.props.className === 'dsm-row dsm-workspace').find(node => text(node).includes('Ungrouped'));
  assert.ok(ungrouped);
  await app.click(ungrouped);
  tree = app.render();
  assert.equal(JSON.parse(app.storage.raw).expanded['workspace:""'], false);
  assert.equal(nodes(tree, node => node.props['data-dsm-key'] === 'session:orphan').length, 0);
  assert.equal(app.errors.length, 0);
});

test('current-session marker follows mainView retention and active native panel', t => {
  const app = setup(t);
  let tree = app.render();
  assert.equal(row(tree, 'session:blank').props['aria-current'], 'page');
  assert.equal(row(tree, 'session:s1').props['aria-current'], undefined);
  tree = app.render({ usePanelInfo: selector => selector({ activePanelId: 'settings' }) });
  assert.equal(row(tree, 'session:blank').props['aria-current'], undefined);
});

test('running state comes from native status selector, overriding stale list summary', t => {
  const app = setup(t);
  const tree = app.render({ useSessionStatus: selector => selector(new Map([['s1', { running: true }]])) });
  assert.equal(nodes(row(tree, 'session:s1'), node => node.props.className === 'dsm-status dsm-running').length, 1);
});

test('archive rejection keeps folder assignments and dialog available', async t => {
  const state = { ...fixtureState(), sessionFolders: { s1: 'a' } };
  const app = setup(t, { state });
  app.ctx.uiWorkspace.archiveSession = async () => { throw new Error('Session is running'); };
  let tree = app.render();
  await app.click(button(row(tree, 'folder:a'), 'Delete folder'));
  tree = app.render();
  await app.click(button(tree, 'Archive sessions and delete'));
  assert.deepEqual(JSON.parse(app.storage.raw), state);
  assert.equal(app.storage.writes, 0);
  assert.match(text(app.render()), /Session is running/);
  assert.ok(button(app.tree, 'Archive sessions and delete'));
});

test('partially completed bulk archive retains all folder metadata for recovery', async t => {
  const state = { ...fixtureState(), sessionFolders: { s1: 'a', s2: 'a', archived: 'a' } };
  const app = setup(t, { state });
  const archived = [];
  app.ctx.uiWorkspace.archiveSession = async id => {
    if (id === 's2') throw new Error('Second session is running');
    archived.push(id);
  };
  let tree = app.render();
  await app.click(button(row(tree, 'folder:a'), 'Delete folder'));
  tree = app.render();
  await app.click(button(tree, 'Archive sessions and delete'));
  assert.deepEqual(archived, ['s1']);
  assert.deepEqual(JSON.parse(app.storage.raw), state);
  assert.equal(app.storage.writes, 0);
  assert.match(text(app.render()), /Second session is running/);
});

test('failed folder persistence never navigates freshly created session', async t => {
  const app = setup(t);
  app.storage.setItem = () => { throw new Error('Quota exceeded'); };
  const tree = app.render();
  await app.click(button(row(tree, 'folder:a'), 'New session'));
  assert.ok(app.calls.some(call => call[0] === 'createSession'));
  assert.equal(app.calls.some(call => call[0] === 'openSession'), false);
  assert.equal(app.storage.writes, 0);
  assert.match(text(app.render()), /Quota exceeded/);
});

test('search button and native shortcut keep folder mode, merge local and content matches, and cancel stale queries', async t => {
  const app = setup(t);
  await app.click(button(app.render(), 'Search sessions'));
  let tree = app.render();
  let input = nodes(tree, node => node.type === 'input' && node.props['aria-label'] === 'Search sessions')[0];
  assert.ok(input);
  app.sessions.search = async (query, signal) => { app.calls.push(['searchContent', query, signal]); return { ok: true,
    value: { items: [{ sessionId: 's2', snippet: '<unsafe> body match' }], hasMore: true } }; };
  input.props.onChange({ target: { value: 'First' } });
  tree = app.render();
  assert.ok(row(tree, 'session:s1'));
  assert.equal(nodes(tree, node => node.props['data-dsm-key'] === 'session:s2').length, 0);
  await new Promise(resolve => setTimeout(resolve, 280));
  tree = app.render();
  assert.ok(row(tree, 'session:s2'));
  assert.match(text(tree), /<unsafe> body match/);
  assert.match(text(tree), /Refine your search/);
  assert.ok(app.entries.get(WORKSPACES).some(entry => entry.options.priority === -10));
  const signal = app.calls.find(call => call[0] === 'searchContent')[2];
  input = nodes(tree, node => node.type === 'input')[0];
  input.props.onKeyDown(event({ key: 'Escape' }));
  tree = app.render();
  assert.equal(signal.aborted, true);
  assert.ok(row(tree, 'folder:a'));
  app.native.inject().requestSearch();
  app.render();
  tree = app.render();
  assert.ok(nodes(tree, node => node.type === 'input').length);
  assert.ok(app.entries.get(WORKSPACES).some(entry => entry.options.priority === -10));
  assert.equal(app.storage.writes, 0);
});

test('disabled content search shows native-style empty result instead of backend error', async t => {
  const app = setup(t);
  const message = 'session search is disabled: openAt never';
  app.sessions.search = async () => ({ ok: false, error: { message } });
  await app.click(button(app.render(), 'Search sessions'));
  nodes(app.render(), node => node.type === 'input')[0].props.onChange({ target: { value: 'no-local-match' } });
  app.render();
  await new Promise(resolve => setTimeout(resolve, 280));
  const tree = app.render();
  assert.match(text(tree), /No matching sessions/);
  assert.doesNotMatch(text(tree), /session search is disabled|openAt/);
  assert.equal(nodes(tree, node => node.props.role === 'alert').length, 0);
});

test('native search shortcut expands narrow sidebar without changing mode', t => {
  const app = setup(t);
  app.render({ wide: false });
  app.native.inject().requestSearch();
  app.render({ wide: false });
  assert.ok(app.calls.some(call => call[0] === 'expand'));
  const tree = app.render({ wide: true });
  assert.ok(nodes(tree, node => node.type === 'input').length);
  assert.ok(app.entries.get(WORKSPACES).some(entry => entry.options.priority === -10));
});

test('search failures stay in logs, local matches survive, stale replies ignored and query input is bounded', async t => {
  const app = setup(t);
  let finish;
  app.sessions.search = () => new Promise(resolve => { finish = resolve; });
  await app.click(button(app.render(), 'Search sessions'));
  let tree = app.render();
  let input = nodes(tree, node => node.type === 'input')[0];
  input.props.onChange({ target: { value: 'First' } });
  app.render();
  await new Promise(resolve => setTimeout(resolve, 280));
  tree = app.render();
  input = nodes(tree, node => node.type === 'input')[0];
  input.props.onChange({ target: { value: 'Second' } });
  app.render();
  finish({ ok: true, value: { items: [{ sessionId: 'orphan', snippet: 'STALE' }], hasMore: false } });
  await flush();
  assert.doesNotMatch(text(app.render()), /STALE/);
  app.sessions.search = async () => ({ ok: false, error: { message: 'Search unavailable' } });
  await new Promise(resolve => setTimeout(resolve, 280));
  tree = app.render();
  assert.doesNotMatch(text(tree), /Search unavailable/);
  assert.equal(nodes(tree, node => node.props.role === 'alert').length, 0);
  assert.ok(app.errors.some(args => args.some(value => value?.message === 'Search unavailable')));
  assert.ok(row(tree, 'session:s2'));
  input = nodes(tree, node => node.type === 'input')[0];
  input.props.onChange({ target: { value: '\0' + 'x'.repeat(499) + '😀' } });
  tree = app.render();
  const value = nodes(tree, node => node.type === 'input')[0].props.value;
  assert.equal(value.length, 499);
  assert.equal(value.includes('\0'), false);
  assert.equal(app.storage.writes, 0);
});

test('folder rename uses native modal close handling, selects draft and keeps input undo local', async t => {
  const app = setup(t);
  let tree = app.render();
  row(tree, 'folder:a').props.onDoubleClick(event());
  tree = app.render();
  const modal = nodes(tree, node => node.type === 'native-modal')[0];
  assert.equal(modal.props.open, true);
  assert.equal(modal.props.closeLabel, 'Close');
  const input = nodes(modal, node => node.type === 'input')[0];
  assert.equal(input.props['data-modal-autofocus'], true);
  let selected = false;
  input.props.onFocus({ target: { select() { selected = true; } } });
  assert.equal(selected, true);
  modal.props.onClose();
  assert.equal(nodes(app.render(), node => node.type === 'native-modal').length, 0);
  assert.equal(app.storage.writes, 0);
});

test('settings switch persists native mode and returns to tree without losing folders or registering footer', async t => {
  const app = setup(t);
  assert.equal(app.entries.has('sidebar.footer.action'), false);
  assert.equal(app.entries.get('settings.section')[0].options.label(), 'Session Manager');
  let toggle = app.renderToggle();
  assert.equal(toggle.props.label, 'Use tree view');
  assert.equal(toggle.props.checked, true);
  toggle.props.onChange(false);
  assert.equal(app.storage.mode, 'false');
  assert.deepEqual(app.entries.get(WORKSPACES), [app.native]);
  app.emit(WORKSPACES);
  assert.deepEqual(app.entries.get(WORKSPACES), [app.native]);
  toggle = app.renderToggle();
  assert.equal(toggle.props.checked, false);
  toggle.props.onChange(true);
  assert.equal(app.storage.mode, 'true');
  assert.ok(app.entries.get(WORKSPACES).some(entry => entry.options.priority === -10));
  assert.match(text(row(app.render(), 'folder:a')), /Alpha/);
  assert.equal(app.storage.writes, 0);
  app.cleanup();
  assert.deepEqual(app.entries.get('settings.section'), []);
});

test('saved native mode survives initialization and cross-window changes restore tree', t => {
  const app = setup(t, { mode: 'false' });
  assert.deepEqual(app.entries.get(WORKSPACES), [app.native]);
  assert.equal(app.renderToggle().props.checked, false);
  app.storage.mode = 'true';
  for (const listener of app.windowListeners.get('storage')) listener({ key: 'dsh.session-manager.tree-view', storageArea: app.storage });
  assert.ok(app.entries.get(WORKSPACES).some(entry => entry.options.priority === -10));
  assert.equal(app.renderToggle().props.checked, true);
});
test('mode write failure leaves tree and saved preference unchanged', t => {
  const app = setup(t);
  app.storage.setItem = () => { throw new Error('Storage unavailable'); };
  app.renderToggle().props.onChange(false);
  assert.equal(app.renderToggle().props.checked, true);
  assert.equal(app.storage.mode, null);
  assert.ok(app.entries.get(WORKSPACES).some(entry => entry.options.priority === -10));
  assert.ok(app.errors.length);
});

test('pending interaction wins over running and unread status presentation', t => {
  const app = setup(t);
  const tree = app.render({ useSessionStatus: selector => selector(new Map([['s1', {
    pendingInteraction: { kind: 'approval' }, running: true, completionUnread: true,
  }]])) });
  const indicator = nodes(row(tree, 'session:s1'), node => node.props.className === 'dsm-status dsm-pending')[0];
  assert.ok(indicator);
  assert.equal(indicator.props['aria-label'], 'Needs attention: approval');
  assert.equal(nodes(indicator, node => node.type === 'native-state-dot')[0].props.state, 'warning');
});

test('unread completion uses native done dot and accessible label, absent on ordinary session', t => {
  const app = setup(t);
  const tree = app.render({ useSessionStatus: selector => selector(new Map([['s1', { running: false, completionUnread: true }]])) });
  const unread = nodes(row(tree, 'session:s1'), node => node.props['aria-label'] === 'Unread completion')[0];
  assert.ok(unread);
  assert.equal(nodes(unread, node => node.type === 'native-state-dot')[0].props.state, 'done');
  assert.equal(nodes(row(tree, 'session:s2'), node => node.props['aria-label'] === 'Unread completion').length, 0);
  assert.equal(nodes(row(tree, 'session:s2'), node => node.type === 'small').length, 0);
});

test('parent subagent count uses direct native catalog, live status precedence and list fallback', t => {
  const app = setup(t);
  Object.assign(app.sessions.value.byId, {
    childLive: { id: 'childLive', running: false },
    childStopped: { id: 'childStopped', running: true },
    childFallback: { id: 'childFallback', running: true },
    unrelated: { id: 'unrelated', parentId: 's1', running: true },
  });
  app.sessions.value.projectionsBySession = { s1: { values: { subagentCatalog: [
    { id: 'childLive' }, { id: 'childStopped' }, { id: 'childFallback' },
  ] } } };
  const statuses = new Map([
    ['s1', { running: false }], ['childLive', { running: true }], ['childStopped', { running: false }],
  ]);
  let tree = app.render({ useSessionStatus: selector => selector(statuses) });
  const count = nodes(row(tree, 'session:s1'), node => node.type === 'small')[0];
  assert.ok(count);
  assert.equal(text(count), '+2');
  assert.equal(count.props['aria-label'], 'Running: 2');
  assert.equal(nodes(row(tree, 'session:s2'), node => node.type === 'small').length, 0);
  app.sessions.value.projectionsBySession.s1.values.subagentCatalog = [];
  tree = app.render({ useSessionStatus: selector => selector(statuses) });
  assert.equal(nodes(row(tree, 'session:s1'), node => node.type === 'small').length, 0);
});

test('delayed event uses latest stored value; foreign area ignored and clear event resets', t => {
  const app = setup(t);
  app.render();
  const latest = model.renameFolder(fixtureState(), 'a', 'Latest state');
  app.storage.raw = JSON.stringify(latest);
  const dispatch = options => {
    for (const listener of app.windowListeners.get('storage')) listener({ storageArea: window.localStorage, key: KEY, newValue: '{}', ...options });
  };
  dispatch({ storageArea: {} });
  assert.match(text(row(app.render(), 'folder:a')), /Alpha/);
  dispatch();
  assert.match(text(row(app.render(), 'folder:a')), /Latest state/);
  assert.equal(app.errors.length, 0);
  app.storage.raw = null;
  dispatch({ key: null, newValue: null });
  assert.equal(nodes(app.render(), node => node.props['data-dsm-key'] === 'folder:a').length, 0);
  assert.equal(app.storage.writes, 0);
});

test('native UI primitives replace glyphs, use themed 14px rows and contain icon-only controls', t => {
  const app = setup(t);
  const tree = app.render();
  assert.equal(nodes(row(tree, 'session:s1'), node => node.type === 'native-state-dot').length, 0);
  assert.ok(nodes(row(tree, 'session:s2'), node => node.type === 'native-icon' && node.props.name === 'IconPinFillRegular').length);
  const css = text(nodes(tree, node => node.type === 'style')[0]);
  assert.match(css, /font:inherit/);
  assert.match(css, /data-archived=true\]>\.dsm-label\{color:var\(--dsw-alias-label-caption\)/);
  assert.match(css, /--dsw-alias-label-primary/);
  assert.doesNotMatch(text(tree), /Ctrl-click select|Shift-click range/);
  assert.equal(text(button(row(tree, 'folder:a'), 'New session')), '');
  assert.equal(text(nodes(row(tree, 'session:s1'), node => node.props.className === 'dsm-time')[0]), '1m');
});

test('nested folder colors differ and native menu exposes new, rename and delete actions', t => {
  const state = model.createFolder(fixtureState(), { id: 'child', parentId: 'a', workspaceId: 'w', name: 'Child' });
  const app = setup(t, { state });
  const tree = app.render();
  const color = key => nodes(row(tree, key), node => node.props.className === 'dsm-folder-icon')[0].props.style.color;
  assert.notEqual(color('folder:a'), color('folder:child'));
  const menus = nodes(row(tree, 'folder:a'), node => node.type === 'native-menu');
  assert.deepEqual(menus[0].props.items.map(item => item.id), ['folder', 'session', 'rename', 'delete']);
  assert.equal(menus[0].props.portal, true);
});

test('archived toggle mixes gray rows into normal ordering and folder, without a separate list or pin priority', async t => {
  const state = { ...fixtureState(), sessionFolders: { archived: 'a', s1: 'a' } };
  const app = setup(t, { state });
  app.sessions.value.byId.archived.updatedAt = 21;
  app.workspaces.value.pinnedSessionIds.push('archived');
  let tree = app.render();
  await app.click(button(tree, 'Archived'));
  tree = app.render();
  const archived = row(tree, 'session:archived');
  assert.equal(archived.props['data-archived'], true);
  assert.equal(archived.props.style.paddingLeft, row(tree, 'session:s1').props.style.paddingLeft);
  const order = nodes(tree, node => node.props['data-dsm-key']).map(node => node.props['data-dsm-key']);
  assert.ok(order.indexOf('session:archived') < order.indexOf('session:s1'));
  assert.equal(nodes(archived, node => node.props.className === 'dsm-pin').length, 0);
  assert.equal(nodes(tree, node => node.props.className === 'dsm-archived-list').length, 0);
  await app.click(archived);
  assert.equal(app.calls.some(call => call[0] === 'openSession'), false);
  assert.match(text(app.render()), /Restore this archived session/);
  await app.click(button(archived, 'Restore'));
  assert.deepEqual(app.calls.at(-1), ['unarchiveSession', 'archived']);
  await app.click(button(app.render(), 'Hide archived'));
  assert.equal(nodes(app.render(), node => node.props['data-dsm-key'] === 'session:archived').length, 0);
  assert.deepEqual(JSON.parse(app.storage.raw), state);
});

test('rendered pagination grows by five and shift selection excludes hidden sessions', async t => {
  const app = setup(t);
  for (let i = 0; i < 12; i++) {
    const id = 'extra' + i;
    app.sessions.value.ids.push(id);
    app.sessions.value.byId[id] = { id, title: id, updatedAt: 100 - i };
    app.workspaces.value.items[0].sessionIds.push(id);
  }
  let tree = app.render();
  const extras = () => nodes(tree, node => node.props['data-dsm-key']?.startsWith('session:extra')).length;
  assert.equal(extras(), 4); // The pinned s2 takes the first seat; blank does not consume one.
  assert.equal(nodes(tree, node => node.type === 'native-menu').flatMap(node => node.props.items).some(item => item.id === 'undo'), false);
  const more = nodes(tree, node => node.props.className === 'dsm-overflow')[0];
  await app.click(more);
  tree = app.render();
  assert.equal(extras(), 9);
  await app.click(row(tree, 'session:extra0'), { ctrlKey: true });
  tree = app.render();
  await app.click(row(tree, 'session:extra8'), { shiftKey: true });
  tree = app.render();
  assert.equal(nodes(tree, node => node.props['data-dsm-key'] === 'session:extra9').length, 0);
});
