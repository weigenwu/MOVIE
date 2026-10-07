import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('./src/time-overlay.js', import.meta.url), 'utf8');
const { timeOverlayLayout, videoFilterArgs } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const region = { x:440, y:8, w:192, h:28 };
const crop = { x:100, y:120, w:320, h:240 };
assert.deepEqual(timeOverlayLayout(crop, region), { x:124, y:4, w:192, h:28 });
assert.deepEqual(timeOverlayLayout(crop, region, 'top-left'), { x:4, y:4, w:192, h:28 });
assert.throws(() => videoFilterArgs(crop, { enabled:true }), /框选/);
assert.deepEqual(videoFilterArgs(crop, { enabled:false }), ['-map','0:v:0','-vf','crop=320:240:100:120:exact=1,setsar=1']);
for (const w of [2, 8, 30, 128, 640]) for (const h of [2, 20, 96, 480]) {
  for (const position of ['top-left','top-right']) {
    const p = timeOverlayLayout({ w, h }, region, position);
    assert(p.w >= 1 && p.h >= 1 && p.x >= 0 && p.y >= 0 && p.x+p.w <= w && p.y+p.h <= h);
  }
}
console.log('Timestamp placement, small crops, missing selection and disabled-path checks passed.');
