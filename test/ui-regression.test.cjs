'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../client-source.cjs'), 'utf8');
test('session titles share the column of sibling folder icons, deeper levels advance 20px', () => {
  const sessionTitle = depth => 8 + 20 * depth + 16 + 4; // padding + status slot + label margin
  const folderIcon = depth => 8 + 20 * (depth + 1);
  for (let depth = 0; depth < 5; depth++) assert.equal(folderIcon(depth), sessionTitle(depth));
  assert.match(source, /paddingLeft: 8 \+ 20 \* \(row.depth \+ \(folder \? 1 : 0\)\)/);
  assert.match(source, /\.dsmgr-row\[data-kind=session\]\{gap:0\}\.dsmgr-row\[data-kind=session\]>\.dsmgr-label\{margin:0 6px 0 4px\}/);
});
test('delete dialog: Cancel + danger Delete in the footer, archiving is an opt-in checkbox', () => {
  assert.match(source, /h\(ui.Checkbox, \{ checked: dialog.archive === true/);
  assert.match(source, /removeFolder\(dialog.archive === true\)/);
  assert.match(source, /\.dsmgr-delete-danger,\.dsmgr-delete-danger:hover:not\(:disabled\)\{background:var\(--dsw-alias-state-error-primary\)/);
  assert.doesNotMatch(source, /dsmgr-delete-actions|archiveAll/);
});
test('row titles inherit native typography instead of forcing lighter weight', () => {
  const title = source.match(/\.dsmgr-label\{([^}]+)\}/)[1];
  assert.doesNotMatch(title, /font-weight|opacity|color:/);
  assert.match(title, /font-size:14px;line-height:20px/);
  assert.match(source, /\.dsmgr-row\{[^}]*color:var\(--dsw-alias-label-primary\)/);
  assert.match(source, /data-archived=true\]>\.dsmgr-label\{color:var\(--dsw-alias-label-caption\)/);
});
test('classes stay in the dsmgr namespace: plugin CSS is global and dsh-plugin-tool-management owns .dsm-*', () => {
  assert.doesNotMatch(source, /(?<![\w-])dsm-/);
  const styles = source.match(/const styles = `([\s\S]*?)`;/)[1];
  for (const name of styles.match(/\.-?[_a-zA-Z][\w-]*/g)) assert.match(name, /^\.dsmgr(-|$)/);
});
test('hover actions replace time and pin; size containment stays on summary rows and the header', () => {
  assert.match(source, /\.dsmgr-actions\{display:none;align-items:center;gap:15px;flex:none\}/);
  assert.match(source, /\.dsmgr-row:hover>\.dsmgr-time,\.dsmgr-row:hover>\.dsmgr-pin,/);
  assert.doesNotMatch(source, /\.dsmgr\{[^}]*container-type:/);
  assert.match(source, /\.dsmgr-row\[data-kind=folder\],\.dsmgr-workspace\{width:100%;container-type:inline-size\}\.dsmgr header\{container-type:inline-size\}/);
});
test('settings owns native mode switch without footer registration; modal uses native primitives', () => {
  assert.match(source, /ctx.slots.inject\('settings.section'/);
  assert.match(source, /h\(ui.Switch, \{ checked: !native/);
  assert.doesNotMatch(source, /sidebar.footer.action|modeStyles|dsmgr-mode-toggle/);
  assert.match(source, /return h\(ui.Modal/);
  assert.doesNotMatch(source, /showModal\(|::backdrop|h\('dialog'/);
  assert.match(source, /'data-modal-autofocus': true/);
  assert.match(source, /h\(ui.Button, \{ key: 'save', variant: 'primary'/);
});
