// Copy the original burned-in timestamp from the same decoded frame.
// Do not infer experiment time from playback seconds or OCR the label.
export function timeRegionError(region, meta) {
  if (!region) return '请先选择原时间；不需要时取消勾选。';
  const {x,y,w,h} = region;
  if (![x,y,w,h].every(Number.isInteger) || x < 0 || y < 0 || w < 2 || h < 2 ||
      (meta && (x+w > meta.width || y+h > meta.height))) return '时间区域超出原视频，请重新选择。';
  // A large scene rectangle must never silently become a timestamp overlay.
  // This is only a shape guard; the user verifies the original pixels in the picker.
  if (w < 3*h || (meta && h > meta.height/4)) return '时间区域应是横向的一小条，请只框时间文字。';
  return '';
}

export function timeOverlayLayout(crop, region, position = 'top-right') {
  const margin = Math.min(8, Math.floor(Math.min(crop.w, crop.h) * .02));
  const scale = Math.min(1, (crop.w - 2 * margin) / region.w, (crop.h - 2 * margin) / region.h);
  const w = Math.max(1, Math.floor(region.w * scale));
  const h = Math.max(1, Math.floor(region.h * scale));
  return { x: position === 'top-left' ? margin : crop.w - margin - w, y: margin, w, h };
}

export function videoFilterArgs(crop, timestamp, scaleBar = null) {
  const cropFilter = c => `crop=${c.w}:${c.h}:${c.x}:${c.y}:exact=1`;
  if (scaleBar) {
    const previous = videoFilterArgs(crop,timestamp);
    const graph = timestamp?.enabled ? previous[1] : `[0:v:0]${cropFilter(crop)},setsar=1[withtime]`;
    return ['-filter_complex', graph + `;[1:v:0]format=rgba[bar];[withtime][bar]overlay=${scaleBar.x}:${scaleBar.y}:format=rgb:eof_action=repeat:repeatlast=1[withscale]`, '-map','[withscale]'];
  }
  if (!timestamp?.enabled) return ['-map', '0:v:0', '-vf', `${cropFilter(crop)},setsar=1`];
  const r = timestamp.region;
  const error = timeRegionError(r, timestamp.meta);
  if (error) throw new Error(error);
  const p = timeOverlayLayout(crop, r, timestamp.position);
  const resize = p.w === r.w && p.h === r.h ? '' : `,scale=${p.w}:${p.h}:flags=neighbor`;
  // One input + split keeps both branches frame-aligned, including trimmed clips.
  // RGB overlay avoids chroma subsampling before lossless FFV1 output.
  const graph = `[0:v:0]split=2[scene][clock];[scene]${cropFilter(crop)},format=rgb24[base];` +
    `[clock]${cropFilter(r)}${resize},format=rgb24[stamp];` +
    `[base][stamp]overlay=${p.x}:${p.y}:format=rgb:shortest=1,setsar=1[withtime]`;
  return ['-filter_complex', graph, '-map', '[withtime]'];
}
