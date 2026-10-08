import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
const code = await readFile('dist/sw.js', 'utf8');
const fileNames = JSON.parse(code.match(/const FILES = (\[.*?\]);/)[1].replaceAll("'", '"'));
const origin = 'https://example.test/editor/';
const bodies = new Map(await Promise.all([...fileNames, 'index.html'].map(async file => [new URL(file, origin).href, await readFile(`dist/${file}`)])));
const databases = new Map();
const key = request => typeof request === 'string' ? request : request.url;
let network = 'ok', count = 0, failFile = '', quota = false;
const caches = {
  async open(name) {
    if (!databases.has(name)) databases.set(name, new Map());
    const data = databases.get(name);
    return {
      async match(request) { return data.get(key(request))?.clone(); },
      async put(request, response) { if (quota) throw new Error('QuotaExceededError'); data.set(key(request), response.clone()); }
    };
  },
  async keys() { return [...databases.keys()]; },
  async delete(name) { return databases.delete(name); }
};
async function fetch(request) {
  count++;
  if (network === 'offline') throw new TypeError('Network unavailable');
  if (network === '429') return new Response('rate limited', { status: 429 });
  const url = key(request), data = bodies.get(url);
  const html = url.endsWith('.html');
  if (url.endsWith(failFile) && failFile) return new Response('corrupt', { headers: { 'content-type': 'application/javascript' } });
  return new Response(data || 'not found', { status: data ? 200 : 404, headers: { 'content-type': html ? 'text/html' : 'application/octet-stream' } });
}
function boot(script = code) {
  const handlers = {}, messages = [], state = { skipped: false, claimed: false };
  const client = { url: origin + 'index.html', postMessage: data => messages.push(data) };
  const self = {
    registration: { scope: origin },
    clients: { async matchAll() { return [client]; }, async claim() { state.claimed = true; } },
    async skipWaiting() { state.skipped = true; },
    addEventListener(type, fn) { handlers[type] = fn; }
  };
  vm.runInNewContext(script, { self, caches, fetch, Response, Headers, URL, AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array, crypto: webcrypto });
  return { handlers, messages, state,
    async event(type, extras = {}) { let work; handlers[type]({ ...extras, waitUntil: p => work = p }); await work; },
    async get(url, mode = 'navigate') { let work; handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: p => work = p }); return work; }
  };
}
const first = boot();
await first.event('install'); await first.event('activate');
assert(first.state.skipped && first.state.claimed);
assert.equal(first.messages.at(-1).ready, true);
const installedFetches = count;
network = '429';
assert((await (await first.get(origin + 'index.html')).text()).includes('FrameCut'));
assert((await (await first.get(origin)).text()).includes('FrameCut'));
for (const file of fileNames) assert.equal((await first.get(new URL(file, origin).href, 'cors')).status, 200);
assert.equal(count, installedFetches, 'Cached requests must not hammer a limited server');
network = 'offline';
assert.equal((await first.get(origin + 'index.html')).status, 200);
network = '429';
assert.equal((await first.get('https://example.test/another-project/index.html')).status, 429, 'Do not serve editor into other projects');
network = 'ok';
const v2 = code.replaceAll('offline-v1', 'offline-v2');
const oldCount = databases.size;
failFile = 'app.js';
await assert.rejects(boot(v2).event('install'), /fingerprint/);
assert.equal(databases.size, oldCount);
failFile = '';
await assert.rejects(boot(v2).event('install'), /Inconsistent editor release/);
assert.equal(databases.size, oldCount);
quota = true;
await assert.rejects(boot(v2).event('install'), /QuotaExceeded/);
quota = false;
assert.equal(databases.size, oldCount);
network = '429'; const before = count;
await assert.rejects(boot(v2).event('install'), /429/);
assert.equal(count, before + 1, 'Do not retry a 429 during installation');
assert.equal(databases.size, oldCount);
assert.equal((await first.get(origin + 'index.html')).status, 200);
console.log('Offline checks passed: complete cache, 429/disconnection, scope, atomic updates, corrupt assets, quota and no retry bursts.');
