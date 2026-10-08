import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=file=>import(`data:text/javascript;base64,${Buffer.from(readFileSync(new URL(file,import.meta.url),'utf8')).toString('base64')}`);
const p=await load('./src/project.js'),w=await load('./src/workflow.js');
const file=new File([new Uint8Array(200000).fill(37)],'test.avi',{lastModified:100});
const identity=await p.identifyFile(file);
const item={identity,meta:{width:800,height:640,duration:3,fps:4,audio:false},crop:{x:80,y:100,w:480,h:400},start:.5,end:2.5,aspect:'free',
  timeOverlay:{enabled:true,position:'top-right',widthPercent:40,color:'red'},timeRegion:{x:500,y:8,w:292,h:28},transparentAnnotations:true,
  scaleBar:{enabled:true,autoLength:true,length:20,unit:'µm',unitsPerPixel:.5,referenceLength:50,referenceUnit:'µm',position:'bottom-right'},
  scaleReference:{x:16,y:600,w:100,h:4,pixelLength:100},autoTimeState:'found',autoScaleState:'found',exportSettings:{format:'avi',quality:'18',audio:false},workflow:{state:'saved'},current:1,view:{zoom:2},file};
const serialized=p.writeProject([p.projectEntry(item)]),entries=p.readProject(serialized),entry=entries[0];
assert(!serialized.includes('blob:'));assert(!serialized.includes('"file"'));assert(!serialized.includes('"view"'));
const restored={identity:{...identity},meta:{...item.meta}};
assert(p.restoreEntry({identity:{...identity,lastModified:200},meta:{...item.meta}},entry),'A copied source may have a different mtime on another computer');
assert(p.restoreEntry(restored,entry));assert.deepEqual(p.editSettings(restored),p.editSettings(item));
assert.equal(restored.current,.5);assert.equal(w.itemState(restored).label,'上次已保存');
// Same filename and length cannot silently transfer a calibration to different contents.
const different=new File([new Uint8Array(200000).fill(38)],'test.avi',{lastModified:100});
assert.notDeepEqual(await p.identifyFile(different),identity);
assert.equal(p.restoreEntry({identity:await p.identifyFile(different),meta:item.meta},entry),false);
assert.equal(p.restoreEntry({identity,meta:{...item.meta,width:802}},entry),false);
assert.equal(p.restoreEntry({identity,meta:{...item.meta,fps:3}},entry),false);
for(const modify of [e=>e.settings.crop.x=-2,e=>e.settings.crop.w=801,e=>e.settings.end=4,e=>e.settings.start=2.4,e=>e.settings.scaleBar.unitsPerPixel=-1,e=>e.settings.timeRegion.w=30,e=>e.settings.timeOverlay.widthPercent=100,e=>e.settings.exportSettings.format='exe',e=>e.identity.sampleHash='fake',e=>e.meta.duration=Infinity]){
  const bad=structuredClone(entry);modify(bad);assert.throws(()=>p.readProject(JSON.stringify({app:'FrameCut',version:1,entries:[bad]})));
}
assert.throws(()=>p.readProject(p.writeProject([entry,entry])));assert.throws(()=>p.readProject('not json'));
assert.throws(()=>p.readProject(JSON.stringify({app:'FrameCut',version:2,entries:[]})));
const malicious=JSON.parse(JSON.stringify(entry));malicious.settings.__proto__={polluted:true};malicious.settings.secret='ignored';
assert(!('secret' in p.validateEntry(malicious).settings));assert.equal({}.polluted,undefined);
for(const state of ['exporting','failed','unsaved'])assert.equal(p.projectEntry({...item,workflow:{state}}).state,'ready');
const signature=p.editSignature(item);item.current=2;item.view.zoom=4;assert.equal(p.editSignature(item),signature);
item.scaleBar.length=10;assert.notEqual(p.editSignature(item),signature);
assert.equal(w.processingFrame('frame=   127 fps= 3.2 size=1024kB'),127);assert.equal(w.processingFrame('Some filter initialized'),null);
assert.match(w.failureMessage(new Error('RuntimeError: memory access out of bounds'),'encode').message,/内存不足/);
assert.match(w.failureMessage(new Error('Failed to fetch'),'engine').message,/加载失败/);
assert.match(w.failureMessage(new Error('disk full'),'save').message,/无需重新编码/);
assert.equal(w.itemState({workflow:{state:'downloaded'}}).label,'已发起下载');
console.log('Project roundtrip, source fingerprint, calibration validation, incomplete jobs, tampered plans and truthful workflow states passed.');
