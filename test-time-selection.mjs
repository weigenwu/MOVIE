import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
const scaleSource = readFileSync(new URL('./src/scale-bar.js', import.meta.url), 'utf8');
const { calibrationFromReference } = await import(`data:text/javascript;base64,${Buffer.from(scaleSource).toString('base64')}`);
const canvas = { style:{},setPointerCapture(){} };
const rect = {left:20,top:30,width:640,height:480,right:660,bottom:510};
const keyHandlers=[],statuses=[];
const ctx = { canvas, active:{meta:{width:640,height:480},crop:{x:100,y:120,w:320,h:240},timeRegion:null,scaleBar:{unitsPerPixel:null,referenceLength:50},aspect:'1',view:{x:0,y:0}},timestampMode:true,calibrationMode:false,busy:false,panMode:false,spacePan:false,moveMode:false,dragging:null,
  $:()=>({getBoundingClientRect:()=>rect}),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),even:v=>Math.floor(v/2)*2,calibrationFromReference,stopPlayback(){},sync(){},updatePanMode(){},resize(){},drawCrop(){},status(...args){statuses.push(args)},
  document:{addEventListener(_type,handler){keyHandlers.push(handler)},querySelector:()=>null} };
const geometry = source.slice(source.indexOf('function handles('), source.indexOf('for(const key of',source.indexOf('canvas.onpointerdown')));
const cancel = source.slice(source.indexOf('function cancelSelection('),source.indexOf('function expandWorkspace('));
runInNewContext(cancel+geometry,ctx);
const escapeStart=source.indexOf("document.addEventListener('keydown', e => {",source.indexOf('function expandWorkspace('));
runInNewContext(source.slice(escapeStart,source.indexOf('function resize()',escapeStart)),ctx);
const event=(x,y)=>({clientX:x+20,clientY:y+30,isPrimary:true,button:0,pointerId:1,preventDefault(){}});
const plain=value=>JSON.parse(JSON.stringify(value));
const crop=plain(ctx.active.crop);
canvas.onpointerdown(event(440,8));canvas.onpointermove(event(632,36));canvas.onpointerup();
assert.deepEqual(plain(ctx.active.timeRegion),{x:440,y:8,w:192,h:28});
assert.deepEqual(plain(ctx.active.crop),crop,'Time region must not replace scientific field of view');
assert.equal(ctx.timestampMode,false,'Return to ordinary crop after selecting the label');
const stamp=plain(ctx.active.timeRegion);
canvas.onpointerdown(event(160,180));canvas.onpointermove(event(260,280));canvas.onpointerup();
assert.deepEqual(plain(ctx.active.crop),{x:160,y:180,w:100,h:100});
assert.deepEqual(plain(ctx.active.timeRegion),stamp,'Normal cropping must not move timestamp source');
ctx.timestampMode=true;
canvas.onpointerdown(event(460,20));canvas.onpointermove(event(500,28));canvas.onpointercancel();
assert.deepEqual(plain(ctx.active.timeRegion),stamp,'Cancelled selection must restore original label');
ctx.active.timeRegion=null;
canvas.onpointerdown(event(100,100));canvas.onpointerup();
assert.equal(ctx.active.timeRegion,null,'A click must not create a fake time region');
assert.equal(ctx.timestampMode,true);
canvas.onpointerdown(event(638,44));canvas.onpointermove(event(434,6));canvas.onpointerup();
assert.deepEqual(plain(ctx.active.timeRegion),{x:434,y:6,w:204,h:38},'Reverse drag remains free aspect despite square crop setting');
const beforeCalibration=plain({crop:ctx.active.crop,timeRegion:ctx.active.timeRegion});
ctx.calibrationMode=true;ctx.timestampMode=false;
canvas.onpointerdown(event(20,450));canvas.onpointermove(event(120,450));
assert.equal(ctx.active.scaleBar.unitsPerPixel,null,'Measurement is not committed before release');
canvas.onpointerup();
assert.equal(ctx.active.scaleBar.unitsPerPixel,.5,'50 µm / 100 source pixels');
assert.equal(ctx.calibrationMode,false);
assert.deepEqual(plain({crop:ctx.active.crop,timeRegion:ctx.active.timeRegion}),beforeCalibration,'Calibration must not edit crop or timestamp source');
for(const cancelEvent of ['cancel','escape']){
  ctx.calibrationMode=true;
  canvas.onpointerdown(event(20,450));canvas.onpointermove(event(220,450));
  if(cancelEvent==='cancel')canvas.onpointercancel();else keyHandlers[0]({key:'Escape'});
  assert.equal(ctx.active.scaleBar.unitsPerPixel,.5,`${cancelEvent} must preserve prior calibration`);
  assert.equal(ctx.dragging,null);
  assert.deepEqual(plain({crop:ctx.active.crop,timeRegion:ctx.active.timeRegion}),beforeCalibration);
}
// The reference can be cleared or edited after measurement mode is entered.
// Release must report the invalid number without losing the prior calibration.
for(const invalidReference of [0,NaN,null,-1,Infinity]){
  ctx.calibrationMode=true;
  ctx.active.scaleBar.referenceLength=invalidReference;
  canvas.onpointerdown(event(20,450));canvas.onpointermove(event(220,450));
  const messagesBefore=statuses.length;
  assert.doesNotThrow(()=>canvas.onpointerup(),`Invalid reference ${invalidReference} must not escape the pointer handler`);
  assert.equal(ctx.active.scaleBar.unitsPerPixel,.5,'Invalid reference must preserve previously calibrated value');
  assert.equal(ctx.dragging,null,'Failed measurement must still release the drag');
  assert.deepEqual(plain({crop:ctx.active.crop,timeRegion:ctx.active.timeRegion}),beforeCalibration);
  assert(statuses.length>messagesBefore,'Invalid measurement must show an error');
  assert.equal(statuses.at(-1)[1],true);
}
console.log('Independent time selection, crop, cancellation, reverse drag and scientific scale measurement checks passed.');
