import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uri = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const overlay = uri(readFileSync(new URL('./src/time-overlay.js', import.meta.url), 'utf8'));
const moduleText = readFileSync(new URL('./src/time-picker.js', import.meta.url), 'utf8').replace("'./time-overlay.js'", JSON.stringify(overlay));
const { createTimePicker } = await import(uri(moduleText));

class Element {
  handlers = new Map(); disabled = false; hidden = false; open = false; textContent = '';
  addEventListener(name, fn) { const set = this.handlers.get(name) || new Set(); set.add(fn); this.handlers.set(name, set); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  dispatch(name, e = {}) { for (const fn of [...this.handlers.get(name) || []]) fn({ preventDefault() {}, ...e }); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
}
// A small software raster keeps the tests dependency-free while checking the
// actual source pixels requested by the picker, not just rectangle arithmetic.
class Canvas extends Element {
  _width = 1; _height = 1; pixels = new Uint32Array(1); capture = null;
  get width() { return this._width; } get height() { return this._height; }
  set width(n) { this._width = n; this.pixels = new Uint32Array(this.width * this.height); }
  set height(n) { this._height = n; this.pixels = new Uint32Array(this.width * this.height); }
  getBoundingClientRect() { return { left: 20, top: 30, width: 640, height: 480 }; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture(id) { this.capture = null; this.dispatch('lostpointercapture', { pointerId: id }); }
  getContext() {
    return {
      clearRect: () => this.pixels.fill(0), fillRect() {}, strokeRect() {},
      drawImage: (source, ...args) => {
        let sx = 0, sy = 0, sw = source.width, sh = source.height, dx, dy, dw, dh;
        if (args.length === 2) [dx, dy, dw, dh] = [...args, sw, sh];
        else if (args.length === 4) [dx, dy, dw, dh] = args;
        else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
        for (let y = Math.max(0, Math.ceil(dy)); y < Math.min(this.height, dy + dh); y++) {
          for (let x = Math.max(0, Math.ceil(dx)); x < Math.min(this.width, dx + dw); x++) {
            const px = Math.floor(sx + (x - dx) / dw * sw), py = Math.floor(sy + (y - dy) / dh * sh);
            this.pixels[y * this.width + x] = source.pixels[py * source.width + px];
          }
        }
      }
    };
  }
}
globalThis.document = { createElement: () => new Canvas() };
const controls = { dialog: new Element(), canvas: new Canvas(), preview: new Canvas(), error: new Element(), confirm: new Element(), cancel: new Element() };
const pick = createTimePicker(controls);
const source = new Canvas(); source.width = 320; source.height = 240;
source.pixels = Uint32Array.from({ length: 320 * 240 }, (_, i) => i + 1);
const meta = Object.freeze({ width: 1280, height: 960 });
const prior = Object.freeze({ x: 800, y: 16, w: 400, h: 64 });
const expected = { ...prior };
const pointer = (x, y, extra = {}) => ({ clientX: 20 + x / 2, clientY: 30 + y / 2, pointerId: 1, button: 0, isPrimary: true, ...extra });
const drag = (x1, y1, x2, y2) => {
  controls.canvas.dispatch('pointerdown', pointer(x1, y1));
  controls.canvas.dispatch('pointermove', pointer(x2, y2));
  controls.canvas.dispatch('pointerup', pointer(x2, y2));
};
const input = { source, meta, region: null };

// A 320px proxy displayed at 640px still selects coordinates in the 1280px original.
let promise = pick(input), settled = false;
promise.then(() => { settled = true; });
assert(controls.confirm.disabled);
controls.canvas.dispatch('pointerdown', pointer(800, 16));
controls.canvas.dispatch('pointermove', pointer(1200, 80));
assert(controls.confirm.disabled, 'Never commit a selection during a drag');
controls.canvas.dispatch('pointerup', pointer(1200, 80));
await Promise.resolve(); assert.equal(settled, false, 'Pointer release must require explicit confirmation');
assert.equal(controls.confirm.disabled, false);
assert.equal(controls.preview.width, 400); assert.equal(controls.preview.height, 64);
assert.equal(controls.preview.pixels[0], 4 * 320 + 200 + 1, 'Preview starts at the selected original timestamp pixel');
assert.equal(controls.preview.pixels[63 * 400 + 399], 19 * 320 + 299 + 1, 'Preview ends at selected source strip');
controls.confirm.dispatch('click'); assert.deepEqual(await promise, expected);

promise = pick(input);
drag(200, 200, 1000, 800);
assert(controls.confirm.disabled, 'A large scientific field cannot be accepted as a timestamp');
assert.match(controls.error.textContent, /时间/); assert(controls.preview.hidden);
controls.confirm.dispatch('click'); assert(controls.dialog.open);
controls.cancel.dispatch('click'); assert.equal(await promise, null);

promise = pick(input); drag(800, 16, 800, 16);
assert(controls.confirm.disabled, 'A click creates no fake selection');
drag(1200, 80, 800, 16);
assert.equal(controls.confirm.disabled, false);
controls.confirm.dispatch('click'); assert.deepEqual(await promise, expected, 'Reverse dragging selects the same source region');

for (const event of ['pointercancel', 'lostpointercapture']) {
  promise = pick({ ...input, region: prior });
  const pixelBefore = controls.preview.pixels[0];
  const saved = source.pixels[4 * 320 + 200]; source.pixels[4 * 320 + 200] = 999999;
  controls.canvas.dispatch('pointerdown', pointer(100, 100));
  controls.canvas.dispatch('pointermove', pointer(1100, 700));
  controls.canvas.dispatch(event, { pointerId: 1 });
  assert.equal(controls.confirm.disabled, false, `${event} restores prior valid selection`);
  assert.equal(controls.preview.pixels[0], pixelBefore, 'Snapshot must stay frozen when the source changes');
  source.pixels[4 * 320 + 200] = saved;
  controls.confirm.dispatch('click'); assert.deepEqual(await promise, expected);
  assert.deepEqual(prior, expected, 'Passed source region is immutable');
}
for (const event of ['cancel', 'close']) {
  promise = pick({ ...input, region: prior }); drag(400, 20, 1000, 100);
  if (event === 'close') controls.dialog.close(); else controls.dialog.dispatch(event);
  assert.equal(await promise, null);
  assert.deepEqual(prior, expected, 'Dismissal must not edit passed source region');
}
for (const unready of [{}, { width: 320, height: 240, readyState: 1 }, { width: 320, height: 240, complete: false }]) {
  promise = pick({ ...input, source: unready });
  assert(controls.confirm.disabled); assert.match(controls.error.textContent, /尚未准备好/); assert(controls.preview.hidden);
  controls.cancel.dispatch('click'); assert.equal(await promise, null);
}

const first = pick(input), second = pick({ ...input, region: prior });
assert.equal(await first, null, 'Reopening cancels the pending picker safely');
controls.confirm.dispatch('click'); assert.deepEqual(await second, expected);
// Native close dispatch is asynchronous: a finished session may fire after a
// second picker has already installed its listeners and reopened the dialog.
const queued = [];
controls.dialog.close = () => { controls.dialog.open = false; queued.push(() => controls.dialog.dispatch('close')); };
const previous = pick(input), reopened = pick({ ...input, region: prior });
assert.equal(await previous, null);
let reopenedSettled = false; reopened.then(() => { reopenedSettled = true; });
queued.shift()(); await Promise.resolve();
assert.equal(reopenedSettled, false, 'Queued previous close must not cancel a newly opened picker');
assert(controls.dialog.open);
controls.confirm.dispatch('click'); assert.deepEqual(await reopened, expected);
while (queued.length) queued.shift()();
controls.dialog.showModal = () => { throw new Error('Unsupported or already open'); };
assert.equal(await pick(input), null, 'Failure to open must never leave a pending promise');
for (const control of Object.values(controls)) {
  for (const handlers of control.handlers.values()) assert.equal(handlers.size, 0, 'Completed dialog removes all handlers');
}
console.log('Timestamp dialog source pixels, original coordinates, explicit confirmation, rejection, cancellation and reopening checks passed.');
