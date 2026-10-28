'use strict';

const record = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const text = value => typeof value === 'string' && value.trim().length > 0;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function requireText(value, label) {
  if (!text(value)) throw new Error(`${label} must be a non-empty string`);
}

function requireName(name) {
  requireText(name, 'Folder name');
  if (name.trim().length > 120) throw new Error('Folder name must be at most 120 characters');
}

function initialState() {
  return { version: 1, folders: [], sessionFolders: {}, expanded: {} };
}

// Persistence boundary: invalid data is an error, never an instruction to reset storage.
function validateState(value) {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'expanded,folders,sessionFolders,version' ||
      value.version !== 1 || !Array.isArray(value.folders) ||
      !record(value.sessionFolders) || !record(value.expanded)) {
    throw new Error('Invalid or unsupported session-folder state');
  }
  const folders = new Map();
  for (const folder of value.folders) {
    if (!record(folder) || Object.keys(folder).sort().join(',') !== 'id,name,parentId,workspaceId' ||
        !text(folder.id) || !text(folder.workspaceId) || !text(folder.name) || folder.name.trim().length > 120 ||
        (folder.parentId !== null && !text(folder.parentId)) || folders.has(folder.id)) {
      throw new Error('Invalid or duplicate folder');
    }
    folders.set(folder.id, folder);
  }
  for (const folder of folders.values()) {
    const seen = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId !== null) {
      const parent = folders.get(parentId);
      if (!parent || parent.workspaceId !== folder.workspaceId || seen.has(parentId)) {
        throw new Error('Invalid folder parent, workspace, or cycle');
      }
      seen.add(parentId);
      parentId = parent.parentId;
    }
  }
  for (const [id, folderId] of Object.entries(value.sessionFolders)) {
    if (!text(id) || !text(folderId) || !folders.has(folderId)) {
      throw new Error('Invalid session-folder mapping');
    }
  }
  for (const [key, expanded] of Object.entries(value.expanded)) {
    if (!/^(folder|workspace):.+$/.test(key) || typeof expanded !== 'boolean' ||
        (key.startsWith('folder:') && !folders.has(key.slice(7)))) {
      throw new Error('Invalid expansion entry');
    }
  }
  return value;
}

function getFolder(state, id) {
  requireText(id, 'Folder id');
  const folder = state.folders.find(folder => folder.id === id);
  if (!folder) throw new Error(`Unknown folder: ${id}`);
  return folder;
}

function createFolder(state, { id, workspaceId, parentId = null, name }) {
  requireText(id, 'Folder id');
  requireText(workspaceId, 'Workspace id');
  requireName(name);
  if (state.folders.some(folder => folder.id === id)) throw new Error(`Duplicate folder: ${id}`);
  if (parentId !== null && getFolder(state, parentId).workspaceId !== workspaceId) {
    throw new Error('Cannot create a folder across workspaces');
  }
  return { ...state, folders: [...state.folders, { id, workspaceId, parentId, name: name.trim() }] };
}

function renameFolder(state, id, name) {
  getFolder(state, id);
  requireName(name);
  return { ...state, folders: state.folders.map(folder => folder.id === id ? { ...folder, name: name.trim() } : folder) };
}

function setExpanded(state, key, expanded) {
  if (typeof key !== 'string' || !/^(folder|workspace):.+$/.test(key) || typeof expanded !== 'boolean') {
    throw new Error('Invalid expansion entry');
  }
  if (key.startsWith('folder:')) getFolder(state, key.slice(7));
  return { ...state, expanded: { ...state.expanded, [key]: expanded } };
}

function subtreeIds(state, id) {
  getFolder(state, id);
  const children = new Map();
  for (const folder of state.folders) {
    if (!children.has(folder.parentId)) children.set(folder.parentId, []);
    children.get(folder.parentId).push(folder.id);
  }
  const result = new Set();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop();
    if (result.has(current)) continue;
    result.add(current);
    pending.push(...(children.get(current) || []));
  }
  return result;
}

function moveItems(state, items, target) {
  if (!record(target) || !Array.isArray(items)) throw new Error('Invalid move');
  requireText(target.workspaceId, 'Target workspace id');
  if (target.folderId !== null && getFolder(state, target.folderId).workspaceId !== target.workspaceId) {
    throw new Error('Cannot move across workspaces');
  }
  const folders = new Map(state.folders.map(folder => [folder.id, folder]));
  const selectedFolders = new Set();
  for (const item of items) {
    if (!record(item) || !['folder', 'session'].includes(item.kind)) throw new Error('Invalid move item');
    requireText(item.id, 'Item id');
    if (item.workspaceId !== target.workspaceId) throw new Error('Cannot move across workspaces');
    if (item.kind === 'folder') {
      if (getFolder(state, item.id).workspaceId !== target.workspaceId) throw new Error('Cannot move across workspaces');
      selectedFolders.add(item.id);
    } else {
      const current = own(state.sessionFolders, item.id) ? folders.get(state.sessionFolders[item.id]) : null;
      if (current && current.workspaceId !== target.workspaceId) throw new Error('Cannot move across workspaces');
    }
  }
  const hasSelectedAncestor = id => {
    while (id !== null && folders.has(id)) {
      if (selectedFolders.has(id)) return true;
      id = folders.get(id).parentId;
    }
    return false;
  };
  if (hasSelectedAncestor(target.folderId)) throw new Error('Cannot move a folder into itself or its descendant');
  const sessionFolders = { ...state.sessionFolders };
  for (const item of items) {
    if (item.kind !== 'session' || hasSelectedAncestor(own(sessionFolders, item.id) ? sessionFolders[item.id] : null)) continue;
    if (target.folderId === null) delete sessionFolders[item.id];
    else Object.defineProperty(sessionFolders, item.id, { value: target.folderId, enumerable: true, configurable: true, writable: true });
  }
  return {
    ...state,
    folders: state.folders.map(folder => selectedFolders.has(folder.id) && !hasSelectedAncestor(folder.parentId)
      ? { ...folder, parentId: target.folderId } : folder),
    sessionFolders,
  };
}

function deleteFolder(state, id) {
  const removed = subtreeIds(state, id);
  return {
    ...state,
    folders: state.folders.filter(folder => !removed.has(folder.id)),
    sessionFolders: Object.fromEntries(Object.entries(state.sessionFolders).filter(([, folderId]) => !removed.has(folderId))),
    expanded: Object.fromEntries(Object.entries(state.expanded).filter(([key]) => !removed.has(key.startsWith('folder:') ? key.slice(7) : null))),
  };
}

function folderSessionIds(state, id) {
  const folders = subtreeIds(state, id);
  return Object.entries(state.sessionFolders).filter(([, folderId]) => folders.has(folderId)).map(([sessionId]) => sessionId);
}

function rowsForWorkspace(state, workspaceId, sessions, { archivedIds = [], pinnedIds = [], showArchived = false } = {}) {
  const archived = new Set(archivedIds);
  const pinned = new Set(pinnedIds.filter(id => !archived.has(id)));
  const folders = state.folders.filter(folder => folder.workspaceId === workspaceId);
  const folderIds = new Set(folders.map(folder => folder.id));
  const children = new Map();
  const add = (parentId, row) => {
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(row);
  };
  for (const folder of folders) add(folder.parentId, { ...folder, kind: 'folder' });
  const visible = sessions.filter(session => (showArchived || !archived.has(session.id)) &&
    session.origin !== 'subagent' && !(session.blank && !(session.retainedBy?.mainView > 0)));
  const timestamp = session => typeof session.updatedAt === 'number' ? session.updatedAt : (Date.parse(session.updatedAt) || 0);
  visible.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || timestamp(b) - timestamp(a) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const session of visible) {
    const mapped = own(state.sessionFolders, session.id) ? state.sessionFolders[session.id] : null;
    const parentId = folderIds.has(mapped) ? mapped : null;
    add(parentId, { ...session, kind: 'session', workspaceId, parentId, archived: archived.has(session.id) });
  }
  const rows = [];
  const stack = (children.get(null) || []).map(row => ({ ...row, depth: 0 })).reverse();
  while (stack.length) {
    const row = stack.pop();
    rows.push(row);
    if (row.kind === 'folder' && state.expanded[`folder:${row.id}`] !== false) {
      const nested = children.get(row.id) || [];
      for (let index = nested.length - 1; index >= 0; index--) stack.push({ ...nested[index], depth: row.depth + 1 });
    }
  }
  return rows;
}

// Folder rows are never paged; each sibling session list has its own five-row watermark.
function pageRows(rows, limits = {}, attention = () => false) {
  const buckets = new Map();
  for (const row of rows) if (row.kind === 'session') {
    const key = row.parentId === null ? 'root' : 'folder:' + row.parentId;
    if (!buckets.has(key)) buckets.set(key, { total: 0, required: 5 });
    const bucket = buckets.get(key);
    if (!row.blank) {
      bucket.total++;
      if (bucket.total <= 50 && attention(row)) bucket.required = Math.max(bucket.required, bucket.total);
    }
    bucket.last = row;
  }
  const result = [];
  for (const row of rows) {
    if (row.kind !== 'session') { result.push(row); continue; }
    const key = row.parentId === null ? 'root' : 'folder:' + row.parentId;
    const bucket = buckets.get(key), limit = Math.max(limits[key] || 5, bucket.required);
    bucket.seen = (bucket.seen || 0) + (row.blank ? 0 : 1);
    if (row.blank || bucket.seen <= limit) result.push(row);
    if (row === bucket.last && bucket.total > 5) result.push({
      kind: 'overflow', id: key, workspaceId: row.workspaceId, depth: row.depth,
      hidden: Math.max(0, bucket.total - limit), limit,
    });
  }
  return result;
}

function selectItems(selection, anchor, key, visibleKeys, { ctrl = false, shift = false } = {}) {
  if (!/^(folder|session):.+$/.test(key) || !visibleKeys.includes(key)) throw new Error('Invalid or invisible selection key');
  if (shift && visibleKeys.includes(anchor)) {
    const start = visibleKeys.indexOf(anchor);
    const end = visibleKeys.indexOf(key);
    const range = visibleKeys.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { selection: ctrl ? [...new Set([...selection, ...range])] : range, anchor };
  }
  if (ctrl) {
    return { selection: selection.includes(key) ? selection.filter(item => item !== key) : [...new Set([...selection, key])], anchor: key };
  }
  return { selection: [key], anchor: key };
}

function sessionActivity(session, statuses, sessions) {
  const status = statuses.get(session.id);
  const runningChildren = sessions.projectionsBySession?.[session.id]?.values.subagentCatalog?.filter(child =>
    (statuses.get(child.id)?.running ?? sessions.byId[child.id]?.running) === true).length || 0;
  return { runningChildren, state: status?.pendingInteraction ? 'pending'
    : (status?.running ?? session.running) || runningChildren ? 'running' : status?.completionUnread ? 'unread' : 'idle' };
}

// Aggregate actual membership, not the expanded/paginated row projection.
function folderActivity(state, workspaces, sessions, statuses) {
  const folders = new Map(state.folders.map(folder => [folder.id, folder]));
  const counts = new Map(state.folders.map(folder => [folder.id, { pending: 0, running: 0, unread: 0, idle: 0, total: 0 }]));
  const archived = new Set(workspaces.archivedSessionIds);
  const seen = new Set();
  for (const workspace of workspaces.items) for (const id of workspace.sessionIds) {
    const session = sessions.byId[id], folder = folders.get(state.sessionFolders[id]);
    if (seen.has(id) || !session || session.origin === 'subagent' || archived.has(id) || !folder || folder.workspaceId !== workspace.workspaceId) continue;
    seen.add(id);
    const activity = sessionActivity(session, statuses, sessions).state;
    let current = folder;
    while (current) {
      const summary = counts.get(current.id);
      summary.total++; summary[activity]++;
      current = folders.get(current.parentId);
    }
  }
  return counts;
}

module.exports = {
  initialState, validateState, createFolder, renameFolder, setExpanded, moveItems,
  deleteFolder, folderSessionIds, rowsForWorkspace, pageRows, selectItems, sessionActivity, folderActivity,
};
