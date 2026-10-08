// Keep the editor available after a successful complete local cache.
const note = document.getElementById('offline-status');
const retry = document.getElementById('offline-retry');
let registration, starting = false;
function show(text, detail, failed = false) {
  if (note) { note.textContent = text; note.title = detail; }
  if (retry) retry.hidden = !failed;
}
function askStatus() { registration?.active?.postMessage({ type: 'FRAMECUT_CACHE_STATUS' }); }
function watch(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'activated') askStatus();
    if (worker.state === 'redundant') {
      if (registration?.active) askStatus();
      else show('缓存未完成', '当前仍可剪辑；网络恢复后点重试，完整缓存后才能离线打开。', true);
    }
  });
}
async function start() {
  if (starting) return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    show('在线模式', '此浏览器未启用离线缓存。'); return;
  }
  starting = true;
  show('准备离线缓存', '正在保存编辑器和处理引擎，约 31 MB；不缓存你的视频。');
  try {
    registration = await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: './', updateViaCache: 'none' });
    watch(registration.installing);
    registration.addEventListener('updatefound', () => watch(registration.installing));
    askStatus();
  } catch {
    show('缓存未完成', '托管服务或网络暂时不可用；网络恢复后点重试。', true);
  } finally { starting = false; }
}
navigator.serviceWorker?.addEventListener('message', event => {
  if (![registration?.active, registration?.installing, registration?.waiting, navigator.serviceWorker.controller].filter(Boolean).includes(event.source)) return;
  const data = event.data;
  if (data?.type !== 'FRAMECUT_CACHE_STATUS') return;
  if (data.ready) show('离线可用', '本机已完整缓存编辑器和处理引擎。使用普通刷新；清除网站数据后需重新联网缓存。');
  else if (data.failed) show('缓存未完成', '已停止请求，稍后点重试；已有的完整缓存会保留。', true);
  else show(`缓存 ${data.done || 0}/${data.total || 17}`, '请稍候，完整缓存后即使限流或断网也能打开。');
});
navigator.serviceWorker?.addEventListener('controllerchange', askStatus);
retry?.addEventListener('click', start);
start();
