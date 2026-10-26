'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');

test('manifest exports real runtime, localized metadata, icon and unique bundle row', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'dsh-session-manager');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'));
  for (const key of ['.', './client', './package.json', './icon']) {
    assert.ok(fs.statSync(path.join(root, manifest.exports[key])).isFile());
  }
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(fs.readFileSync(path.join(root, 'locale', language + '.json'), 'utf8'));
    assert.equal(locale.meta.title, 'DSH Session Manager');
    assert.ok(locale.meta.description.length > 20);
  }
  const patch = fs.readFileSync(path.join(root, manifest.dsh.bundle.patch), 'utf8');
  assert.match(patch, /id: dsh-session-manager/);
  assert.match(patch, /name: dsh-session-manager/);
  const icon = fs.readFileSync(path.join(root, manifest.exports['./icon']), 'utf8');
  assert.match(icon, /^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(icon, /<\/svg>/);
  assert.ok(Buffer.byteLength(icon) < 256 * 1024);
  const host = await import(pathToFileURL(path.join(root, manifest.exports['.'])).href);
  assert.equal(typeof host.apply, 'function');
});

test('built artifact registers a lazy plugin and reuses host React and native UI primitives', () => {
  let entry;
  const context = vm.createContext({ window: { __ModuleLoader__: { load(value) { entry = value; } } } });
  const artifact = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
  vm.runInContext(artifact, context);
  assert.equal(entry.id, 'dsh-session-manager');
  const imports = [];
  const plugin = entry.factory((id) => {
    imports.push(id);
    assert.ok(['react', '@deepseek-ai/dsh-client-ui-primitives'].includes(id));
    return { createElement() {} };
  });
  assert.deepEqual(imports, ['react', '@deepseek-ai/dsh-client-ui-primitives']);
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale']);
  assert.equal(typeof plugin.apply, 'function');
  for (const name of ['model', 'storage', 'client-source']) {
    assert.ok(artifact.includes(fs.readFileSync(path.join(root, name + '.cjs'), 'utf8')), `${name} was rebuilt`);
  }
});
