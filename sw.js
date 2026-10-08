// This worker is scoped only to this editor, never to the shared host root.
const RELEASE = '2026-10-08-offline-v1';
const ASSET_BASE = './'; // Publication pins this to the same commit as index.html.
const EXPECTED = {"app.js":"0b73be84fa58b051282f960ddfb3f43ee7df5562a0fc65d7f42bb4b005b2e796","style.css":"e980da74fe65ac3db3177e8afe006b034ed99777a04beef9350735186fcc31cb","offline.js":"0b7ca24ce33960ee99f27f5fb74fb3af98a7fff7a4d44d951fd1492251b3e282","raw-avi.js":"7fad208d0a8460f2b1ad9f2483974d440288169e5f330a13bf4d10e731cd5709","save-location.js":"0387922546e1d55a84d7c9b76aa70597b47860cf3b70d7e011ba6736efd26a9a","time-overlay.js":"25543584c428f57a34c6c31a92294e1a25e8cd8d0ed0f7ef85fe1a43c332cc60","scale-bar.js":"031aaffb143108653e5d0a89956547ced7fced6f6bfcb3c7440f42219e92b219","auto-time-region.js":"8afce101e94ab914c633bf672e3342c4a8966d3c3e01ffeb1912b841fcdb7a58","auto-scale-region.js":"5c474f76fd861f69d3be00d7d948f751b49bb7865b11fefce3af8f1abfb9da01","project.js":"6381da79854f33df70ce72e642aa1534a25a945c69a81d5808fabbeab0fab8a5","workflow.js":"67b9ea0de8c4b23f9a1fc6d00a66fd80b7852d9a137f8884e3a6eb34c6878192","vendor/ffmpeg.js":"ad4cfe957589995dea03fc8de1fd5e9f5cb4558a7282913172203082a65bbfaa","vendor/814.ffmpeg.js":"976f4174ae7da80c0d4f9523ee6dde3ecbce7dc2ee392b2a5322049abb9b8627","vendor/ffmpeg-core.js":"b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21","vendor/core-1.wasm":"385b2f7930ae24951f872f308251757bbde3a3b1886a7ed85bf4a0e0075b2142","vendor/core-2.wasm":"7439f1fe7f49f84ac0d08d180779881b5238bf0bf266ff9a783d2dfca54522da"}; // Build injects SHA-256 hashes for every cached asset.
const FILES = ['app.js', 'style.css', 'offline.js', 'raw-avi.js', 'save-location.js', 'time-overlay.js', 'scale-bar.js', 'auto-time-region.js', 'auto-scale-region.js', 'project.js', 'workflow.js', 'vendor/ffmpeg.js', 'vendor/814.ffmpeg.js', 'vendor/ffmpeg-core.js', 'vendor/core-1.wasm', 'vendor/core-2.wasm'];
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
