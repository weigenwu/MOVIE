import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const load=file=>import(`data:text/javascript;base64,${Buffer.from(readFileSync(new URL(file,import.meta.url),'utf8')).toString('base64')}`);
const modules=Object.assign({},...await Promise.all(['project','workflow','time-overlay','scale-bar'].map(n=>load(`./src/${n}.js`))));
const app=readFileSync(new URL('./src/app.js',import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'').replaceAll('import.meta.url',"'http://localhost/app.js'");
function harness(){
  const elements=new Map(),storage=new Map(),events={exports:0,writes:0,next:[],errors:[],downloads:0},paint={clearRect(){},drawImage(){}};
  const make=()=>({value:'',checked:false,disabled:false,hidden:false,dataset:{},style:{setProperty(){}},classList:{toggle(){},add(){},remove(){}},
    textContent:'',setAttribute(){},getAttribute(){return 'false';},removeAttribute(){},append(){},replaceChildren(){},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},scrollIntoView(){},
    click(){this.onclick?.();},pause(){},getContext(){return paint;},parentElement:{},getBoundingClientRect(){return {width:800,height:640,left:0,top:0};}});
  const $=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
  $('format').value='mp4';$('quality').value='18';$('video').hidden=true;
  const context={...modules,Blob,File,URL,crypto,performance,Uint8Array,Uint8ClampedArray,AbortController,console:{warn(){},error(e){events.errors.push(String(e));}},
    document:{getElementById:$,createElement:make,querySelectorAll:()=>[],querySelector:make,body:make(),addEventListener(){}},window:{isSecureContext:true,addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>{if(events.storageFailure)throw Error('quota');storage.set(k,v);}},
    ResizeObserver:class{observe(){}},devicePixelRatio:1,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame:f=>f(),
    folderSetting:async()=>null,writeToFolder:async()=>{events.writes++;if(events.writeFailure)throw Error('disk full');return 'saved.mp4';},openRawAVI:async()=>null,
  };
  const exportsCode=`
    mount=async()=>{if(testEvents.mountFailure)throw Error('Failed to fetch');return '/input/source.avi';};
    exec=async()=>{testEvents.exports++;if(testEvents.cancel){cancelled=true;throw Error('cancel');}if(testEvents.encodeFailure)throw Error('bad codec');operation.frames=8;};
    const fakeEngine=()=>({loaded:true,readFile:async()=>new Uint8Array([1,2,3]),deleteFile:async()=>{},terminate(){}});
    engine=fakeEngine();
    selectFile=async item=>{if(busy)throw Error('Advanced while busy');testEvents.next.push(item.id);active=item;};
    globalThis.api={task,exportVideo,rememberEdits,flushPlan,restorePlanFor,showTaskError,controls,setWorkflow,markExport,
      choose(item){active=item;files.push(item);item.exportSettings={format:'mp4',quality:'18',audio:false};$('format').value='mp4';$('quality').value='18';$('audio').checked=false;rememberEdits();locationReady=true;},
      add(item){files.push(item);},folder(){outputFolder={name:'test',queryPermission:async()=> 'granted'};},resetEngine(){engine=fakeEngine();},
      get active(){return active;},get lastExport(){return lastExport;},get busy(){return busy;},get planCount(){return plans.size;}};
  `;
  context.testEvents=events;runInNewContext(app+exportsCode,context);
  const makeItem=id=>({id,file:new File([new Uint8Array([1,2,3])],`${id}.avi`,{lastModified:1}),ext:'avi',path:`${id}.avi`,identity:{name:`${id}.avi`,size:3,lastModified:1,sampleHash:'a'.repeat(64)},meta:{width:800,height:640,duration:3,fps:4,audio:false},crop:{x:80,y:100,w:480,h:400},start:.5,end:2.5,current:.5,aspect:'free',timeOverlay:{enabled:false,position:'top-right',widthPercent:40,color:'red'},timeRegion:null,autoTimeState:'idle',transparentAnnotations:true,scaleBar:{enabled:false,autoLength:true,length:50,unit:'µm',unitsPerPixel:null,referenceLength:50,referenceUnit:'µm',position:'bottom-right'},scaleReference:null,autoScaleState:'idle',workflow:{state:'ready'},view:{zoom:1,x:0,y:0}});
  return {api:context.api,$,events,storage,makeItem};
}
// Successful download advances after unlocking; playback/view changes aren't edits.
{
  const h=harness(),a=h.makeItem('a'),b=h.makeItem('b');h.api.choose(a);h.api.add(b);
  await h.api.exportVideo(true);assert.equal(a.workflow.state,'downloaded');assert.deepEqual(h.events.next,['b']);assert.equal(h.api.busy,false);
  a.current=2;a.view.zoom=4;h.api.rememberEdits(a);assert.equal(a.workflow.state,'downloaded');
  a.crop.w=460;h.api.rememberEdits(a);assert.equal(a.workflow.state,'ready');
  h.api.flushPlan();const entries=modules.readProject(h.storage.get(modules.PROJECT_KEY));assert.equal(entries[0].settings.crop.w,460);
}
// A failed write preserves the encoded blob and current video. Retry saves it without re-encoding.
{
  const h=harness(),a=h.makeItem('a'),b=h.makeItem('b');h.api.choose(a);h.api.add(b);h.api.folder();h.events.writeFailure=true;
  await h.api.exportVideo(true);assert.equal(a.workflow.state,'unsaved');assert.equal(h.api.active,a);assert.equal(h.events.exports,1);assert.equal(h.api.lastExport.saved,false);
  assert.match(h.$('message').textContent,/无需重新编码/);assert.equal(h.$('error-actions').hidden,false);
  h.events.writeFailure=false;await h.$('save-again').onclick();assert.equal(h.events.exports,1);assert.equal(a.workflow.state,'saved');assert.deepEqual(h.events.next,['b']);
}
// Encoder errors and cancel do not advance or discard the crop/calibration.
for(const failure of ['encodeFailure','cancel','mountFailure']){
  const h=harness(),a=h.makeItem('a');h.api.choose(a);h.api.add(h.makeItem('b'));h.events[failure]=true;
  const before=JSON.stringify(a.crop);await h.api.exportVideo(true);assert.deepEqual(h.events.next,[]);assert.equal(JSON.stringify(a.crop),before);
  assert.equal(a.workflow.state,failure==='cancel'?'ready':'failed');
  if(failure!=='cancel')assert.equal(h.$('error-actions').hidden,false);
}
// Old result saved after switching/editing must never mark the wrong video complete.
{
  const h=harness(),a=h.makeItem('a'),b=h.makeItem('b');h.api.choose(a);await h.api.exportVideo();h.api.choose(b);
  a.crop.w=460;h.api.rememberEdits(a);h.api.markExport('saved');assert.equal(a.workflow.state,'ready');assert.equal(b.workflow.state,'ready');
}
// Storage failure is isolated from normal exports; snapshots keep the last valid edit.
{
  const h=harness(),a=h.makeItem('a');h.api.choose(a);h.api.flushPlan();const prior=h.storage.get(modules.PROJECT_KEY);
  a.scaleBar.unitsPerPixel=-1;h.api.rememberEdits(a);h.api.flushPlan();assert.equal(h.storage.get(modules.PROJECT_KEY),prior);
  a.scaleBar.unitsPerPixel=null;h.events.storageFailure=true;h.api.flushPlan();assert.match(h.$('plan-status').textContent,/保存方案/);
  await h.api.exportVideo();assert.equal(h.events.exports,1);assert.equal(a.workflow.state,'downloaded');
}
console.log('Real application export-next, save/retry without encoding, failure/cancel, ownership, dirty state and storage fallback checks passed.');
