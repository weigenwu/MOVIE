// Locate a compact light-on-dark label at the top right. No characters are read
// and no time values are inferred: export copies this source rectangle per frame.
export function detectTimeRegion(image, meta = image) {
  const W = image?.width, H = image?.height, data = image?.data;
  const outW = meta?.width, outH = meta?.height;
  if (![W, H, outW, outH].every(n => Number.isInteger(n) && n > 0) || !data || data.length < W * H * 4) return null;
  const left = Math.floor(W * .55), bottom = Math.ceil(H * .15), rw = W - left;
  const mask = new Uint8Array(rw * bottom), lum = new Uint8Array(W * bottom);
  const radius = Math.max(1, Math.min(4, Math.round(W / 700)));
  for (let y = 0; y < bottom; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    lum[y * W + x] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  for (let y = 1; y < bottom - 1; y++) for (let x = left; x < W - 1; x++) {
    const p = (y * W + x) * 4, value = lum[y * W + x];
    if (value < 48 || Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]) > Math.max(22, value * .2)) continue;
    const nearby = Math.min(lum[y * W + Math.max(0, x - radius)], lum[y * W + Math.min(W - 1, x + radius)], lum[Math.max(0, y - radius) * W + x], lum[Math.min(bottom - 1, y + radius) * W + x]);
    if (nearby <= 48 && value - nearby >= 22) mask[y * rw + x - left] = 1;
  }
  const components = [], queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let head = 0, tail = 1, x0 = W, x1 = 0, y0 = H, y1 = 0;
    queue[0] = start; mask[start] = 0;
    while (head < tail) {
      const index = queue[head++], x = index % rw, y = Math.floor(index / rw);
      x0 = Math.min(x0, x + left); x1 = Math.max(x1, x + left); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * rw + nx;
        if (nx >= 0 && nx < rw && ny >= 0 && ny < bottom && mask[next]) { mask[next] = 0; queue[tail++] = next; }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (h >= 4 && h <= H * .07 && w >= 2 && w <= h * .95 && tail >= h && tail <= w * h * .95) components.push({ x0, x1, y0, y1, w, h, cy: (y0 + y1) / 2 });
  }
  let best = null;
  for (const anchor of components) {
    const row = components.filter(c => c.h >= anchor.h * .7 && c.h <= anchor.h * 1.4 && Math.abs(c.cy - anchor.cy) <= anchor.h * .25).sort((a, b) => a.x0 - b.x0);
    const groups = [];
    for (const c of row) {
      const last = groups.at(-1);
      if (!last || c.x0 - last.at(-1).x1 > anchor.h * 2) groups.push([c]); else last.push(c);
    }
    for (const group of groups) {
      if (group.length < 8 || group.length > 22) continue;
      const x0 = Math.min(...group.map(c => c.x0)), x1 = Math.max(...group.map(c => c.x1));
      const y0 = Math.min(...group.map(c => c.y0)), y1 = Math.max(...group.map(c => c.y1));
      const w = x1 - x0 + 1, h = y1 - y0 + 1, padding = Math.max(2, Math.round(h * .16));
      if (w < h * 6 || w > h * 30 || x1 < W * .88 || W - x1 > Math.max(W * .05, h * 2) || y0 > H * .08) continue;
      const box = { x: Math.max(left, x0 - padding), y: Math.max(0, y0 - padding), w: Math.min(W, x1 + padding + 1) - Math.max(left, x0 - padding), h: Math.min(bottom, y1 + padding + 1) - Math.max(0, y0 - padding) };
      let dark = 0, border = 0, borderDark = 0, bright = 0;
      for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
        const value = lum[y * W + x];
        if (value < 48) dark++; else bright++;
        if (y < y0 || y > y1 || x < x0 || x > x1) { border++; if (value < 48) borderDark++; }
      }
      const area = box.w * box.h;
      if (dark / area < .60 || bright / area < .045 || bright / area > .4 || borderDark / border < .83) continue;
      const score = group.length + borderDark / border * 3 - y0 / H * 10;
      if (!best || score > best.score) best = { ...box, score };
    }
  }
  if (!best) return null;
  const even = n => Math.floor(n / 2) * 2;
  const x = even(best.x / W * outW), y = even(best.y / H * outH);
  const right = Math.min(even(outW), Math.ceil((best.x + best.w) / W * outW / 2) * 2);
  const lower = Math.min(even(outH), Math.ceil((best.y + best.h) / H * outH / 2) * 2);
  const rect = { x, y, w: right - x, h: lower - y };
  return rect.w >= rect.h * 3 && rect.h <= outH * .1 && rect.w >= 20 && rect.h >= 4 ? rect : null;
}
