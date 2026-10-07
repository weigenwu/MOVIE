import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('./src/time-overlay.js', import.meta.url), 'utf8');
const { timeOverlayLayout, videoFilterArgs, timeRegionError, originalTimeVisible, applyTimeMatte } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const region = { x:440, y:8, w:192, h:28 };
const crop = { x:100, y:120, w:320, h:240 };
assert.deepEqual(timeOverlayLayout(crop, region), { x:188, y:4, w:128, h:19 });
assert.deepEqual(timeOverlayLayout(crop, region, 'top-left'), { x:4, y:4, w:128, h:19 });
assert.deepEqual(timeOverlayLayout(crop, region, 'top-right',15), { x:268, y:4, w:48, h:7 });
assert.deepEqual(timeOverlayLayout(crop, region, 'top-left',90), { x:4, y:4, w:288, h:42 });
assert(timeOverlayLayout(crop,region,'top-right',90).w>region.w,'A requested enlargement is not capped at native label width');
const shortCrop=timeOverlayLayout({w:1000,h:40},region,'top-right',90);
assert.equal(shortCrop.h,40,'Height may limit the requested width while preserving aspect');
assert.equal(shortCrop.w,274);
const preserved = {x:444,y:2,w:190,h:24};
assert.deepEqual(timeOverlayLayout({x:0,y:0,w:640,h:480},preserved), {x:444,y:2,w:190,h:24}, 'Existing upper-right label must not be doubled at a different margin');
assert.deepEqual(timeOverlayLayout({x:300,y:0,w:340,h:240},preserved), {x:144,y:2,w:190,h:24}, 'Already visible original pixels retain their crop-relative position');
assert(originalTimeVisible({x:0,y:0,w:640,h:480},preserved));
assert(originalTimeVisible({...preserved},preserved),'Exact containment includes the boundary');
assert.equal(originalTimeVisible({x:450,y:0,w:190,h:240},preserved),false,'Partial clipping does not count as preserving the original clock');
assert.equal(originalTimeVisible(crop,null),false);
for(const position of ['top-left','top-right']) for(const percent of [15,40,90]) {
  assert.deepEqual(timeOverlayLayout({x:300,y:0,w:340,h:240},preserved,position,percent),{x:144,y:2,w:190,h:24},'An already visible original label must never be duplicated or erased for a size or corner request');
}
for(const invalid of [NaN,Infinity,-Infinity,0,14.9,90.1,null,'40']) {
  assert.throws(()=>timeOverlayLayout(crop,region,'top-right',invalid),/15%/);
  assert.throws(()=>videoFilterArgs(crop,{enabled:true,region,widthPercent:invalid}),/15%/);
}
assert.throws(() => videoFilterArgs(crop, { enabled:true }), /尚未定位/);
assert.throws(() => videoFilterArgs(crop, {enabled:true,region:{x:100,y:100,w:500,h:350}}), /不是时间条/);
assert.throws(() => videoFilterArgs(crop, {enabled:true,region:{x:600,y:8,w:192,h:28},meta:{width:640,height:480}}), /无效/);
assert.equal(timeRegionError(region,{width:640,height:480}), '');
assert.deepEqual(videoFilterArgs(crop, { enabled:false }), ['-map','0:v:0','-vf','crop=320:240:100:120:exact=1,setsar=1']);
for (const w of [1,2, 8, 30, 128, 640]) for (const h of [1,2, 20, 96, 480]) {
  for (const position of ['top-left','top-right']) for(const percent of [15,40,90]) {
    const p = timeOverlayLayout({ w, h }, region, position,percent);
    assert(p.w >= 1 && p.h >= 1 && p.x >= 0 && p.y >= 0 && p.x+p.w <= w && p.y+p.h <= h);
    assert(Math.abs(p.w*region.h/region.w-p.h)<=1,'Aspect changes are limited to unavoidable raster rounding');
  }
}
const filter=videoFilterArgs(crop,{enabled:true,region,position:'top-left',widthPercent:90});
assert(filter[1].includes('scale=288:42:flags=lanczos'),'Export must apply the selected size with smooth resampling');
assert(filter[1].includes('overlay=4:4:format=rgb:shortest=1'),'Selected corner reaches the actual filter');
const unchangedFilter=videoFilterArgs({x:0,y:0,w:640,h:480},{enabled:true,region:preserved,position:'top-left',widthPercent:15});
assert(!unchangedFilter[1].includes('scale='),'An already visible label keeps the exact original pixels');
assert(unchangedFilter[1].includes('overlay=444:2:'),'Copy in place despite a different requested corner');
const withScale=videoFilterArgs(crop,{enabled:true,region,widthPercent:15},{x:200,y:200});
assert(withScale[1].includes('scale=48:7:flags=lanczos'));
assert(withScale[1].includes('overlay=200:200:format=rgb:eof_action=repeat:repeatlast=1[withscale]'));
assert.deepEqual(videoFilterArgs(crop,{enabled:false,widthPercent:NaN}),['-map','0:v:0','-vf','crop=320:240:100:120:exact=1,setsar=1']);
const patch = {data:new Uint8ClampedArray([0,0,0,255,8,8,8,255,16,16,16,255,70,70,70,255,104,104,104,255,255,255,255,255,70,60,90,255])};
assert.equal(applyTimeMatte(patch),patch,'Preview matte returns the modified temporary patch');
const alphas=Array.from(patch.data).filter((_,i)=>i%4===3);
assert.deepEqual(alphas,[0,0,21,164,255,255,155]);
assert(Array.from(patch.data).every((n,i)=>i%4===3||n===255),'All retained glyph RGB pixels are white');
assert.throws(()=>applyTimeMatte(null)); assert.throws(()=>applyTimeMatte({data:[0,0,0]}));
const transparentFilter=videoFilterArgs(crop,{enabled:true,region,transparent:true,widthPercent:40})[1];
assert(transparentFilter.includes("geq=r=255:g=255:b=255:a='floor(clip(((77*r(X,Y)+150*g(X,Y)+29*b(X,Y))/256-8)*255/96,0,255))':interpolation=nearest"),'Matte samples exact original pixels, including last row and column');
assert(transparentFilter.includes('scale=128:19:flags=lanczos,format=rgba[stamp]'),'Resized transparent glyphs must retain their alpha channel');
assert(transparentFilter.indexOf('geq=')<transparentFilter.indexOf('scale='),'Apply the matte to original glyph pixels before scaling');
assert(!videoFilterArgs(crop,{enabled:true,region,transparent:false})[1].includes('geq='),'Unchecked background removal preserves the original timestamp box');
assert(!videoFilterArgs(crop,{enabled:true,region})[1].includes('geq='),'Legacy helper calls remain opaque');
const preservedTransparent=videoFilterArgs({x:0,y:0,w:640,h:480},{enabled:true,region:preserved,transparent:true,position:'top-left'})[1];
assert(!preservedTransparent.includes('geq='),'Never remove the background already burned into the retained scientific scene');
assert(preservedTransparent.includes('overlay=444:2:')&&!preservedTransparent.includes('scale='),'Visible original time is still copied exactly in place');
const transparentWithScale=videoFilterArgs(crop,{enabled:true,region,transparent:true},{x:200,y:200})[1];
assert(transparentWithScale.includes('geq=')&&transparentWithScale.includes('[withscale]'),'Scale export route retains the same timestamp matte');
const makeRedPatch=()=>({data:new Uint8ClampedArray([0,0,0,255,70,70,70,255,104,104,104,255])});
const redTransparent=applyTimeMatte(makeRedPatch(),{color:'red',transparent:true});
assert.deepEqual(Array.from(redTransparent.data),[255,0,0,0,255,0,0,164,255,0,0,255],'Red transparent mode keeps faint glyph alpha and removes black');
const redOpaque=applyTimeMatte(makeRedPatch(),{color:'red',transparent:false});
assert.deepEqual(Array.from(redOpaque.data),[0,0,0,255,164,0,0,255,255,0,0,255],'Red opaque mode draws antialiased red pixels on black');
const originalPatch=makeRedPatch(),originalBytes=Array.from(originalPatch.data);
assert.equal(applyTimeMatte(originalPatch,{transparent:false}),originalPatch);
assert.deepEqual(Array.from(originalPatch.data),originalBytes,'Uncolored opaque mode must preserve original source pixels');
assert.throws(()=>applyTimeMatte(makeRedPatch(),{color:'blue'}),/颜色/);
const redTransparentFilter=videoFilterArgs(crop,{enabled:true,region,transparent:true,color:'red'})[1];
assert(redTransparentFilter.includes("geq=r=255:g=0:b=0:a='floor(clip("));
assert(redTransparentFilter.includes(':interpolation=nearest')&&redTransparentFilter.includes('format=rgba[stamp]'));
const redOpaqueFilter=videoFilterArgs(crop,{enabled:true,region,transparent:false,color:'red'})[1];
assert(redOpaqueFilter.includes("geq=r='floor(clip(")&&redOpaqueFilter.includes(":g=0:b=0:a=255:interpolation=nearest"),'Opaque red must use matte intensity in its red channel');
assert(redOpaqueFilter.includes('format=rgba[stamp]'));
for(const transparent of [false,true]) {
  const embedded=videoFilterArgs({x:0,y:0,w:640,h:480},{enabled:true,region:preserved,transparent,color:'red'})[1];
  assert(!embedded.includes('geq=')&&embedded.includes('format=rgb24[stamp]'),'Already embedded original time bypasses every color/alpha conversion');
}
console.log('Timestamp sizing, original-pixel lock, white/red transparent and opaque glyphs, smooth filters and export paths passed.');
