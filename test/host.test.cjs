'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openHostStorage } = require('../storage.cjs');

const loadHost = () => import(pathToFileURL(path.join(__dirname, '..', 'index.js')).href);
const request = (method, body, headers = {}) => Object.assign((async function* () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); })(), {
  method, headers: { host: '127.0.0.1:43120', 'x-dsh-plugin': 'dsh-session-manager', ...headers },
});
function call(handler, req) {
  return new Promise((resolve) => {
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; },
      end(payload) { resolve({ status: this.status, body: JSON.parse(payload) }); } };
    handler(req, res);
  });
}
function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.host-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'storage.json');
}

test('host route reads an absent file as empty, writes atomically and rejects stale previous values', async t => {
  const { createHandler } = await loadHost();
  const file = tempFile(t);
  const handler = createHandler({ file });
  assert.deepEqual(await call(handler, request('GET')), { status: 200, body: { ok: true, data: {} } });
  const key = 'dsh.session-manager.v1';
  assert.equal((await call(handler, request('POST', { key, value: 'a', previous: null }))).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { [key]: 'a' });
  const stale = await call(handler, request('POST', { key, value: 'b', previous: null }));
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.data, { [key]: 'a' });
  assert.equal((await call(handler, request('POST', { key, value: null, previous: 'a' }))).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['storage.json']);
});

test('host route fences requests: owner peers only, plugin header, loopback host, known keys', async t => {
  const { createHandler } = await loadHost();
  const file = tempFile(t);
  const handler = createHandler({ file });
  assert.equal((await call(handler, request('GET', undefined, { 'x-dsh-plugin': '' }))).status, 403);
  assert.equal((await call(handler, request('GET', undefined, { host: 'evil.example' }))).status, 403);
  assert.equal((await call(handler, request('POST', { key: 'other', value: 'x', previous: null }))).status, 400);
  assert.equal((await call(handler, request('PUT'))).status, 405);
  const peer = (kind) => createHandler({ file, connection: () => ({ admit: () => ({ peer: { principal: { kind } } }) }) });
  assert.equal((await call(peer('guest'), request('GET'))).status, 403);
  assert.equal((await call(peer('owner'), request('GET', undefined, { host: 'lan-name' }))).status, 200);
  const denied = createHandler({ file, connection: () => ({ admit: () => ({ rejection: 401 }) }) });
  assert.equal((await call(denied, request('GET'))).status, 401);
  assert.equal(fs.existsSync(file), false);
});

test('client host storage writes in order and restores the host copy when a write is rejected', async () => {
  let host = { k: 'old' };
  const posts = [];
  const fetcher = async (url, init) => {
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (!init.body) return reply(200, { ok: true, data: { ...host } });
    const body = JSON.parse(init.body);
    posts.push(body);
    if ((host[body.key] ?? null) !== body.previous) return reply(409, { ok: false, error: 'Changed', data: { ...host } });
    host = { ...host, [body.key]: body.value };
    return reply(200, { ok: true });
  };
  const storage = await openHostStorage('/route', fetcher);
  const heard = [];
  storage.subscribe((key, failure) => heard.push([key, failure?.message ?? null]));
  storage.setItem('k', 'one');
  storage.setItem('k', 'two');
  assert.equal(storage.getItem('k'), 'two');
  await storage.refresh();
  assert.deepEqual(posts.map((post) => [post.previous, post.value]), [['old', 'one'], ['one', 'two']]);
  host = { k: 'other shell' };
  storage.setItem('k', 'three');
  await storage.refresh();
  assert.equal(storage.getItem('k'), 'other shell');
  assert.deepEqual(heard, [['k', 'Changed']]);
});
