import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the application's real state validation and export handler. The codec
// itself is covered separately by the actual WASM/export-pixel regression tests.
const source = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
const loadModule = file => import(`data:text/javascript;base64,${Buffer.from(readFileSync(new URL(file, import.meta.url), 'utf8')).toString('base64')}`);
const { timeOverlayLayout, videoFilterArgs } = await loadModule('./src/time-overlay.js');
const { scaleBarLayout, drawScaleBar } = await loadModule('./src/scale-bar.js');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Application section is missing: ${start}`);
  return source.slice(from, to);
}
const realHandlers = [
  section('async function probe(item)', 'function renderFiles()'),
  section('async function selectFile(item)', 'function showVideo()'),
  section('function annotationError()', 'function syncTimeOverlay()'),
  section('function scalePatch()', 'function drawTimePreview()'),
  section('async function exportVideo()', "$('export').onclick=exportVideo;")
].join('\n');
const json = value => JSON.parse(JSON.stringify(value));
function harness() {
  const elements = new Map(), calls = { exports:[], writes:[], removed:[], status:[], downloads:0, probes:0 };
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'format' ? 'avi' : id === 'quality' ? '18' : '',
      checked: id === 'audio', hidden:false, style:{ setProperty(){} },
      onclick(){}, onchange(){}, setAttribute(){},
      click(){ calls.downloads++; }
    });
    return elements.get(id);
  };
  const probeData = { streams:[
    { codec_type:'video', codec_name:'rawvideo', width:640, height:480, avg_frame_rate:'4/1', duration:'3' },
    { codec_type:'audio' }
  ] };
  const drawCalls = [];
  const paint = Object.fromEntries(['save','restore','clearRect','fillRect','fillText'].map(name => [name,(...args)=>drawCalls.push([name,...args])]));
  const context = {
    $, active:null, busy:false, locationBusy:false, locationReady:true, video:{pause(){},hidden:false},canvas:{hidden:false},
    resultURL:null, outputFolder:null, dragging:null, spacePan:false, panMode:false, moveMode:false,
    timestampMode:false, calibrationMode:false, previewEpoch:0, timeOverlayLayout, videoFilterArgs,
    scaleBarLayout, drawScaleBar, Blob,
    URL:{createObjectURL:()=> 'blob:test-result',revokeObjectURL(){}},
    document:{ createElement(type) {
      assert.equal(type,'canvas');
      return {getContext:()=>paint,toBlob(callback,type){ assert.equal(type,'image/png'); callback(new Blob([new Uint8Array([137,80,78,71])],{type})); }};
    } },
    engine:{
      async ffprobe(){ calls.probes++; return 0; },
      async readFile(path){ return path === '/probe.json' ? JSON.stringify(probeData) : new Uint8Array([1,2,3]); },
      async writeFile(path,data){ calls.writes.push([path,Array.from(data)]); }
    },
    task:async(_label,fn)=>{ await fn(); return true; },
    mount:async item => `/input/source.${item.ext}`,
    exec:async args => { calls.exports.push(Array.from(args)); },
    removeTemp:async path=>calls.removed.push(path),
    ensureOutputAccess:async()=>true,
    status:(...args)=>calls.status.push(args),
    nativeVideo:async()=>true,openRawAVI:async()=>({frames:12}),frameAt:async()=>{},showVideo(){},
    checkCancelled(){},updatePanMode(){},renderFiles(){},resize(){},sync(){},progress(){},outputLocation(){},
    even:n=>Math.floor(n/2)*2,humanSize:()=> 'test size'
  };
  runInNewContext(realHandlers,context);
  const makeFile = (ext='avi',name=`source.${ext}`) => ({id:name,ext,path:name,file:{name},native:ext==='mp4'});
  const choose = async (ext='avi') => {
    const item=makeFile(ext); await context.selectFile(item);
    item.crop={x:100,y:120,w:320,h:240};item.start=.75;item.end=2.25;
    return item;
  };
  return {context,calls,$,choose,makeFile,drawCalls};
}

// A freshly read video cannot silently produce a timestamp-free export.
{
  const h=harness(),item=await h.choose();
  assert.equal(item.timeOverlay.enabled,true);
  assert.equal(item.timeRegion,null);
  await h.context.exportVideo();
  assert.equal(h.calls.exports.length,0);
  assert.match(h.calls.status.at(-1)[0],/框选原时间/);
  assert.match(h.context.annotationSummary(),/待框选/);
}

// Both preview paths and both output formats use the original video as input.
for (const input of ['avi','mp4']) for (const format of ['avi','mp4']) {
  const h=harness(),item=await h.choose(input);
  item.timeRegion={x:440,y:8,w:192,h:28};
  h.$('format').value=format;
  await h.context.exportVideo();
  const args=h.calls.exports[0],graph=args[args.indexOf('-filter_complex')+1];
  assert.equal(h.calls.exports.length,1);
  assert.equal(args[args.indexOf('-i')+1],`/input/source.${input}`);
  assert.match(graph,/split=2\[scene\]\[clock\]/);
  assert.match(graph,/crop=192:28:440:8:exact=1/);
  assert.match(graph,/overlay=124:4/);
  assert.equal(args[args.indexOf('-map')+1],'[withtime]');
  assert.equal(args[args.indexOf('-c:v')+1],format==='avi'?'ffv1':'libx264');
  assert.match(h.$('download').download,new RegExp(`_time\\.${format}$`));
  assert.match(h.$('result-note').textContent,/原时间：已加入/);
  assert.equal(h.calls.downloads,1);
}

// Scientific units require calibration. Pixel units intentionally do not.
{
  const h=harness(),item=await h.choose();
  item.timeOverlay.enabled=false;item.scaleBar.enabled=true;
  await h.context.exportVideo();
  assert.equal(h.calls.exports.length,0);
  assert.match(h.calls.status.at(-1)[0],/每像素/);
  item.scaleBar.unit='px';
  await h.context.exportVideo();
  assert.equal(h.calls.exports.length,1);
  assert.match(h.$('download').download,/_scale\.mp4$/);
  assert.doesNotMatch(h.$('download').download,/_time/);
}

// The transparent PNG is a second input, duration is an output option, and
// audio still maps from the source movie, never from the single-frame image.
for (const timestamp of [false,true]) {
  const h=harness(),item=await h.choose();
  item.timeOverlay.enabled=timestamp;item.timeRegion={x:440,y:8,w:192,h:28};
  Object.assign(item.scaleBar,{enabled:true,unitsPerPixel:.5,length:50});
  h.$('format').value='mp4';h.$('audio').checked=true;
  await h.context.exportVideo();
  const args=h.calls.exports[0],graph=args[args.indexOf('-filter_complex')+1];
  const inputs=args.flatMap((value,index)=>value==='-i'?[index]:[]);
  assert.equal(inputs.length,2);
  assert.equal(args[inputs[1]+1],'/scale.png');
  assert(args.indexOf('-ss')<inputs[0]);
  assert(args.indexOf('-t')>inputs[1]+1,'-t must not limit the PNG input');
  assert.equal(args[args.indexOf('-t')+1],'1.500000');
  assert.deepEqual(args.flatMap((value,index)=>value==='-map'?[args[index+1]]:[]),['[withscale]','0:a:0?']);
  assert.match(graph,/\[1:v:0\]format=rgba\[bar\]/);
  assert.match(graph,/\[withtime\]\[bar\]overlay=/);
  assert.match(graph,/eof_action=repeat:repeatlast=1/);
  assert.equal(h.calls.writes[0][0],'/scale.png');
  assert(h.calls.removed.includes('/scale.png'));
  assert(h.drawCalls.some(([name,text])=>name==='fillText'&&text==='50 µm'));
  assert.match(h.$('download').download,timestamp?/_time_scale\.mp4$/:/_scale\.mp4$/);
}

// Do not allow the new bar to hide the copied time.
{
  const h=harness(),item=await h.choose();item.timeRegion={x:440,y:8,w:192,h:28};
  Object.assign(item.scaleBar,{enabled:true,unitsPerPixel:.5,position:'top-right'});
  await h.context.exportVideo();
  assert.equal(h.calls.exports.length,0);assert.match(h.calls.status.at(-1)[0],/重叠/);
}

// Disabling both annotations keeps the original simple crop export.
{
  const h=harness(),item=await h.choose();item.timeOverlay.enabled=false;
  await h.context.exportVideo();
  const args=h.calls.exports[0];
  assert(!args.includes('-filter_complex'));
  assert.equal(args[args.indexOf('-vf')+1],'crop=320:240:100:120:exact=1,setsar=1');
  assert.doesNotMatch(h.$('download').download,/_time|_scale/);
}

// New files demand their own source-time selection; returning to an existing
// file must retain its original region and calibrated scientific scale.
{
  const h=harness(),a=await h.choose();a.timeRegion={x:440,y:8,w:192,h:28};
  Object.assign(a.scaleBar,{enabled:true,unitsPerPixel:.5,length:50});
  const saved=json({timeRegion:a.timeRegion,timeOverlay:a.timeOverlay,scaleBar:a.scaleBar,crop:a.crop});
  const b=h.makeFile('avi','second.avi');await h.context.selectFile(b);
  assert.equal(b.timeOverlay.enabled,true);assert.equal(b.timeRegion,null);assert.equal(b.scaleBar.unitsPerPixel,null);
  assert.equal(h.calls.probes,2);
  await h.context.selectFile(a);
  assert.equal(h.calls.probes,2,'Known file must not be probed/reset again');
  assert.deepEqual(json({timeRegion:a.timeRegion,timeOverlay:a.timeOverlay,scaleBar:a.scaleBar,crop:a.crop}),saved);
}

console.log('Application annotation defaults, validation, AVI/MP4 export args, scale PNG/audio/duration, filenames and per-file state checks passed.');
