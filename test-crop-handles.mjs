import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the same hit-test used by pointer-down and hover, without a browser.
const source = readFileSync(new URL('./src/app.js', import.meta.url), 'utf8');
const hit = runInNewContext(source.slice(source.indexOf('function handles('), source.indexOf('function normalizedCrop(')) + '\ncropHandleAt;');
const meta = { width: 2432, height: 2032 };
const crop = { x: 0, y: 0, w: meta.width, h: meta.height };
for (const zoom of [1, 3, 8]) {
  const rect = { left: -100, top: 50, width: 608 * zoom, height: 508 * zoom };
  for (const [index, fx, fy] of [[0,0,0], [2,1,0], [4,1,1], [6,0,1]]) {
    const x = rect.left + rect.width * fx, y = rect.top + rect.height * fy;
    for (const offset of [0, 4, 13]) {
      assert.equal(hit(crop, meta, rect, x + (fx ? offset : -offset), y + (fy ? offset : -offset)), index, `outside corner ${index} at ${zoom}x`);
      assert.equal(hit(crop, meta, rect, x + (fx ? -offset : offset), y + (fy ? -offset : offset)), index, `inside corner ${index} at ${zoom}x`);
    }
  }
  for (const [index, fx, fy] of [[1,.5,0], [3,1,.5], [5,.5,1], [7,0,.5]]) {
    assert.equal(hit(crop, meta, rect, rect.left + rect.width * fx, rect.top + rect.height * fy), index);
  }
  assert.equal(hit(crop, meta, rect, rect.left - 15, rect.top - 15), -1);
  assert.equal(hit(crop, meta, rect, rect.left + rect.width / 2, rect.top + rect.height / 2), -1);
}
// Overlapping hit areas must choose the nearest handle, not always top-left.
assert.equal(hit({x:0,y:0,w:20,h:20}, {width:100,height:100}, {left:0,top:0,width:100,height:100}, 20, 20), 4);
console.log('CROP HANDLE CHECK PASSED: four corners, edges, outside bounds, zoom and nearest target');
