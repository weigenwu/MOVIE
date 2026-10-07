// Calibration is in original-video pixels. Cropping never changes its value.
// The same pixel-sized patch is drawn for preview and encoded into the export.
const positions = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
const units = new Set(['µm', 'nm', 'mm', 'px']);

function positiveNumber(value, message) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !value.trim())) throw new Error(message);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(message);
  return number;
}

export function calibrationFromReference(pixelLength, realLength) {
  const pixels = positiveNumber(pixelLength, '请测量原标尺的像素长度');
  const real = positiveNumber(realLength, '请输入原标尺代表的长度');
  const result = real / pixels;
  if (!Number.isFinite(result) || result <= 0) throw new Error('标定数值超出范围');
  return result;
}

export function scaleBarLayout(crop, settings) {
  if (!settings?.enabled) return null;
  if (!crop || !Number.isSafeInteger(crop.w) || !Number.isSafeInteger(crop.h) || crop.w < 2 || crop.h < 2) {
    throw new Error('裁剪区域太小，无法放置标尺');
  }
  const unit = settings.unit;
  if (!units.has(unit)) throw new Error('请选择有效的标尺单位');
  const length = positiveNumber(settings.length, '请输入有效的标尺长度');
  const unitsPerPixel = unit === 'px' ? 1 : positiveNumber(settings.unitsPerPixel, '请先设置每像素代表的实际长度');
  // Round once from the original numbers to the nearest source pixel. Raster
  // quantization is at most half a pixel; never use the display label as input.
  const barWidth = Math.round(length / unitsPerPixel);
  if (!Number.isSafeInteger(barWidth)) throw new Error('标尺长度超出范围');
  if (barWidth < 2) throw new Error('标尺不足 2 像素，请增大长度');
  const position = settings.position ?? 'bottom-left';
  if (!positions.has(position)) throw new Error('请选择有效的标尺位置');

  const size = Math.min(crop.w, crop.h);
  const margin = Math.min(8, Math.max(2, Math.floor(size * .02)));
  const padding = 4;
  const fontSize = Math.min(20, Math.max(10, Math.floor(size / 20)));
  const barHeight = Math.max(2, Math.round(fontSize / 5));
  const gap = 4;
  // Hide floating-point tails from unit conversion without altering geometry.
  // Numeric conversion and a fixed unit allowlist keep the label plain text.
  const label = `${Number(length.toPrecision(12))} ${unit}`;
  // Monospace digits are normally ~0.6em; 0.75em reserves room for fallback µ.
  const textWidth = Math.ceil(label.length * fontSize * .75);
  const width = Math.max(barWidth, textWidth) + padding * 2;
  const height = padding * 2 + fontSize + gap + barHeight;
  if (width + margin * 2 > crop.w || height + margin * 2 > crop.h) {
    throw new Error('标尺放不下，请减小标尺长度或扩大裁剪区域');
  }
  return {
    x: position.endsWith('left') ? margin : crop.w - margin - width,
    y: position.startsWith('top') ? margin : crop.h - margin - height,
    width, height,
    barX: Math.floor((width - barWidth) / 2),
    barY: padding + fontSize + gap,
    barWidth, barHeight,
    label, fontSize,
    textX: width / 2,
    textY: padding + fontSize
  };
}

export function drawScaleBar(ctx, layout) {
  if (!layout) return;
  ctx.save();
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = `${layout.fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(layout.label, layout.textX, layout.textY);
  ctx.fillRect(layout.barX, layout.barY, layout.barWidth, layout.barHeight);
  ctx.restore();
}
