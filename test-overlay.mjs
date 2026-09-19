import { chromium } from 'playwright';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(120000);
const consoleErrors=[];page.on('console',m=>{if(m.type()==='error'){consoleErrors.push(m.text());console.log(m.text());}});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
async function idle(){await page.waitForFunction(()=>!document.body.classList.contains('busy'));const s=await page.locator('#message').textContent();console.log(s);assert(!await page.locator('#message').evaluate(e=>e.classList.contains('error')),s);}
async function set(id,v){await page.locator('#'+id).fill(String(v));await page.locator('#'+id).press('Tab');}
try {
  await page.goto('http://127.0.0.1:4173');
  const name=(await readdir('../avi')).find(n=>n.endsWith('_overlay.avi'));
  await page.locator('#file-input').setInputFiles(path.resolve('../avi',name));await idle();
  assert(await page.locator('#frame').evaluate(e=>e.naturalWidth>0));
  await page.screenshot({path:'test-results/overlay-preview.png',fullPage:true});
  for(const t of [1,20,41]){await page.locator('#seek').fill(String(t));await page.locator('#seek').dispatchEvent('change');await idle();}
  await set('crop-w',800);await set('crop-h',600);await set('crop-x',600);await set('crop-y',600);await set('start',1);await set('end',3);
  for(const format of ['mp4','avi']){
    await page.locator('#format').selectOption(format);
    const p=page.waitForEvent('download');await page.locator('#export').click();const d=await p;await d.saveAs(path.resolve(`test-results/overlay-crop.${format}`));await idle();
  }
  await page.locator('#play').click();await idle();await page.waitForFunction(()=>document.getElementById('play').textContent==='Ⅱ');await page.locator('#play').click();
  // The same preview path must remain healthy after repeated channel switches.
  for(const channel of (await readdir('../avi')).filter(n=>n.endsWith('.avi')&&!n.endsWith('_overlay.avi'))){
    await page.locator('#file-input').setInputFiles(path.resolve('../avi',channel));await idle();
    assert(await page.locator('#frame').evaluate(e=>e.naturalWidth===2432));
  }
  await page.locator('.file-item').first().click();await idle();
  assert.deepEqual(consoleErrors,[]);
  await writeFile('test-results/overlay-report.json',JSON.stringify({passed:true,input:name,checks:['initial preview','seek at 1/20/41 sec','MP4 crop export','FFV1 AVI crop export','playback','all five real AVI previews','switch back to overlay']},null,2));
  console.log('OVERLAY TEST PASSED');
} catch(e) {console.error(e);await page.screenshot({path:'test-results/overlay-failure.png',fullPage:true});process.exitCode=1;} finally {await browser.close();}
