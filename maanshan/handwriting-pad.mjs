const WRITING_SIZE = 560;
const INK = '#233d32';

/**
 * Smooth local ink with the same 560 x 560 coordinates used by recognition.
 * getStrokes()/finish() return independent arrays of { x, y, t } points;
 * onChange receives that snapshot at stroke boundaries, clear and undo.
 */
export function createHandwritingPad(canvas, { isLocked = () => false, onChange = () => {} } = {}) {
  const view = canvas.ownerDocument.defaultView;
  const context = canvas.getContext('2d');
  const completedCanvas = canvas.ownerDocument.createElement('canvas');
  const completedContext = completedCanvas.getContext('2d');
  if (!context || !completedContext) throw new Error('Canvas drawing is unavailable.');

  const completed = [];
  const listeners = [];
  const previousTouchAction = canvas.style.touchAction;
  const previousUserSelect = canvas.style.userSelect;
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';

  let active = null;
  let rectangle = null;
  let frame = 0;
  let destroyed = false;
  const timeOrigin = Date.now() - view.performance.now();

  function getStrokes() {
    const all = active ? [...completed, active] : completed;
    return all.map(stroke => stroke.points.map(point => ({ ...point })));
  }

  function notifyChange() {
    onChange(getStrokes());
  }

  function drawStroke(target, stroke) {
    const points = stroke.points;
    if (!points.length) return;
    const first = points[0];
    // Keep the visible nib fine on phones and larger screens alike.
    const nib = stroke.pointerType === 'pen' ? 3.2 : stroke.pointerType === 'touch' ? 4.1 : 3.6;
    const lineWidth = nib * WRITING_SIZE / Math.max(1, rectangle.width);
    target.save();
    target.setTransform(canvas.width / WRITING_SIZE, 0, 0, canvas.height / WRITING_SIZE, 0, 0);
    target.strokeStyle = INK;
    target.fillStyle = INK;
    target.lineWidth = lineWidth;
    target.lineCap = 'round';
    target.lineJoin = 'round';
    target.beginPath();
    if (points.length === 1) {
      target.arc(first.x, first.y, lineWidth / 2, 0, Math.PI * 2);
      target.fill();
    } else {
      target.moveTo(first.x, first.y);
      for (let index = 1; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        target.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
      }
      // The live tip always reaches the latest real sample without a filter delay.
      const last = points[points.length - 1];
      target.lineTo(last.x, last.y);
      target.stroke();
    }
    target.restore();
  }

  function rebuildCompleted() {
    completedContext.clearRect(0, 0, completedCanvas.width, completedCanvas.height);
    completed.forEach(stroke => drawStroke(completedContext, stroke));
  }

  function paint() {
    frame = 0;
    if (destroyed) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(completedCanvas, 0, 0);
    if (active) drawStroke(context, active);
  }

  function paintSoon() {
    if (!frame && !destroyed) frame = view.requestAnimationFrame(paint);
  }

  function paintNow() {
    if (frame) view.cancelAnimationFrame(frame);
    paint();
  }

  function resize() {
    if (destroyed) return;
    rectangle = canvas.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return;
    const ratio = Math.min(3, Math.max(1, view.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rectangle.width * ratio));
    const height = Math.max(1, Math.round(rectangle.height * ratio));
    if (canvas.width !== width || canvas.height !== height || completedCanvas.width !== width || completedCanvas.height !== height) {
      canvas.width = completedCanvas.width = width;
      canvas.height = completedCanvas.height = height;
      rebuildCompleted();
      // Resizing clears a canvas immediately; restore ink in the same turn.
      paintNow();
    }
  }

  function appendPoint(event) {
    if (!active || !rectangle || rectangle.width <= 0 || rectangle.height <= 0) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const x = Math.max(0, Math.min(WRITING_SIZE, (event.clientX - rectangle.left) * WRITING_SIZE / rectangle.width));
    const y = Math.max(0, Math.min(WRITING_SIZE, (event.clientY - rectangle.top) * WRITING_SIZE / rectangle.height));
    const previous = active.points[active.points.length - 1];
    if (previous && previous.x === x && previous.y === y) return;
    const eventTime = Number.isFinite(event.timeStamp) ? event.timeStamp : view.performance.now();
    const t = Math.max(previous?.t || 0, Math.round(eventTime > 1e12 ? eventTime : timeOrigin + eventTime));
    active.points.push({ x, y, t });
  }

  function appendEvent(event) {
    // Safari and older browsers fall back to the dispatched sample.
    let samples = [];
    try { samples = event.getCoalescedEvents?.() || []; } catch { /* Optional browser API. */ }
    samples.forEach(appendPoint);
    appendPoint(event);
  }

  function releasePointer(pointerId) {
    try {
      if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch { /* Capture may already be released by the browser. */ }
  }

  function commitActive(notify = true) {
    if (!active) return;
    const stroke = active;
    active = null;
    if (stroke.points.length) {
      completed.push(stroke);
      drawStroke(completedContext, stroke);
    }
    releasePointer(stroke.pointerId);
    paintNow();
    if (notify) notifyChange();
  }

  function pointerDown(event) {
    if (destroyed || isLocked() || active || event.button > 0 || event.isPrimary === false) return;
    resize();
    if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0) return;
    event.preventDefault();
    active = { points: [], pointerId: event.pointerId, pointerType: event.pointerType };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Window listeners also retain an uncaptured stroke. */ }
    appendPoint(event);
    paintNow();
    notifyChange();
  }

  function pointerMove(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    if (isLocked()) {
      commitActive();
      return;
    }
    appendEvent(event);
    paintSoon();
  }

  function pointerUp(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    appendEvent(event);
    commitActive();
  }

  function pointerCancelled(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    // Cancellation coordinates can be zero; keep the last genuine ink sample.
    commitActive();
  }

  function addListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
  }

  addListener(canvas, 'pointerdown', pointerDown, { passive: false });
  addListener(view, 'pointermove', pointerMove, { passive: false });
  addListener(view, 'pointerup', pointerUp, { passive: false });
  addListener(view, 'pointercancel', pointerCancelled);
  addListener(canvas, 'lostpointercapture', pointerCancelled);
  addListener(view, 'blur', () => commitActive());
  addListener(view, 'resize', resize);
  // Cache layout per gesture, refreshing only when layout actually changes.
  addListener(view, 'scroll', () => { if (active) resize(); }, true);
  const observer = view.ResizeObserver ? new view.ResizeObserver(resize) : null;
  observer?.observe(canvas);
  resize();
  paintNow();

  return {
    getStrokes,
    finish() {
      if (!destroyed) commitActive();
      return getStrokes();
    },
    clear() {
      if (destroyed || isLocked()) return false;
      const pointerId = active?.pointerId;
      active = null;
      completed.length = 0;
      if (pointerId !== undefined) releasePointer(pointerId);
      rebuildCompleted();
      paintNow();
      notifyChange();
      return true;
    },
    undo() {
      if (destroyed || isLocked()) return false;
      if (active) {
        const pointerId = active.pointerId;
        active = null;
        releasePointer(pointerId);
      } else if (completed.length) {
        completed.pop();
      } else {
        return false;
      }
      rebuildCompleted();
      paintNow();
      notifyChange();
      return true;
    },
    destroy() {
      if (destroyed) return;
      commitActive(false);
      destroyed = true;
      if (frame) view.cancelAnimationFrame(frame);
      frame = 0;
      observer?.disconnect();
      listeners.forEach(remove => remove());
      canvas.style.touchAction = previousTouchAction;
      canvas.style.userSelect = previousUserSelect;
    }
  };
}
