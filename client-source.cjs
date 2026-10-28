'use strict';

module.exports = function createPlugin(React, model, persistence, ui) {
  const h = React.createElement;
  const KEY = 'dsh.session-manager.v1';
  const MODE_KEY = 'dsh.session-manager.tree-view';
  const COLOR_KEY = 'dsh.session-manager.folder-colors';
  // Light-theme defaults per nesting level; the stylesheet carries the dark-theme pair.
  const TONES = ['#8b5cf6', '#0d9488', '#db2777'];
  const NS = 'dsh-session-manager';
  const dictionaries = {
    zh: {
      summary: '含子文件夹', workspaceSummary: '含工作区内所有文件夹', totalSummary: '所有工作区（含未分组）', total: '未归档会话', idle: '空闲',
      title: '会话管理', folder: '新建文件夹', session: '新建会话', rename: '重命名', remove: '删除文件夹',
      pin: '置顶', unpin: '取消置顶', archive: '归档', restore: '恢复', archived: '已归档',
      cancel: '取消', save: '保存', delete: '删除', archiveSessions: '同时归档其中会话',
      deleteMessage: '将删除此文件夹及子文件夹，其中会话（包括已归档会话的分组记录）移至工作区根目录。正在运行的会话不会被强制停止。',
      subagents: '{n} 个子代理运行中', 'time.ago': '{t}前',
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
      folderColors: '文件夹颜色', folderColorsDescription: '从左到右对应第 1、2、3 级，更深层级循环使用。默认颜色随深浅色主题调整，自定义后两种主题使用同一颜色。',
      level: '第 {n} 级', resetColors: '恢复默认', jump: '{label} {n} 个，查看',
    },
    en: {
      summary: 'Includes subfolders', workspaceSummary: 'Includes all folders in this workspace', totalSummary: 'All workspaces, including ungrouped', total: 'Unarchived sessions', idle: 'Idle',
      title: 'Session Manager', folder: 'New folder', session: 'New session', rename: 'Rename', remove: 'Delete folder',
      pin: 'Pin', unpin: 'Unpin', archive: 'Archive', restore: 'Restore', archived: 'Archived',
      cancel: 'Cancel', save: 'Save', delete: 'Delete', archiveSessions: 'Also archive its sessions',
      deleteMessage: 'Delete this folder and its subfolders. Their sessions, including archived assignments, move to the workspace root. Running sessions will not be forcibly stopped.',
      subagents: '{n} running subagents', 'time.ago': '{t} ago',
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
      folderColors: 'Folder colors', folderColorsDescription: 'Levels 1, 2 and 3 from left to right; deeper levels repeat the cycle. Defaults adapt to light and dark themes; a custom color applies to both.',
      level: 'Level {n}', resetColors: 'Reset', jump: '{label}: {n}, show',
    },
  };
  const workspaceKey = (id) => 'workspace:' + JSON.stringify(id);
  function useSource(source) {
    return React.useSyncExternalStore(source.subscribe, source.getSnapshot);
  }
  const icon = (name, props) => h(ui['Icon' + name + 'Regular'], { size: 16, ...props });
  // Nesting level tint cycles violet → teal → pink; hues avoid the native state colors (blue/amber/green/red).
  function FolderIcon({ depth, open = true }) {
    return h('span', { className: 'dsmgr-folder-icon', 'data-tone': depth === undefined ? undefined : depth % 3 }, icon(open ? 'FolderOpen' : 'FolderClose'));
  }
  // point: viewport coordinates of a right-click; the menu then opens at the cursor instead of under the button.
  function Actions({ label, items, disabled = false, point = null, onPointClose }) {
    const [open, setOpen] = React.useState(false);
    const shown = open || point !== null;
    const close = () => { setOpen(false); onPointClose?.(); };
    return h(ui.Menu, { open: shown, onClose: close, portal: true, align: point ? 'start' : 'end',
      getAnchorRect: point ? () => ({ left: point.x, right: point.x, top: point.y, bottom: point.y }) : undefined,
      items: items.map((item) => ({ ...item, disabled: disabled || item.disabled })),
      onSelect: (id) => { close(); items.find((item) => item.id === id)?.action(); },
      anchor: h('button', { type: 'button', className: 'dsmgr-icon-button', title: label, 'aria-label': label,
        'aria-haspopup': 'menu', 'aria-expanded': shown, disabled,
        onClick: (event) => { event.stopPropagation(); if (point) close(); else setOpen(!open); } }, icon('EllipsisOutline')) });
  }
  // One activity count. A single session opens directly; several open a native menu of them.
  function ActivityCount({ kind, count, label, stats, entries, onOpen }) {
    const [open, setOpen] = React.useState(false);
    return h(ui.Menu, { open, onClose: () => setOpen(false), portal: true, align: 'end', className: 'dsmgr-folder-count',
      items: open ? entries().map((entry) => ({ id: entry.id, label: h('span', { className: 'dsmgr-jump' },
        h('span', null, entry.title), entry.where && h('span', { className: 'dsmgr-jump-where' }, entry.where)) })) : [],
      footer: [{ type: 'label', id: 'stats', text: stats }],
      onSelect: (id) => { setOpen(false); onOpen(id); },
      anchor: h('button', { type: 'button', className: 'dsmgr-count-button', 'data-activity': kind, title: label, 'aria-label': label,
        'aria-haspopup': count > 1 ? 'menu' : undefined, 'aria-expanded': count > 1 ? open : undefined,
        onClick: (event) => { event.stopPropagation(); if (count > 1) setOpen(!open); else onOpen(entries()[0].id); } },
      kind === 'running' ? h(ui.StateDot, { state: 'ongoing', size: 14 }) : icon(kind === 'pending' ? 'WarningOutline' : 'CheckCircleOutline', { size: 14 }),
      h('span', null, count)) });
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
    } }, h(ui.Input, { className: 'dsmgr-name-input', 'aria-label': t('name'), 'data-modal-autofocus': true,
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
      // Per-level custom folder colors; null keeps the theme-aware default from the stylesheet.
      let folderColors = [null, null, null];
      const colorListeners = new Set();
      const colorSource = { subscribe: (listener) => { colorListeners.add(listener); return () => colorListeners.delete(listener); },
        getSnapshot: () => folderColors };
      const setColors = (next) => { folderColors = next; for (const listener of colorListeners) listener(); };
      function readColors() {
        try {
          const saved = JSON.parse(window.localStorage.getItem(COLOR_KEY) || 'null');
          setColors(TONES.map((_, index) => /^#[0-9a-f]{6}$/i.test(saved?.[index]) ? saved[index] : null));
        } catch (error) { report(error); setColors([null, null, null]); }
      }
      readColors();
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
        const [dialog, setDialog] = React.useState(null), [toast, setToast] = React.useState(null);
        const [dropTarget, setDropTarget] = React.useState(null), toastId = React.useRef(0);
        const colors = useSource(colorSource), [menuAt, setMenuAt] = React.useState(null);
        // Each message remounts the native Toast so repeated text restarts its hold timer.
        const setMessage = (text) => setToast({ id: ++toastId.current, text });
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
          dragging = null; setDropTarget(null);
        }
        // Rows accept drops only within the dragged items' workspace, matching model.moveItems.
        const dropProps = (target, workspaceId, folderId) => ({
          'data-drop-target': dropTarget === target || undefined,
          onDragOver: (event) => {
            if (!dragging) return;
            event.stopPropagation();
            if (!workspaceId || dragging.some((item) => item.workspaceId !== workspaceId)) { event.dataTransfer.dropEffect = 'none'; return; }
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(target);
          },
          onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget((current) => current === target ? null : current); },
          onDrop: (event) => drop(event, workspaceId, folderId),
        });
        function toggle(key, open) {
          try { change((previous) => model.setExpanded(previous, key, open)); }
          catch (error) { report(error); setMessage(t('failed') + ': ' + error.message); }
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
        const activity = model.treeActivity(state, workspaces, sessions, statuses);
        const groupOf = (id) => groups.find((group) => group.sessionIds.includes(id)) || groups.at(-1);
        const workspaceTitle = (group) => group.title || group.path?.split(/[\\/]/).filter(Boolean).at(-1) || t('workspace');
        const [reveal, setReveal] = React.useState(null);
        React.useEffect(() => {
          if (reveal) rootRef.current?.querySelector('[data-dsm-key=' + JSON.stringify('session:' + reveal.id) + ']')?.scrollIntoView({ block: 'nearest' });
        }, [reveal]);
        // Jumping expands the workspace and every folder holding the session (persisted, like a manual expand), then scrolls to it.
        function jump(id) {
          const group = groupOf(id);
          const keys = [workspaceKey(group.workspaceId), ...model.folderChain(state, id, group.workspaceId).map((folder) => 'folder:' + folder.id)];
          try { change((previous) => keys.reduce((next, key) => next.expanded[key] === false ? model.setExpanded(next, key, true) : next, previous)); }
          catch (error) { report(error); setMessage(t('failed') + ': ' + error.message); }
          setReveal({ id });
          Promise.resolve().then(() => ctx.uiWorkspace.openSession(id)).catch((error) => { report(error); setMessage(t('failed') + ': ' + error.message); });
        }
        // scope: dictionary key describing what the counts cover; folderId trims the location to paths below that folder.
        function activitySummary(counts, scope, { folderId = null, withWorkspace = false } = {}) {
          if (!counts || !(counts.pending || counts.running || counts.unread)) return null;
          const stats = t(scope) + ' · ' + t('idle') + ' ' + counts.idle + ' · ' + t('total') + ' ' + counts.total;
          const entries = (kind) => () => counts.ids[kind].map((id) => sessions.byId[id]).filter(Boolean)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map((session) => {
              const group = groupOf(session.id), chain = model.folderChain(state, session.id, group.workspaceId).reverse();
              const below = folderId ? chain.slice(chain.findIndex((folder) => folder.id === folderId) + 1) : chain;
              return { id: session.id, title: session.displayTitle || session.title || t('session'),
                where: [withWorkspace && workspaceTitle(group), ...below.map((folder) => folder.name)].filter(Boolean).join(' / ') };
            });
          return h('span', { className: 'dsmgr-folder-summary', draggable: false, onDragStart: (event) => event.preventDefault(),
            onDoubleClick: (event) => event.stopPropagation() },
          ['pending', 'running', 'unread'].filter((kind) => counts[kind]).map((kind) => h(ActivityCount, {
            key: kind, kind, count: counts[kind], label: t('jump', { label: t(kind), n: counts[kind] }), stats, entries: entries(kind), onOpen: jump })));
        }
        function rowView(row) {
          if (row.kind === 'overflow') return h('button', { key: 'overflow:' + row.id, type: 'button', className: 'dsmgr-overflow',
            style: { paddingLeft: 28 + row.depth * 20 }, onClick: () => setLimits((previous) => ({ ...previous,
              [row.workspaceId]: { ...previous[row.workspaceId], [row.id]: row.hidden ? row.limit + 5 : 5 },
            })) }, row.hidden ? t('showMore', { n: row.hidden }) : t('collapse'));
          const key = keyOf(row), folder = row.kind === 'folder', expanded = state.expanded['folder:' + row.id] !== false;
          const status = statuses.get(row.id);
          const { state: sessionState, runningChildren } = model.sessionActivity(row, statuses, sessions);
          const running = sessionState === 'running';
          const statusLabel = [status?.pendingInteraction ? t('pending') + ': ' + status.pendingInteraction.kind
            : running || runningChildren ? t('running') : status?.completionUnread ? t('unread') : '',
          runningChildren > 0 ? t('subagents', { n: runningChildren }) : ''].filter(Boolean).join(' · ');
          const title = folder ? row.name : row.displayTitle || row.title || t('session');
          const time = !folder && !row.blank ? ui.relativeTime(row.updatedAt, Date.now()) : null;
          const timeText = time && t('time.' + time.unit, { n: time.n });
          const restoreSession = safe(async () => { await ctx.uiWorkspace.unarchiveSession(row.id); setMessage(t('restored')); });
          // A lone click selects too; only a real multi-selection gets its own fill, the current session keeps the hover fill.
          const element = h('div', { key, role: 'treeitem', tabIndex: 0, className: 'dsmgr-row' + (chosen.size > 1 && chosen.has(key) ? ' dsmgr-selected' : ''),
            'data-dsm-key': key, 'aria-level': row.depth + 2, 'aria-selected': chosen.has(key),
            'aria-current': !panelActive && !folder && row.retainedBy?.mainView > 0 ? 'page' : undefined,
            'aria-expanded': folder ? expanded : undefined, draggable: !busy && !row.archived,
            // Sessions outdent their 16px status slot so their title shares the column of sibling folder icons;
            // an empty slot would otherwise push idle titles under the previous subfolder's name.
            style: { paddingLeft: 8 + 20 * (row.depth + (folder ? 1 : 0)) },
            'data-kind': row.kind, 'data-archived': !folder && row.archived || undefined,
            ...(folder ? dropProps(key, row.workspaceId, row.id) : {}),
            onContextMenu: folder ? (event) => { event.preventDefault(); event.stopPropagation(); setMenuAt({ key, x: event.clientX, y: event.clientY }); } : undefined,
            onClick: (event) => {
              select(event, row);
              if (event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (folder && event.detail < 2) toggle('folder:' + row.id, !expanded);
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
            }, onDragEnd: () => { dragging = null; setDropTarget(null); },
          }, folder ? h(FolderIcon, { depth: row.depth, open: expanded }) : h('span', {
            className: 'dsmgr-status ' + (status?.pendingInteraction ? 'dsmgr-pending' : statusLabel ? 'dsmgr-running' : ''),
            title: statusLabel, 'aria-label': statusLabel || undefined }, !row.archived && statusLabel && h(ui.StateDot, {
              state: status?.pendingInteraction ? 'warning' : running || runningChildren ? 'ongoing' : 'done',
            })),
          folder ? h('span', { className: 'dsmgr-label', title }, title)
            : h('span', { className: 'dsmgr-label' }, title),
          folder && activitySummary(activity.folders.get(row.id), 'summary', { folderId: row.id }),
          timeText && h('span', { className: 'dsmgr-time' }, timeText),
          !folder && !row.archived && pinned.has(row.id) && h('span', { className: 'dsmgr-pin', 'aria-label': t('pin'), title: t('pin') }, icon('PinFill', { size: 14 })),
          h('span', { className: 'dsmgr-actions', onClick: (event) => event.stopPropagation(), onDoubleClick: (event) => event.stopPropagation(), draggable: false,
            onDragStart: (event) => event.preventDefault() },
          h(Actions, { label: t('more'), disabled: busy, point: folder && menuAt?.key === key ? menuAt : null, onPointClose: () => setMenuAt(null), items: folder ? [
            item('folder', t('folder'), 'FolderClose', () => setDialog({ type: 'create', workspaceId: row.workspaceId, parentId: row.id })),
            item('session', t('session'), 'NewChatOutline', safe(() => newSession(row.workspaceId, row.id)), !row.workspaceId),
            item('rename', t('rename'), 'EditOutline', () => rename(row)),
            item('delete', t('remove'), 'TrashOutline', () => setDialog({ type: 'delete', row }), false, true),
          ] : row.archived ? [
            item('restore', t('restore'), 'UnarchiveOutline', restoreSession),
          ] : [
            item('pin', pinned.has(row.id) ? t('unpin') : t('pin'), 'PinOutline', safe(() => pinned.has(row.id) ? ctx.uiWorkspace.unpinSession(row.id) : ctx.uiWorkspace.pinSession(row.id))),
            item('rename', t('rename'), 'EditOutline', () => rename(row), row.blank),
            item('archive', t('archive'), 'ArchiveOutline', safe(() => adapter.archive(row.id)), row.blank),
          ] }),
          folder && iconButton(t('session'), 'NewChatOutline', safe(() => newSession(row.workspaceId, row.id)), !row.workspaceId),
          // Native session rows put a quick archive/restore button beside the menu.
          !folder && !row.blank && (row.archived ? iconButton(t('restore'), 'UnarchiveOutline', restoreSession)
            : iconButton(t('archive'), 'ArchiveOutline', safe(() => adapter.archive(row.id))))));
          if (folder) return element;
          // Native session rows show the full title and age in a hover card anchored on the whole row.
          return h(ui.HoverCard, { key, anchor: element, content: h('div', { className: 'dsmgr-hover' },
            h('div', { className: 'dsmgr-hover-title' }, title),
            timeText && h('div', { className: 'dsmgr-hover-time' }, time.unit === 'now' ? timeText : t('time.ago', { t: timeText }))) });
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
            event.preventDefault(); toggle('folder:' + row.id, event.key === 'ArrowRight');
          }
        }
        if (!wide) return h('button', { type: 'button', className: 'dsmgr-expand', title: t('title'), onClick: expandSidebar }, h(FolderIcon, {}));
        return h('section', { className: 'dsmgr', ref: rootRef, onKeyDown: keyboard, 'aria-label': t('title'),
          style: Object.fromEntries(colors.flatMap((color, index) => color ? [['--dsmgr-tone-' + index, color]] : [])) },
          h('style', null, styles), h('header', null, !searchOpen && h('span', { className: 'dsmgr-heading' }, t('workspace')),
            !searchOpen && activitySummary(activity.total, 'totalSummary', { withWorkspace: true }),
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
            (sessions.phase !== 'ready' || workspaces.phase !== 'ready') && h('div', { role: 'status', 'aria-label': t('loading') },
              [0, 1, 2].map((index) => h('div', { key: index, className: 'dsmgr-skeleton-row' }, h('span', { className: 'dsmgr-skeleton-dot' }),
                h('span', { className: 'dsmgr-skeleton-bars' }, h('span', { className: 'dsmgr-skeleton-bar' }),
                  h('span', { className: 'dsmgr-skeleton-bar dsmgr-skeleton-bar-wide' }))))),
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
                onClick: () => toggle(workspaceKey(group.workspaceId), !open),
                ...dropProps(workspaceKey(group.workspaceId), group.workspaceId, null) },
              // Native project rows swap the folder for a rotating chevron on hover.
              h('span', { className: 'dsmgr-folder-icon dsmgr-workspace-folder' }, icon(open ? 'FolderOpen' : 'FolderClose')),
              h('span', { className: 'dsmgr-folder-icon dsmgr-chevron' }, icon('TriangleRightFill', { className: 'dsmgr-arrow' + (open ? ' dsmgr-arrow-open' : '') })),
              h('span', { className: 'dsmgr-label' }, group.title || group.path?.split(/[\\/]/).filter(Boolean).at(-1) || t('workspace')),
              activitySummary(activity.workspaces.get(group.workspaceId), 'workspaceSummary'),
              group.workspaceId && h('span', { className: 'dsmgr-actions' },
                h(Actions, { label: t('more'), disabled: busy, items: [
                  item('folder', t('folder'), 'FolderClose', () => setDialog({ type: 'create', workspaceId: group.workspaceId, parentId: null })),
                  item('session', t('session'), 'NewChatOutline', safe(() => newSession(group.workspaceId, null))),
                ] }), iconButton(t('session'), 'NewChatOutline', safe(() => newSession(group.workspaceId, null))))),
              open && group.rows.map(rowView), open && group.rows.length === 0 && h('p', { className: 'dsmgr-hint' }, t('empty')));
            })),
          toast && h(ui.Toast, { key: toast.id, text: toast.text, onDone: () => setToast((current) => current?.id === toast.id ? null : current) }),
          dialog && (dialog.type === 'delete' ? h(Dialog, { title: t('remove'), closeLabel: t('close'), onClose: () => !busy && setDialog(null), footer: [
            h(ui.Button, { key: 'cancel', variant: 'outline', type: 'button', disabled: busy, onClick: () => setDialog(null) }, t('cancel')),
            h(ui.Button, { key: 'delete', variant: 'primary', type: 'button', className: 'dsmgr-delete-danger', disabled: busy,
              onClick: safe(() => removeFolder(dialog.archive === true)) }, t('delete')),
          ] }, h('p', { className: 'dsmgr-delete-message' }, t('deleteMessage')),
            h(ui.Checkbox, { checked: dialog.archive === true, disabled: busy, label: t('archiveSessions'),
              onChange: (checked) => setDialog((current) => ({ ...current, archive: checked })) }))
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
          // Same row shape as the native General settings toggles (title + description, switch on the right).
          return h('div', { className: 'dsmgr-setting' }, h('style', null, styles),
            h('div', null, h('div', { className: 'dsmgr-setting-title' }, t('treeView')),
              h('div', { className: 'dsmgr-setting-description' }, t('viewDescription')),
              error && h('div', { role: 'alert', className: 'dsmgr-name-error' }, error)),
            h(ui.Switch, { checked: !native, label: t('treeView'), onChange: (checked) => {
              try {
                window.localStorage.setItem(MODE_KEY, String(checked));
                nativeMode = !checked; reconcile(); for (const listener of modeListeners) listener(); setError('');
              } catch (reason) { report(reason); setError(reason.message); }
            } }));
        }
        function ColorSettings() {
          const colors = useSource(colorSource), [error, setError] = React.useState('');
          const save = (next) => {
            try {
              if (next.every((color) => color === null)) window.localStorage.removeItem(COLOR_KEY);
              else window.localStorage.setItem(COLOR_KEY, JSON.stringify(next));
              setColors(next); setError('');
            } catch (reason) { report(reason); setError(reason.message); }
          };
          return h('div', { className: 'dsmgr-setting' },
            h('div', null, h('div', { className: 'dsmgr-setting-title' }, t('folderColors')),
              h('div', { className: 'dsmgr-setting-description' }, t('folderColorsDescription')),
              error && h('div', { role: 'alert', className: 'dsmgr-name-error' }, error)),
            h('div', { className: 'dsmgr-colors' }, colors.map((color, index) => h('input', {
              key: index, type: 'color', className: 'dsmgr-color', value: color || TONES[index],
              'aria-label': t('level', { n: index + 1 }), title: t('level', { n: index + 1 }),
              onChange: (event) => save(colors.map((value, i) => i === index ? event.target.value : value)),
            })), h(ui.Button, { variant: 'outline', size: 'sm', type: 'button', disabled: colors.every((color) => color === null),
              onClick: () => save([null, null, null]) }, t('resetColors'))));
        }
        const disposeSettings = ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: NS, order: 50, locale: NS, label: () => t('title'),
        }, function SettingsSection() { return h('div', null, h(Settings), h(ColorSettings)); }));
        const syncMode = (event) => {
          if (event.storageArea && event.storageArea !== window.localStorage) return;
          if (event.key === null || event.key === COLOR_KEY) readColors();
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
.dsmgr-row:hover,.dsmgr-row[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover)}.dsmgr-selected[aria-selected=true]{background:var(--dsw-alias-interactive-bg-active)}
.dsmgr-row[data-drop-target=true]{background:var(--dsw-alias-interactive-bg-hover-accent);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsmgr-chevron{display:none;color:var(--dsw-alias-label-caption)}.dsmgr-workspace:hover>.dsmgr-chevron{display:inline-flex}.dsmgr-workspace:hover>.dsmgr-workspace-folder{display:none}.dsmgr-arrow{transition:transform .15s var(--ds-ease-in-out)}.dsmgr-arrow-open{transform:rotate(90deg)}
.dsmgr-hover{display:flex;flex-direction:column;gap:8px}.dsmgr-hover-title{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}.dsmgr-hover-time{color:#cfd3d6;font-size:12px;line-height:16px}
.dsmgr-skeleton-row{box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;min-height:48px;padding:6px 8px 7px}.dsmgr-skeleton-dot{flex:none;width:16px;height:16px;border-radius:50%}.dsmgr-skeleton-bars{display:flex;flex-direction:column;flex:1;gap:6px;min-width:0}.dsmgr-skeleton-dot,.dsmgr-skeleton-bar{background:var(--dsw-alias-bg-skeleton);animation:2s cubic-bezier(.36,0,.64,1) infinite dsmgr-pulse}.dsmgr-skeleton-bar{border-radius:var(--dsw-radius-xs);width:65%;height:16px}.dsmgr-skeleton-bar-wide{width:90%;height:13px}@keyframes dsmgr-pulse{50%{opacity:.4}}
@media(prefers-reduced-motion:reduce){.dsmgr-arrow{transition:none}.dsmgr-skeleton-dot,.dsmgr-skeleton-bar{animation:none}}
.dsmgr-workspace,.dsmgr-row[data-kind=folder]{height:34px}.dsmgr-workspace{margin-top:8px}.dsmgr-label{font-size:14px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.dsmgr-row[data-kind=session]{gap:0}.dsmgr-row[data-kind=session]>.dsmgr-label{margin:0 6px 0 4px}.dsmgr-status,.dsmgr-folder-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;flex:none;color:var(--dsw-alias-label-tertiary)}
.dsmgr-folder-icon[data-tone="0"]{color:var(--dsmgr-tone-0,#8b5cf6)}.dsmgr-folder-icon[data-tone="1"]{color:var(--dsmgr-tone-1,#0d9488)}.dsmgr-folder-icon[data-tone="2"]{color:var(--dsmgr-tone-2,#db2777)}body[data-ds-dark-theme] .dsmgr-folder-icon[data-tone="0"]{color:var(--dsmgr-tone-0,#a78bfa)}body[data-ds-dark-theme] .dsmgr-folder-icon[data-tone="1"]{color:var(--dsmgr-tone-1,#2dd4bf)}body[data-ds-dark-theme] .dsmgr-folder-icon[data-tone="2"]{color:var(--dsmgr-tone-2,#f472b6)}
.dsmgr-folder-summary{display:inline-flex;gap:8px;flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}.dsmgr-folder-count{display:inline-flex}.dsmgr-count-button{display:inline-flex;align-items:center;gap:4px;padding:0 2px;margin:0 -2px;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:inherit;font:inherit;cursor:pointer}.dsmgr-count-button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.dsmgr-count-button[data-activity=pending]>svg{color:var(--dsw-alias-state-warn-primary)}.dsmgr-count-button[data-activity=unread]>svg{color:var(--dsw-alias-state-success-primary)}
.dsmgr-jump{display:flex;flex-direction:column;min-width:0}.dsmgr-jump>span{overflow:hidden;text-overflow:ellipsis}.dsmgr-jump-where{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsmgr-row[data-kind=folder],.dsmgr-workspace{width:100%;container-type:inline-size}.dsmgr header{container-type:inline-size}@container(max-width:260px){.dsmgr-folder-count~.dsmgr-folder-count{display:none}}
.dsmgr-time{font-size:10px;line-height:16px;flex:none;color:var(--dsw-alias-label-tertiary)}.dsmgr-pin{display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;margin-left:6px;flex:none;color:var(--dsw-alias-label-caption)}
.dsmgr-actions{display:none;align-items:center;gap:15px;flex:none}.dsmgr-row:hover>.dsmgr-actions,.dsmgr-row:focus-within>.dsmgr-actions,.dsmgr-actions:has([aria-expanded=true]){display:inline-flex}.dsmgr-row:hover>.dsmgr-time,.dsmgr-row:hover>.dsmgr-pin,.dsmgr-row:focus-within>.dsmgr-time,.dsmgr-row:focus-within>.dsmgr-pin{display:none}
.dsmgr-icon-button{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none;padding:0;border:0;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}.dsmgr header .dsmgr-icon-button{width:28px;height:28px}.dsmgr-icon-button:hover{color:var(--dsw-alias-label-primary)}.dsmgr header .dsmgr-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsmgr button:disabled,.dsmgr-dialog button:disabled{opacity:.4;cursor:default}.dsmgr button:focus-visible,.dsmgr-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsmgr-overflow{display:block;text-align:left;font-size:12px!important;line-height:20px;color:var(--dsw-alias-label-tertiary);background:transparent;border:0;padding:4px 8px}.dsmgr-overflow:hover{color:var(--dsw-alias-label-primary)}.dsmgr-hint{font-size:12px;padding:2px 10px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsmgr-delete-danger,.dsmgr-delete-danger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);color:#fff}.dsmgr-delete-message{margin:0 0 16px;font-size:14px;line-height:22px;overflow-wrap:anywhere}
.dsmgr-setting{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsmgr-setting-title{font-size:14px;line-height:20px}.dsmgr-setting-description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.dsmgr-colors{display:flex;align-items:center;gap:8px;flex:none}.dsmgr-color{width:28px;height:28px;padding:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer}
.dsmgr-name-input{box-sizing:border-box;width:100%;height:44px;padding:0 14px;border-radius:var(--dsw-radius-lg)}.dsmgr-name-error{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}
.dsmgr-row[data-archived=true]>.dsmgr-label{color:var(--dsw-alias-label-caption)}
.dsmgr-search{display:flex;align-items:center;gap:4px;min-width:0;flex:1;color:var(--dsw-alias-label-secondary)}.dsmgr-search input{font:inherit;color:var(--dsw-alias-label-primary);background:transparent;border:0;outline:none;min-width:0;width:100%}.dsmgr-search:focus-within{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));border-radius:var(--dsw-radius-sm)}
.dsmgr-search-meta{display:flex;gap:6px;margin:0 8px 4px 28px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}.dsmgr-search-meta span{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsmgr-expand{background:transparent;border:0;color:inherit;cursor:pointer;padding:12px}
`;
