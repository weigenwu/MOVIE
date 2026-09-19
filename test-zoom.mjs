import { chromium } from 'playwright';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},acceptDownloads:true});page.setDefaultTimeout(90000);
const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});
async function idle(){await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert(!await page.locator('#message').evaluate(e=>e.classList.contains('error')),await page.locator('#message').textContent());}
async function set(id,v){await page.locator('#'+id).fill(String(v));await page.locator('#'+id).press('Tab');}
const crop=()=>page.locator('.crop-inputs input').evaluateAll(nodes=>nodes.map(n=>Number(n.value)));
const stage=()=>page.locator('#media-stage').boundingBox();
const close=(actual,expected,tolerance=2)=>assert(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
async function drag(x,y,dx,dy){await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();}
try{
  await page.goto('http://127.0.0.1:4173');assert(await page.locator('#zoom').isDisabled());
  const name=(await readdir('../avi')).find(n=>n.endsWith('_overlay.avi'));
  await page.locator('#file-input').setInputFiles(path.resolve('../avi',name));await idle();
  await set('crop-w',320);await set('crop-h',240);await set('crop-x',1100);await set('crop-y',900);
  const original=await crop(),fit=await stage();
  const normalViewer=await page.locator('#viewer').boundingBox();close(normalViewer.width/normalViewer.height,2432/2032,.003);
  await page.locator('#expand-workspace').click();await page.waitForFunction(()=>document.querySelector('.workspace').classList.contains('expanded'));
  const expandedViewer=await page.locator('#viewer').boundingBox();assert(expandedViewer.width>normalViewer.width);assert(expandedViewer.height>normalViewer.height);
  close(expandedViewer.width/expandedViewer.height,2432/2032,.003);assert.deepEqual(await crop(),original);
  await page.screenshot({path:'test-results/expanded-avi.png',fullPage:true});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#expand-workspace').getAttribute('aria-expanded'),'false');
  // Return to the initial scroll position before screen-coordinate zoom checks.
  await page.evaluate(()=>window.scrollTo(0,0));await page.locator('#viewer').evaluate(()=>new Promise(requestAnimationFrame));
  await page.locator('#zoom').fill('3');let box=await stage();close(box.width,fit.width*3,.1);assert.deepEqual(await crop(),original);
  // Zoom around the mouse, keeping the pointed source pixel in place.
  const area=await page.locator('#viewer').boundingBox(),mx=area.x+area.width*.6,my=area.y+area.height*.45;
  const oldPoint=[(mx-box.x)/box.width,(my-box.y)/box.height];await page.mouse.move(mx,my);await page.mouse.wheel(0,-100);
  await page.waitForFunction(()=>Number(document.getElementById('zoom').value)>3);box=await stage();
  close((mx-box.x)/box.width,oldPoint[0],.001);close((my-box.y)/box.height,oldPoint[1],.001);
  // Panning changes only the view, not the crop.
  await page.locator('#pan-mode').click();const beforePan=await stage();await drag(mx,my,60,35);box=await stage();
  close(box.x-beforePan.x,60);close(box.y-beforePan.y,35);assert.deepEqual(await crop(),original);
  await page.locator('#pan-mode').click();
  await page.locator('#crop-canvas').focus();await page.keyboard.down('Space');const beforeSpace=await stage();await drag(mx,my,-30,-20);await page.keyboard.up('Space');box=await stage();
  close(box.x-beforeSpace.x,-30);close(box.y-beforeSpace.y,-20);assert.deepEqual(await crop(),original);
  // The overlay allocation stays bounded by the viewport at maximum zoom.
  await page.locator('#zoom').fill('8');assert(await page.locator('#zoom-in').isDisabled());
  assert(await page.locator('#crop-canvas').evaluate(c=>c.width<=document.getElementById('viewer').clientWidth*devicePixelRatio+1));
  await page.locator('#zoom-reset').click();assert.equal(await page.locator('#zoom-value').textContent(),'1×');box=await stage();close(box.x,fit.x);close(box.width,fit.width);assert.deepEqual(await crop(),original);
  await page.locator('#zoom').fill('3');box=await stage();
  // Move a crop in a zoomed view, then resize it; coordinates are source pixels.
  await drag(box.x+1260/2432*box.width,box.y+1020/2032*box.height,24,-12);
  const moved=await crop();close(moved[0],1100+24/box.width*2432);close(moved[1],900-12/box.height*2032);assert.deepEqual(moved.slice(2),[320,240]);
  await drag(box.x+(moved[0]+320)/2432*box.width,box.y+(moved[1]+240)/2032*box.height,20,10);
  const resized=await crop();close(resized[2],320+20/box.width*2432);close(resized[3],240+10/box.height*2032);
  // Start outside the current crop and draw a new field of view.
  await drag(box.x+920/2432*box.width,box.y+740/2032*box.height,200/2432*box.width,120/2032*box.height);
  const selected=await crop();for(const [i,v] of [920,740,200,120].entries())close(selected[i],v);
  await page.screenshot({path:'test-results/zoom-desktop.png',fullPage:true});
  await set('start',1);await set('end',2);await page.locator('#format').selectOption('avi');
  const download=page.waitForEvent('download');await page.locator('#export').click();await(await download).saveAs(path.resolve('test-results/zoom-crop.avi'));await idle();
  // Each file keeps its own zoom/pan; MP4 playback and AVI seek retain the view.
  const mp4=(await readdir('../MP4')).find(n=>n.endsWith('.mp4'));
  await page.locator('#file-input').setInputFiles(path.resolve('../MP4',mp4));await idle();assert.equal(await page.locator('#zoom-value').textContent(),'1×');
  let squareViewer=await page.locator('#viewer').boundingBox();close(squareViewer.width,squareViewer.height,.1);
  await page.locator('#expand-workspace').click();squareViewer=await page.locator('#viewer').boundingBox();close(squareViewer.width,squareViewer.height,.1);
  await page.screenshot({path:'test-results/expanded-square.png',fullPage:true});await page.locator('#expand-workspace').click();
  await page.locator('#zoom-in').click();await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('video').currentTime>.15);await page.locator('#play').click();
  await page.locator('.file-item').first().click();await idle();assert.equal(await page.locator('#zoom-value').textContent(),'3×');assert.deepEqual(await crop(),selected);
  await page.locator('#seek').fill('20');await page.locator('#seek').dispatchEvent('change');await idle();assert.equal(await page.locator('#zoom-value').textContent(),'3×');
  await page.setViewportSize({width:390,height:844});await page.locator('#zoom').fill('4');await page.locator('#pan-mode').click();
  await page.screenshot({path:'test-results/zoom-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#zoom-reset').click();assert.equal(await page.locator('#zoom-value').textContent(),'1×');assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);
  await writeFile('test-results/zoom-report.json',JSON.stringify({passed:true,source:name,crop:selected,start:1,end:2,errors,posts},null,2));console.log('ZOOM TEST PASSED');
}catch(error){console.error(error);await page.screenshot({path:'test-results/zoom-failure.png',fullPage:true});process.exitCode=1;}finally{await browser.close();}
