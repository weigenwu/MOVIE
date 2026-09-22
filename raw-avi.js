// Fast path for uncompressed, silent 24-bit RGB AVI; other formats use FFmpeg.
// https://learn.microsoft.com/en-us/windows/win32/directshow/avi-riff-file-reference
const fourcc = (view, offset = 0) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
export async function openRawAVI(file, meta) {
  if (meta.codec !== 'rawvideo' || meta.audio) return null;
  try {
    const read = async (start, size) => new DataView(await file.slice(start, start + size).arrayBuffer());
    const root = await read(0, 12);
    if (fourcc(root) !== 'RIFF' || fourcc(root, 8) !== 'AVI ') return null;
    const end = root.getUint32(4, true) + 8;
    if (end > file.size) return null;
    let bitmap, stream = 0, videoStream = -1, movie;
    for (let pos = 12; pos + 12 <= end;) {
      const chunk = await read(pos, 12), size = chunk.getUint32(4, true), next = pos + 8 + size;
      if (next > end) return null;
      if (fourcc(chunk) === 'LIST' && fourcc(chunk, 8) === 'hdrl' && size < 1024 * 1024) {
        const header = await read(pos + 12, size - 4);
        for (let p = 0; p + 12 <= header.byteLength;) {
          const length = header.getUint32(p + 4, true), limit = p + 8 + length;
          if (limit > header.byteLength) return null;
          if (fourcc(header, p) === 'LIST' && fourcc(header, p + 8) === 'strl') {
            let isVideo = false;
            for (let q = p + 12; q + 8 <= limit;) {
              const n = header.getUint32(q + 4, true);
              if (q + 8 + n > limit) return null;
              if (fourcc(header, q) === 'strh' && n >= 4) isVideo = fourcc(header, q + 8) === 'vids';
              if (fourcc(header, q) === 'strf' && isVideo && !bitmap && n >= 40) {
                bitmap = new DataView(header.buffer.slice(q + 8, q + 48)); videoStream = stream;
              }
              q += 8 + n + n % 2;
            }
            stream++;
          }
          p = limit + length % 2;
        }
      }
      if (fourcc(chunk) === 'LIST' && fourcc(chunk, 8) === 'movi') movie = [pos + 12, next];
      pos = next + size % 2;
    }
    if (!bitmap || !movie || bitmap.getUint32(0, true) !== 40 || bitmap.getUint32(16, true) !== 0 || bitmap.getUint16(12, true) !== 1) return null;
    const width = bitmap.getInt32(4, true), height = bitmap.getInt32(8, true), bits = bitmap.getUint16(14, true);
    if (width !== meta.width || Math.abs(height) !== meta.height || bits !== 24) return null;
    const frameSize = Math.ceil(width * bits / 32) * 4 * Math.abs(height), frames = [];
    const prefix = String(videoStream).padStart(2, '0');
    let count = 0;
    async function scan(start, limit, depth = 0) {
      if (depth > 2) throw new Error('Unsupported AVI nesting');
      for (let pos = start; pos + 8 <= limit;) {
        if (++count > 100000) throw new Error('AVI index too large');
        const chunk = await read(pos, Math.min(12, limit - pos)), size = chunk.getUint32(4, true), next = pos + 8 + size, tag = fourcc(chunk);
        if (next > limit) throw new Error('Truncated AVI');
        if (tag === prefix + 'db' || tag === prefix + 'dc') {
          if (size !== frameSize) throw new Error('Unsupported frame layout');
          frames.push(pos + 8);
        } else if (tag === 'LIST' && size >= 4 && fourcc(chunk, 8) === 'rec ') await scan(pos + 12, next, depth + 1);
        pos = next + size % 2;
      }
    }
    await scan(...movie);
    if (!frames.length || frames.length !== Math.round(meta.duration * meta.fps)) return null;
    // A BMP file adds just 14 bytes to the AVI's DIB header and frame bytes.
    // Slice references the local file; never copy the entire AVI into memory.
    const bmp = new Uint8Array(54), view = new DataView(bmp.buffer);
    bmp.set([0x42, 0x4d]); view.setUint32(2, 54 + frameSize, true); view.setUint32(10, 54, true);
    bmp.set(new Uint8Array(bitmap.buffer), 14); view.setUint32(34, frameSize, true);
    return { frames: frames.length, frame(index) {
      const offset = frames[Math.min(frames.length - 1, Math.max(0, index))];
      return new Blob([bmp, file.slice(offset, offset + frameSize)], { type:'image/bmp' });
    } };
  } catch { return null; }
}
