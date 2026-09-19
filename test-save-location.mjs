import { chromium } from 'playwright';
import { readdir, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(path.resolve('test-results/save-profile-'));
const options={channel:process.env.BROWSER_CHANNEL||'msedge',headless:true,viewport:{width:1440,height:1200},acceptDownloads:true,downloadsPath:await mkdtemp(path.resolve('test-results/save-downloads-'))};
let context=await chromium.launchPersistentContext(profile,options);
// The native OS picker is replaced, but handles, IndexedDB, streams and file
// contents are real browser APIs in OPFS. Permission loss is injected explicitly.
const harness=()=>{
  window.pickerCalls=0;window.permissionCalls=0;window.encodes=0;
  window.showDirectoryPicker=async()=>{
    window.pickerCalls++;
    if(sessionStorage.cancelPicker)throw new DOMException('Cancelled','AbortError');
    return(await navigator.storage.getDirectory()).getDirectoryHandle(sessionStorage.folderName||'Exports',{create:true});
  };
  const query=FileSystemHandle.prototype.queryPermission;
  FileSystemHandle.prototype.queryPermission=function(opts){return sessionStorage.permission?Promise.resolve(sessionStorage.permission):query.call(this,opts);};
  FileSystemHandle.prototype.requestPermission=async function(){window.permissionCalls++;window.permissionHadActivation=navigator.userActivation.isActive;return sessionStorage.permission=sessionStorage.permissionAnswer||'granted';};
  const create=FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable=async function(...args){
    if(sessionStorage.failWrite==='create')throw new DOMException('Unavailable','NotAllowedError');
    const stream=await create.apply(this,args),write=stream.write.bind(stream),close=stream.close.bind(stream);
    stream.write=(...a)=>sessionStorage.failWrite==='write'?Promise.reject(new DOMException('Disk full','QuotaExceededError')):write(...a);
    stream.close=()=>sessionStorage.failWrite==='close'?Promise.reject(new DOMException('Permission expired','NotAllowedError')):close();
    return stream;
  };
};
await context.addInitScript(harness);
let page=await context.newPage();page.setDefaultTimeout(90000);
const errors=[],downloads=[];page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
const source=path.resolve('../MP4',(await readdir('../MP4')).find(n=>n.endsWith('.mp4')));
async function idle(error=false){await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.equal(await page.locator('#message').evaluate(e=>e.classList.contains('error')),error,await page.locator('#message').textContent());}
async function set(id,v){await page.locator('#'+id).fill(String(v));await page.locator('#'+id).press('Tab');}
async function setup(){await page.locator('#file-input').setInputFiles(source);await idle();await set('crop-w',320);await set('crop-h',240);await set('start',1);await set('end',2);}
async function exportSaved(){await page.locator('#export').click();await idle();assert.equal(await page.locator('#result-title').textContent(),'已保存到文件夹');}
async function compareSaved(){
  return page.evaluate(async()=>{
    const text=document.getElementById('result-info').textContent,name=text.split(' / ')[1].split(' · ')[0];
    const folder=(await navigator.storage.getDirectory()).getDirectoryHandle(text.split(' / ')[0]);
    const file=await(await(await folder).getFileHandle(name)).getFile();
    const blob=await(await fetch(document.getElementById('download').href)).blob();
    const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].join(',');
    return{equal:await hash(file)===await hash(blob),name,size:file.size};
  });
}
try{
  await page.goto('http://127.0.0.1:4173');await setup();await page.locator('#choose-output').click();
  await page.waitForFunction(()=>document.getElementById('output-folder').textContent.includes('已记住：Exports'));
  const base=path.basename(source).replace(/\.[^.]+$/,'')+'_crop_320x240_1.000-2.000.mp4';
  await page.evaluate(async name=>{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('Exports');const w=await(await d.getFileHandle(name,{create:true})).createWritable();await w.write('original sentinel');await w.close();},base);
  await exportSaved();const first=await compareSaved();assert(first.equal&&first.size>0);assert(first.name.endsWith(' (2).mp4'));
  await exportSaved();const second=await compareSaved();assert(second.equal&&second.name.endsWith(' (3).mp4'));assert.equal(await page.evaluate(()=>window.pickerCalls),1);assert.deepEqual(downloads,[]);
  assert.equal(await page.evaluate(async name=>(await(await(await(await navigator.storage.getDirectory()).getDirectoryHandle('Exports')).getFileHandle(name)).getFile()).text(),base),'original sentinel');
  const manual=page.waitForEvent('download');await page.locator('#download').click();await(await manual).saveAs(path.resolve('test-results/saved-folder-crop.mp4'));
  // Refresh restores the actual serialised directory handle without a picker.
  await page.reload();await setup();assert.match(await page.locator('#output-folder').textContent(),/已记住：Exports/);await exportSaved();assert.equal(await page.evaluate(()=>window.pickerCalls),0);assert.equal(downloads.length,1);
  await page.evaluate(()=>{const exec=FFmpegWASM.FFmpeg.prototype.exec;FFmpegWASM.FFmpeg.prototype.exec=function(...a){window.encodes++;return exec.apply(this,a);};sessionStorage.permission='prompt';sessionStorage.permissionAnswer='denied';});
  await page.locator('#export').click();await idle(true);assert.equal(await page.evaluate(()=>window.encodes),0);assert(await page.locator('#grant-output').isVisible());
  await page.evaluate(()=>sessionStorage.permissionAnswer='granted');await page.locator('#grant-output').click();await page.waitForFunction(()=>document.getElementById('grant-output').hidden);assert(await page.evaluate(()=>window.permissionHadActivation));
  await exportSaved();assert.equal(await page.evaluate(()=>window.pickerCalls),0);
  for(const stage of ['create','write','close']){
    await page.evaluate(stage=>sessionStorage.failWrite=stage,stage);await page.locator('#export').click();await idle(true);
    assert.equal(await page.locator('#result-title').textContent(),'已生成，尚未保存');assert(await page.locator('#save-again').isVisible());assert(await page.locator('#download').isVisible());
    const encodes=await page.evaluate(()=>window.encodes);await page.evaluate(()=>sessionStorage.removeItem('failWrite'));
    await page.locator('#save-again').click();await idle();assert.equal(await page.evaluate(()=>window.encodes),encodes);assert((await compareSaved()).equal);
  }
  await page.evaluate(()=>sessionStorage.cancelPicker='yes');await page.locator('#choose-output').click();await page.waitForFunction(()=>!document.getElementById('choose-output').disabled);assert.match(await page.locator('#output-folder').textContent(),/Exports/);
  await page.evaluate(()=>{sessionStorage.removeItem('cancelPicker');sessionStorage.folderName='New location';});await page.locator('#choose-output').click();await page.waitForFunction(()=>document.getElementById('output-folder').textContent.includes('New location'));
  await page.locator('#save-again').click();await idle();assert.match(await page.locator('#result-info').textContent(),/New location/);
  await page.screenshot({path:'test-results/save-location.png',fullPage:true});
  // A restarted browser restores the folder, and one permission confirmation
  // can be performed at the export click, before FFmpeg runs.
  await context.close();context=await chromium.launchPersistentContext(profile,options);await context.addInitScript(harness);page=await context.newPage();page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173');await setup();assert.match(await page.locator('#output-folder').textContent(),/已记住：New location/);
  await page.evaluate(()=>{sessionStorage.permission='prompt';sessionStorage.permissionAnswer='granted';});await exportSaved();assert.equal(await page.evaluate(()=>window.pickerCalls),0);assert.equal(await page.evaluate(()=>window.permissionCalls),1);assert((await compareSaved()).equal);
  // Storage failure must not pretend the newly picked folder was remembered.
  await page.evaluate(()=>{window.originalOpen=indexedDB.open.bind(indexedDB);indexedDB.open=()=>{throw new DOMException('Unavailable','SecurityError');};sessionStorage.folderName='Session only';});
  await page.locator('#choose-output').click();await page.waitForFunction(()=>document.getElementById('output-folder').textContent.includes('本次保存：Session only'));await exportSaved();assert.match(await page.locator('#folder-note').textContent(),/未能记住/);
  await page.evaluate(()=>indexedDB.open=window.originalOpen);
  // Concurrent tabs use the same browser lock and cannot overwrite one another.
  const concurrent=await page.evaluate(async()=>{const {writeToFolder}=await import('./save-location.js');const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('Concurrent',{create:true});const names=await Promise.all([0,1,2].map(i=>writeToFolder(d,'same.mp4',new Blob([String(i)]))));return{names,data:await Promise.all(names.map(async name=>(await(await d.getFileHandle(name)).getFile()).text()))};});
  assert.equal(new Set(concurrent.names).size,3);assert.deepEqual(concurrent.data,['0','1','2']);
  await page.locator('#clear-output').click();await page.waitForFunction(()=>document.getElementById('output-folder').textContent.includes('普通下载'));await page.reload();await setup();assert.match(await page.locator('#output-folder').textContent(),/普通下载/);
  // Installed headless Edge crashes on any download after relaunching a profile;
  // reproduced separately with about:blank + a text Blob (no app/FFmpeg/IDB).
  // Keep the restart/persistence checks above; use a fresh profile for downloads.
  await context.close();context=await chromium.launchPersistentContext(await mkdtemp(path.resolve('test-results/save-fallback-profile-')),options);await context.addInitScript(harness);page=await context.newPage();page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173');await setup();
  const fallback=page.waitForEvent('download');await page.locator('#export').click();await(await fallback).saveAs(path.resolve('test-results/save-cleared.mp4'));await idle();
  // Missing support still offers an ordinary download, with no fake path promise.
  await page.addInitScript(()=>window.showDirectoryPicker=undefined);await page.reload();await setup();assert(await page.locator('#choose-output').isDisabled());
  const unsupported=page.waitForEvent('download');await page.locator('#export').click();await(await unsupported).saveAs(path.resolve('test-results/save-unsupported.mp4'));await idle();
  assert.deepEqual(errors,[]);await writeFile('test-results/save-location-report.json',JSON.stringify({passed:true,first,second,checks:['real directory handle persistence after reload and browser restart','no repeated picker','collision keeps originals','permission denial before encode','re-grant without picking','create/write/close recovery without re-encoding','change folder','clear folder','storage unavailable','concurrent writes','ordinary download fallback'],nativePickerAutomated:false},null,2));
  console.log('SAVE LOCATION TEST PASSED');
}catch(error){console.error(error);try{await page.screenshot({path:'test-results/save-location-failure.png',fullPage:true});}catch{}process.exitCode=1;}finally{await context.close();}
