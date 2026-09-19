import { chromium } from 'playwright';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const fixtureRoot=process.argv[2]||'..';
const results=path.resolve('test-results');await mkdir(results,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',err=>errors.push(err.message));
page.on('console',msg=>{if(msg.type()==='error')console.log('BROWSER:',msg.text());});
const posts=[];page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});
async function idle(){await page.waitForFunction(()=>!document.body.classList.contains('busy'),{},{timeout:180000});const msg=await page.locator('#message').textContent();console.log(msg);assert(!await page.locator('#message').evaluate(e=>e.classList.contains('error')),msg);}
async function set(id,value){await page.locator('#'+id).fill(String(value));await page.locator('#'+id).press('Tab');}
const report=[];
try{
  await page.goto('http://127.0.0.1:4173');
  await page.screenshot({path:path.join(results,'empty.png'),fullPage:true});
  for(const dir of ['MP4','avi']){
    const names=await readdir(path.resolve(fixtureRoot,dir));const name=names.find(n=>n.toLowerCase().endsWith('.'+dir.toLowerCase()));
    console.log('IMPORT',name);
    await page.locator('#file-input').setInputFiles(path.resolve(fixtureRoot,dir,name));await idle();
    const info=await page.locator('#source-info').textContent();const duration=Number(await page.locator('#end').inputValue());console.log({info,duration});
    assert(duration>0);assert(await page.locator('#media-stage').isVisible());
    await set('crop-w',320);await set('crop-h',240);await set('crop-x',100);await set('crop-y',80);await set('start',1);await set('end',Math.min(duration,3));
    const canvas=page.locator('#crop-canvas');const box=await canvas.boundingBox();
    assert(box.width>0&&box.height>0);
    await page.screenshot({path:path.join(results,`${dir}-edit.png`),fullPage:true});
    const downloadPromise=page.waitForEvent('download',{timeout:180000});await page.locator('#export').click();
    const download=await downloadPromise;const output=path.join(results,`${dir}-crop.mp4`);await download.saveAs(output);await idle();
    report.push({input:dir,name,info,duration,output});console.log('EXPORTED',output);
    if(dir==='avi'){
      // Exercise the alternate output codec and arbitrary-time AVI seeking.
      await page.locator('#seek').fill('2');await page.locator('#seek').dispatchEvent('change');await idle();
      await page.locator('#format').selectOption('avi');
      const dlPromise=page.waitForEvent('download',{timeout:180000});await page.locator('#export').click();const dl=await dlPromise;await dl.saveAs(path.join(results,'AVI-lossless.avi'));await idle();
      await page.locator('#format').selectOption('mp4');
    }
  }
  // Reject an out-of-range time without leaving an empty or reversed interval.
  await set('start',99999);assert(Number(await page.locator('#start').inputValue())<Number(await page.locator('#end').inputValue()));
  await page.locator('#reset-time').click();await page.locator('#reset-crop').click();
  await page.locator('.file-item').first().click();await idle();assert.equal(await page.locator('#crop-w').inputValue(),'320');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(results,'mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile horizontal overflow');
  assert.deepEqual(posts,[],'Video must not be posted over the network');assert.deepEqual(errors,[]);
  await writeFile(path.join(results,'browser-report.json'),JSON.stringify({passed:true,report,errors,posts},null,2));console.log('BROWSER TESTS PASSED');
}catch(err){await page.screenshot({path:path.join(results,'failure.png'),fullPage:true});console.error(err);process.exitCode=1;}
finally{await browser.close();}
