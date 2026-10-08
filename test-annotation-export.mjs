import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the application's real state validation and export handler. The codec
// itself is covered separately by the actual WASM/export-pixel regression tests.
const source = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
const loadModule = file => import(`data:text/javascript;base64,${Buffer.from(readFileSync(new URL(file, import.meta.url), 'utf8')).toString('base64')}`);
const { timeOverlayLayout, timeRegionError, originalTimeVisible, applyTimeMatte, videoFilterArgs } = await loadModule('./src/time-overlay.js');
const { scaleBarLayout, drawScaleBar, suggestedScaleLength, calibrationFromReference } = await loadModule('./src/scale-bar.js');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Application section is missing: ${start}`);
  return source.slice(from, to);
}
const realHandlers = [
  section('async function probe(item)', 'function renderFiles()'),
  section('async function selectFile(item)', 'function showVideo()'),
  section('function updateScaleLength()', 'function syncTimeOverlay()'),
  section('function syncTimeOverlay()', 'function scalePatch()'),
  section('async function detectOriginalTime(', "$('frame').addEventListener"),
  section('function scalePatch()', 'function drawTimePreview()'),
  section('function drawTimePreview()', 'async function detectOriginalTime('),
  section("$('keep-scale').onchange", 'function cancelSelection()'),
  section('async function exportVideo(', "$('export').onclick=()=>exportVideo();")
].join('\n');
const json = value => JSON.parse(JSON.stringify(value));
function harness() {
  const elements = new Map(), calls = { exports:[], writes:[], removed:[], status:[], downloads:0, probes:0, detections:[], detected:null, scaleDetections:[], detectedScale:null, decodes:0, mattes:[], fills:[] };
  const drawCalls=[];
  const paintFor = owner => ({...Object.fromEntries(['save','restore','clearRect','fillRect','fillText','strokeText','drawImage','putImageData'].map(name => [name,function(...args){drawCalls.push([name,...args,owner]);if(name==='fillText'||name==='fillRect')calls.fills.push({name,args,style:this.fillStyle});}])),
    getImageData(_x,_y,width,height){const data=new Uint8ClampedArray(width*height*4);data.set([0,0,0,255,200,200,200,255,56,56,56,255,8,8,8,255].slice(0,data.length));return {width,height,data};}});
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'format' ? 'avi' : id === 'quality' ? '18' : '',
      classList:{remove(){},toggle(){}},checked: id === 'audio', hidden:false, style:{ setProperty(){} },
      src:'',naturalWidth:640,naturalHeight:480,async decode(){calls.decodes++;},getContext(){return paintFor(id);},
      onclick(){}, onchange(){}, setAttribute(){},
      click(){ calls.downloads++; }
    });
    return elements.get(id);
  };
  const probeData = { streams:[
    { codec_type:'video', codec_name:'rawvideo', width:640, height:480, avg_frame_rate:'4/1', duration:'3' },
    { codec_type:'audio' }
  ] };
  const context = {
    $, active:null, busy:false, locationBusy:false, locationReady:true, video:{pause(){},hidden:false,src:'',currentSrc:'',videoWidth:640,videoHeight:480,readyState:3},canvas:{hidden:false},
    resultURL:null, outputFolder:null, dragging:null, spacePan:false, panMode:false, moveMode:false,
    requestAnimationFrame:f=>f(),
    resultMode:false,restoringPlan:false,operation:null,files:[],captureExportSettings(){},rememberEdits(){},restorePlanFor:async()=>{},setViewMode(){},setWorkflow(){},markExport(){},editSignature:()=>'test',advanceAfterExport:async()=>{},setPhase(){},
    calibrationMode:false, previewEpoch:0, timeOverlayLayout, timeRegionError, originalTimeVisible, videoFilterArgs,
    applyTimeMatte(imageData,options){const result=applyTimeMatte(imageData,options);calls.mattes.push({options:json(options),pixels:Array.from(result.data.slice(0,16))});return result;},
    scaleBarLayout, drawScaleBar, suggestedScaleLength, calibrationFromReference, Blob,
    URL:{createObjectURL:()=> 'blob:test-result',revokeObjectURL(){}},
    document:{ createElement(type) {
      assert.equal(type,'canvas');
      return {getContext:()=>paintFor('scratch'),toBlob(callback,type){ assert.equal(type,'image/png'); callback(new Blob([new Uint8Array([137,80,78,71])],{type})); }};
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
    nativeVideo:async url=>{context.video.src=context.video.currentSrc=url;context.video.readyState=3;return true;},openRawAVI:async()=>({frames:12}),
    frameAt:async()=>{context.active.frameURL=`blob:frame-${context.active.id}`;$('frame').src=context.active.frameURL;context.video.hidden=true;},showVideo(){context.video.hidden=false;},
    detectTimeRegion:(image,meta)=>{calls.detections.push({image,meta});return calls.detectFn ? calls.detectFn(image,meta) : calls.detected;},
    detectScaleReference:(image,meta)=>{calls.scaleDetections.push({image,meta});return calls.scaleDetectFn ? calls.scaleDetectFn(image,meta) : calls.detectedScale;},
    stopPlayback(){},cancelSelection(){context.dragging=null;},
    checkCancelled(){},updatePanMode(){},renderFiles(){},resize(){},sync(){if(context.active?.meta)context.syncTimeOverlay();},progress(){},outputLocation(){},
    even:n=>Math.floor(n/2)*2,clamp:(n,min,max)=>Math.min(max,Math.max(min,n)),humanSize:()=> 'test size'
  };
  runInNewContext(realHandlers,context);
  const makeFile = (ext='avi',name=`source.${ext}`) => ({id:name,ext,path:name,file:{name},native:ext==='mp4'});
  const choose = async (ext='avi',{autoScale=false}={}) => {
    const item=makeFile(ext); await context.selectFile(item);
    // Isolate prior manual-calibration regression cases after testing real import
    // defaults/detection. New automatic-scale cases opt in to the untouched state.
    if(!autoScale){item.scaleBar.enabled=false;item.scaleBar.autoLength=false;}
    item.crop={x:100,y:120,w:320,h:240};item.start=.75;item.end=2.25;
    return item;
  };
  return {context,calls,$,choose,makeFile,drawCalls};
}

// A freshly read video cannot silently produce a timestamp-free export.
{
  const h=harness(),item=await h.choose();
  assert.equal(item.timeOverlay.enabled,true);
  assert.equal(item.timeOverlay.position,'top-right','Original time defaults to the requested upper corner');
  assert.equal(item.timeOverlay.widthPercent,40,'Relocated time defaults to 40 percent of the output width');
  assert.equal(item.timeOverlay.color,'red','Original timestamp glyphs default to the requested red');
  assert.equal(item.transparentAnnotations,true,'Original time and scale default to transparent backgrounds');
  assert.equal(h.$('transparent-annotations').checked,true);
  assert.equal(item.scaleBar.position,'bottom-right','Scientific scale defaults to the requested bottom-right corner');
  assert.equal(item.timeRegion,null);
  await h.context.exportVideo();
  assert.equal(h.calls.exports.length,0);
  assert.equal(item.autoTimeState,'missing');
  assert.equal(h.calls.detections.length,1,'Import automatically tries to locate source time');
  assert.match(h.calls.status.at(-1)[0],/尚未定位/);
  assert.match(h.context.annotationSummary(),/待定位/);
}

// Enabling preservation locates the source label without asking the user to draw.
// Detection and retries cannot alter the scientific crop or current zoom.
{
  const h=harness(),item=await h.choose();
  const crop=json(item.crop),view=json(item.view);
  for(const enabled of [false,true]){
    h.$('keep-time').checked=enabled;await h.$('keep-time').onchange();
    assert.equal(item.timeOverlay.enabled,enabled);
    assert.deepEqual(json(item.crop),crop);
    assert.deepEqual(json(item.view),view);
    assert.equal(item.timeRegion,null);
  }
  const selected={x:440,y:8,w:192,h:28};
  h.calls.detected=selected;
  await h.$('detect-time').onclick();
  assert.deepEqual(json(item.timeRegion),selected);
  assert.equal(item.autoTimeState,'found');
  assert.equal(h.calls.detections.at(-1).meta,item.meta);
  assert(h.calls.decodes>0,'AVI page frame must be decoded before pixel sampling');
  assert.equal(item.timeOverlay.enabled,true);
  assert.deepEqual(json(item.crop),crop);
  assert.deepEqual(json(item.view),view,'Auto detection must not reset the scientific viewing zoom');
  const attempts=h.calls.detections.length;
  await h.context.detectOriginalTime(item);
  assert.equal(h.calls.detections.length,attempts,'Existing original region is reused without scanning every redraw');
  h.calls.detected=null;
  await h.$('detect-time').onclick();
  assert.deepEqual(json(item.timeRegion),selected,'Failed retry preserves the previously found original strip');
  for(const bad of [{x:100,y:100,w:500,h:350},{x:600,y:8,w:192,h:28}]){
    h.calls.detected=bad;
    await h.$('detect-time').onclick();
    assert.deepEqual(json(item.timeRegion),selected,'Invalid detector result must never replace the time strip');
  }
  h.$('frame').decode=async()=>{throw new Error('Frame not ready');};
  assert.equal(await h.context.detectOriginalTime(item,true),false);
  assert.deepEqual(json(item.timeRegion),selected,'Decode failure preserves the previously found region');
}

// Successful imports automatically locate both AVI and native MP4 labels. The
// preview and export copy source pixels, with no generated clock or text drawing.
for(const ext of ['avi','mp4']){
  const h=harness();h.calls.detected={x:440,y:8,w:192,h:28};
  const item=await h.choose(ext);
  assert.deepEqual(json(item.timeRegion),h.calls.detected);
  const sourceImage=ext==='avi'?h.$('frame'):h.context.video;
  assert(h.drawCalls.some(call=>call[0]==='drawImage'&&call[1]===sourceImage&&call.at(-1)==='scratch'));
  h.drawCalls.length=0;h.context.drawTimePreview();
  const copies=h.drawCalls.filter(call=>call[0]==='drawImage'&&call.at(-1)==='time-preview');
  assert.equal(copies.length,2,'Preview draws the cropped field and one original timestamp strip');
  assert.equal(copies[1].length,7,'Transparent preview overlays a prepared stamp canvas');
  assert(h.drawCalls.some(call=>call[0]==='drawImage'&&call[1]===sourceImage&&call.at(-1)==='scratch'&&json(call.slice(2,6)).join(',')==='440,8,192,28'),'Matte must be derived from original source pixels');
  assert(h.drawCalls.some(call=>call[0]==='putImageData'),'Preview applies the time alpha matte');
  assert(!h.drawCalls.some(call=>call[0]==='fillText'),'Original timestamp must not be regenerated from playback time');
}

// Starting a native seek can immediately lower readyState. Detection must use
// the loaded frame first, and a later return must retain the located source strip.
{
  const h=harness();h.calls.detected={x:440,y:8,w:192,h:28};
  const seekStates=[];
  Object.defineProperty(h.context.video,'currentTime',{set(value){
    seekStates.push({value,region:json(h.context.active.timeRegion),detections:h.calls.detections.length});
    h.context.video.readyState=1;
  }});
  const item=await h.choose('mp4');
  assert.deepEqual(json(item.timeRegion),h.calls.detected,'Detection must complete before a seek makes the frame unavailable');
  assert.deepEqual(seekStates[0].region,h.calls.detected);
  assert.equal(seekStates[0].detections,1);
  item.current=1.25;
  const next=h.makeFile('mp4','next.mp4');await h.context.selectFile(next);
  const attempts=h.calls.detections.length;
  await h.context.selectFile(item);
  assert.equal(h.calls.detections.length,attempts,'Returning to a known native video reuses its region without sampling a seeking frame');
  assert.deepEqual(json(item.timeRegion),h.calls.detected);
  assert.equal(seekStates.at(-1).value,1.25);
  assert.deepEqual(seekStates.at(-1).region,h.calls.detected);
}

// Switching files or changing a source URL while decode is unresolved cannot
// copy an old frame's location onto the newly active video.
{
  const h=harness(),first=await h.choose();let finish;
  h.$('frame').decode=()=>new Promise(resolve=>{finish=resolve;});
  h.calls.detected={x:440,y:8,w:192,h:28};
  const pending=h.context.detectOriginalTime(first);
  const next=h.makeFile('mp4','next.mp4');await h.context.selectFile(next);
  finish();assert.equal(await pending,false);
  assert.equal(first.timeRegion,null);
  assert.deepEqual(json(next.timeRegion),h.calls.detected);
}
{
  const h=harness(),item=await h.choose();let finish;
  h.$('frame').decode=()=>new Promise(resolve=>{finish=resolve;});
  h.calls.detected={x:440,y:8,w:192,h:28};
  const pending=h.context.detectOriginalTime(item);
  h.$('frame').src='blob:stale-source';finish();
  assert.equal(await pending,false);assert.equal(item.timeRegion,null);
}
{
  const h=harness(),item=await h.choose('mp4');h.calls.detected={x:440,y:8,w:192,h:28};
  h.context.video.readyState=1;
  assert.equal(await h.context.detectOriginalTime(item),false);
  assert.equal(item.timeRegion,null,'Unloaded video must not commit a detector result');
}

// A scene rectangle is not a timestamp strip. Reproduce the reported duplicate
// field shape and make sure the real export handler refuses to encode it.
for (const badRegion of [
  {x:100,y:100,w:500,h:350},
  {x:100,y:100,w:180,h:180},
  {x:0,y:0,w:600,h:150},
  {x:600,y:8,w:192,h:28},
  {x:440,y:470,w:192,h:28},
  {x:-2,y:8,w:192,h:28},
  {x:440,y:8,w:192.5,h:28}
]) {
  const h=harness(),item=await h.choose();item.timeRegion=badRegion;
  await h.context.exportVideo();
  assert.equal(h.calls.exports.length,0,`Invalid time patch must not be encoded: ${JSON.stringify(badRegion)}`);
  assert.equal(h.calls.status.at(-1)[1],true,'Invalid time patch must show an actionable error');
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
  const placement=timeOverlayLayout(item.crop,item.timeRegion,item.timeOverlay.position,item.timeOverlay.widthPercent);
  assert.equal(placement.w,128,'Default source strip scales to 40 percent of a 320 pixel crop');
  assert(graph.includes(`scale=${placement.w}:${placement.h}:flags=lanczos`));
  assert(graph.includes(`overlay=${placement.x}:${placement.y}`));
  assert.equal(args[args.indexOf('-map')+1],'[withtime]');
  assert.equal(args[args.indexOf('-c:v')+1],format==='avi'?'ffv1':'libx264');
  assert.match(h.$('download').download,new RegExp(`_time\\.${format}$`));
  assert.match(h.$('result-note').textContent,/原时间：自动保留/);
  assert.equal(h.calls.downloads,1);
}

// Sizing is a per-file presentation setting. It updates the actual preview and
// export together while preserving the scientific crop, source strip and scale.
{
  const h=harness(),item=await h.choose();item.timeRegion={x:440,y:8,w:192,h:28};
  Object.assign(item.scaleBar,{enabled:true,unitsPerPixel:.5,length:50});
  const scientific=json({crop:item.crop,timeRegion:item.timeRegion,scaleBar:item.scaleBar,start:item.start,end:item.end});
  h.$('time-size').value='60';h.$('time-size').oninput();
  assert.equal(item.timeOverlay.widthPercent,60);
  assert.equal(Number(h.$('time-size-value').value),60);
  h.$('time-size-value').value='85';h.$('time-size-value').onchange();
  assert.equal(item.timeOverlay.widthPercent,85);
  assert.equal(Number(h.$('time-size').value),85);
  assert.deepEqual(json({crop:item.crop,timeRegion:item.timeRegion,scaleBar:item.scaleBar,start:item.start,end:item.end}),scientific);
  const p=timeOverlayLayout(item.crop,item.timeRegion,'top-right',85);
  assert.equal(p.w,272);assert.equal(p.h,40);
  h.drawCalls.length=0;h.context.drawTimePreview();
  const previewCopies=h.drawCalls.filter(call=>call[0]==='drawImage'&&call.at(-1)==='time-preview');
  assert.deepEqual(previewCopies[1].slice(2,6),[p.x,p.y,p.w,p.h],'Preview must use the selected time size');
  assert(h.drawCalls.some(call=>call[0]==='drawImage'&&call[1]===h.$('frame')&&call.at(-1)==='scratch'&&json(call.slice(2,6)).join(',')==='440,8,192,28'),'Resizing must matte the original time region');
  await h.context.exportVideo();
  const args=h.calls.exports.at(-1),graph=args[args.indexOf('-filter_complex')+1];
  assert(graph.includes('scale=272:40:flags=lanczos'));
  assert(graph.includes(`overlay=${p.x}:${p.y}`));
  assert.match(graph,/crop=192:28:440:8:exact=1/,'Resize must not change the source time rectangle');
  for(const invalid of ['', 'not-a-number','Infinity','NaN','14','91','-1']){
    h.$('time-size-value').value=invalid;h.$('time-size-value').onchange();
    assert.equal(item.timeOverlay.widthPercent,85,`Invalid size ${invalid} must keep the previous valid preference`);
    assert.equal(Number(h.$('time-size-value').value),85,'Invalid numeric input must recover its displayed value');
    assert.equal(Number(h.$('time-size').value),85);
  }
  const next=h.makeFile('avi','sizing-next.avi');await h.context.selectFile(next);
  assert.equal(next.timeOverlay.widthPercent,40,'Another file starts with the default size');
  await h.context.selectFile(item);
  assert.equal(item.timeOverlay.widthPercent,85,'Returning to a file retains its chosen size');
  h.$('time-size-reset').onclick();
  assert.equal(item.timeOverlay.widthPercent,40);
  assert.equal(Number(h.$('time-size').value),40);
  assert.equal(Number(h.$('time-size-value').value),40);
  assert.deepEqual(json({crop:item.crop,timeRegion:item.timeRegion,scaleBar:item.scaleBar,start:item.start,end:item.end}),scientific);
}

// A label already present in the field must keep its original location and
// native size; changing the requested corner cannot create a duplicate label.
for(const position of ['top-left','top-right']){
  const h=harness(),item=await h.choose();
  item.timeRegion={x:438,y:6,w:192,h:28};item.crop={x:100,y:0,w:540,h:200};
  Object.assign(item.timeOverlay,{position,widthPercent:85});h.context.syncTimeOverlay();
  assert(originalTimeVisible(item.crop,item.timeRegion));
  for(const id of ['time-position','time-size','time-size-value','time-size-reset'])assert.equal(h.$(id).disabled,true,`${id} must be unavailable for an embedded time label`);
  assert.match(h.$('time-size-note').textContent,/原时间已在选区内/);
  h.$('time-size').value='20';h.$('time-size').oninput();h.$('time-size-reset').onclick();
  assert.equal(item.timeOverlay.widthPercent,85,'Disabled controls must not mutate an embedded label');
  h.drawCalls.length=0;h.context.drawTimePreview();
  const copies=h.drawCalls.filter(call=>call[0]==='drawImage'&&call.at(-1)==='time-preview');
  assert.equal(copies.length,1,'Embedded timestamp is already in the source crop; do not draw a duplicate');
  assert.deepEqual(copies[0].slice(2,6),[100,0,540,200]);
  await h.context.exportVideo();
  const args=h.calls.exports[0],graph=args[args.indexOf('-filter_complex')+1];
  assert.doesNotMatch(graph,/,scale=/,'The native label must not be resized');
  assert.doesNotMatch(graph,/geq=/,'An embedded black background must not be removed by inventing hidden scene pixels');
  assert(!h.drawCalls.some(call=>call[0]==='putImageData'),'An embedded label bypasses preview matting too');
  assert.match(graph,/overlay=338:6/,'Original location must be retained instead of moving to the requested corner');
  item.crop={x:100,y:120,w:320,h:240};h.context.syncTimeOverlay();
  for(const id of ['time-position','time-size','time-size-value','time-size-reset'])assert.equal(h.$(id).disabled,false);
  assert.equal(Number(h.$('time-size-value').value),85,'Original size preference returns when the label needs relocation again');
}

// One shared choice controls the source-time matte and scale rectangle in both
// preview and export; it does not change time values, source region or calibration.
{
  const h=harness(),item=await h.choose();item.timeRegion={x:440,y:8,w:192,h:28};
  Object.assign(item.scaleBar,{enabled:true,unitsPerPixel:.5,length:50});
  const scientific=json({crop:item.crop,timeRegion:item.timeRegion,timeOverlay:item.timeOverlay,scaleBar:item.scaleBar});
  const bar=scaleBarLayout(item.crop,item.scaleBar);
  for(const transparent of [true,false]){
    h.drawCalls.length=0;
    h.$('transparent-annotations').checked=transparent;h.$('transparent-annotations').onchange();
    assert.equal(item.transparentAnnotations,transparent);
    assert.equal(h.$('transparent-annotations').checked,transparent);
    assert(h.drawCalls.some(call=>call[0]==='putImageData'),'Red time preview recolors the original glyph pixels in both background modes');
    const matte=h.calls.mattes.at(-1);
    assert.deepEqual(matte.options,{color:'red',transparent},'Preview passes the requested color and shared background choice to the real pixel helper');
    assert.deepEqual(matte.pixels.slice(4,8),[255,0,0,255],'Bright original glyph pixels become red without generating new text');
    assert.deepEqual(matte.pixels.slice(0,4),transparent?[255,0,0,0]:[0,0,0,255],'Black source pixels follow the selected background mode');
    assert.equal(h.drawCalls.some(call=>call[0]==='strokeText'&&call[1]==='50 µm'),transparent,'Transparent scale label keeps a legible text stroke');
    assert(h.calls.fills.some(call=>call.name==='fillText'&&call.args[0]==='50 µm'&&call.style==='#ffffff'),'Scale label remains white when the time glyphs are red');
    const background=h.drawCalls.some(call=>call[0]==='fillRect'&&call.slice(1,5).join(',')===[0,0,bar.width,bar.height].join(','));
    assert.equal(background,!transparent,'Shared choice must remove or retain the scale rectangle');
    assert(h.drawCalls.some(call=>call[0]==='fillRect'&&call.slice(1,5).join(',')===[bar.barX,bar.barY,100,bar.barHeight].join(',')),'The calibrated white line remains exactly 100 pixels');
    assert.deepEqual(json({crop:item.crop,timeRegion:item.timeRegion,timeOverlay:item.timeOverlay,scaleBar:item.scaleBar}),scientific);
    await h.context.exportVideo();
    const args=h.calls.exports.at(-1),graph=args[args.indexOf('-filter_complex')+1];
    assert(graph.includes('geq='),'Export recolors original timestamp pixels red in both background modes');
    assert.match(graph,/g=0:b=0/,'Export time glyphs have red channels only');
    if(transparent)assert.match(graph,/r=255:g=0:b=0:a='floor/);
    else assert.match(graph,/g=0:b=0:a=255/);
    assert.match(graph,/crop=192:28:440:8:exact=1/);
    assert.match(graph,/\[withtime\]\[bar\]overlay=/,'Scale remains a separate calibrated overlay');
  }
  const next=h.makeFile('avi','transparency-next.avi');await h.context.selectFile(next);
  assert.equal(next.transparentAnnotations,true,'Another video gets the transparent default');
  await h.context.selectFile(item);
  assert.equal(item.transparentAnnotations,false,'A video keeps its own background choice');
  assert.equal(h.$('transparent-annotations').checked,false);
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

// Auto scale detection reads the source, calibrates the original pixels, and
// adapts the labelled integer length to the crop without altering the calibration.
for(const ext of ['avi','mp4']){
  const h=harness();h.calls.detected={x:440,y:8,w:192,h:28};
  h.calls.detectedScale={x:16,y:450,w:100,h:4,pixelLength:100};
  const seekStates=[];
  if(ext==='mp4')Object.defineProperty(h.context.video,'currentTime',{set(){
    seekStates.push({calibration:h.context.active.scaleBar.unitsPerPixel,detections:h.calls.scaleDetections.length});
    h.context.video.readyState=1;
  }});
  const item=await h.choose(ext,{autoScale:true});h.context.syncTimeOverlay();
  assert.equal(item.scaleBar.enabled,true,'Scale is enabled on import');
  assert.equal(item.scaleBar.autoLength,true,'Length is automatically matched on import');
  assert.equal(item.scaleBar.referenceLength,50,'The assumed original reference is explicit');
  assert.equal(item.scaleBar.referenceUnit,'µm','The physical reference keeps its own unit across pixel display');
  assert.equal(item.scaleBar.unit,'µm');
  assert.equal(item.scaleBar.position,'bottom-right');
  assert.equal(item.scaleBar.unitsPerPixel,.5);
  assert.equal(item.autoScaleState,'found');
  assert.deepEqual(json(item.scaleReference),h.calls.detectedScale);
  assert.equal(h.calls.scaleDetections.length,1);
  assert.equal(h.calls.scaleDetections[0].meta,item.meta);
  assert.match(h.$('scale-reference-note').textContent,/已按原标尺标定/);
  assert.equal(Number(h.$('scale-reference').value),50);
  assert.equal(h.$('scale-source-preview').hidden,false);
  assert.equal(h.$('scale-auto-length').checked,true);
  if(ext==='mp4')assert.deepEqual(seekStates,[{calibration:.5,detections:1}],'Scale detection must precede native seeking too');
  const crop=json(item.crop),time=json(item.timeRegion),view=json(item.view);
  assert.equal(item.scaleBar.length,50);
  assert.equal(scaleBarLayout(item.crop,item.scaleBar).barWidth,100);
  h.drawCalls.length=0;h.context.drawTimePreview();
  const bar=scaleBarLayout(item.crop,item.scaleBar);
  // A real browser seek temporarily hides the preview; restore only readyState.
  if(ext==='mp4'){h.context.video.readyState=3;h.context.drawTimePreview();}
  assert(h.drawCalls.some(call=>call[0]==='fillText'&&call[1]==='50 µm'));
  assert(h.drawCalls.some(call=>call[0]==='fillRect'&&call.slice(1,5).join(',')===[bar.barX,bar.barY,100,bar.barHeight].join(',')));
  await h.context.exportVideo();
  const args=h.calls.exports.at(-1),graph=args[args.indexOf('-filter_complex')+1];
  assert.equal(h.calls.exports.length,1);
  assert.equal(args[args.indexOf('-ss')+1],'0.750000');
  assert.equal(args[args.indexOf('-t')+1],'1.500000');
  assert.match(graph,/crop=192:28:440:8:exact=1/);
  assert.match(graph,/g=0:b=0/,'Auto scale must retain original red source time');
  assert(graph.includes(`[withtime][bar]overlay=${bar.x}:${bar.y}`));
  assert.deepEqual(json(item.crop),crop);assert.deepEqual(json(item.timeRegion),time);assert.deepEqual(json(item.view),view);
  item.crop={...item.crop,w:160,h:160};h.context.syncTimeOverlay();
  assert.equal(item.scaleBar.length,20,'A smaller crop selects a smaller meaningful integer label');
  assert.equal(scaleBarLayout(item.crop,item.scaleBar).barWidth,40);
  assert.equal(item.scaleBar.unitsPerPixel,.5,'Crop resizing must never recalibrate physical pixels');
  const attempts=h.calls.scaleDetections.length;
  await h.context.detectOriginalScale(item);
  assert.equal(h.calls.scaleDetections.length,attempts,'Known calibration is reused');
}

// A missing or malformed original bar cannot silently become a scientific scale.
{
  const h=harness();h.calls.detected={x:440,y:8,w:192,h:28};
  const item=await h.choose('avi',{autoScale:true});h.context.syncTimeOverlay();
  assert.equal(item.scaleBar.enabled,true);assert.equal(item.scaleBar.autoLength,true);
  assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);
  assert.equal(item.autoScaleState,'missing');
  assert.match(h.$('scale-hint').textContent,/未识别/);
  await h.context.exportVideo();assert.equal(h.calls.exports.length,0);
  assert.match(h.calls.status.at(-1)[0],/每像素/);
  const valid={x:16,y:450,w:100,h:4,pixelLength:100};
  for(const bad of [null,{...valid,pixelLength:NaN},{...valid,pixelLength:1},{...valid,pixelLength:101},{...valid,x:-1},{...valid,y:479},{...valid,w:0}]){
    h.calls.detectedScale=bad;
    assert.equal(await h.context.detectOriginalScale(item,true),false);
    assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);
  }
  h.calls.detectedScale=valid;await h.$('detect-scale').onclick();
  assert.equal(item.scaleBar.unitsPerPixel,.5);assert.deepEqual(json(item.scaleReference),valid);
  h.calls.detectedScale=null;await h.$('detect-scale').onclick();
  assert.equal(item.autoScaleState,'missing');assert.equal(item.scaleBar.unitsPerPixel,.5);
  assert.deepEqual(json(item.scaleReference),valid,'Failed retry retains the last measured reference');
  assert.match(h.$('scale-hint').textContent,/沿用已有标定/);
  h.$('frame').decode=async()=>{throw new Error('Frame unavailable');};
  assert.equal(await h.context.detectOriginalScale(item,true),false);
  assert.equal(item.scaleBar.unitsPerPixel,.5,'Decode failure cannot erase existing calibration');
}

// Automatic defaults still allow precise integer manual length changes. A new
// physical reference uses measured pixels; manual calibration severs that link.
{
  const h=harness();h.calls.detected={x:440,y:8,w:192,h:28};
  h.calls.detectedScale={x:16,y:450,w:100,h:4,pixelLength:100};
  const item=await h.choose('avi',{autoScale:true});h.context.syncTimeOverlay();
  const scientific=json({crop:item.crop,time:item.timeRegion,view:item.view,start:item.start,end:item.end});
  h.$('scale-length').value='7';h.$('scale-length').onchange();
  assert.equal(item.scaleBar.length,7);assert.equal(item.scaleBar.autoLength,false);
  assert.equal(h.$('scale-auto-length').checked,false);
  assert.equal(scaleBarLayout(item.crop,item.scaleBar).barWidth,14);
  for(const invalid of ['', '0','-1','2.5','NaN','Infinity','9007199254740992']){
    h.$('scale-length').value=invalid;h.$('scale-length').onchange();
    assert.equal(item.scaleBar.length,7);assert.equal(Number(h.$('scale-length').value),7);
    assert.equal(item.scaleBar.autoLength,false);
  }
  h.$('scale-auto-length').checked=true;h.$('scale-auto-length').onchange();
  assert.equal(item.scaleBar.autoLength,true);assert.equal(item.scaleBar.length,50);
  h.$('scale-reference').value='20';h.$('scale-reference').onchange();
  assert.equal(item.scaleBar.unitsPerPixel,.2);assert.equal(item.scaleReference.pixelLength,100);
  assert.equal(item.scaleBar.length,20);assert.equal(scaleBarLayout(item.crop,item.scaleBar).barWidth,100);
  h.$('scale-calibration').value='.25';h.$('scale-calibration').onchange();
  assert.equal(item.scaleBar.unitsPerPixel,.25);assert.equal(item.scaleReference,null);
  assert.equal(item.autoScaleState,'manual');assert.equal(item.scaleBar.autoLength,true);
  h.$('scale-reference').value='50';h.$('scale-reference').onchange();
  assert.equal(item.scaleBar.unitsPerPixel,.25,'No measured source pixels means a new reference label cannot overwrite manual calibration');
  const before=json(item.scaleBar);
  h.$('scale-unit').value='nm';h.$('scale-unit').onchange();
  assert.equal(item.scaleBar.unitsPerPixel,250);assert.equal(item.scaleBar.referenceLength,50000);
  assert.equal(item.scaleBar.referenceUnit,'nm','Direct physical-unit conversion updates the stored reference unit');
  assert.equal(item.scaleBar.length,before.length*1000);
  assert.equal(scaleBarLayout(item.crop,item.scaleBar).barWidth,80);
  h.$('scale-unit').value='px';h.$('scale-unit').onchange();
  assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);assert.equal(item.autoScaleState,'idle');
  assert.equal(h.$('detect-scale').hidden,true);
  assert.equal(h.context.annotationError(),'');
  h.$('scale-unit').value='µm';h.$('scale-unit').onchange();
  assert.match(h.context.annotationError(),/每像素/);
  assert.deepEqual(json({crop:item.crop,time:item.timeRegion,view:item.view,start:item.start,end:item.end}),scientific);
}

// Displaying pixels between physical units must preserve the original physical
// reference, while requiring fresh measurement before physical export resumes.
{
  const h=harness();h.calls.detected={x:440,y:8,w:192,h:28};
  h.calls.detectedScale={x:16,y:450,w:100,h:4,pixelLength:100};
  const item=await h.choose('avi',{autoScale:true});h.context.syncTimeOverlay();
  const scientific=json({crop:item.crop,time:item.timeRegion,start:item.start,end:item.end});
  const attempts=h.calls.scaleDetections.length;
  h.$('scale-unit').value='px';h.$('scale-unit').onchange();
  assert.equal(item.scaleBar.referenceLength,50);assert.equal(item.scaleBar.referenceUnit,'µm');
  assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);
  h.$('scale-unit').value='mm';h.$('scale-unit').onchange();
  assert.equal(item.scaleBar.referenceLength,.05,'50 µm remains 0.05 mm after pixel display');
  assert.equal(item.scaleBar.referenceUnit,'mm');
  assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);
  assert.equal(item.autoScaleState,'idle');
  assert.equal(h.calls.scaleDetections.length,attempts,'Unit changes cannot silently reuse an old measurement');
  assert.match(h.context.annotationError(),/每像素/);
  await h.$('detect-scale').onclick();
  assert.equal(item.scaleBar.unitsPerPixel,.0005,'0.05 mm measured across 100 pixels gives 0.0005 mm per pixel');
  assert.equal(item.scaleReference.pixelLength,100);assert.equal(item.autoScaleState,'found');
  h.$('scale-unit').value='px';h.$('scale-unit').onchange();
  assert.equal(item.scaleBar.referenceLength,.05);assert.equal(item.scaleBar.referenceUnit,'mm');
  assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);
  h.$('scale-unit').value='µm';h.$('scale-unit').onchange();
  assert.equal(item.scaleBar.referenceLength,50,'Returning from millimetres through pixels restores 50 µm');
  assert.equal(item.scaleBar.referenceUnit,'µm');
  assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);
  assert.equal(h.calls.scaleDetections.length,attempts+1,'Restoring the unit still awaits explicit redetection');
  await h.$('detect-scale').onclick();
  assert.equal(item.scaleBar.unitsPerPixel,.5);assert.equal(item.scaleReference.pixelLength,100);
  assert.deepEqual(json({crop:item.crop,time:item.timeRegion,start:item.start,end:item.end}),scientific);
}

// An integer scale must really fit: never shrink a line while retaining its label.
{
  const h=harness(),item=await h.choose('avi',{autoScale:true});
  item.timeOverlay.enabled=false;item.scaleBar.unitsPerPixel=.00001;
  h.context.syncTimeOverlay();
  assert.equal(item.scaleBar.length,null);assert.equal(h.$('scale-length').value,'');
  assert.match(h.context.annotationError(),/放不下整数标尺/);
  await h.context.exportVideo();assert.equal(h.calls.exports.length,0);
}

// Source ownership and calibration settings may change during image decoding.
// Neither a stale frame nor a result for an old unit/reference may be committed.
for(const change of ['file','url','unit','reference']){
  const h=harness(),item=await h.choose('avi',{autoScale:true});let finish;
  h.$('frame').decode=()=>new Promise(resolve=>{finish=resolve;});
  h.calls.detectedScale={x:16,y:450,w:100,h:4,pixelLength:100};
  const before=h.calls.scaleDetections.length,pending=h.context.detectOriginalScale(item);
  if(change==='file')h.context.active=h.makeFile('avi','new-active.avi');
  if(change==='url')h.$('frame').src='blob:replaced';
  if(change==='unit')item.scaleBar.unit='nm';
  if(change==='reference')item.scaleBar.referenceLength=20;
  finish();assert.equal(await pending,false);
  assert.equal(h.calls.scaleDetections.length,before);
  assert.equal(item.scaleBar.unitsPerPixel,null);assert.equal(item.scaleReference,null);
}

// Each imported video keeps its own manual/automatic choice and calibration.
{
  const h=harness();h.calls.detected={x:440,y:8,w:192,h:28};
  h.calls.detectedScale={x:16,y:450,w:100,h:4,pixelLength:100};
  const first=await h.choose('avi',{autoScale:true});h.context.syncTimeOverlay();
  h.$('scale-length').value='10';h.$('scale-length').onchange();
  const saved=json({scaleBar:first.scaleBar,scaleReference:first.scaleReference,autoScaleState:first.autoScaleState});
  const next=h.makeFile('avi','auto-scale-next.avi');h.calls.detectedScale={x:16,y:450,w:200,h:4,pixelLength:200};
  await h.context.selectFile(next);
  assert.equal(next.scaleBar.autoLength,true);assert.equal(next.scaleBar.unitsPerPixel,.25);
  assert.equal(next.scaleReference.pixelLength,200);
  const attempts=h.calls.scaleDetections.length;
  await h.context.selectFile(first);
  assert.deepEqual(json({scaleBar:first.scaleBar,scaleReference:first.scaleReference,autoScaleState:first.autoScaleState}),saved);
  assert.equal(h.calls.scaleDetections.length,attempts,'Returning to a calibrated file must not resample another file');
  assert.equal(h.$('scale-auto-length').checked,false);assert.equal(Number(h.$('scale-length').value),10);
}

console.log('Application annotation defaults, automatic scale calibration/length, manual controls, source lifecycle, AVI/MP4 export args, PNG/audio/duration and per-file state checks passed.');

// The large result view works even without annotations and uses the same crop,
// timestamp placement and physical bar as the small preview.
{
  const h=harness(),item=await h.choose();h.context.resultMode=true;
  item.timeOverlay.enabled=false;item.scaleBar.enabled=false;
  h.drawCalls.length=0;h.context.drawTimePreview();
  assert.equal(h.$('result-preview').width,320);assert.equal(h.$('result-preview').height,240);
  const base=h.drawCalls.filter(c=>c[0]==='drawImage'&&c.at(-1)==='result-preview');
  assert.equal(base.length,1);assert.deepEqual(base[0].slice(2,6),[100,120,320,240]);
  item.timeOverlay.enabled=true;item.timeRegion={x:440,y:8,w:192,h:28};Object.assign(item.scaleBar,{enabled:true,unitsPerPixel:.5,length:20});
  h.drawCalls.length=0;h.context.drawTimePreview();
  const main=h.drawCalls.filter(c=>c[0]==='drawImage'&&c.at(-1)==='result-preview'),small=h.drawCalls.filter(c=>c[0]==='drawImage'&&c.at(-1)==='time-preview');
  assert.equal(main.length,3);assert.deepEqual(main.map(c=>c.slice(2,-1)),small.map(c=>c.slice(2,-1)));
  h.$('frame').src='blob:other-source';h.drawCalls.length=0;h.context.drawTimePreview();assert.equal(h.drawCalls.length,0,'Do not composite frames owned by a different file');
}
console.log('Large result preview, annotation-free crops, shared overlay geometry and source ownership passed.');
