import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('./src/auto-time-region.js', import.meta.url), 'utf8');
const { detectTimeRegion } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const digits = {
  '0':['01110','11011','11011','11011','11011','11011','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','11011','00011','00110','01100','11000','11111'],
  '3':['11110','00011','00011','01110','00011','00011','11110'],
  '5':['11111','11000','11000','11110','00011','00011','11110'],
  '7':['11111','00011','00110','00110','01100','01100','01100'],
  '9':['01110','11011','11011','01111','00011','00011','01110'],
  '.':['00000','00000','00000','00000','00000','00100','00100'],
  ':':['00000','00100','00100','00000','00100','00100','00000']
};
const frame = (W = 640, H = 480, value = 27) => ({ width: W, height: H, data: Uint8ClampedArray.from({ length: W * H * 4 }, (_, p) => p % 4 === 3 ? 255 : value) });
const pixel = (image, x, y, value) => { const p = (y * image.width + x) * 4; for (let c = 0; c < 3; c++) image.data[p + c] = Array.isArray(value) ? value[c] : value; };
function stamp(image, { value = 205, noise = 0, y = 8 } = {}) {
  const label = '00.13:15:01.729', scale = 2, width = label.length * 12, x = image.width - width - 8;
  for (let by = y - 3; by < y + 17; by++) for (let bx = x - 3; bx < x + width + 3; bx++) pixel(image, bx, by, 5);
  for (let c = 0; c < label.length; c++) for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
    if (digits[label[c]][gy][gx] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) pixel(image, x + c * 12 + gx * 2 + dx, y + gy * 2 + dy, value);
  }
  if (noise) for (let i = 0; i < image.data.length; i++) if (i % 4 !== 3) image.data[i] += ((i * 17) % (noise * 2 + 1)) - noise;
  return { x, y, w: width - 2, h: 14 };
}
for (const options of [{}, { value: 70, noise: 6 }, { value: 125, noise: 12 }, { value: 250 }]) {
  const image = frame(), expected = stamp(image, options), rect = detectTimeRegion(image);
  assert(rect, `Timestamp should be located for ${JSON.stringify(options)}`);
  assert(rect.x <= expected.x && rect.y <= expected.y);
  assert(rect.x + rect.w >= expected.x + expected.w && rect.y + rect.h >= expected.y + expected.h, 'All digits must be included');
  assert(rect.w < expected.w + 14 && rect.h < expected.h + 12, 'Detector must never select a large field');
  assert(Object.values(rect).every(n => n % 2 === 0), 'Original coordinates are even');
  const full = detectTimeRegion(image, { width: 2560, height: 1920 });
  assert.deepEqual(full, Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value * 4])), 'Scaled preview maps back to original pixels');
}
assert.equal(detectTimeRegion(frame()), null, 'Blank scene has no timestamp');
const cells = frame();
for (let i = 0; i < 38; i++) {
  const cx = 352 + (i * 43) % 260, cy = 5 + (i * 37) % 65, radius = 3 + i % 8;
  for (let y = Math.max(0, cy - radius); y <= Math.min(71, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(639, cx + radius); x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d >= radius - 1.5 && d <= radius) pixel(cells, x, y, i % 2 ? [80, 90, 160] : 170);
  }
}
assert.equal(detectTimeRegion(cells), null, 'Scattered bright cells must not become an overlay');
const ui = frame(640, 480, 90); stamp(ui);
for (let y = 0; y < 36; y++) for (let x = 352; x < 640; x++) {
  const p = (y * 640 + x) * 4; if (ui.data[p] < 48) pixel(ui, x, y, 90);
}
assert.equal(detectTimeRegion(ui), null, 'A gray browser toolbar does not satisfy the black label background');
const wrongPosition = frame(); stamp(wrongPosition, { y: 100 });
assert.equal(detectTimeRegion(wrongPosition), null, 'Only the original top-right label area is eligible');
for (const invalid of [null, {}, { width: 10, height: 10, data: [] }, { width: -1, height: 10, data: [] }]) assert.equal(detectTimeRegion(invalid), null);
console.log('Automatic top-right label detection, faint/noisy text, full original coordinates and scene rejection checks passed.');
