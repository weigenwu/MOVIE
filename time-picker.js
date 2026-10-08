import { timeRegionError } from './time-overlay.js';

// This dialog owns a frozen full-frame snapshot and its own selection. It never edits the scene crop.
export function createTimePicker({ dialog, canvas, preview, error, confirm, cancel }) {
  let closePending;
  return function pick({ source, meta, region }) {
    closePending?.(null);
    return new Promise(resolve => {
      const snapshot = document.createElement('canvas'), ctx = canvas.getContext('2d');
      const listeners = [];
      let candidate = region ? { ...region } : null, drag = null, ready = false, done = false;
      const on = (target, name, fn) => { target.addEventListener(name, fn); listeners.push([target, name, fn]); };
      const finish = result => {
        if (done) return;
        done = true;
        for (const [target, name, fn] of listeners) target.removeEventListener(name, fn);
        drag = null; closePending = null;
        if (dialog.open) dialog.close();
        snapshot.width = snapshot.height = 0;
        resolve(result ? { ...result } : null);
      };
      closePending = finish;
      const paint = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (ready) ctx.drawImage(snapshot, 0, 0);
        const message = ready ? timeRegionError(candidate, meta) : '当前画面尚未准备好，请关闭后重试。';
        confirm.disabled = !ready || Boolean(drag) || Boolean(message);
        error.textContent = message;
        preview.hidden = true;
        if (!ready || !candidate || ![candidate.x, candidate.y, candidate.w, candidate.h].every(Number.isFinite) || candidate.w <= 0 || candidate.h <= 0) return;
        const sx = snapshot.width / meta.width, sy = snapshot.height / meta.height;
        const { x, y, w, h } = candidate;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(snapshot, x * sx, y * sy, w * sx, h * sy, x * sx, y * sy, w * sx, h * sy);
        ctx.strokeStyle = '#ffb454'; ctx.lineWidth = Math.max(2, snapshot.width / 700);
        ctx.strokeRect(x * sx, y * sy, w * sx, h * sy);
        if (message) return;
        preview.width = w; preview.height = h;
        preview.getContext('2d').drawImage(snapshot, x * sx, y * sy, w * sx, h * sy, 0, 0, w, h);
        preview.hidden = false;
      };
      const point = e => {
        const box = canvas.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(meta.width, (e.clientX - box.left) / box.width * meta.width)),
          y: Math.max(0, Math.min(meta.height, (e.clientY - box.top) / box.height * meta.height))
        };
      };
      const update = e => {
        if (!drag || e.pointerId !== drag.id) return;
        if (Math.hypot(e.clientX - drag.clientX, e.clientY - drag.clientY) < 4 && !drag.moved) return;
        drag.moved = true;
        const p = point(e), even = n => Math.floor(n / 2) * 2;
        const x = even(Math.min(p.x, drag.start.x)), y = even(Math.min(p.y, drag.start.y));
        candidate = { x, y, w: even(Math.max(p.x, drag.start.x)) - x, h: even(Math.max(p.y, drag.start.y)) - y };
      };
      on(canvas, 'pointerdown', e => {
        if (!ready || drag || e.button !== 0 || e.isPrimary === false) return;
        e.preventDefault();
        drag = { id: e.pointerId, start: point(e), clientX: e.clientX, clientY: e.clientY, before: candidate ? { ...candidate } : null, moved: false };
        try { canvas.setPointerCapture(e.pointerId); } catch { /* The following cancel event restores the selection. */ }
        paint();
      });
      on(canvas, 'pointermove', e => { if (drag && e.pointerId === drag.id) { update(e); paint(); } });
      on(canvas, 'pointerup', e => {
        if (!drag || e.pointerId !== drag.id) return;
        update(e);
        if (!drag.moved) candidate = drag.before;
        drag = null; paint();
        if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      });
      const restore = e => {
        if (!drag || e.pointerId !== drag.id) return;
        candidate = drag.before; drag = null; paint();
      };
      on(canvas, 'pointercancel', restore);
      on(canvas, 'lostpointercapture', restore);
      on(confirm, 'click', () => { if (ready && !drag && !timeRegionError(candidate, meta)) finish(candidate); });
      on(cancel, 'click', () => finish(null));
      on(dialog, 'cancel', e => { e.preventDefault(); finish(null); });
      // close is queued by native <dialog>; ignore an earlier session's event
      // if this picker has already reopened the same dialog.
      on(dialog, 'close', () => { if (!dialog.open) finish(null); });
      try {
        if (typeof source?.readyState === 'number' && source.readyState < 2) throw new Error('Video frame not decoded');
        if (source?.complete === false) throw new Error('Image frame not decoded');
        const width = source?.videoWidth || source?.naturalWidth || source?.width;
        const height = source?.videoHeight || source?.naturalHeight || source?.height;
        if (!(width > 0 && height > 0 && meta?.width > 0 && meta?.height > 0)) throw new Error('No frame');
        snapshot.width = canvas.width = width; snapshot.height = canvas.height = height;
        snapshot.getContext('2d').drawImage(source, 0, 0, width, height);
        ready = true;
      } catch {
        canvas.width = 640; canvas.height = 360; candidate = null;
      }
      paint();
      try { dialog.showModal(); } catch { finish(null); }
    });
  };
}
