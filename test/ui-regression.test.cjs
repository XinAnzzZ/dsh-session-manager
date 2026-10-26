'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../client-source.cjs'), 'utf8');
test('folder icon shares parent session title column, deeper levels advance 20px', () => {
  const sessionTitle = depth => 8 + 20 * depth + 16 + 4;
  const folderIcon = depth => 8 + 20 * (depth + 1);
  for (let depth = 0; depth < 5; depth++) assert.equal(folderIcon(depth), sessionTitle(depth));
  assert.match(source, /paddingLeft: 8 \+ 20 \* \(row.depth \+ \(folder \? 1 : 0\)\)/);
});
test('delete choices stack at full width without wrapping, with a scoped danger action', () => {
  assert.match(source, /footer:\s*h\('div', \{ className: 'dsm-delete-actions' \}/);
  assert.match(source, /\.dsm-delete-actions\{display:flex;flex-direction:column;gap:8px;width:100%;min-width:0\}/);
  assert.match(source, /\.dsm-delete-actions>button\{width:100%;flex-shrink:0;white-space:nowrap/);
  assert.match(source, /\.dsm-delete-actions>\.dsm-delete-danger\{color:var\(--dsw-alias-state-error-primary\)/);
  assert.match(source, /button\(t\('archiveAll'\), safe\(\(\) => removeFolder\(true\)\), true\)/);
});
test('row titles inherit native typography instead of forcing lighter weight', () => {
  const title = source.match(/\.dsm-label\{([^}]+)\}/)[1];
  assert.doesNotMatch(title, /font-weight|opacity|color:/);
  assert.match(title, /font-size:14px;line-height:20px/);
  assert.match(source, /\.dsm-row\{[^}]*color:var\(--dsw-alias-label-primary\)/);
  assert.match(source, /data-archived=true\]>\.dsm-label\{color:var\(--dsw-alias-label-caption\)/);
});
test('settings owns native mode switch without footer registration; modal uses native primitives', () => {
  assert.match(source, /ctx.slots.inject\('settings.section'/);
  assert.match(source, /h\(ui.Switch, \{ checked: !native/);
  assert.doesNotMatch(source, /sidebar.footer.action|modeStyles|dsm-mode-toggle/);
  assert.match(source, /return h\(ui.Modal/);
  assert.doesNotMatch(source, /showModal\(|::backdrop|h\('dialog'/);
  assert.match(source, /'data-modal-autofocus': true/);
  assert.match(source, /h\(ui.Button, \{ key: 'save', variant: 'primary'/);
});
