import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('./src/time-overlay.js', import.meta.url), 'utf8');
const { timeOverlayLayout, videoFilterArgs, timeRegionError } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const region = { x:440, y:8, w:192, h:28 };
const crop = { x:100, y:120, w:320, h:240 };
assert.deepEqual(timeOverlayLayout(crop, region), { x:124, y:4, w:192, h:28 });
assert.deepEqual(timeOverlayLayout(crop, region, 'top-left'), { x:4, y:4, w:192, h:28 });
const preserved = {x:444,y:2,w:190,h:24};
assert.deepEqual(timeOverlayLayout({x:0,y:0,w:640,h:480},preserved), {x:444,y:2,w:190,h:24}, 'Existing upper-right label must not be doubled at a different margin');
assert.deepEqual(timeOverlayLayout({x:300,y:0,w:340,h:240},preserved), {x:144,y:2,w:190,h:24}, 'Already visible original pixels retain their crop-relative position');
assert.throws(() => videoFilterArgs(crop, { enabled:true }), /尚未定位/);
assert.throws(() => videoFilterArgs(crop, {enabled:true,region:{x:100,y:100,w:500,h:350}}), /不是时间条/);
assert.throws(() => videoFilterArgs(crop, {enabled:true,region:{x:600,y:8,w:192,h:28},meta:{width:640,height:480}}), /无效/);
assert.equal(timeRegionError(region,{width:640,height:480}), '');
assert.deepEqual(videoFilterArgs(crop, { enabled:false }), ['-map','0:v:0','-vf','crop=320:240:100:120:exact=1,setsar=1']);
for (const w of [2, 8, 30, 128, 640]) for (const h of [2, 20, 96, 480]) {
  for (const position of ['top-left','top-right']) {
    const p = timeOverlayLayout({ w, h }, region, position);
    assert(p.w >= 1 && p.h >= 1 && p.x >= 0 && p.y >= 0 && p.x+p.w <= w && p.y+p.h <= h);
  }
}
console.log('Timestamp placement, small crops, missing selection and disabled-path checks passed.');
