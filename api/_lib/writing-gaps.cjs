'use strict';
// A pupil sometimes writes the parts of a character far apart (竹 well above 離, 雨 above 沾);
// the recogniser then reads only one part (人離, 雨, 原). Standard characters almost never leave
// an empty band wider than 0.12 of their size (p99 0.10–0.11 over 1,900 hanzi-writer characters),
// so wider bands are closed to 0.05 and the result is offered to the recogniser as a second
// reading. Returns null when there is nothing to close: normal writing sends no second request.
// Calibrated 2026-10-14 on synthetic spread-out writing (C:/tmp/r2/agents/hw-recog).
const GAPS = Object.freeze({wide: 0.12, keep: 0.05, size: 440, centre: 280});

function closeGaps(ink, o = GAPS) {
  if (!Array.isArray(ink) || ink.length < 2) return null;
  const strokes = ink.map(([xs, ys, ts]) => [[...xs], [...ys], ts]);
  const low = values => values.reduce((a, b) => Math.min(a, b), Infinity);
  const high = values => values.reduce((a, b) => Math.max(a, b), -Infinity);
  const extent = () => {
    const x0 = low(strokes.map(s => low(s[0]))), x1 = high(strokes.map(s => high(s[0])));
    const y0 = low(strokes.map(s => low(s[1]))), y1 = high(strokes.map(s => high(s[1])));
    return {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0, 1)};
  };
  let closed = 0;
  for (const axis of [1, 0]) { // top/bottom parts first, the usual case
    const {size} = extent(), spans = strokes.map(s => [low(s[axis]), high(s[axis])]).sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let end = spans[0][1];
    for (const [from, to] of spans.slice(1)) {
      if (from - end > o.wide * size) gaps.push([end, from]);
      end = Math.max(end, to);
    }
    // From the far side, so a shift never moves a band still to be closed.
    for (const [from, to] of gaps.reverse()) {
      const shift = to - from - o.keep * size;
      closed++;
      for (const s of strokes) if (low(s[axis]) >= to) s[axis] = s[axis].map(v => v - shift);
    }
  }
  if (!closed) return null;
  const {cx, cy, size} = extent(), k = o.size / size; // re-centre in the 560 writing box
  return strokes.map(([xs, ys, ts]) => [xs.map(x => Math.round(o.centre + (x - cx) * k)), ys.map(y => Math.round(o.centre + (y - cy) * k)), ts]);
}

module.exports = {GAPS, closeGaps};
