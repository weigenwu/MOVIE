import { openRawAVI } from './raw-avi.js';
import { folderSetting, writeToFolder, sharedHosting } from './save-location.js';
const $ = id => document.getElementById(id);
const video = $('video'), canvas = $('crop-canvas'), ctx = canvas.getContext('2d');
const files = [];
let active = null, engine = null, mounted = null, wasmURL = null, busy = false, cancelled = false, fetchAbort = null;
let dragging = null, clipOffset = 0, processingDuration = 0, previewPlaying = false;
let previewEpoch = 0, previewTimer = null;
let panMode = false, spacePan = false;
let logLines = [], resultURL = null;
let outputFolder = null, outputPermission = 'prompt', locationReady = false, locationBusy = false, savingFile = false, lastExport = null;
let folderRemembered = true;
const canChooseFolder = typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const even = n => Math.floor(n / 2) * 2;
const humanSize = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
function time(n) { n = Math.max(0, n || 0); return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toFixed(3).padStart(6, '0')}`; }
function status(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function progress(text, percent) { $('progress-text').textContent = text; if (percent == null) $('progress').removeAttribute('value'); else $('progress').value = clamp(percent, 0, 100); }
function controls() {
  const locked = busy || locationBusy || !locationReady;
  $('choose-output').disabled = locked || !canChooseFolder;
  $('grant-output').disabled = locked;
  $('clear-output').disabled = locked;
  $('save-again').disabled = locked;
  $('export').disabled = locked;
  $('cancel').disabled = savingFile;
  $('edit-controls').disabled = busy || !active?.meta;
  $('view-controls').disabled = busy || !active?.meta;
  for (const id of ['play','previous','next','seek','start-range','end-range']) $(id).disabled = busy || !active?.meta;
  document.querySelectorAll('.import-trigger,.folder-trigger,.file-item').forEach(el => el.disabled = busy);
  const index = files.indexOf(active);
  $('queue-nav').hidden = !files.length;
  $('queue-position').textContent = index < 0 ? `共 ${files.length} 个` : `第 ${index + 1} / ${files.length} 个`;
  $('previous-file').disabled = busy || index <= 0;
  $('next-file').disabled = busy || index < 0 || index >= files.length - 1;
  $('progress-area').hidden = !busy;
  document.body.classList.toggle('busy', busy);
}
async function task(label, fn) {
  if (busy) return false;
  busy = true; cancelled = false; fetchAbort = new AbortController(); stopPlayback(); controls(); progress(label);
  try { await fn(); return true; }
  catch (err) {
    if (cancelled) status('已取消，可以调整后重新操作。');
    else { console.error(err); status(`处理失败：${String(err?.message || err).slice(0, 220)}。可重试，或缩短时间、减小画面后再导出。`, true); }
    if (engine && !cancelled) { engine.terminate(); engine = null; mounted = null; }
    return false;
  } finally { busy = false; processingDuration = 0; fetchAbort = null; controls(); }
}
function checkCancelled() { if (cancelled) throw new Error('操作已取消'); }
$('cancel').onclick = () => { if(savingFile)return; cancelled = true; fetchAbort?.abort(); engine?.terminate(); engine = null; mounted = null; };
async function getEngine() {
  if (engine?.loaded) return engine;
  progress('首次使用：加载视频处理引擎（约 31 MB）');
  if (!wasmURL) {
    const parts = await Promise.all([1,2].map(async n => {
      const r = await fetch(new URL(`./vendor/core-${n}.wasm`, import.meta.url), { signal: fetchAbort?.signal });
      if (!r.ok) throw new Error('处理引擎下载失败，请检查网络');
      return r.arrayBuffer();
    }));
    checkCancelled(); wasmURL = URL.createObjectURL(new Blob(parts, { type: 'application/wasm' }));
  }
  checkCancelled();
  engine = new window.FFmpegWASM.FFmpeg();
  engine.on('log', ({ message }) => { logLines.push(message); if (logLines.length > 60) logLines.shift(); });
  engine.on('progress', ({ time: us }) => {
    if (processingDuration > 0) { const percent = clamp(us / 1e6 / processingDuration * 100, 0, 99); $('progress').value = percent; }
  });
  await engine.load({ coreURL: new URL('./vendor/ffmpeg-core.js', import.meta.url).href, wasmURL });
  await engine.createDir('/input');
  return engine;
}
async function mount(item) {
  const ff = await getEngine(); checkCancelled();
  if (mounted !== item.id) {
    if (mounted) await ff.unmount('/input');
    const ok = await ff.mount('WORKERFS', { blobs: [{ name: `source.${item.ext}`, data: item.file }] }, '/input');
    if (!ok) throw new Error('浏览器不支持按需读取大文件');
    mounted = item.id;
  }
  return `/input/source.${item.ext}`;
}
async function exec(args) {
  logLines = [];
  const code = await engine.exec(args);
  checkCancelled();
  if (code !== 0) throw new Error(logLines.filter(s => /error|invalid|not found|failed|memory/i.test(s)).slice(-2).join(' / ') || '视频处理未完成，可能是编码不受支持或内存不足');
}
async function removeTemp(path) { try { await engine?.deleteFile(path); } catch {} }
async function probe(item) {
  const path = await mount(item);
  await removeTemp('/probe.json');
  const ret = await engine.ffprobe(['-v','error','-show_format','-show_streams','-of','json',path,'-o','/probe.json']);
  // core 0.12.10 may leave ret at -1 after ffprobe returns normally;
  // a fresh, complete JSON result and valid video stream are the success gate.
  if (ret > 0) throw new Error('无法读取该视频，请检查文件是否完整');
  const data = JSON.parse(await engine.readFile('/probe.json', 'utf8')); await removeTemp('/probe.json');
  const stream = data.streams?.find(s => s.codec_type === 'video');
  if (!stream) throw new Error('文件中没有可识别的视频画面');
  const [a,b] = (stream.avg_frame_rate || stream.r_frame_rate || '25/1').split('/').map(Number);
  const fps = a / b || 25;
  const duration = Number(stream.duration || data.format.duration || Number(stream.nb_frames) / fps);
  let width = stream.width, height = stream.height;
  const rotation = Number(stream.side_data_list?.find(s => s.rotation != null)?.rotation || stream.tags?.rotate || 0);
  if (Math.abs(rotation) % 180 === 90) [width,height] = [height,width];
  if (!(duration > 0 && Number.isFinite(duration) && width >= 2 && height >= 2)) throw new Error('视频时长或尺寸无效');
  item.meta = { width, height, duration, fps, audio: data.streams.some(s => s.codec_type === 'audio'), codec: stream.codec_name };
  item.crop = { x:0, y:0, w:even(width), h:even(height) }; item.start = 0; item.end = duration; item.current = 0; item.aspect = 'free';
}
function renderFiles() {
  $('file-count').textContent = files.length;
  $('file-list').replaceChildren(...files.map(item => {
    const button = document.createElement('button'); button.className = `file-item${item === active ? ' active' : ''}`; button.title = item.path;
    button.setAttribute('aria-current', item === active ? 'true' : 'false');
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = item.ext.toUpperCase();
    const detail = document.createElement('span'); detail.className = 'file-detail';
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = item.file.name;
    const meta = document.createElement('span'); meta.className = 'file-meta'; meta.textContent = humanSize(item.file.size) + (item.meta ? ` · ${time(item.meta.duration)}` : '');
    detail.append(name);
    if (item.path !== item.file.name) { const folder = document.createElement('span'); folder.className = 'file-path'; folder.textContent = item.path.slice(0, item.path.lastIndexOf('/')); detail.append(folder); }
    detail.append(meta); button.append(icon,detail); button.onclick = () => selectFile(item); return button;
  })); controls();
  $('file-list').querySelector('.active')?.scrollIntoView({ block:'nearest', inline:'nearest' });
}
async function importFiles(list, { folder = false } = {}) {
  if (busy) return;
  const incoming = Array.from(list);
  if (!incoming.length) return;
  const accepted = [], rejected = [];
  let ignored = 0, duplicates = 0;
  const relativePath = file => file.webkitRelativePath || file.name;
  if (folder) incoming.sort((a,b) => relativePath(a).localeCompare(relativePath(b), 'zh-CN', { numeric:true }));
  const keyOf = file => JSON.stringify([relativePath(file),file.size,file.lastModified]);
  const known = new Set(files.map(item => keyOf(item.file)));
  for (const file of incoming) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['avi','mp4'].includes(ext)) { ignored++; continue; }
    if (file.size >= 2 ** 31) { rejected.push(`${relativePath(file)}：超过单文件 2 GiB 上限`); continue; }
    if (!file.size) { rejected.push(`${relativePath(file)}：文件为空`); continue; }
    const key = keyOf(file);
    if (known.has(key)) { duplicates++; continue; }
    known.add(key);
    const item = { id:crypto.randomUUID(), file, ext, path:relativePath(file) }; files.push(item); accepted.push(item);
  }
  const summary = [`新增 ${accepted.length} 个视频`];
  if (ignored) summary.push(`忽略 ${ignored} 个非 AVI / MP4 文件`);
  if (duplicates) summary.push(`${duplicates} 个视频已在列表中`);
  if (rejected.length) summary.push(`跳过 ${rejected.length} 个视频：${rejected.slice(0,3).join('；')}${rejected.length > 3 ? '…' : ''}`);
  $('import-summary').textContent = summary.join(' · '); $('import-summary').hidden = false;
  renderFiles();
  if (accepted.length) await selectFile(accepted[0]);
  else if (!files.length) status('没有可用的 AVI / MP4 视频，请检查所选文件或文件夹。', true);
}
document.querySelectorAll('.import-trigger').forEach(el => el.onclick = () => $('file-input').click());
$('file-input').onchange = async e => { await importFiles(e.target.files); e.target.value = ''; };
$('import-folder').onclick = () => {
  if (!('webkitdirectory' in $('folder-input'))) { status('此浏览器不支持选择文件夹，请使用“导入视频”多选文件。', true); return; }
  $('folder-input').click();
};
$('folder-input').onchange = async e => { await importFiles(e.target.files, { folder:true }); e.target.value = ''; };
for (const [id,step] of [['previous-file',-1],['next-file',1]]) $(id).onclick = () => {
  const item = files[files.indexOf(active) + step]; if (!busy && item) selectFile(item);
};
document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); $('drop-zone').classList.add('dragover'); } });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) $('drop-zone').classList.remove('dragover'); });
document.addEventListener('drop', e => { e.preventDefault(); $('drop-zone').classList.remove('dragover'); if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
async function nativeVideo(url, timeout = 12000) {
  video.pause();
  return new Promise(resolve => {
    const finish = value => { clearTimeout(timer); video.removeEventListener('loadeddata',loaded); video.removeEventListener('error',error); resolve(value); };
    const loaded = () => finish(true), error = () => finish(false);
    const timer = setTimeout(() => finish(false), timeout);
    video.addEventListener('loadeddata', loaded); video.addEventListener('error', error); video.src = url; video.load();
  });
}
async function selectFile(item) {
  if (busy) return;
  if (active?.meta) active.exportSettings = { format:$('format').value, quality:$('quality').value, audio:$('audio').checked };
  await task('正在读取视频…', async () => {
    if (active?.raw && active !== item) { URL.revokeObjectURL(active.frameURL); active.frameURL = null; active.frameIndex = null; }
    video.pause(); active = item; dragging = null; spacePan = false; panMode = false; updatePanMode();
    $('result').hidden = true; $('media-stage').hidden = true; canvas.hidden = true; $('crop-badge').hidden = true; $('empty-state').hidden = true; renderFiles();
    $('active-name').textContent = item.file.name;
    $('active-name').title = item.path;
    $('source-info').textContent = '正在读取视频…';
    if (!item.meta) await probe(item);
    $('viewer').style.setProperty('--video-ratio', item.meta.width / item.meta.height);
    item.view ||= { zoom:1, x:0, y:0 };
    if (item.ext === 'avi' && item.raw === undefined) item.raw = await openRawAVI(item.file, item.meta);
    checkCancelled();
    $('source-info').textContent = `${item.meta.width} × ${item.meta.height} · ${Number(item.meta.fps.toFixed(3))} fps`;
    item.exportSettings ||= { format:'mp4', quality:'18', audio:item.meta.audio };
    $('aspect').value = item.aspect; $('audio').checked = item.exportSettings.audio;
    $('format').value = item.exportSettings.format; $('quality').value = item.exportSettings.quality; $('format').onchange();
    $('audio').disabled = !item.meta.audio;
    $('media-stage').hidden = false; canvas.hidden = false; $('crop-badge').hidden = false; sync(); resize();
    if (item.ext === 'mp4' && item.native !== false) {
      item.nativeURL ||= URL.createObjectURL(item.file);
      item.native = await nativeVideo(item.nativeURL); checkCancelled();
    }
    if (item.native) { clipOffset = 0; showVideo(); video.currentTime = item.current; }
    else {
      item.native = false;
      try { await frameAt(item.current); }
      catch (error) { if (!item.raw) throw error; item.raw = null; await frameAt(item.current); }
    }
    status(item.raw ? '可以直接播放，无需等待生成预览。拖动进度条或逐帧查看后即可裁剪导出。' : item.native ? '拖动选框调整画面，设置时间后即可导出。' : '已开启按帧预览。拖动进度条查看；点击播放可生成所选片段的播放预览。');
    renderFiles();
  });
}
function showVideo() { video.hidden = false; $('frame').hidden = true; $('preview-label').textContent = active.native ? '原视频预览' : '播放预览 · 导出使用原视频'; }
async function frameAt(seconds) {
  if (active.raw) { await rawFrameAt(active, seconds, previewEpoch); return; }
  const path = await mount(active);
  progress('正在读取当前帧…');
  const t = clamp(seconds, 0, Math.max(0,active.meta.duration - 1 / active.meta.fps));
  // The bundled MJPEG encoder fails on the supplied overlay AVI with a buffer
  // reallocation/out-of-bounds error. PNG avoids that path; exports use the source.
  await exec(['-ss',t.toFixed(6),'-i',path,'-frames:v','1','-vf',"scale='min(1024,iw)':-2,setsar=1",'-threads','1','/frame.png']);
  const bytes = await engine.readFile('/frame.png'); await removeTemp('/frame.png');
  if (!bytes.length) throw new Error('该时间点没有可读取的画面');
  if (active.frameURL) URL.revokeObjectURL(active.frameURL);
  active.frameURL = URL.createObjectURL(new Blob([bytes], { type:'image/png' }));
  $('frame').src = active.frameURL; await $('frame').decode();
  video.hidden = true; $('frame').hidden = false; $('preview-label').textContent = '按帧预览 · 点击播放生成片段预览';
}
function stopPlayback() {
  previewEpoch++; clearTimeout(previewTimer); previewTimer = null;
  previewPlaying = false; video.pause(); $('play').textContent = '▶';
}
$('edit-controls').addEventListener('focusin', stopPlayback);
canvas.addEventListener('focus', stopPlayback);
async function rawFrameAt(item, seconds, epoch) {
  const index = clamp(Math.floor(seconds * item.meta.fps + 1e-6), 0, item.raw.frames - 1);
  if (item.frameIndex !== index || !item.frameURL) {
    const url = URL.createObjectURL(item.raw.frame(index)), image = new Image(); image.src = url;
    try { await image.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
    if (epoch !== previewEpoch || item !== active) { URL.revokeObjectURL(url); return; }
    const previousURL = item.frameURL;
    item.frameURL = url; item.frameIndex = index; $('frame').src = url;
    if (previousURL) URL.revokeObjectURL(previousURL);
  } else $('frame').src = item.frameURL;
  video.hidden = true; $('frame').hidden = false; $('frame').dataset.index = index;
  $('preview-label').textContent = '直接播放 · 无需生成预览';
}
function playRaw() {
  const item = active, epoch = ++previewEpoch, start = item.current, started = performance.now();
  previewPlaying = true; $('play').textContent = 'Ⅱ';
  // Keep only the displayed frame and one pending read. Slow disks may skip
  // preview frames to keep time; source frames remain untouched for export.
  const tick = async () => {
    if (epoch !== previewEpoch || active !== item) return;
    const target = Math.min(item.end, start + (performance.now() - started) / 1000);
    try { await rawFrameAt(item, Math.min(target, item.end - 1e-6), epoch); }
    catch { if (epoch === previewEpoch) { stopPlayback(); status('当前画面读取失败，请重新定位或切换视频后重试。', true); } return; }
    if (epoch !== previewEpoch || active !== item) return;
    item.current = target; sync();
    if (target >= item.end) { stopPlayback(); return; }
    const nextFrame = (Math.floor(target * item.meta.fps + 1e-6) + 1) / item.meta.fps;
    previewTimer = setTimeout(tick, Math.max(0, (nextFrame - start) * 1000 - (performance.now() - started)));
  };
  tick();
}
function sync() {
  if (!active?.meta) return;
  const { meta, crop, start, end, current } = active;
  for (const key of ['x','y','w','h']) $('crop-' + key).value = crop[key];
  $('start').value = Number(start.toFixed(3)); $('end').value = Number(end.toFixed(3));
  for (const id of ['seek','start-range','end-range','start','end']) $(id).max = meta.duration;
  $('seek').value = current; $('start-range').value = start; $('end-range').value = end;
  $('selected-track').style.left = `${start / meta.duration * 100}%`; $('selected-track').style.right = `${(1 - end / meta.duration) * 100}%`;
  $('clock').innerHTML = `${time(current)} <span>/ ${time(meta.duration)}</span>`;
  $('selection-duration').textContent = `保留 ${(end-start).toFixed(3)} 秒`;
  $('output-size').textContent = `${crop.w} × ${crop.h}`; $('output-duration').textContent = `${(end-start).toFixed(3)} 秒`;
  $('crop-badge').textContent = `${crop.w} × ${crop.h}`; drawCrop();
}
function expandWorkspace(expanded) {
  document.querySelector('.workspace').classList.toggle('expanded', expanded);
  $('expand-workspace').setAttribute('aria-expanded', String(expanded));
  $('expand-workspace').textContent = expanded ? '收起工作区' : '展开工作区';
  dragging = null;
  document.querySelector('.editor').scrollIntoView({ block:'start' });
}
$('expand-workspace').onclick = () => expandWorkspace($('expand-workspace').getAttribute('aria-expanded') !== 'true');
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('expand-workspace').getAttribute('aria-expanded') === 'true' && !document.querySelector('dialog[open]')) {
    expandWorkspace(false); $('expand-workspace').focus();
  }
});
function resize() {
  if (!active?.view) return;
  const area = $('viewer'), ratio = active.meta.width / active.meta.height, view = active.view;
  const w = Math.min(area.clientWidth - 16, (area.clientHeight - 16) * ratio), h = w / ratio;
  if (view.fitWidth) { view.x *= w / view.fitWidth; view.y *= w / view.fitWidth; }
  view.fitWidth = w;
  const maxX = Math.max(0, (w * view.zoom - area.clientWidth) / 2 + 8), maxY = Math.max(0, (h * view.zoom - area.clientHeight) / 2 + 8);
  view.x = clamp(view.x, -maxX, maxX); view.y = clamp(view.y, -maxY, maxY);
  $('media-stage').style.width = `${w}px`; $('media-stage').style.height = `${h}px`;
  $('media-stage').style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  // Keep the overlay at viewport size even at 8x, rather than allocating a huge canvas.
  const cw = Math.round(area.clientWidth * devicePixelRatio), ch = Math.round(area.clientHeight * devicePixelRatio);
  if (canvas.width !== cw) canvas.width = cw; if (canvas.height !== ch) canvas.height = ch;
  $('zoom').value = view.zoom; $('zoom-value').textContent = `${Number(view.zoom.toFixed(2))}×`;
  $('zoom-out').disabled = view.zoom <= 1; $('zoom-in').disabled = view.zoom >= 8;
  drawCrop();
}
new ResizeObserver(resize).observe($('viewer'));
function zoomTo(value, clientX, clientY) {
  if (busy || !active?.view) return;
  const rect = $('viewer').getBoundingClientRect(), view = active.view, next = clamp(value, 1, 8);
  const x = clientX == null ? 0 : clientX - (rect.left + rect.width / 2), y = clientY == null ? 0 : clientY - (rect.top + rect.height / 2);
  view.x = x - (x - view.x) * next / view.zoom; view.y = y - (y - view.y) * next / view.zoom;
  view.zoom = next; dragging = null; resize();
}
function updatePanMode() {
  $('pan-mode').setAttribute('aria-pressed', String(panMode));
  canvas.classList.toggle('pan-ready', panMode || spacePan);
  canvas.classList.toggle('panning', dragging?.mode === 'pan');
}
$('zoom').oninput = () => zoomTo(Number($('zoom').value));
$('zoom-in').onclick = () => zoomTo(active.view.zoom * 1.25);
$('zoom-out').onclick = () => zoomTo(active.view.zoom / 1.25);
$('zoom-reset').onclick = () => { active.view = { zoom:1, x:0, y:0 }; dragging = null; resize(); };
$('pan-mode').onclick = () => { panMode = !panMode; updatePanMode(); };
$('viewer').addEventListener('wheel', e => {
  if (busy || !active?.view || e.ctrlKey || e.metaKey) return;
  e.preventDefault(); zoomTo(active.view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
}, { passive:false });
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || !active?.view || busy || e.target.closest('input,textarea,select,button,a,[contenteditable]')) return;
  e.preventDefault(); spacePan = true; updatePanMode();
});
document.addEventListener('keyup', e => { if (e.code === 'Space') { spacePan = false; updatePanMode(); } });
window.addEventListener('blur', () => { spacePan = false; dragging = null; updatePanMode(); });
function drawCrop() {
  if (!active?.meta || canvas.hidden) return;
  const {crop:c,meta:m} = active, box = $('media-stage').getBoundingClientRect(), overlay = canvas.getBoundingClientRect(), unit=devicePixelRatio;
  const sx = box.width / m.width * unit, sy = box.height / m.height * unit, ox = (box.left - overlay.left) * unit, oy = (box.top - overlay.top) * unit;
  const x = ox+c.x*sx, y = oy+c.y*sy, w = c.w*sx, h = c.h*sy;
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#0009'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.clearRect(x,y,w,h);
  ctx.strokeStyle='#bca5ff'; ctx.lineWidth=1.5*unit; ctx.strokeRect(x,y,w,h);
  ctx.strokeStyle='#ffffff36'; ctx.lineWidth=unit*.6;
  for(let i=1;i<=2;i++){ctx.beginPath();ctx.moveTo(x+w*i/3,y);ctx.lineTo(x+w*i/3,y+h);ctx.moveTo(x,y+h*i/3);ctx.lineTo(x+w,y+h*i/3);ctx.stroke();}
  ctx.fillStyle='#ede4ff'; for(const [px,py] of handles(c)){ctx.fillRect(ox+px*sx-3*unit,oy+py*sy-3*unit,6*unit,6*unit);}
}
function handles(c){return [[c.x,c.y],[c.x+c.w/2,c.y],[c.x+c.w,c.y],[c.x+c.w,c.y+c.h/2],[c.x+c.w,c.y+c.h],[c.x+c.w/2,c.y+c.h],[c.x,c.y+c.h],[c.x,c.y+c.h/2]];}
function normalizedCrop(c) {
  const m=active.meta;
  const w=clamp(even(c.w),2,even(m.width)), h=clamp(even(c.h),2,even(m.height));
  return {x:clamp(even(c.x),0,even(m.width-w)),y:clamp(even(c.y),0,even(m.height-h)),w,h};
}
function aspectRatio(){return active.aspect==='original'?active.meta.width/active.meta.height:active.aspect==='free'?0:Number(active.aspect);}
function position(e){const rect=$('media-stage').getBoundingClientRect();return {x:clamp((e.clientX-rect.left)/rect.width*active.meta.width,0,active.meta.width),y:clamp((e.clientY-rect.top)/rect.height*active.meta.height,0,active.meta.height)};}
canvas.onpointerdown=e=>{
  if(busy||!active?.meta||!e.isPrimary||![0,1].includes(e.button))return; stopPlayback();
  if(panMode||spacePan||e.button===1){dragging={mode:'pan',startX:e.clientX,startY:e.clientY,x:active.view.x,y:active.view.y};canvas.setPointerCapture(e.pointerId);e.preventDefault();updatePanMode();return;}
  const rect=$('media-stage').getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return;
  const p=position(e),c=active.crop;
  const threshold=12/rect.width*active.meta.width;
  const handle=handles(c).findIndex(([x,y])=>Math.abs(x-p.x)<threshold&&Math.abs(y-p.y)<threshold);
  const inside=p.x>=c.x&&p.x<=c.x+c.w&&p.y>=c.y&&p.y<=c.y+c.h;
  dragging={start:p,crop:{...c},handle,mode:handle>=0?'resize':inside?'move':'new'};canvas.setPointerCapture(e.pointerId);e.preventDefault();
};
canvas.onpointermove=e=>{
  if(!dragging||!active)return;
  if(dragging.mode==='pan'){active.view.x=dragging.x+e.clientX-dragging.startX;active.view.y=dragging.y+e.clientY-dragging.startY;resize();return;}
  const p=position(e),d=dragging,c=d.crop,m=active.meta;
  if(d.mode==='move'){active.crop=normalizedCrop({...c,x:c.x+p.x-d.start.x,y:c.y+p.y-d.start.y});sync();return;}
  let left=c.x,right=c.x+c.w,top=c.y,bottom=c.y+c.h;
  if(d.mode==='new'){left=d.start.x;right=p.x;top=d.start.y;bottom=p.y;}
  else{if([0,6,7].includes(d.handle))left=p.x;if([2,3,4].includes(d.handle))right=p.x;if([0,1,2].includes(d.handle))top=p.y;if([4,5,6].includes(d.handle))bottom=p.y;}
  let x=Math.min(left,right),y=Math.min(top,bottom),w=Math.abs(right-left),h=Math.abs(bottom-top);const ratio=aspectRatio();
  if(ratio){if(w/h>ratio)w=h*ratio;else h=w/ratio;if(d.mode==='resize'){if([0,6,7].includes(d.handle))x=c.x+c.w-w;if([0,1,2].includes(d.handle))y=c.y+c.h-h;}else{if(p.x<d.start.x)x=d.start.x-w;if(p.y<d.start.y)y=d.start.y-h;}}
  active.crop=normalizedCrop({x,y,w:Math.min(w,m.width-x),h:Math.min(h,m.height-y)});sync();
};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{dragging=null;updatePanMode();};
canvas.onkeydown=e=>{if(!active?.meta||busy)return;const delta=e.shiftKey?10:2;const changes={ArrowLeft:[-delta,0],ArrowRight:[delta,0],ArrowUp:[0,-delta],ArrowDown:[0,delta]};if(changes[e.key]){e.preventDefault();const [x,y]=changes[e.key];active.crop=normalizedCrop({...active.crop,x:active.crop.x+x,y:active.crop.y+y});sync();}};
for(const key of ['x','y','w','h'])$('crop-'+key).onchange=()=>{
  const value=Number($('crop-'+key).value);if(!Number.isFinite(value)){sync();return;}
  const c={...active.crop,[key]:value},ratio=aspectRatio();if(ratio&&key==='w')c.h=c.w/ratio;if(ratio&&key==='h')c.w=c.h*ratio;active.crop=normalizedCrop(c);sync();
};
$('aspect').onchange=()=>{active.aspect=$('aspect').value;const ratio=aspectRatio();if(ratio){let w=active.crop.w,h=w/ratio;if(h>active.meta.height){h=active.meta.height;w=h*ratio;}active.crop=normalizedCrop({...active.crop,w,h});}sync();};
$('reset-crop').onclick=()=>{active.aspect='free';$('aspect').value='free';active.crop={x:0,y:0,w:even(active.meta.width),h:even(active.meta.height)};sync();};
function setTime(which,value){
  if(!Number.isFinite(value)){sync();return;}const gap=Math.min(1/active.meta.fps,active.meta.duration);
  if(which==='start')active.start=clamp(value,0,active.end-gap);else active.end=clamp(value,active.start+gap,active.meta.duration);stopPlayback();sync();
}
for(const key of ['start','end']){$(key).onchange=()=>setTime(key,Number($(key).value));$(key+'-range').oninput=()=>setTime(key,Number($(key+'-range').value));}
$('reset-time').onclick=()=>{stopPlayback();active.start=0;active.end=active.meta.duration;sync();};
$('set-start').onclick=()=>setTime('start',active.current);$('set-end').onclick=()=>setTime('end',active.current);
async function seek(seconds){
  if(busy||!active?.meta)return;stopPlayback();active.current=clamp(seconds,0,Math.max(0,active.meta.duration-1/active.meta.fps));sync();
  if(active.native){clipOffset=0;showVideo();video.currentTime=active.current;}
  else if(active.proxy && active.current>=active.proxy.start && active.current<active.proxy.end){if(video.src!==active.proxy.url)await nativeVideo(active.proxy.url);clipOffset=active.proxy.start;showVideo();video.currentTime=active.current-clipOffset;}
  else await task('读取视频帧…',()=>frameAt(active.current));
}
$('seek').oninput=()=>{if(active){stopPlayback();active.current=Number($('seek').value);sync();if(active.native)video.currentTime=active.current;}};
$('seek').onchange=()=>seek(Number($('seek').value));$('previous').onclick=()=>seek(active.current-1/active.meta.fps);$('next').onclick=()=>seek(active.current+1/active.meta.fps);
$('play').onclick=async()=>{
  if(previewPlaying || (!video.paused&&!video.hidden)){stopPlayback();return;}if(!active?.meta)return;
  if(active.raw){
    if(active.current<active.start||active.current>=active.end-1/active.meta.fps)active.current=active.start;
    playRaw();return;
  }
  if(!active.native && !(active.proxy&&active.proxy.start<=active.start&&active.proxy.end>=active.end)){
    const ok=await task('正在生成选定片段的播放预览…',async()=>{
      const path=await mount(active);processingDuration=active.end-active.start;progress('正在生成播放预览，完成后自动播放…',0);
      await exec(['-ss',String(active.start),'-i',path,'-t',String(processingDuration),'-map','0:v:0','-map','0:a:0?','-c:a','aac','-vf',`scale='min(720,iw)':-2,setsar=1,fps=${Math.min(15,active.meta.fps)}`,'-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p','-threads','1','-movflags','+faststart','/preview.mp4']);
      const data=await engine.readFile('/preview.mp4');await removeTemp('/preview.mp4');if(active.proxy)URL.revokeObjectURL(active.proxy.url);
      active.proxy={start:active.start,end:active.end,url:URL.createObjectURL(new Blob([data],{type:'video/mp4'}))};
      if(!await nativeVideo(active.proxy.url))throw new Error('播放预览无法打开');status('播放预览已生成；最终导出使用原视频的完整分辨率和帧率。');
    });if(!ok)return;
  }
  if(!active.native&&video.src!==active.proxy.url)await nativeVideo(active.proxy.url);
  clipOffset=active.native?0:active.proxy.start;showVideo();
  if(active.current<active.start||active.current>=active.end-1/active.meta.fps)active.current=active.start;
  video.currentTime=active.current-clipOffset;previewPlaying=true;video.play().catch(e=>status('请再次点击播放：'+e.message,true));
};
video.ontimeupdate=()=>{if(!active?.meta||video.hidden||busy||!previewPlaying)return;active.current=clamp(video.currentTime+clipOffset,0,active.meta.duration);if(active.current>=active.end){video.pause();active.current=active.end;}sync();};
video.onplay=()=>{if(!video.hidden)$('play').textContent='Ⅱ';};video.onpause=video.onended=()=>{if(active?.raw&&video.hidden)return;$('play').textContent='▶';previewPlaying=false;};
$('format').onchange=()=>{$('quality-label').hidden=$('format').value==='avi';$('export-note').textContent=$('format').value==='avi'?'FFV1 无损编码，文件较大；建议用 VLC 播放。':'按原视频帧率导出，画面不拉伸。';};
function outputLocation(note) {
  $('output-folder').textContent = outputFolder ? `${folderRemembered ? '已记住' : '本次保存'}：${outputFolder.name}${outputPermission === 'granted' ? ' · 自动保存' : ' · 待允许访问'}` : '普通下载（由浏览器决定位置）';
  $('choose-output').textContent = outputFolder ? '更换保存文件夹' : '选择保存文件夹';
  $('grant-output').hidden = !outputFolder || outputPermission === 'granted';
  $('clear-output').hidden = !outputFolder;
  $('save-again').hidden = !lastExport || !outputFolder || lastExport.saved;
  $('folder-note').textContent = note || (sharedHosting ? '此免费入口仅在当前页面记住文件夹，连续导出无需重选；刷新或关闭后需重新选择。' : outputFolder && !folderRemembered ? '本次可直接保存；浏览器未能记住该位置，关闭网页后需要重新选择。' : canChooseFolder ? '首次选择后记住，后续导出自动保存；同名文件自动编号。' : '此浏览器仅支持普通下载；记住文件夹请使用电脑上的 Chrome 或 Edge。');
  controls();
}
async function restoreOutputLocation() {
  let note;
  try {
    if (canChooseFolder) {
      const remembered = await folderSetting('get');
      outputFolder = remembered?.kind === 'directory' && typeof remembered.queryPermission === 'function' ? remembered : null;
      if (outputFolder) outputPermission = await outputFolder.queryPermission({ mode:'readwrite' });
    }
  } catch { note = '未能恢复上次保存位置，请重新选择文件夹。'; }
  finally { locationReady = true; outputLocation(note); }
}
$('choose-output').onclick = async () => {
  if (busy || locationBusy || !locationReady || !canChooseFolder) return;
  locationBusy = true; stopPlayback(); controls();
  try {
    const folder = await window.showDirectoryPicker({ id:'framecut-output', mode:'readwrite' });
    outputFolder = folder; outputPermission = await folder.queryPermission({ mode:'readwrite' });
    if (lastExport) lastExport.saved = false;
    try { await folderSetting('set', folder); folderRemembered = true; }
    catch { folderRemembered = false; }
    outputLocation();
  } catch (error) { if (error.name !== 'AbortError') status('无法选择保存文件夹，请在电脑上的 Chrome / Edge 打开网页后重试。', true); }
  finally { locationBusy = false; controls(); }
};
async function ensureOutputAccess() {
  if (!outputFolder) return true;
  try {
    outputPermission = await outputFolder.queryPermission({ mode:'readwrite' });
    if (outputPermission !== 'granted') outputPermission = await outputFolder.requestPermission({ mode:'readwrite' });
  } catch { outputPermission = 'prompt'; }
  outputLocation();
  if (outputPermission !== 'granted') status('请允许保存到已记住的文件夹；也可更换文件夹或恢复普通下载。', true);
  return outputPermission === 'granted';
}
$('grant-output').onclick = async () => {
  if (busy || locationBusy) return;
  locationBusy = true; controls();
  try { if (await ensureOutputAccess()) status('已允许访问保存文件夹，后续导出会直接保存。'); }
  finally { locationBusy = false; controls(); }
};
$('clear-output').onclick = async () => {
  if (busy || locationBusy) return;
  locationBusy = true; controls();
  try { await folderSetting('set', null); outputFolder = null; outputPermission = 'prompt'; outputLocation(); }
  catch { status('未能清除保存位置，请稍后重试。', true); }
  finally { locationBusy = false; controls(); }
};
async function saveCompletedExport() {
  savingFile = true; controls(); progress('正在保存到所选文件夹…');
  try {
    const savedName = await writeToFolder(outputFolder, lastExport.name, lastExport.blob);
    lastExport.saved = true;
    $('result-title').textContent = '已保存到文件夹';
    $('result-info').textContent = `${outputFolder.name} / ${savedName} · ${humanSize(lastExport.blob.size)}`;
    $('result-note').textContent = '已自动保存。同名文件自动编号，不覆盖已有文件。';
    $('download').textContent = '另存一份（普通下载）';
    status(`已保存到「${outputFolder.name}」：${savedName}`);
  } catch {
    // Keep the encoded Blob even if createWritable, write, or close fails.
    lastExport.saved = false;
    $('result-title').textContent = '已生成，尚未保存';
    $('result-note').textContent = '可重试保存或更换文件夹，无需重新处理视频；也可点击普通下载。';
    $('download').textContent = '普通下载';
    try { outputPermission = await outputFolder.queryPermission({ mode:'readwrite' }); } catch { outputPermission = 'prompt'; }
    status('文件夹写入失败。请检查权限或剩余磁盘空间；视频已保留，可重试保存或普通下载。', true);
  } finally { savingFile = false; outputLocation(); }
}
$('save-again').onclick = async () => {
  if (busy || locationBusy || !lastExport || !outputFolder) return;
  await task('正在准备保存…', async () => { if (await ensureOutputAccess()) { checkCancelled(); await saveCompletedExport(); } });
};
restoreOutputLocation();
async function exportVideo(){
  if(!active?.meta||busy||locationBusy||!locationReady)return;
  await task('正在准备导出…',async()=>{
    // Ask while the export click still supplies user activation, before encoding.
    if (!await ensureOutputAccess()) return;
    checkCancelled();
    const path=await mount(active),format=$('format').value,c={...active.crop},duration=active.end-active.start;
    if(!(duration>0&&c.w>=2&&c.h>=2&&c.x+c.w<=active.meta.width&&c.y+c.h<=active.meta.height))throw new Error('裁剪参数无效');
    const out=`/output.${format}`,name=`${active.file.name.replace(/\.[^.]+$/,'')}_crop_${c.w}x${c.h}_${active.start.toFixed(3)}-${active.end.toFixed(3)}.${format}`;
    processingDuration=duration;progress('正在导出视频，请保持页面打开…',0);
    const args=['-ss',active.start.toFixed(6),'-i',path,'-t',duration.toFixed(6),'-map','0:v:0'];
    if($('audio').checked&&active.meta.audio)args.push('-map','0:a:0?');else args.push('-an');
    args.push('-vf',`crop=${c.w}:${c.h}:${c.x}:${c.y}:exact=1,setsar=1`);
    if(format==='mp4')args.push('-c:v','libx264','-preset','fast','-crf',$('quality').value,'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart');
    else args.push('-c:v','ffv1','-level','3','-c:a','pcm_s16le');
    args.push('-threads','1',out);
    try{
      await exec(args);progress('正在准备下载…');const data=await engine.readFile(out);if(!data.length)throw new Error('导出文件为空');
      const blob=new Blob([data],{type:format==='mp4'?'video/mp4':'video/x-msvideo'});
      lastExport={blob,name,saved:false};
      if(resultURL)URL.revokeObjectURL(resultURL);resultURL=URL.createObjectURL(blob);
      $('download').href=resultURL;$('download').download=name;$('result-info').textContent=`${name} · ${humanSize(data.length)}`;$('result').hidden=false;
      $('result-title').textContent='导出完成';$('download').textContent='保存视频';$('result-note').textContent='若没有自动下载，请点击保存。';outputLocation();
      if(outputFolder)await saveCompletedExport();
      else{status(`导出完成：${c.w} × ${c.h}，${duration.toFixed(3)} 秒。原视频未修改。`);$('download').click();}
    }finally{await removeTemp(out);}
  });
}
$('export').onclick=exportVideo;
$('help-button').onclick=()=>$('help').showModal();$('close-help').onclick=()=>$('help').close();
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
// Optional structured access uses the same validated state as the visible controls.
if(document.modelContext?.registerTool){
  const lifetime=new AbortController();window.addEventListener('pagehide',()=>lifetime.abort(),{once:true});
  for(const tool of [{name:'read_video_edit',description:'Read the selected local video crop and time range. No video contents are sent.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>active?.meta?{name:active.file.name,...active.meta,crop:{...active.crop},start:active.start,end:active.end}: {selected:false}},
    {name:'configure_video_edit',description:'Set the current video crop and time range without exporting.',inputSchema:{type:'object',properties:{x:{type:'integer'},y:{type:'integer'},width:{type:'integer'},height:{type:'integer'},start:{type:'number'},end:{type:'number'}},required:['x','y','width','height','start','end'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:p=>{if(!active?.meta||busy)throw new Error('No editable video');const {x,y,width:w,height:h,start,end}=p;if(![x,y,w,h].every(Number.isInteger)||![start,end].every(Number.isFinite)||x<0||y<0||w<2||h<2||x+w>active.meta.width||y+h>active.meta.height||start<0||end>active.meta.duration||end-start<1/active.meta.fps||[x,y,w,h].some(n=>n%2))throw new Error('Invalid crop or time range');active.crop={x,y,w,h};active.start=start;active.end=end;active.aspect='free';$('aspect').value='free';sync();return{crop:active.crop,start,end};}}]){
    try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifetime.signal})).catch(console.warn);}catch(e){console.warn(e);}
  }
}
