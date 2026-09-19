import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function idle(){await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert(!await page.locator('#message').evaluate(e=>e.classList.contains('error')),await page.locator('#message').textContent());}
async function set(id,v){await page.locator('#'+id).fill(String(v));await page.locator('#'+id).press('Tab');}
try{
  await page.goto('http://127.0.0.1:4173');
  const names=await readdir('../avi');await page.locator('#file-input').setInputFiles(path.resolve('../avi',names.find(n=>n.endsWith('.avi'))));await idle();
  const box=await page.locator('#crop-canvas').boundingBox();
  // Resize full frame through its bottom-right corner, then move the selection.
  await page.mouse.move(box.x+box.width-2,box.y+box.height-2);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:10});await page.mouse.up();
  const width=Number(await page.locator('#crop-w').inputValue());assert(width>1100&&width<1300);
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3,{steps:10});await page.mouse.up();
  assert(Number(await page.locator('#crop-x').inputValue())>200);
  await page.locator('#aspect').selectOption('1');assert.equal(await page.locator('#crop-w').inputValue(),await page.locator('#crop-h').inputValue());
  await set('start',1);await set('end',3);await page.locator('#play').click();await idle();
  await page.waitForFunction(()=>document.getElementById('play').textContent==='Ⅱ');assert.equal(await page.locator('#frame').evaluate(v=>v.naturalWidth),2432);await page.locator('#play').click();
  // Export a sizeable region of the real large AVI and cancel, then retry.
  await page.locator('#reset-time').click();await page.locator('#reset-crop').click();await page.locator('#export').click();await page.locator('#cancel').click();
  await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.match(await page.locator('#message').textContent(),/取消/);
  await set('crop-w',800);await set('crop-h',600);await set('crop-x',600);await set('crop-y',600);
  const dlPromise=page.waitForEvent('download');await page.locator('#export').click();const dl=await dlPromise;await dl.saveAs(path.resolve('test-results/AVI-full-duration.mp4'));await idle();
  await page.screenshot({path:'test-results/completed-desktop.png',fullPage:true});
  await page.locator('#file-input').setInputFiles(path.resolve('test-results/audio-source.mp4'));await idle();assert(await page.locator('#audio').isChecked());
  await set('start',1);await set('end',3);
  for(const mute of [false,true]){await page.locator('#audio').setChecked(!mute);const p=page.waitForEvent('download');await page.locator('#export').click();const d=await p;await d.saveAs(path.resolve(`test-results/audio-${mute?'muted':'kept'}.mp4`));await idle();}
  // Invalid input shows an intentional error and a valid file can still be selected.
  await page.locator('#file-input').setInputFiles({name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});
  await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert(await page.locator('#message').evaluate(e=>e.classList.contains('error')));
  await page.locator('.file-item').first().click();await idle();
  await page.setViewportSize({width:800,height:600});await page.evaluate(()=>document.documentElement.style.fontSize='32px');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);await writeFile('test-results/interactions.json',JSON.stringify({passed:true,checks:['pointer resize','pointer move','aspect ratio','AVI playback','cancel and retry','full duration AVI export','audio keep and mute','bad file recovery','200% text zoom'],errors},null,2));
  console.log('INTERACTION TESTS PASSED');
}catch(e){console.error(e);await page.screenshot({path:'test-results/interaction-failure.png',fullPage:true});process.exitCode=1;}finally{await browser.close();}
