import { chromium } from 'playwright';
import { mkdir, readdir, link, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const fixture=path.resolve('test-results/folder-fixture');
await mkdir(path.join(fixture,'groupA'),{recursive:true});await mkdir(path.join(fixture,'groupB'),{recursive:true});
const mp4=path.resolve('../MP4',(await readdir('../MP4')).find(n=>n.endsWith('.mp4')));
const avi=path.resolve('../avi',(await readdir('../avi')).find(n=>n.endsWith('_overlay.avi')));
for(const [source,target] of [[mp4,'clip2.mp4'],[mp4,'clip10.MP4'],[mp4,'groupA/same.mp4'],[mp4,'groupB/same.mp4'],[avi,'overlay.AVI']]){
  try{await link(source,path.join(fixture,target));}catch(e){if(e.code!=='EEXIST')throw e;}
}
await writeFile(path.join(fixture,'notes.txt'),'not a video');await writeFile(path.join(fixture,'empty.mp4'),'');await writeFile(path.join(fixture,'z-broken.mp4'),'broken video');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});page.setDefaultTimeout(120000);
const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});
async function idle({error=false}={}){await page.waitForFunction(()=>!document.body.classList.contains('busy'));const message=await page.locator('#message').textContent();assert.equal(await page.locator('#message').evaluate(e=>e.classList.contains('error')),error,message);}
async function set(id,v){await page.locator('#'+id).fill(String(v));await page.locator('#'+id).press('Tab');}
try{
  await page.goto('http://127.0.0.1:4173');
  assert(await page.locator('#queue-nav').isHidden());
  const chooser=page.waitForEvent('filechooser');await page.locator('#import-folder').click();await(await chooser).setFiles(fixture);await idle();
  assert.equal(await page.locator('#file-count').textContent(),'6');
  assert.match(await page.locator('#import-summary').textContent(),/忽略 1.*跳过 1/);
  const titles=await page.locator('.file-item').evaluateAll(nodes=>nodes.map(n=>n.title));
  assert.deepEqual(titles.map(t=>t.replace(/^folder-fixture\//,'')),['clip2.mp4','clip10.MP4','groupA/same.mp4','groupB/same.mp4','overlay.AVI','z-broken.mp4']);
  assert.equal(await page.locator('#queue-position').textContent(),'第 1 / 6 个');assert(await page.locator('#previous-file').isDisabled());
  assert.equal(await page.locator('.file-meta').evaluateAll(nodes=>nodes.filter(n=>n.textContent.includes(' · ')).length),1,'Only the current video should be probed');
  await set('crop-w',320);await set('crop-h',240);await set('crop-x',100);await set('crop-y',80);await set('start',1);await set('end',3);
  await page.locator('#quality').selectOption('23');await page.locator('#format').selectOption('avi');
  await page.locator('#next-file').click();await idle();assert.equal(await page.locator('#active-name').textContent(),'clip10.MP4');assert.equal(await page.locator('#format').inputValue(),'mp4');
  await set('crop-w',640);await set('crop-h',480);
  await page.locator('#previous-file').click();await idle();
  for(const [id,expected] of Object.entries({'crop-w':'320','crop-h':'240','crop-x':'100','crop-y':'80',start:'1',end:'3',quality:'23',format:'avi'}))assert.equal(await page.locator('#'+id).inputValue(),expected,id);
  await page.locator('#format').selectOption('mp4');
  const download=page.waitForEvent('download');await page.locator('#export').click();await(await download).saveAs(path.resolve('test-results/folder-crop.mp4'));await idle();
  await page.locator('#folder-input').setInputFiles(fixture);await idle();assert.equal(await page.locator('#file-count').textContent(),'6');assert.match(await page.locator('#import-summary').textContent(),/6 个视频已在列表中/);assert.equal(await page.locator('#crop-w').inputValue(),'320');
  for(let i=0;i<4;i++){await page.locator('#next-file').click();await idle();}
  assert.equal(await page.locator('#active-name').textContent(),'overlay.AVI');assert(await page.locator('#frame').evaluate(e=>e.naturalWidth===1024));
  await page.screenshot({path:'test-results/folder-desktop.png',fullPage:true});
  await page.locator('#next-file').click();await idle({error:true});assert.equal(await page.locator('#active-name').textContent(),'z-broken.mp4');assert(await page.locator('#next-file').isDisabled());assert(await page.locator('#previous-file').isEnabled());
  await page.locator('#previous-file').click();await idle();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/folder-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);
  await writeFile('test-results/folder-report.json',JSON.stringify({passed:true,checks:['native folder picker','nested directories','AVI and MP4 filtering','natural order','same filenames in different directories','duplicate folder import','lazy metadata reading','previous/next boundaries','per-video crop/time/export settings','crop export','overlay preview','bad-file recovery','mobile width','no video uploads']},null,2));
  console.log('FOLDER TEST PASSED');
}catch(e){console.error(e);await page.screenshot({path:'test-results/folder-failure.png',fullPage:true});process.exitCode=1;}finally{await browser.close();}
