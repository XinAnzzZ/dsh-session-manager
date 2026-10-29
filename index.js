/**
 * Host side: the plugin's data (folders, tags, colors, view mode) lives in one JSON file under the DSH home,
 * so every shell on this machine (DSH Desktop, DeepSeek Harness, a browser tab) reads and writes the same copy.
 * Session records are never touched.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const name = 'dsh-session-manager';
export const ROUTE = '/dsh-session-manager/storage';
const KEY = /^dsh\.session-manager\.[\w.-]{1,64}$/;
const LIMIT = 4 * 1024 * 1024;

export const storageFile = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'session-manager', 'storage.json');

function respond(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

// Same fence as other host plugins: the host's admit() (Host/Origin fence + browser auth, owner peers only).
// Without it, fall back to a loopback Host check; the required custom header makes cross-origin pages preflight and fail.
function rejection(req, connection) {
  let admission;
  try { admission = connection?.admit?.(req); } catch (error) { console.error('dsh-session-manager: admit failed, using loopback check', error); }
  if (admission) return 'rejection' in admission ? admission.rejection : admission.peer?.principal?.kind === 'owner' ? null : 403;
  let host;
  try { host = new URL('http://' + (req.headers.host ?? '')).hostname; } catch { return 403; }
  return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host) ? null : 403;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

export function createHandler({ file = storageFile(), connection = () => undefined } = {}) {
  let queue = Promise.resolve();
  // One request at a time, so a read-compare-write never interleaves with another write from this host.
  const serial = (task) => { const run = queue.then(task); queue = run.catch(() => {}); return run; };
  const load = async () => {
    let data;
    try { data = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some((value) => typeof value !== 'string')) {
      throw new Error('Invalid storage file: ' + file);
    }
    return data;
  };
  const save = async (data) => {
    await mkdir(dirname(file), { recursive: true });
    const temp = file + '.' + process.pid + '.tmp';
    await writeFile(temp, JSON.stringify(data, null, 2));
    await rename(temp, file);
  };
  return async function handle(req, res) {
    try {
      const status = rejection(req, connection());
      if (status) return respond(res, status, { ok: false, error: 'Forbidden' });
      if (req.headers['x-dsh-plugin'] !== name) return respond(res, 403, { ok: false, error: 'Forbidden' });
      if (req.method === 'GET') return respond(res, 200, { ok: true, data: await serial(load) });
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'Method not allowed' });
      const { key, value, previous } = await readBody(req);
      const text = (item) => item === null || typeof item === 'string';
      if (typeof key !== 'string' || !KEY.test(key) || !text(value) || !text(previous)) return respond(res, 400, { ok: false, error: 'Invalid storage write' });
      // previous = the value the client last saw; a mismatch means another shell wrote first.
      const result = await serial(async () => {
        const data = await load();
        if ((data[key] ?? null) !== previous) return [409, { ok: false, error: 'Changed in another window; showing the latest data.', data }];
        if (value === null) delete data[key]; else data[key] = value;
        await save(data);
        return [200, { ok: true }];
      });
      respond(res, ...result);
    } catch (error) {
      if (!error.status) console.error('dsh-session-manager: storage route failed', error);
      if (!res.headersSent) respond(res, error.status || 500, { ok: false, error: error.message });
    }
  };
}

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: ROUTE, handler: createHandler({ connection: () => ctx.get?.('connection') }),
    }), 'dsh-session-manager: storage route');
  });
}
