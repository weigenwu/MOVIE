// Plans contain edit settings and a small source fingerprint, never video bytes
// or directory handles. Probe the reselected source before applying its settings.
export const PROJECT_KEY = 'framecut:weigenwu-MOVIE:plan-v1';
const units = ['µm','nm','mm','px'];
const corners = ['top-left','top-right','bottom-left','bottom-right'];
const fail = () => { throw new Error('剪辑方案格式或参数无效'); };
const number = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const positive = n => number(n, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER);
const nullablePositive = n => n === null || positive(n);
const bool = n => typeof n === 'boolean';
const copy = value => JSON.parse(JSON.stringify(value));
export async function identifyFile(file, cryptoAPI = globalThis.crypto) {
  const size = 65536;
  const bytes = new Uint8Array(await new Blob([file.slice(0,size),file.slice(Math.max(size,file.size-size))]).arrayBuffer());
  const digest = await cryptoAPI.subtle.digest('SHA-256',bytes);
  return { name:file.name, size:file.size, lastModified:file.lastModified, sampleHash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('') };
}
export const identityKey = id => JSON.stringify([id.name,id.size,id.sampleHash]);
export function editSettings(item) {
  return copy({crop:item.crop,start:item.start,end:item.end,aspect:item.aspect,
    timeOverlay:item.timeOverlay,timeRegion:item.timeRegion,transparentAnnotations:item.transparentAnnotations,
    scaleBar:item.scaleBar,scaleReference:item.scaleReference,autoTimeState:item.autoTimeState,autoScaleState:item.autoScaleState,
    exportSettings:item.exportSettings});
}
export const editSignature = item => JSON.stringify(editSettings(item));
export function projectEntry(item) {
  if (!item.identity || !item.meta || !item.exportSettings) return null;
  const {width,height,duration,fps} = item.meta;
  return {identity:copy(item.identity),meta:{width,height,duration,fps},settings:editSettings(item),
    state:['saved','downloaded'].includes(item.workflow?.state)?item.workflow.state:'ready'};
}
function rect(r, meta, even = false) {
  return r && ['x','y','w','h'].every(k=>number(r[k],0,Math.max(meta.width,meta.height))) &&
    (!even || ['x','y','w','h'].every(k=>Number.isInteger(r[k]) && r[k]%2===0)) &&
    r.w>=2 && r.h>=2 && r.x+r.w<=meta.width && r.y+r.h<=meta.height;
}
export function validateEntry(entry) {
  const id=entry?.identity,m=entry?.meta,s=entry?.settings,t=s?.timeOverlay,b=s?.scaleBar,e=s?.exportSettings;
  if (!id || typeof id.name!=='string' || !id.name || id.name.length>1024 || !Number.isSafeInteger(id.size) || id.size<=0 ||
    !number(id.lastModified,0,Number.MAX_SAFE_INTEGER) || !/^[a-f0-9]{64}$/.test(id.sampleHash)) fail();
  if (!m || ![m.width,m.height].every(n=>Number.isInteger(n)&&n>=2&&n<=65536) || !positive(m.duration) || !number(m.fps,.001,100000)) fail();
  if (!s || !rect(s.crop,m,true) || !number(s.start,0,m.duration) || !number(s.end,s.start+Math.min(1/m.fps,m.duration)-1e-8,m.duration) ||
    !['free','original','1','1.7777777778','0.5625','1.3333333333'].includes(s.aspect) || !bool(s.transparentAnnotations)) fail();
  if (!t || !bool(t.enabled) || !['top-left','top-right'].includes(t.position) || !number(t.widthPercent,15,90) || !['red','white'].includes(t.color)) fail();
  if (s.timeRegion!==null && (!rect(s.timeRegion,m,true) || s.timeRegion.w<s.timeRegion.h*3 || s.timeRegion.h>m.height/4)) fail();
  if (!b || !bool(b.enabled) || !bool(b.autoLength) || !nullablePositive(b.length) || !units.includes(b.unit) ||
    !nullablePositive(b.unitsPerPixel) || !positive(b.referenceLength) || !units.slice(0,3).includes(b.referenceUnit) || !corners.includes(b.position)) fail();
  if (s.scaleReference!==null && (!positive(s.scaleReference?.pixelLength) || s.scaleReference.pixelLength>Math.hypot(m.width,m.height) ||
    (s.scaleReference.w!==undefined && (!rect(s.scaleReference,m) || s.scaleReference.pixelLength>s.scaleReference.w)))) fail();
  if (!['idle','found','missing'].includes(s.autoTimeState) || !['idle','found','missing','manual'].includes(s.autoScaleState) ||
    !e || !['mp4','avi'].includes(e.format) || !['15','18','23'].includes(e.quality) || !bool(e.audio) || !['ready','saved','downloaded'].includes(entry.state)) fail();
  // Whitelist every restored field instead of assigning untrusted objects.
  return {identity:{name:id.name,size:id.size,lastModified:id.lastModified,sampleHash:id.sampleHash},meta:{width:m.width,height:m.height,duration:m.duration,fps:m.fps},
    state:entry.state,settings:{crop:{x:s.crop.x,y:s.crop.y,w:s.crop.w,h:s.crop.h},start:s.start,end:s.end,aspect:s.aspect,
      timeOverlay:{enabled:t.enabled,position:t.position,widthPercent:t.widthPercent,color:t.color},
      timeRegion:s.timeRegion?{x:s.timeRegion.x,y:s.timeRegion.y,w:s.timeRegion.w,h:s.timeRegion.h}:null,
      transparentAnnotations:s.transparentAnnotations,
      scaleBar:{enabled:b.enabled,autoLength:b.autoLength,length:b.length,unit:b.unit,unitsPerPixel:b.unitsPerPixel,referenceLength:b.referenceLength,referenceUnit:b.referenceUnit,position:b.position},
      scaleReference:s.scaleReference?(s.scaleReference.w!==undefined?{x:s.scaleReference.x,y:s.scaleReference.y,w:s.scaleReference.w,h:s.scaleReference.h,pixelLength:s.scaleReference.pixelLength}:{pixelLength:s.scaleReference.pixelLength}):null,
      autoTimeState:s.autoTimeState,autoScaleState:s.autoScaleState,exportSettings:{format:e.format,quality:e.quality,audio:e.audio}}};
}
export function readProject(text) {
  if (typeof text!=='string' || text.length>5*1024*1024) fail();
  let doc; try {doc=JSON.parse(text);} catch {fail();}
  if (doc?.app!=='FrameCut' || doc.version!==1 || !Array.isArray(doc.entries) || doc.entries.length>1000) fail();
  const entries=doc.entries.map(validateEntry),seen=new Set();
  for(const entry of entries){const key=identityKey(entry.identity);if(seen.has(key))fail();seen.add(key);}
  return entries;
}
export function writeProject(entries) {
  if(!Array.isArray(entries) || entries.length>1000) fail();
  return JSON.stringify({app:'FrameCut',version:1,entries:entries.map(validateEntry)},null,2);
}
export function restoreEntry(item, entry) {
  const clean=validateEntry(entry),m=item.meta;
  if (!item.identity || identityKey(item.identity)!==identityKey(clean.identity) || !m ||
    m.width!==clean.meta.width || m.height!==clean.meta.height || Math.abs(m.duration-clean.meta.duration)>1e-4 || Math.abs(m.fps-clean.meta.fps)>1e-5) return false;
  Object.assign(item,clean.settings);
  item.current=item.start;
  item.workflow={state:clean.state,restored:true,completedSignature:['saved','downloaded'].includes(clean.state)?editSignature(item):null};
  return true;
}
