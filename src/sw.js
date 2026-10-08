// This worker is scoped only to this editor, never to the shared host root.
const RELEASE = '2026-10-08-offline-v1';
const ASSET_BASE = './'; // Publication pins this to the same commit as index.html.
const EXPECTED = {}; // Build injects SHA-256 hashes for every cached asset.
const FILES = ['app.js', 'style.css', 'offline.js', 'raw-avi.js', 'save-location.js', 'time-overlay.js', 'scale-bar.js', 'auto-time-region.js', 'auto-scale-region.js', 'project.js', 'workflow.js', 'vendor/ffmpeg.js', 'vendor/814.ffmpeg.js', 'vendor/ffmpeg-core.js', 'vendor/core-1.bin', 'vendor/core-2.bin'];
const scope = self.registration.scope;
const entry = new URL('index.html', scope).href;
const urls = FILES.map(file => new URL(file, new URL(ASSET_BASE, scope)).href);
const prefix = `framecut-offline:${scope}:`;
const cacheName = prefix + RELEASE;
const readyKey = new URL('__framecut_cache_ready__', scope).href;
async function tell(data) {
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    if (client.url.startsWith(scope)) client.postMessage({ type: 'FRAMECUT_CACHE_STATUS', ...data });
  }
}
async function checkedFetch(url, html = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(url, { cache: html ? 'reload' : 'default', signal: controller.signal });
    if (!response.ok || response.type === 'opaque') throw new Error(`Cache HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new Error('Empty asset');
    if (html) {
      const body = new TextDecoder().decode(bytes);
      if (!type.includes('text/html') || !body.includes(`data-offline-release="${RELEASE}"`) || (ASSET_BASE !== './' && !body.includes(ASSET_BASE))) throw new Error('Inconsistent editor release');
    } else {
      if (type.includes('text/html')) throw new Error('Unexpected HTML instead of asset');
      const file = FILES[urls.indexOf(url)];
      const expected = EXPECTED[file];
      if (!expected) throw new Error('Missing asset fingerprint');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
      if (digest !== expected) throw new Error('Asset fingerprint mismatch');
    }
    const headers = new Headers(response.headers);
    headers.delete('content-encoding'); headers.delete('content-length');
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
  } finally { clearTimeout(timer); }
}
async function install() {
  const cache = await caches.open(cacheName);
  if (await cache.match(readyKey)) { await self.skipWaiting(); return; }
  let done = 0;
  try {
    // Sequential fetches reuse the HTTP cache and avoid request bursts/rate-limit retries.
    for (const url of urls) {
      await cache.put(url, await checkedFetch(url));
      await tell({ done: ++done, total: urls.length + 1 });
    }
    await cache.put(entry, await checkedFetch(entry, true));
    await cache.put(readyKey, new Response(RELEASE));
    await self.skipWaiting();
  } catch (error) {
    await caches.delete(cacheName); // Only this incomplete version, not old working versions.
    await tell({ failed: true });
    throw error;
  }
}
self.addEventListener('install', event => event.waitUntil(install()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  await tell({ ready: true });
})()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'FRAMECUT_CACHE_STATUS' || !event.source?.url?.startsWith(scope)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    event.source.postMessage({ type: 'FRAMECUT_CACHE_STATUS', ready: !!(await cache.match(readyKey)) });
  })());
});
async function serve(request) {
  const url = new URL(request.url);
  const own = await caches.open(cacheName);
  if (request.mode === 'navigate' && (url.pathname === new URL(entry).pathname || url.pathname === new URL(scope).pathname)) {
    const shell = await own.match(entry);
    if (shell && await own.match(readyKey)) return shell;
  }
  // Keep existing tabs on their pinned release while a newer worker activates.
  for (const name of [cacheName, ...(await caches.keys()).filter(name => name.startsWith(prefix) && name !== cacheName)]) {
    const cache = await caches.open(name);
    if (!await cache.match(readyKey)) continue;
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  return fetch(request);
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !/^https?:/.test(event.request.url)) return;
  event.respondWith(serve(event.request));
});
