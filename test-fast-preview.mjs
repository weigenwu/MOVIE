import { chromium } from 'playwright';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(90000);
const errors = [], posts = [], frames = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if(r.method() !== 'GET') posts.push(r.url()); });
const names = (await readdir('../avi')).filter(n => n.endsWith('.avi'));
const overlay = names.find(n => n.endsWith('_overlay.avi'));
async function idle(){await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert(!await page.locator('#message').evaluate(e=>e.classList.contains('error')),await page.locator('#message').textContent());}
async function seek(t){await page.locator('#seek').fill(String(t));await page.locator('#seek').dispatchEvent('change');await idle();}
async function set(id,v){await page.locator('#'+id).fill(String(v));await page.locator('#'+id).press('Tab');}
async function digest(name,t){
  const hash = await page.locator('#frame').evaluate(async image => {
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,canvas.width,canvas.height).data))].map(n=>n.toString(16).padStart(2,'0')).join('');
  }); frames.push({name,t,hash});
}
try {
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#file-input').setInputFiles(path.resolve('../avi',overlay)); await idle();
  assert.match(await page.locator('#preview-label').textContent(),/无需生成/);
  assert.equal(await page.locator('#frame').evaluate(e=>e.naturalWidth),2432);
  await digest(overlay,0);
  // No preview encoding command may run when playing or seeking raw AVI.
  await page.evaluate(()=>{window.previewEncodes=0;const original=FFmpegWASM.FFmpeg.prototype.exec;FFmpegWASM.FFmpeg.prototype.exec=function(args,...rest){window.previewEncodes++;return original.call(this,args,...rest);};});
  const begin = Date.now();
  await page.locator('#play').click();
  await page.waitForFunction(()=>document.getElementById('frame').dataset.index==='1');
  const firstAdvanceMs = Date.now()-begin;
  assert(firstAdvanceMs < 2000,`first advance took ${firstAdvanceMs} ms`);
  assert(await page.locator('#export').isEnabled());
  assert(await page.locator('#progress-area').isHidden());
  await page.locator('#play').click();const paused=await page.locator('#seek').inputValue();
  await page.waitForTimeout(500);assert.equal(await page.locator('#seek').inputValue(),paused);
  for(const t of [20,41]){await seek(t);assert.equal(await page.locator('#frame').getAttribute('data-index'),String(t*3));await digest(overlay,t);}
  await set('start',1);await set('end',2.1);await seek(1);
  await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('play').textContent==='▶');
  assert.equal(await page.locator('#seek').inputValue(),'2.1');assert.equal(await page.locator('#frame').getAttribute('data-index'),'6');
  await page.locator('#play').click();await page.locator('#end').fill('2');await page.locator('#end').press('Tab');
  assert.equal(await page.locator('#play').textContent(),'▶');
  await seek(1);await page.locator('#play').click();await seek(20);await page.waitForTimeout(500);
  assert.equal(await page.locator('#frame').getAttribute('data-index'),'60');assert.equal(await page.locator('#play').textContent(),'▶');
  await page.locator('#reset-time').click();
  for(const name of names.filter(n=>n!==overlay)){
    await page.locator('#play').click();await page.locator('#file-input').setInputFiles(path.resolve('../avi',name));await idle();
    assert.match(await page.locator('#preview-label').textContent(),/无需生成/);await digest(name,0);
  }
  assert.equal(await page.evaluate(()=>window.previewEncodes),0);
  // MP4 still uses native video playback, including after leaving AVI mid-play.
  await page.locator('#play').click();
  const mp4=(await readdir('../MP4')).find(n=>n.endsWith('.mp4'));
  await page.locator('#file-input').setInputFiles(path.resolve('../MP4',mp4));await idle();
  await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('video').currentTime>0.2);await page.locator('#play').click();
  // Return during playback and export from the original source.
  await page.locator('.file-item').first().click();await idle();await seek(1);
  await set('crop-w',320);await set('crop-h',240);await set('start',1);await set('end',3);
  await page.locator('#play').click();const download=page.waitForEvent('download');await page.locator('#export').click();
  await(await download).saveAs(path.resolve('test-results/fast-preview-crop.mp4'));await idle();
  assert.equal(await page.locator('#play').textContent(),'▶');
  // Compressed AVI must still use the compatible preview, with audio behavior unchanged.
  await page.locator('#format').selectOption('avi');const compressedDownload=page.waitForEvent('download');await page.locator('#export').click();
  const compressed=path.resolve('test-results/fast-preview-compressed.avi');await(await compressedDownload).saveAs(compressed);await idle();
  await page.locator('#file-input').setInputFiles(compressed);await idle();assert.match(await page.locator('#preview-label').textContent(),/按帧预览/);
  await page.locator('#play').click();await idle();await page.waitForFunction(()=>!document.getElementById('video').paused);
  await page.locator('#crop-w').focus();assert(await page.locator('#video').evaluate(v=>v.paused));
  await set('crop-w',160);await page.locator('#video').dispatchEvent('timeupdate');assert.equal(await page.locator('#crop-w').inputValue(),'160');
  assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);
  await page.screenshot({path:'test-results/fast-preview.png',fullPage:true});
  await writeFile('test-results/fast-preview-report.json',JSON.stringify({passed:true,firstAdvanceMs,frames,errors,posts},null,2));
  console.log(JSON.stringify({passed:true,firstAdvanceMs,pixelChecks:frames.length}));
} catch(error){console.error(error);await page.screenshot({path:'test-results/fast-preview-failure.png',fullPage:true});process.exitCode=1;}
finally{await browser.close();}
