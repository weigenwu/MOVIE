// Copy the original burned-in timestamp from the same decoded frame.
// Do not infer experiment time from playback seconds or OCR the label.
const MATTE_BLACK = 8, MATTE_RANGE = 96;

// Mutate only a temporary timestamp patch, never the scientific source frame.
// Tint existing glyph pixels and optionally remove their dark box; never read text.
export function applyTimeMatte(imageData, { color = 'white', transparent = true } = {}) {
  if (!imageData?.data || imageData.data.length % 4) throw new Error('时间图像无效');
  if (!['white','red'].includes(color)) throw new Error('时间颜色无效');
  if (!transparent && color !== 'red') return imageData;
  const data = imageData.data;
  for (let p = 0; p < data.length; p += 4) {
    const luminance = (77 * data[p] + 150 * data[p+1] + 29 * data[p+2]) / 256;
    const alpha = Math.floor(Math.min(255, Math.max(0, (luminance - MATTE_BLACK) * 255 / MATTE_RANGE)));
    data[p] = transparent ? 255 : alpha;
    data[p+1] = data[p+2] = color === 'red' ? 0 : 255;
    data[p+3] = transparent ? alpha : 255;
  }
  return imageData;
}

export function timeRegionError(region, meta) {
  if (!region) return '尚未定位右上角时间，请换一帧后点“重新识别”；无时间的视频可取消勾选。';
  const {x,y,w,h} = region;
  if (![x,y,w,h].every(Number.isInteger) || x < 0 || y < 0 || w < 2 || h < 2 ||
      (meta && (x+w > meta.width || y+h > meta.height))) return '时间区域无效，请重新识别。';
  // A large scene rectangle must never silently become a timestamp overlay.
  // The detector must supply a compact strip; source pixels remain visible in preview.
  if (w < 3*h || (meta && h > meta.height/4)) return '定位结果不是时间条，请重新识别。';
  return '';
}

export function originalTimeVisible(crop, region) {
  return Boolean(crop && region && [crop.x,crop.y,crop.w,crop.h,region.x,region.y,region.w,region.h].every(Number.isInteger) &&
    crop.w > 0 && crop.h > 0 && region.w > 0 && region.h > 0 && region.x >= crop.x && region.y >= crop.y &&
    region.x + region.w <= crop.x + crop.w && region.y + region.h <= crop.y + crop.h);
}

export function timeOverlayLayout(crop, region, position = 'top-right', widthPercent = 40) {
  if (!Number.isFinite(widthPercent) || widthPercent < 15 || widthPercent > 90) throw new Error('时间宽度应为画面宽度的 15%–90%');
  if (!crop || ![crop.w,crop.h].every(n => Number.isInteger(n) && n > 0) || !['top-left','top-right'].includes(position)) throw new Error('时间位置或裁剪尺寸无效');
  const error = timeRegionError(region); if (error) throw new Error(error);
  // A burned-in label cannot be removed cleanly from the scene. If it survives
  // the crop, copy in place for either requested corner and keep its native size.
  if (originalTimeVisible(crop, region)) {
    return { x:region.x-crop.x, y:region.y-crop.y, w:region.w, h:region.h };
  }
  const margin = Math.min(8, Math.floor(Math.min(crop.w, crop.h) * .02));
  const availableWidth = crop.w - 2 * margin, availableHeight = crop.h - 2 * margin;
  const scale = Math.min(crop.w * widthPercent / 100 / region.w, availableWidth / region.w, availableHeight / region.h);
  const w = Math.max(1, Math.min(availableWidth, Math.round(region.w * scale)));
  const h = Math.max(1, Math.min(availableHeight, Math.round(region.h * scale)));
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
  const p = timeOverlayLayout(crop, r, timestamp.position, timestamp.widthPercent);
  const resize = p.w === r.w && p.h === r.h ? '' : `,scale=${p.w}:${p.h}:flags=lanczos`;
  // An already visible burned-in label is part of the scene. Keep it intact;
  // removing its black box would require inventing the hidden source pixels.
  const transparent = timestamp.transparent === true, color = timestamp.color ?? 'white';
  if (!['white','red'].includes(color)) throw new Error('时间颜色无效');
  const recolor = (transparent || color === 'red') && !originalTimeVisible(crop, r);
  const alpha = `floor(clip(((77*r(X,Y)+150*g(X,Y)+29*b(X,Y))/256-${MATTE_BLACK})*255/${MATTE_RANGE},0,255))`;
  const matte = recolor ? `,format=rgba,geq=r=${transparent?255:`'${alpha}'`}:g=${color==='red'?0:255}:b=${color==='red'?0:255}:a=${transparent?`'${alpha}'`:255}:interpolation=nearest` : '';
  // One input + split keeps both branches frame-aligned, including trimmed clips.
  // RGB overlay avoids chroma subsampling before lossless FFV1 output.
  const graph = `[0:v:0]split=2[scene][clock];[scene]${cropFilter(crop)},format=rgb24[base];` +
    `[clock]${cropFilter(r)}${matte}${resize},format=${recolor?'rgba':'rgb24'}[stamp];` +
    `[base][stamp]overlay=${p.x}:${p.y}:format=rgb:shortest=1,setsar=1[withtime]`;
  return ['-filter_complex', graph, '-map', '[withtime]'];
}
