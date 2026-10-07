import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('./src/scale-bar.js', import.meta.url), 'utf8');
const { scaleBarLayout, suggestedScaleLength, calibrationFromReference, drawScaleBar } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const crop = { x: 80, y: 100, w: 320, h: 240 };
const settings = { enabled: true, length: 50, unit: 'µm', unitsPerPixel: .5 };
assert.equal(calibrationFromReference(100, 50), .5);
assert.equal(calibrationFromReference('200', '50'), .25);
assert.equal(scaleBarLayout(null, { enabled: false }), null);
const initial = scaleBarLayout(crop, settings);
assert.equal(initial.barWidth, 100);
assert.equal(initial.label, '50 µm');
assert.equal(initial.barHeight, 4);
assert.equal(initial.x, 4);
assert.equal(initial.y + initial.height, crop.h - 4);
assert.equal(scaleBarLayout({ ...crop, x: 1000, y: 9999 }, settings).barWidth, 100);
assert.equal(scaleBarLayout(crop, { ...settings, unit: 'px', unitsPerPixel: undefined }).barWidth, 50);
assert.equal(scaleBarLayout(crop, { ...settings, length: 50.2 }).barWidth, 100);
const converted = scaleBarLayout(crop, { ...settings, length: .1 + .2, unitsPerPixel: .001 });
assert.equal(converted.label, '0.3 µm');
assert.equal(converted.barWidth, Math.round((.1 + .2) / .001));
// Display rounding must not move an almost-half-pixel length across its boundary.
const nearHalfPixel = scaleBarLayout(crop, { ...settings, length: 50.249999999999 });
assert.equal(nearHalfPixel.label, '50.25 µm');
assert.equal(nearHalfPixel.barWidth, 100);
assert.equal(scaleBarLayout(crop, { ...settings, length: 50.25 }).barWidth, 101);
// Equivalent units preserve the physical calibration and number of source pixels.
assert.equal(scaleBarLayout(crop, { ...settings, unit: 'mm', length: .05, unitsPerPixel: .0005 }).barWidth, 100);
assert.equal(scaleBarLayout(crop, { ...settings, unit: 'nm', length: 50000, unitsPerPixel: 500 }).barWidth, 100);
for (const length of [1, 1.1, 10.249, 10.25, 20.333333, 50.249999999999, 50.25]) {
  const p = scaleBarLayout(crop, { ...settings, length });
  assert(Math.abs(p.barWidth * settings.unitsPerPixel - length) <= settings.unitsPerPixel / 2);
}
for (const unit of ['µm', 'nm', 'mm', 'px']) {
  assert.equal(scaleBarLayout(crop, { ...settings, unit }).label, `50 ${unit}`);
}
for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
  const p = scaleBarLayout(crop, { ...settings, position });
  assert(p.x >= 0 && p.y >= 0 && p.x + p.width <= crop.w && p.y + p.height <= crop.h);
  assert.equal(position.endsWith('left') ? p.x : crop.w - p.x - p.width, 4);
  assert.equal(position.startsWith('top') ? p.y : crop.h - p.y - p.height, 4);
  assert.equal(p.barWidth, 100);
  assert(p.barX + p.barWidth <= p.width && p.barY + p.barHeight <= p.height);
}
for (const bad of [undefined, null, '', ' ', 'abc', '<script>', NaN, Infinity, 0, -1, true]) {
  assert.throws(() => scaleBarLayout(crop, { ...settings, length: bad }), /长度/);
  assert.throws(() => scaleBarLayout(crop, { ...settings, unitsPerPixel: bad }), /长度/);
  assert.throws(() => calibrationFromReference(bad, 50), /像素/);
  assert.throws(() => calibrationFromReference(100, bad), /长度/);
}
assert.throws(() => scaleBarLayout(crop, { ...settings, length: 500 }), /放不下/);
assert.throws(() => scaleBarLayout(crop, { ...settings, length: .1 }), /不足 2/);
assert.throws(() => scaleBarLayout({ w: 16, h: 16 }, { ...settings, length: 2 }), /放不下/);
assert.throws(() => scaleBarLayout({ w: 0, h: 0 }, settings), /太小/);
assert.throws(() => scaleBarLayout({ w: Number.MAX_SAFE_INTEGER + 1, h: 240 }, settings), /太小/);
assert.throws(() => scaleBarLayout(crop, { ...settings, unit: '<b>µm</b>' }), /单位/);
assert.throws(() => scaleBarLayout(crop, { ...settings, position: 'middle' }), /位置/);
assert.throws(() => calibrationFromReference(Number.MIN_VALUE, Number.MAX_VALUE), /范围/);
assert.throws(() => calibrationFromReference(Number.MAX_VALUE, Number.MIN_VALUE), /范围/);
assert.throws(() => scaleBarLayout(crop, { ...settings, unitsPerPixel: Number.MIN_VALUE }), /范围/);
// Automatic length is a suggestion only; the original calibration and manual
// length remain untouched, including settings passed from an immutable store.
const originalSettings = Object.freeze({ ...settings });
assert.equal(suggestedScaleLength(crop, originalSettings), 50);
assert.equal(suggestedScaleLength({w:200,h:160}, originalSettings), 20);
assert.equal(suggestedScaleLength({w:100,h:100}, originalSettings), 10);
assert.equal(suggestedScaleLength({w:640,h:480}, originalSettings), 100);
assert.equal(suggestedScaleLength({w:320,h:240}, {...settings, unit:'px', unitsPerPixel:undefined}), 100);
assert.equal(originalSettings.unitsPerPixel, .5);
assert.equal(originalSettings.length, 50);
assert.equal(scaleBarLayout(crop, { ...settings, length:37 }).barWidth, 74);
assert.equal(scaleBarLayout(crop, { ...settings, length:37 }).label, '37 µm');
// 1 mm would be 2,000 source pixels and cannot fit; do not choose 0.05 mm or
// silently change the calibration merely to satisfy an integer preference.
assert.equal(suggestedScaleLength(crop, { ...settings, unit:'mm', unitsPerPixel:.0005 }), null);
assert.equal(suggestedScaleLength({w:16,h:16}, settings), null);
assert.equal(suggestedScaleLength(crop, { ...settings, unitsPerPixel:undefined }), null);
assert.equal(suggestedScaleLength(crop, { ...settings, unitsPerPixel:NaN }), null);
for (const w of [64, 96, 200, 320, 1024]) for (const h of [64, 160, 240, 480]) {
  for (const unitsPerPixel of [.05, .25, .5, 2, 10]) {
    const c = {w,h}, s = {...settings, unitsPerPixel};
    const length = suggestedScaleLength(c,s);
    if (length === null) continue;
    assert(Number.isSafeInteger(length) && length >= 1);
    assert(/^[125]0*$/.test(String(length)));
    const p = scaleBarLayout(c, {...s,length});
    assert.equal(p.barWidth, Math.round(length / unitsPerPixel));
    assert(p.x >= 0 && p.y >= 0 && p.x+p.width <= w && p.y+p.height <= h);
    assert.equal(p.barHeight, 2 * Math.max(2, Math.round(p.fontSize / 5)));
  }
}
// Verify canvas drawing uses exact geometry and never rescales the calibrated bar.
const calls = [];
const ctx = Object.fromEntries(['save', 'clearRect', 'fillRect', 'fillText', 'strokeText', 'restore'].map(name => [name, (...args) => calls.push([name, ...args])]));
drawScaleBar(ctx, initial);
assert.deepEqual(calls.at(-2), ['fillRect', initial.barX, initial.barY, 100, initial.barHeight]);
assert(calls.some(call => call[0] === 'fillText' && call[1] === '50 µm'));
assert.equal(ctx.textAlign, 'center');
assert.equal(ctx.font, `bold ${initial.fontSize}px monospace`);
assert.deepEqual(calls.filter(call => call[0] === 'fillRect')[0], ['fillRect', 0, 0, initial.width, initial.height]);
assert.equal(calls.filter(call => call[0] === 'strokeText').length, 0);
calls.length = 0;
drawScaleBar(ctx, initial, { transparent: true });
assert.deepEqual(calls.filter(call => call[0] === 'fillRect'), [['fillRect', initial.barX, initial.barY, 100, initial.barHeight]]);
assert.deepEqual(calls.filter(call => call[0] === 'strokeText'), [['strokeText', initial.label, initial.textX, initial.textY]]);
assert(calls.findIndex(call => call[0] === 'strokeText') < calls.findIndex(call => call[0] === 'fillText'));
assert.deepEqual(calls[0], ['save']);
assert.deepEqual(calls.at(-1), ['restore']);
assert.equal(ctx.shadowOffsetX, 0);
assert.equal(ctx.shadowOffsetY, 0);
assert.equal(ctx.shadowBlur, 0);
assert.equal(ctx.lineWidth, 1);
console.log('Scale bar calibration, automatic integer lengths, bounds, exact line width, bold font, thicker line and transparent rendering passed.');
