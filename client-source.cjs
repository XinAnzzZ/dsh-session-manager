'use strict';

module.exports = function createPlugin(React, model, persistence, ui) {
  const h = React.createElement;
  const KEY = 'dsh.session-manager.v1';
  const MODE_KEY = 'dsh.session-manager.tree-view';
  const NS = 'dsh-session-manager';
  const dictionaries = {
    zh: {
      summary: '含子文件夹', total: '未归档会话', idle: '空闲',
      title: '会话管理', folder: '新建文件夹', session: '新建会话', rename: '重命名', remove: '删除文件夹',
      pin: '置顶', unpin: '取消置顶', archive: '归档', restore: '恢复', archived: '已归档',
      cancel: '取消', save: '保存', root: '移至工作区根目录', archiveAll: '归档会话并删除',
      deleteMessage: '将删除此文件夹及子文件夹。请选择其中会话的处理方式（包括已归档会话的分组记录）。正在运行的会话不会被强制停止。',
      undo: '撤销移动', empty: '暂无会话', ungrouped: '未分组', name: '名称', loading: '正在加载…',
      incompatible: 'Session Manager 与当前 DSH 接口不兼容，已保留原生列表。',
      storageError: '分组数据无法读取；已保留原生列表，未覆盖已保存数据。',
      changed: '其他窗口更新了分组；撤销历史已清空。', moved: '移动完成，可按 Ctrl+Z 撤销',
      noMatches: '没有匹配的会话', refineSearch: '结果较多，请缩小搜索范围', restoreFirst: '已归档会话请先恢复后查看',
      search: '搜索会话', hideArchived: '隐藏已归档', more: '更多操作', noUndo: '暂无可撤销的移动', undone: '已撤销移动', noArchived: '暂无已归档会话',
      showMore: '展开其余 {n} 个会话', collapse: '收起会话', restored: '已恢复到原位置',
      'time.now': '刚刚', 'time.minutes': '{n}分钟', 'time.hours': '{n}小时', 'time.days': '{n}天', 'time.months': '{n}个月', 'time.years': '{n}年',
      failed: '操作失败', close: '关闭', selected: '已选择', workspace: '工作区',
      treeView: '使用树状列表', viewDescription: '关闭后使用原生列表，文件夹分组数据保留。', running: '运行中', pending: '等待处理', unread: '完成未读',
    },
    en: {
      summary: 'Includes subfolders', total: 'Unarchived sessions', idle: 'Idle',
      title: 'Session Manager', folder: 'New folder', session: 'New session', rename: 'Rename', remove: 'Delete folder',
      pin: 'Pin', unpin: 'Unpin', archive: 'Archive', restore: 'Restore', archived: 'Archived',
      cancel: 'Cancel', save: 'Save', root: 'Move sessions to workspace root', archiveAll: 'Archive sessions and delete',
      deleteMessage: 'Delete this folder and its subfolders. Choose what happens to their sessions, including archived assignments. Running sessions will not be forcibly stopped.',
      undo: 'Undo move', empty: 'No sessions', ungrouped: 'Ungrouped', name: 'Name', loading: 'Loading…',
      incompatible: 'Session Manager is incompatible with this DSH interface. The native list was retained.',
      storageError: 'Folder data could not be read. The native list and saved data were retained.',
      changed: 'Another window updated folders; undo history was cleared.', moved: 'Moved. Press Ctrl+Z to undo.',
      noMatches: 'No matching sessions', refineSearch: 'More results available. Refine your search.', restoreFirst: 'Restore this archived session before opening it.',
      search: 'Search sessions', hideArchived: 'Hide archived', more: 'More actions', noUndo: 'No moves to undo', undone: 'Move undone', noArchived: 'No archived sessions',
      showMore: 'Show {n} more sessions', collapse: 'Collapse sessions', restored: 'Restored to original location',
      'time.now': 'Now', 'time.minutes': '{n}m', 'time.hours': '{n}h', 'time.days': '{n}d', 'time.months': '{n}mo', 'time.years': '{n}y',
      failed: 'Operation failed', close: 'Close', selected: 'Selected', workspace: 'Workspace',
      treeView: 'Use tree view', viewDescription: 'Turn off to use the native list. Folder assignments are retained.', running: 'Running', pending: 'Needs attention', unread: 'Unread completion',
    },
  };
  const workspaceKey = (id) => 'workspace:' + JSON.stringify(id);
  function useSource(source) {
    return React.useSyncExternalStore(source.subscribe, source.getSnapshot);
  }
  const icon = (name, props) => h(ui['Icon' + name + 'Regular'], { size: 16, ...props });
  function FolderIcon({ depth, open = true }) {
    return h('span', { className: 'dsmgr-folder-icon', style: depth === undefined ? undefined : {
      color: ['var(--dsw-static-blue-400)', 'var(--dsw-static-amber-400)', 'var(--dsw-static-green-400)'][depth % 3],
    } }, icon(open ? 'FolderOpen' : 'FolderClose'));
  }
  function Actions({ label, items, disabled = false }) {
    const [open, setOpen] = React.useState(false);
    return h(ui.Menu, { open, onClose: () => setOpen(false), portal: true, align: 'end',
      items: items.map((item) => ({ ...item, disabled: disabled || item.disabled })),
      onSelect: (id) => { setOpen(false); items.find((item) => item.id === id)?.action(); },
      anchor: h('button', { type: 'button', className: 'dsmgr-icon-button', title: label, 'aria-label': label,
        'aria-haspopup': 'menu', 'aria-expanded': open, disabled,
        onClick: (event) => { event.stopPropagation(); setOpen(!open); } }, icon('EllipsisOutline')) });
  }
  function Dialog({ title, children, footer, onClose, closeLabel }) {
    return h(ui.Modal, { open: true, title, onClose, closeLabel, footer }, children);
  }
  function NameDialog({ title, initial = '', t, onSave, onClose }) {
    const [name, setName] = React.useState(initial);
    const [error, setError] = React.useState('');
    return h(Dialog, { title, onClose, closeLabel: t('close'), footer: [
      h(ui.Button, { key: 'cancel', variant: 'outline', type: 'button', onClick: onClose }, t('cancel')),
      h(ui.Button, { key: 'save', variant: 'primary', type: 'submit', form: 'dsmgr-name-form', disabled: !name.trim() }, t('save')),
    ] }, h('form', { id: 'dsmgr-name-form', onSubmit: (event) => {
      event.preventDefault(); if (!name.trim()) return;
      try { onSave(name.trim()); onClose(); } catch (reason) { console.error('DSH Session Manager:', reason); setError(reason.message); }
    } }, h('input', { className: 'dsmgr-name-input', 'aria-label': t('name'), 'data-modal-autofocus': true,
      value: name, maxLength: 120, onFocus: (event) => event.target.select(),
      onChange: (event) => { setName(event.target.value); setError(''); }, onKeyDown: (event) => {
        if (event.key === 'Enter' && (event.nativeEvent?.isComposing || event.keyCode === 229)) event.preventDefault();
      } })), error && h('p', { className: 'dsmgr-name-error', role: 'alert' }, error));
  }
  return {
    inject: ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale'],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'session-manager: locale');
      const t = ctx.locale.bind(NS);
      let store;
      try { store = persistence.createStore(window.localStorage, KEY); }
      catch (error) { console.error(t('storageError'), error); return; }
      const source = (service) => ({ subscribe: (listener) => service.list.subscribe(listener), getSnapshot: () => service.list.getSnapshot() });
      const sessionSource = source(ctx.sessions), workspaceSource = source(ctx.workspaces);
      let adapter, dragging = null, disposeTree;
      let searchRequest = 0;
      const searchListeners = new Set();
      const searchSource = { subscribe: (listener) => { searchListeners.add(listener); return () => searchListeners.delete(listener); },
        getSnapshot: () => searchRequest };
      const requestSearch = () => { searchRequest++; for (const listener of searchListeners) listener(); };
      function report(error) { console.error('DSH Session Manager:', error); }
      // shortcut: native dialog callbacks are introspected in 0.2.1-rc.2; use a public action API when DSH exposes one.
      function discover() {
        const native = ctx.slots.entries('sidebar.workspaces').find((entry) => (entry.options?.priority ?? 0) === 0 && entry.inject);
        const face = native?.inject();
        const archive = ctx.slots.entries('sidebar.workspaces.session.menu.item').find((entry) => entry.options?.id === 'archive')?.inject?.();
        if (typeof face?.requestSessionRename !== 'function' || typeof archive?.archiveSession !== 'function'
          || typeof ctx.sessions.create !== 'function' || typeof ctx.uiWorkspace.openSession !== 'function') return null;
        return { rename: face.requestSessionRename, archive: archive.archiveSession };
      }
      function Tree({ wide, expandSidebar, useSessionStatus, usePanelInfo }) {
        const state = useSource(store), sessions = useSource(sessionSource), workspaces = useSource(workspaceSource);
        const statuses = useSessionStatus((value) => value);
        const panelActive = usePanelInfo((info) => info.activePanelId !== null);
        const [selection, setSelection] = React.useState({ selection: [], anchor: null });
        const [dialog, setDialog] = React.useState(null), [message, setMessage] = React.useState('');
        const [busy, setBusy] = React.useState(false), [showArchived, setShowArchived] = React.useState(false);
        const [limits, setLimits] = React.useState({});
        const [searchOpen, setSearchOpen] = React.useState(false), [query, setQuery] = React.useState('');
        const [remote, setRemote] = React.useState({ query: '', items: [], hasMore: false });
        const searchRevision = useSource(searchSource), searchRef = React.useRef(null);
        const rootRef = React.useRef(null);
        const normalizedQuery = query.trim(), q = normalizedQuery.toLowerCase();
        React.useEffect(() => { if (searchRevision) { setSearchOpen(true); if (!wide) expandSidebar(); } }, [searchRevision]);
        React.useEffect(() => { if (searchOpen && wide) searchRef.current?.focus(); }, [searchOpen, searchRevision, wide]);
        React.useEffect(() => {
          if (!q) { setRemote({ query: '', items: [], hasMore: false }); return; }
          const controller = new AbortController();
          setRemote({ query: q, items: [], hasMore: false, loading: true });
          const timer = setTimeout(async () => {
            try {
              const result = await ctx.sessions.search(normalizedQuery, controller.signal);
              if (controller.signal.aborted) return;
              if (!result.ok) throw new Error(result.error.message);
              setRemote({ query: q, ...result.value });
            } catch (error) {
              if (!controller.signal.aborted) { report(error); setRemote({ query: q, items: [], hasMore: false }); }
            }
          }, 250);
          return () => { clearTimeout(timer); controller.abort(); };
        }, [normalizedQuery]);
        const accounted = new Set(workspaces.items.flatMap((item) => item.sessionIds));
        const groups = [...workspaces.items, { workspaceId: '', title: t('ungrouped'), sessionIds: sessions.ids.filter((id) => !accounted.has(id)) }];
        const archived = new Set(workspaces.archivedSessionIds), pinned = new Set(workspaces.pinnedSessionIds);
        const attention = (row) => {
          const status = statuses.get(row.id);
          return row.retainedBy?.mainView > 0 || (status?.running ?? row.running) || status?.pendingInteraction || status?.completionUnread;
        };
        const groupsWithRows = groups.map((group) => ({ ...group, rows: model.pageRows(model.rowsForWorkspace(state, group.workspaceId,
          group.sessionIds.map((id) => sessions.byId[id]).filter(Boolean), { archivedIds: [...archived], pinnedIds: [...pinned], showArchived }), limits[group.workspaceId], attention) }));
        const matches = new Map();
        const include = (session, group, snippet) => {
          if (!session || session.blank || session.origin === 'subagent' || (!showArchived && archived.has(session.id))) return;
          if (!matches.has(session.id)) matches.set(session.id, { ...session, kind: 'session', workspaceId: group.workspaceId,
            workspaceTitle: group.title || group.path, depth: 0, archived: archived.has(session.id), snippet });
          else if (snippet) matches.get(session.id).snippet = snippet;
        };
        if (q) {
          const local = groups.flatMap((group) => group.sessionIds.map((id) => ({ session: sessions.byId[id], group })))
            .filter(({ session, group }) => session && [session.displayTitle, session.title, group.title, group.path]
              .some((value) => value?.toLowerCase().includes(q)))
            .sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime());
          for (const { session, group } of local) include(session, group);
          if (remote.query === q) for (const hit of remote.items) include(sessions.byId[hit.sessionId],
            groups.find((group) => group.sessionIds.includes(hit.sessionId)) || groups.at(-1), hit.snippet);
        }
        const visible = q ? [...matches.values()].slice(0, 20) : groupsWithRows.flatMap((group) => state.expanded[workspaceKey(group.workspaceId)] === false ? [] : group.rows.filter((row) => row.kind !== 'overflow'));
        const keyOf = (row) => row.kind + ':' + row.id;
        const chosen = new Set(selection.selection);
        const safe = (action) => async () => {
          if (busy) return;
          setBusy(true);
          try { await action(); } catch (error) { report(error); setMessage(t('failed') + ': ' + error.message); }
          finally { setBusy(false); }
        };
        function change(transform, options) { store.update(transform, options); }
        function select(event, row) {
          setSelection((previous) => model.selectItems(previous.selection, previous.anchor, keyOf(row), visible.map(keyOf),
            { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey }));
        }
        function rename(row) {
          if (row.kind === 'folder') setDialog({ type: 'rename', row });
          else if (!row.blank && !row.archived) adapter.rename(row.id, row.title?.trim() ?? '');
        }
        async function newSession(workspaceId, folderId) {
          const id = await ctx.sessions.create({ workspaceId });
          if (folderId) change((previous) => model.moveItems(previous, [{ kind: 'session', id, workspaceId }], { workspaceId, folderId }));
          ctx.uiWorkspace.openSession(id);
        }
        function drop(event, workspaceId, folderId) {
          event.preventDefault(); event.stopPropagation();
          if (!dragging || busy) return;
          try { const before = store.getSnapshot();
            change((previous) => model.moveItems(previous, dragging, { workspaceId, folderId }), { drag: true });
            setSelection({ selection: [], anchor: null });
            if (store.getSnapshot() !== before) setMessage(t('moved'));
          } catch (error) { report(error); setMessage(t('failed') + ': ' + error.message); }
          dragging = null;
        }
        React.useEffect(() => {
          const listener = (event) => {
            if (event.storageArea !== window.localStorage || (event.key !== KEY && event.key !== null)) return;
            try { store.reload(window.localStorage.getItem(KEY)); setMessage(t('changed')); }
            catch (error) { report(error); setMessage(t('failed') + ': ' + error.message); }
          };
          window.addEventListener('storage', listener);
          return () => window.removeEventListener('storage', listener);
        }, []);
        const button = (label, onClick, danger = false) => h(ui.Button, { key: label, variant: 'outline', type: 'button', className: danger ? 'dsmgr-delete-danger' : undefined, title: label, 'aria-label': label,
          disabled: busy, onClick: (event) => { event.stopPropagation(); onClick(event); } }, label);
        const iconButton = (label, artwork, onClick, disabled = false) => h('button', { type: 'button', className: 'dsmgr-icon-button',
          title: label, 'aria-label': label, disabled: disabled || busy,
          onClick: (event) => { event.stopPropagation(); onClick(event); } }, icon(artwork));
        const item = (id, label, artwork, action, disabled = false, danger = false) => ({ id, label, icon: icon(artwork), action, disabled, danger });
        const undo = () => { store.undo(); setMessage(t('undone')); };
        const folderCounts = model.folderActivity(state, workspaces, sessions, statuses);
        function folderSummary(id) {
          const counts = folderCounts.get(id);
          if (!counts || !(counts.pending || counts.running || counts.unread)) return null;
          const summary = t('summary') + '\n' + ['pending', 'running', 'unread', 'idle', 'total'].map(key => t(key) + ': ' + counts[key]).join('\n');
          return h(ui.HoverCard, { inline: true, content: h('div', { style: { whiteSpace: 'pre-line' } }, summary), anchor:
            h('span', { className: 'dsmgr-folder-summary', tabIndex: 0, role: 'img', 'aria-label': summary },
            ['pending', 'running', 'unread'].filter(key => counts[key]).map(key => h('span', {
              key, className: 'dsmgr-folder-count', 'data-activity': key,
            }, key === 'running' ? h(ui.StateDot, { state: 'ongoing', size: 14 })
              : icon(key === 'pending' ? 'WarningOutline' : 'CheckCircleOutline', { size: 14 }),
            h('span', null, counts[key])))) });
        }
        function rowView(row) {
          if (row.kind === 'overflow') return h('button', { key: 'overflow:' + row.id, type: 'button', className: 'dsmgr-overflow',
            style: { paddingLeft: 28 + row.depth * 20 }, onClick: () => setLimits((previous) => ({ ...previous,
              [row.workspaceId]: { ...previous[row.workspaceId], [row.id]: row.hidden ? row.limit + 5 : 5 },
            })) }, row.hidden ? t('showMore', { n: row.hidden }) : t('collapse'));
          const key = keyOf(row), folder = row.kind === 'folder', expanded = state.expanded['folder:' + row.id] !== false;
          const status = statuses.get(row.id);
          const { state: activity, runningChildren } = model.sessionActivity(row, statuses, sessions);
          const running = activity === 'running';
          const statusLabel = status?.pendingInteraction ? t('pending') + ': ' + status.pendingInteraction.kind
            : running || runningChildren ? t('running') : status?.completionUnread ? t('unread') : '';
          return h('div', { key, role: 'treeitem', tabIndex: 0, className: 'dsmgr-row' + (chosen.has(key) ? ' dsmgr-selected' : ''),
            'data-dsm-key': key, 'aria-level': row.depth + 2, 'aria-selected': chosen.has(key),
            'aria-current': !panelActive && !folder && row.retainedBy?.mainView > 0 ? 'page' : undefined,
            'aria-expanded': folder ? expanded : undefined, draggable: !busy && !row.archived,
            style: { paddingLeft: 8 + 20 * (row.depth + (folder ? 1 : 0)) },
            'data-kind': row.kind, 'data-archived': !folder && row.archived || undefined,
            onClick: (event) => {
              select(event, row);
              if (event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (folder && event.detail < 2) safe(() => change((previous) => model.setExpanded(previous, 'folder:' + row.id, !expanded)))();
              else if (!folder) {
                if (row.archived) setMessage(t('restoreFirst'));
                else Promise.resolve().then(() => ctx.uiWorkspace.openSession(row.id)).catch(error => { report(error); setMessage(t('failed') + ': ' + error.message); });
              }
            },
            onDoubleClick: (event) => { event.stopPropagation(); if (!event.ctrlKey && !event.shiftKey && !event.metaKey) rename(row); },
            onDragStart: (event) => {
              const keys = chosen.has(key) ? chosen : new Set([key]);
              dragging = visible.filter((item) => !item.archived && keys.has(keyOf(item))).map(({ kind, id, workspaceId }) => ({ kind, id, workspaceId }));
              setSelection({ selection: [...keys], anchor: key });
              event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-dsh-session-manager', 'move');
            }, onDragEnd: () => { dragging = null; },
            onDragOver: folder ? (event) => { if (dragging) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; } } : undefined,
            onDrop: folder ? (event) => drop(event, row.workspaceId, row.id) : undefined,
          }, folder ? h(FolderIcon, { depth: row.depth, open: expanded }) : h('span', {
            className: 'dsmgr-status ' + (status?.pendingInteraction ? 'dsmgr-pending' : statusLabel ? 'dsmgr-running' : ''),
            title: statusLabel, 'aria-label': statusLabel || undefined }, !row.archived && statusLabel && h(ui.StateDot, {
              state: status?.pendingInteraction ? 'warning' : running || runningChildren ? 'ongoing' : 'done',
            })),
          !folder && runningChildren > 0 && h('small', { title: t('running'), 'aria-label': t('running') + ': ' + runningChildren }, '+' + runningChildren),
          h('span', { className: 'dsmgr-label', title: row.name || row.displayTitle || row.title }, folder ? row.name : row.displayTitle || row.title || t('session')),
          folder && folderSummary(row.id),
          !folder && !row.blank && h('span', { className: 'dsmgr-time' }, (() => {
            const { unit, n } = ui.relativeTime(row.updatedAt, Date.now()); return t('time.' + unit, { n });
          })()),
          !folder && !row.archived && pinned.has(row.id) && h('span', { className: 'dsmgr-pin', 'aria-label': t('pin'), title: t('pin') }, icon('PinFill', { size: 14 })),
          h('span', { className: 'dsmgr-actions', onClick: (event) => event.stopPropagation(), onDoubleClick: (event) => event.stopPropagation(), draggable: false,
            onDragStart: (event) => event.preventDefault() },
          h(Actions, { label: t('more'), disabled: busy, items: folder ? [
            item('folder', t('folder'), 'FolderClose', () => setDialog({ type: 'create', workspaceId: row.workspaceId, parentId: row.id })),
            item('session', t('session'), 'NewChatOutline', safe(() => newSession(row.workspaceId, row.id)), !row.workspaceId),
            item('rename', t('rename'), 'EditOutline', () => rename(row)),
            item('delete', t('remove'), 'TrashOutline', () => setDialog({ type: 'delete', row }), false, true),
          ] : row.archived ? [
            item('restore', t('restore'), 'UnarchiveOutline', safe(async () => {
              await ctx.uiWorkspace.unarchiveSession(row.id); setMessage(t('restored'));
            })),
          ] : [
            item('pin', pinned.has(row.id) ? t('unpin') : t('pin'), 'PinOutline', safe(() => pinned.has(row.id) ? ctx.uiWorkspace.unpinSession(row.id) : ctx.uiWorkspace.pinSession(row.id))),
            item('rename', t('rename'), 'EditOutline', () => rename(row), row.blank),
            item('archive', t('archive'), 'ArchiveOutline', safe(() => adapter.archive(row.id)), row.blank),
          ] }),
          folder && iconButton(t('session'), 'NewChatOutline', safe(() => newSession(row.workspaceId, row.id)), !row.workspaceId)));

        }
        async function removeFolder(archive) {
          const id = dialog.row.id;
          if (archive) for (const sessionId of model.folderSessionIds(store.getSnapshot(), id)) {
            if (!archived.has(sessionId) && sessions.byId[sessionId]) await ctx.uiWorkspace.archiveSession(sessionId);
          }
          change((previous) => model.deleteFolder(previous, id)); setDialog(null);
        }
        function keyboard(event) {
          if (event.target.closest('input,textarea,dialog,button') || busy) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
            if (store.canUndo()) { event.preventDefault(); event.stopPropagation(); safe(undo)(); } return;
          }
          const elements = [...rootRef.current.querySelectorAll('[role=treeitem]')];
          const index = elements.indexOf(event.target.closest('[role=treeitem]'));
          const row = visible.find((item) => keyOf(item) === event.target.closest('[data-dsm-key]')?.dataset.dsmKey);
          if (event.key === 'F2' && row) { event.preventDefault(); rename(row); }
          if (event.key === 'Enter') { event.preventDefault(); event.target.click(); }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? elements.length - 1
              : Math.max(0, Math.min(elements.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            elements[next]?.focus();
          }
          if (row?.kind === 'folder' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault(); safe(() => change((previous) => model.setExpanded(previous, 'folder:' + row.id, event.key === 'ArrowRight')))();
          }
        }
        if (!wide) return h('button', { type: 'button', className: 'dsmgr-expand', title: t('title'), onClick: expandSidebar }, h(FolderIcon, {}));
        return h('section', { className: 'dsmgr', ref: rootRef, onKeyDown: keyboard, 'aria-label': t('title') },
          h('style', null, styles), h('header', null, !searchOpen && h('span', { className: 'dsmgr-heading' }, t('workspace')),
            searchOpen ? h('div', { className: 'dsmgr-search' }, icon('SearchOutline'),
              h('input', { ref: searchRef, type: 'text', value: query, maxLength: 500, 'aria-label': t('search'), placeholder: t('search'),
                onChange: (event) => { const value = event.target.value.replaceAll('\0', '');
                  setQuery(Array.from(value).reduce((text, char) => text.length + char.length <= 500 ? text + char : text, '')); },
                onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); setQuery(''); setSearchOpen(false); } } }),
              iconButton(t('close'), 'CloseOutline', () => { setQuery(''); setSearchOpen(false); }))
              : iconButton(t('search'), 'SearchOutline', () => setSearchOpen(true)),

            h(Actions, { label: t('more'), disabled: busy, items: [
              item('archived', t(showArchived ? 'hideArchived' : 'archived'), 'ArchiveOutline', () => setShowArchived((shown) => !shown)),
            ] })), 
          h('div', { className: 'dsmgr-tree', role: 'tree', 'aria-label': t('title'), 'aria-multiselectable': true },
            (sessions.phase !== 'ready' || workspaces.phase !== 'ready') && h('p', null, t('loading')),
            q ? h('div', { className: 'dsmgr-search-results' }, [...matches.values()].slice(0, 20).map((row) => h('div', { key: row.id },
              rowView(row), h('div', { className: 'dsmgr-search-meta' }, row.workspaceTitle,
                row.snippet && h('span', null, row.snippet)))),
              remote.query === q && remote.loading && h('p', { role: 'status', className: 'dsmgr-hint' }, t('loading')),
              !matches.size && !(remote.query === q && remote.loading) && h('p', { className: 'dsmgr-hint' }, t('noMatches')),
              (matches.size > 20 || remote.query === q && remote.hasMore) && h('p', { className: 'dsmgr-hint' }, t('refineSearch')))
              : groupsWithRows.filter((group) => group.workspaceId || group.rows.length).map((group) => {
              const open = state.expanded[workspaceKey(group.workspaceId)] !== false;
              return h('div', { key: group.workspaceId }, h('div', { role: 'treeitem', 'aria-level': 1, 'aria-expanded': open,
                tabIndex: 0, className: 'dsmgr-row dsmgr-workspace', title: group.path,
                onClick: safe(() => change((previous) => model.setExpanded(previous, workspaceKey(group.workspaceId), !open))),
                onDragOver: (event) => { if (dragging) event.preventDefault(); }, onDrop: (event) => drop(event, group.workspaceId, null) },
              h(FolderIcon, { open }),
              h('span', { className: 'dsmgr-label' }, group.title || group.path?.split(/[\\/]/).filter(Boolean).at(-1) || t('workspace')),
              group.workspaceId && h('span', { className: 'dsmgr-actions' },
                h(Actions, { label: t('more'), disabled: busy, items: [
                  item('folder', t('folder'), 'FolderClose', () => setDialog({ type: 'create', workspaceId: group.workspaceId, parentId: null })),
                  item('session', t('session'), 'NewChatOutline', safe(() => newSession(group.workspaceId, null))),
                ] }), iconButton(t('session'), 'NewChatOutline', safe(() => newSession(group.workspaceId, null))))),
              open && group.rows.map(rowView), open && group.rows.length === 0 && h('p', { className: 'dsmgr-hint' }, t('empty')));
            })),
          message && h('p', { role: 'status', 'aria-live': 'polite', className: 'dsmgr-message' }, message),
          dialog && (dialog.type === 'delete' ? h(Dialog, { title: t('remove'), closeLabel: t('close'), onClose: () => !busy && setDialog(null), footer:
            h('div', { className: 'dsmgr-delete-actions' },
              button(t('root'), safe(() => removeFolder(false))),
              button(t('archiveAll'), safe(() => removeFolder(true)), true),
              button(t('cancel'), () => setDialog(null)))
          }, h('p', { className: 'dsmgr-delete-message' }, t('deleteMessage')), busy && h('p', null, t('loading')))
            : h(NameDialog, { key: dialog.type + (dialog.row?.id || ''), title: t(dialog.type === 'create' ? 'folder' : 'rename'),
              initial: dialog.row?.name, t, onClose: () => setDialog(null), onSave: (name) => change((previous) => dialog.type === 'create'
                ? model.createFolder(previous, { id: crypto.randomUUID(), workspaceId: dialog.workspaceId, parentId: dialog.parentId, name })
                : model.renameFolder(previous, dialog.row.id, name)) })));
      }
      ctx.effect(() => {
        let reconciling = false, nativeMode = false;
        try { nativeMode = window.localStorage.getItem(MODE_KEY) === 'false'; }
        catch (error) { report(error); }
        const modeListeners = new Set();
        const modeSource = { subscribe: (listener) => { modeListeners.add(listener); return () => modeListeners.delete(listener); },
          getSnapshot: () => nativeMode };
        const reconcile = () => {
          if (reconciling) return; reconciling = true;
          try {
            adapter = discover();
            if ((!adapter || nativeMode) && disposeTree) {
              const dispose = disposeTree; disposeTree = undefined; dispose();
              if (!adapter) console.warn(t('incompatible'));
            } else if (adapter && !nativeMode && !disposeTree) disposeTree = ctx.slots.register({ name: 'sidebar.workspaces', priority: -10, locale: NS }, Tree);
          } catch (error) { report(error); }
          finally { reconciling = false; }
        };
        const dispose = ctx.slots.subscribe('sidebar.workspaces', reconcile);
        const disposeMenu = ctx.slots.subscribe('sidebar.workspaces.session.menu.item', reconcile);
        const shortcuts = ctx.slots.entries('sidebar.workspaces').find((entry) => (entry.options?.priority ?? 0) === 0 && entry.inject)?.inject()?.hooks?.workspaceShortcuts;
        let lastSearchRequest = shortcuts?.getSnapshot().searchRequest;
        const disposeSearch = shortcuts?.subscribe(() => {
          const next = shortcuts.getSnapshot().searchRequest;
          if (next !== lastSearchRequest) { lastSearchRequest = next; if (!nativeMode) requestSearch(); }
        });

        function Settings() {
          const native = useSource(modeSource), [error, setError] = React.useState('');
          return h('section', null, h('h2', null, t('title')),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 } },
              h('div', null, h('div', null, t('treeView')), h('p', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('viewDescription'))),
              h(ui.Switch, { checked: !native, label: t('treeView'), onChange: (checked) => {
                try {
                  window.localStorage.setItem(MODE_KEY, String(checked));
                  nativeMode = !checked; reconcile(); for (const listener of modeListeners) listener(); setError('');
                } catch (reason) { report(reason); setError(reason.message); }
              } })), error && h('p', { role: 'alert' }, error));
        }
        const disposeSettings = ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: NS, order: 50, locale: NS, label: () => t('title'),
        }, Settings));
        const syncMode = (event) => {
          if (event.storageArea && event.storageArea !== window.localStorage) return;
          if (event.key !== null && event.key !== MODE_KEY) return;
          try {
            nativeMode = window.localStorage.getItem(MODE_KEY) === 'false';
            reconcile(); for (const listener of modeListeners) listener();
          } catch (error) { report(error); }
        };
        window.addEventListener('storage', syncMode);
        reconcile();
        return () => { dispose(); disposeMenu(); disposeSearch?.(); disposeSettings(); window.removeEventListener('storage', syncMode); disposeTree?.(); disposeTree = undefined; };
      }, 'session-manager: sidebar tree');
    },
  };
};

const styles = `
.dsmgr{display:flex;flex-direction:column;min-height:0;font:inherit;color:var(--dsw-alias-label-primary);height:100%;padding-right:var(--dsh-sidebar-inline-padding,8px);box-sizing:border-box}
.dsmgr header{display:flex;align-items:center;gap:4px;height:36px;min-height:36px;margin:2px -4px 4px 0;padding-left:4px;color:var(--dsw-alias-label-tertiary)}.dsmgr-heading{flex:1;font-weight:400}.dsmgr button,.dsmgr-dialog button{font:inherit;cursor:pointer}.dsmgr-tree{min-height:0;overflow:auto;flex:1}.dsmgr-row{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:var(--dsw-radius-md);cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);flex-shrink:0}
.dsmgr-row:hover,.dsmgr-row[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover)}.dsmgr-selected[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dsmgr-workspace,.dsmgr-row[data-kind=folder]{height:34px}.dsmgr-workspace{margin-top:8px}.dsmgr-label{font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.dsmgr-row[data-kind=session]{gap:0}.dsmgr-row[data-kind=session]>.dsmgr-label{margin:0 6px 0 4px}.dsmgr-status,.dsmgr-folder-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsmgr-folder-summary{display:inline-flex;gap:8px;flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}.dsmgr-folder-count{display:inline-flex;align-items:center;gap:4px}.dsmgr-folder-count[data-activity=pending]>svg{color:var(--dsw-alias-state-warn-primary)}.dsmgr-folder-count[data-activity=unread]>svg{color:var(--dsw-alias-state-success-primary)}
.dsmgr-row[data-kind=folder]{width:100%;container-type:inline-size}@container(max-width:260px){.dsmgr-folder-count~.dsmgr-folder-count{display:none}}
.dsmgr-time{font-size:10px;line-height:16px;flex:none;color:var(--dsw-alias-label-tertiary)}.dsmgr-pin{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;margin-left:6px;flex:none;color:var(--dsw-alias-label-caption)}
.dsmgr-actions{display:none;align-items:center;gap:15px;flex:none}.dsmgr-row:hover>.dsmgr-actions,.dsmgr-row:focus-within>.dsmgr-actions,.dsmgr-actions:has([aria-expanded=true]){display:inline-flex}.dsmgr-row:hover>.dsmgr-time,.dsmgr-row:hover>.dsmgr-pin,.dsmgr-row:focus-within>.dsmgr-time,.dsmgr-row:focus-within>.dsmgr-pin{display:none}
.dsmgr-icon-button{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;padding:0;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}.dsmgr header .dsmgr-icon-button{width:28px;height:28px}.dsmgr-icon-button:hover{color:var(--dsw-alias-label-primary)}.dsmgr header .dsmgr-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsmgr button:disabled,.dsmgr-dialog button:disabled{opacity:.4;cursor:default}.dsmgr button:focus-visible,.dsmgr-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsmgr-overflow{display:block;text-align:left;font-size:12px!important;line-height:20px;color:var(--dsw-alias-label-tertiary);background:transparent;border:0;padding:4px 8px}.dsmgr-overflow:hover{color:var(--dsw-alias-label-primary)}.dsmgr-hint,.dsmgr-message{font-size:12px;padding:2px 10px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dsmgr-message{white-space:pre-wrap}
.dsmgr-name-input{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:transparent;outline:none;padding:7px 14px;font-family:var(--dsw-font-family);font-size:14px;font-weight:400;line-height:22px}
.dsmgr-delete-actions{display:flex;flex-direction:column;gap:8px;width:100%;min-width:0}.dsmgr-delete-actions>button{width:100%;flex-shrink:0;white-space:nowrap;font:inherit;font-size:14px;line-height:22px}.dsmgr-delete-actions>.dsmgr-delete-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.dsmgr-delete-message{margin:0;font-size:14px;line-height:22px;overflow-wrap:anywhere}
.dsmgr-name-error{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}
.dsmgr-row[data-archived=true]>.dsmgr-label{color:var(--dsw-alias-label-caption)}
.dsmgr-search{display:flex;align-items:center;gap:4px;min-width:0;flex:1;color:var(--dsw-alias-label-secondary)}.dsmgr-search input{font:inherit;color:var(--dsw-alias-label-primary);background:transparent;border:0;outline:none;min-width:0;width:100%}.dsmgr-search:focus-within{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));border-radius:var(--dsw-radius-sm)}
.dsmgr-search-meta{display:flex;gap:6px;margin:0 8px 4px 28px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.dsmgr-search-meta span{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsmgr-expand{background:transparent;border:0;color:inherit;cursor:pointer;padding:12px}
`;
