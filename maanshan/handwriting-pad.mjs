const WRITING_SIZE = 560;
const INK = '#233d32';

/**
 * Incremental local ink; recognition keeps the original 560 x 560 samples.
 * getStrokes()/finish() return independent arrays of { x, y, t } points.
 */
export function createHandwritingPad(canvas, { isLocked = () => false, onChange = () => {} } = {}) {
  const view = canvas.ownerDocument.defaultView;
  // Browsers that support it can present ink without waiting for the page's
  // normal compositor cycle. Others use the same standard 2D canvas path.
  const context = canvas.getContext('2d', { desynchronized: true });
  const inkCanvas = canvas.ownerDocument.createElement('canvas');
  const inkContext = inkCanvas.getContext('2d');
  if (!context || !inkContext) throw new Error('Canvas drawing is unavailable.');

  const completed = [];
  const listeners = [];
  const previousTouchAction = canvas.style.touchAction;
  const previousUserSelect = canvas.style.userSelect;
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';

  let active = null;
  let rectangle = null;
  let destroyed = false;
  const timeOrigin = Date.now() - view.performance.now();

  function getStrokes() {
    const all = active ? [...completed, active] : completed;
    return all.map(stroke => stroke.points.map(point => ({ ...point })));
  }

  function notifyChange() {
    onChange(getStrokes());
  }

  function widthFor(stroke) {
    const nib = stroke.pointerType === 'pen' ? 2.8 : stroke.pointerType === 'touch' ? 3.6 : 3.2;
    return nib * WRITING_SIZE / Math.max(1, rectangle.width);
  }

  function prepare(target, stroke) {
    target.save();
    target.setTransform(canvas.width / WRITING_SIZE, 0, 0, canvas.height / WRITING_SIZE, 0, 0);
    target.strokeStyle = INK;
    target.fillStyle = INK;
    target.lineWidth = widthFor(stroke);
    target.lineCap = 'round';
    target.lineJoin = 'round';
    target.beginPath();
  }

  function dot(target, stroke) {
    const point = stroke.points[0];
    prepare(target, stroke);
    target.arc(point.x, point.y, widthFor(stroke) / 2, 0, Math.PI * 2);
    target.fill();
    target.restore();
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function curve(target, points, index) {
    const previous = points[index - 1], current = points[index], next = points[index + 1];
    const end = midpoint(current, next);
    const incomingX = current.x - previous.x, incomingY = current.y - previous.y;
    const outgoingX = next.x - current.x, outgoingY = next.y - current.y;
    const lengths = Math.hypot(incomingX, incomingY) * Math.hypot(outgoingX, outgoingY);
    // Keep deliberate folds/hooks when the direction changes sharply, while
    // smoothing ordinary finger movement between the real samples.
    if (lengths && (incomingX * outgoingX + incomingY * outgoingY) / lengths < 0.25) {
      target.lineTo(current.x, current.y);
      target.lineTo(end.x, end.y);
    } else {
      target.quadraticCurveTo(current.x, current.y, end.x, end.y);
    }
    return end;
  }

  function wholeStroke(target, stroke) {
    if (!stroke.points.length) return;
    dot(target, stroke);
    if (stroke.points.length === 1) return;
    prepare(target, stroke);
    target.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let index = 1; index < stroke.points.length - 1; index += 1) curve(target, stroke.points, index);
    const last = stroke.points[stroke.points.length - 1];
    target.lineTo(last.x, last.y);
    target.stroke();
    target.restore();
  }

  function restoreTip() {
    if (!active?.tipBounds) return;
    const { x, y, width, height } = active.tipBounds;
    // Only the provisional half-segment under the fingertip can change.
    // Completed ink, including the current stroke, stays in the backing bitmap.
    context.clearRect(x, y, width, height);
    context.drawImage(inkCanvas, x, y, width, height, x, y, width, height);
    active.tipBounds = null;
  }

  function tipBounds(from, to, stroke) {
    const scaleX = canvas.width / WRITING_SIZE, scaleY = canvas.height / WRITING_SIZE;
    const padding = widthFor(stroke) / 2 + 2 * WRITING_SIZE / rectangle.width;
    const x = Math.max(0, Math.floor((Math.min(from.x, to.x) - padding) * scaleX));
    const y = Math.max(0, Math.floor((Math.min(from.y, to.y) - padding) * scaleY));
    const right = Math.min(canvas.width, Math.ceil((Math.max(from.x, to.x) + padding) * scaleX));
    const bottom = Math.min(canvas.height, Math.ceil((Math.max(from.y, to.y) + padding) * scaleY));
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }

  function renderActive(final = false) {
    if (!active?.points.length || destroyed) return;
    const stroke = active, points = stroke.points;
    restoreTip();
    if (!stroke.anchor) {
      dot(inkContext, stroke);
      dot(context, stroke);
      stroke.anchor = points[0];
      stroke.drawnThrough = 0;
    }
    const lastCurve = points.length - 2;
    if (lastCurve > stroke.drawnThrough) {
      let end = stroke.anchor;
      for (const target of [inkContext, context]) {
        prepare(target, stroke);
        target.moveTo(stroke.anchor.x, stroke.anchor.y);
        for (let index = stroke.drawnThrough + 1; index <= lastCurve; index += 1) end = curve(target, points, index);
        target.stroke();
        target.restore();
      }
      stroke.anchor = end;
      stroke.drawnThrough = lastCurve;
    }
    if (points.length > 1) {
      const tip = points[points.length - 1];
      for (const target of final ? [inkContext, context] : [context]) {
        prepare(target, stroke);
        target.moveTo(stroke.anchor.x, stroke.anchor.y);
        target.lineTo(tip.x, tip.y);
        target.stroke();
        target.restore();
      }
      if (!final) stroke.tipBounds = tipBounds(stroke.anchor, tip, stroke);
    }
  }

  function rebuild() {
    inkContext.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    completed.forEach(stroke => wholeStroke(inkContext, stroke));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(inkCanvas, 0, 0);
    if (active) {
      active.anchor = null;
      active.tipBounds = null;
      renderActive();
    }
  }

  function resize() {
    if (destroyed) return;
    rectangle = canvas.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return;
    const ratio = Math.min(3, Math.max(1, view.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rectangle.width * ratio));
    const height = Math.max(1, Math.round(rectangle.height * ratio));
    if (canvas.width !== width || canvas.height !== height || inkCanvas.width !== width || inkCanvas.height !== height) {
      canvas.width = inkCanvas.width = width;
      canvas.height = inkCanvas.height = height;
      // Layout changes, clear and undo are the only full redraws.
      rebuild();
    }
  }

  function appendPoint(event, rawDuplicateCutoff) {
    if (!active || !rectangle || rectangle.width <= 0 || rectangle.height <= 0) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const eventTime = Number.isFinite(event.timeStamp) ? event.timeStamp : view.performance.now();
    // A browser may reduce timestamp precision. Equal times can still carry
    // different genuine coordinates, so deduplicate those samples by position.
    if (rawDuplicateCutoff !== undefined) {
      if (eventTime < rawDuplicateCutoff) return;
      if (eventTime === rawDuplicateCutoff) {
        const key = `${event.clientX}:${event.clientY}`;
        if (active.rawPointKeys?.has(key)) return;
        active.rawPointKeys?.add(key);
      }
    }
    const x = Math.max(0, Math.min(WRITING_SIZE, (event.clientX - rectangle.left) * WRITING_SIZE / rectangle.width));
    const y = Math.max(0, Math.min(WRITING_SIZE, (event.clientY - rectangle.top) * WRITING_SIZE / rectangle.height));
    const previous = active.points[active.points.length - 1];
    if (previous && previous.x === x && previous.y === y) return;
    const t = Math.max(previous?.t || 0, Math.round(eventTime > 1e12 ? eventTime : timeOrigin + eventTime));
    active.points.push({ x, y, t });
  }

  function appendEvent(event) {
    const isRaw = event.type === 'pointerrawupdate';
    const cutoff = isRaw || event.type === 'pointermove' ? active.lastRawTime : undefined;
    let samples = [];
    try { samples = event.getCoalescedEvents?.() || []; } catch { /* Optional browser API. */ }
    samples.forEach(sample => appendPoint(sample, cutoff));
    appendPoint(event, cutoff);
    if (isRaw && Number.isFinite(event.timeStamp)) {
      if (active.lastRawTime !== event.timeStamp) active.rawPointKeys = new Set();
      active.lastRawTime = event.timeStamp;
      for (const sample of [...samples, event]) {
        if (sample.timeStamp === event.timeStamp && Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY)) {
          active.rawPointKeys.add(`${sample.clientX}:${sample.clientY}`);
        }
      }
    }
  }

  function releasePointer(pointerId) {
    try {
      if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch { /* Capture may already be released by the browser. */ }
  }

  function commitActive(notify = true) {
    if (!active) return;
    renderActive(true);
    const stroke = active;
    active = null;
    if (stroke.points.length) completed.push(stroke);
    releasePointer(stroke.pointerId);
    if (notify) notifyChange();
  }

  function pointerDown(event) {
    if (destroyed || isLocked() || active || event.button > 0 || event.isPrimary === false) return;
    resize();
    if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0) return;
    event.preventDefault();
    active = { points: [], pointerId: event.pointerId, pointerType: event.pointerType, anchor: null, tipBounds: null };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Window listeners retain uncaptured strokes. */ }
    appendPoint(event);
    renderActive();
    notifyChange();
  }

  function pointerMove(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    if (event.cancelable && event.type !== 'pointerrawupdate') event.preventDefault();
    if (isLocked()) {
      commitActive();
      return;
    }
    const before = active.points.length;
    appendEvent(event);
    // Draw in this input task: never wait for a requested animation frame and
    // never replay the start of a long stroke to put its new tip on screen.
    if (active.points.length !== before) renderActive();
  }

  function pointerUp(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    appendEvent(event);
    commitActive();
  }

  function pointerCancelled(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    // Cancellation coordinates can be zero; keep the last genuine sample.
    commitActive();
  }

  function addListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
  }

  addListener(canvas, 'pointerdown', pointerDown, { passive: false });
  if ('onpointerrawupdate' in view) addListener(view, 'pointerrawupdate', pointerMove, { passive: true });
  addListener(view, 'pointermove', pointerMove, { passive: false });
  addListener(view, 'pointerup', pointerUp, { passive: false });
  addListener(view, 'pointercancel', pointerCancelled);
  addListener(canvas, 'lostpointercapture', pointerCancelled);
  addListener(view, 'blur', () => commitActive());
  addListener(view, 'resize', resize);
  addListener(view, 'scroll', () => { if (active) resize(); }, true);
  const observer = view.ResizeObserver ? new view.ResizeObserver(resize) : null;
  observer?.observe(canvas);
  resize();

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
      rebuild();
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
      rebuild();
      notifyChange();
      return true;
    },
    destroy() {
      if (destroyed) return;
      commitActive(false);
      destroyed = true;
      observer?.disconnect();
      listeners.forEach(remove => remove());
      canvas.style.touchAction = previousTouchAction;
      canvas.style.userSelect = previousUserSelect;
    }
  };
}
