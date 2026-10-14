// Is a correctly recognised character written neatly enough to pass? The pupil's
// strokes are matched one to one with the standard stroke medians (hanzi-writer
// data, the file 看筆順 already loads), then one affine map is fitted from the
// pupil's points to the standard ones, so a slanted or squashed but tidy character
// is fine. What the map cannot explain is the mess: the mean distance in
// character-box units (residual). Calibrated on 2026-10-14 against the teacher's
// scores (pass at 60/100) for 32 characters at 0.04–0.12 (C:/tmp/r2/stroke-check/round2):
// passed 32/32 at 0.05, 27/32 at 0.06, 11/32 at 0.07, 5/32 at 0.08, none from 0.10.
// Two or more missing or extra strokes also fail; a single one is allowed, since
// the matcher misreads one stroke in about one in sixteen tidy characters.
export const NEATNESS = Object.freeze({fail: 0.07, hint: 0.06, structural: 2, match: 0.22, cover: 0.09});

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function resample(poly, n = 16) {
  if (poly.length === 1) return Array(n).fill(poly[0]);
  const seg = [];let total = 0;
  for (let i = 1; i < poly.length; i++) {const l = dist(poly[i - 1], poly[i]);seg.push(l);total += l;}
  if (total === 0) return Array(n).fill(poly[0]);
  const out = [];let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const t = total * k / (n - 1);
    while (i < seg.length - 1 && acc + seg[i] < t) {acc += seg[i];i++;}
    const f = seg[i] ? Math.min(1, (t - acc) / seg[i]) : 0;
    out.push([poly[i][0] + (poly[i + 1][0] - poly[i][0]) * f, poly[i][1] + (poly[i + 1][1] - poly[i][1]) * f]);
  }
  return out;
}
// Bounding box into [0,1]², with a floor so thin characters do not blow up along their thin side.
function normalise(strokes) {
  const pts = strokes.flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const m = Math.max(x1 - x0, y1 - y0) || 1, w = Math.max(x1 - x0, 0.45 * m), h = Math.max(y1 - y0, 0.45 * m);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return strokes.map(s => s.map(p => [(p[0] - cx) / w + 0.5, (p[1] - cy) / h + 0.5]));
}
// Mean point distance, either direction (a stroke written backwards costs a little more).
function strokeCost(p, s) {
  const a = resample(p), b = resample(s), r = [...a].reverse();
  const f = a.reduce((t, q, i) => t + dist(q, b[i]), 0) / a.length;
  const g = r.reduce((t, q, i) => t + dist(q, b[i]), 0) / a.length;
  return f <= g + 0.04 ? {cost: f, reversed: false} : {cost: g + 0.04, reversed: true};
}
const meanDistTo = (pts, poly) => {const q = resample(poly, 32);return resample(pts, 12).reduce((t, p) => t + Math.min(...q.map(x => dist(p, x))), 0) / 12;};

// Hungarian algorithm (square matrix, minimise): row i -> column.
function hungarian(c) {
  const n = c.length, u = Array(n + 1).fill(0), v = Array(n + 1).fill(0), p = Array(n + 1).fill(0), way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;let j0 = 0;const minv = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
    do {
      used[j0] = true;const i0 = p[j0];let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = c[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {minv[j] = cur;way[j] = j0;}
        if (minv[j] < delta) {delta = minv[j];j1 = j;}
      }
      for (let j = 0; j <= n; j++) if (used[j]) {u[p[j]] += delta;v[j] -= delta;} else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {const j1 = way[j0];p[j0] = p[j1];j0 = j1;} while (j0);
  }
  const row = Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) row[p[j] - 1] = j - 1;
  return row;
}

// Missing and extra strokes, allowing one stroke written in two pieces and
// two or three consecutive strokes written in one go.
function matchStrokes(P, S, o) {
  const n = Math.max(P.length, S.length), info = [];
  const cost = Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => {
    if (i >= P.length || j >= S.length) return 10;
    const c = strokeCost(P[i], S[j]);info[i * n + j] = c;return c.cost;
  }));
  const row = hungarian(cost), pairs = [], leftP = [], leftS = new Set(S.map((_, j) => j));
  for (let i = 0; i < P.length; i++) {
    const j = row[i];
    if (j >= 0 && j < S.length && cost[i][j] <= o.match) {pairs.push({p: i, s: j, reversed: info[i * n + j].reversed});leftS.delete(j);}
    else leftP.push(i);
  }
  let extra = 0, missing = 0;
  for (const i of leftP) {
    const host = pairs.find(q => meanDistTo(P[i], S[q.s]) <= o.cover &&
      Math.min(strokeCost([...P[q.p], ...P[i]], S[q.s]).cost, strokeCost([...P[i], ...P[q.p]], S[q.s]).cost) < cost[q.p][q.s]);
    if (host) continue;
    let joined = false;
    for (let j = 0; j < S.length && !joined; j++) for (const k of [2, 3]) {
      if (j + k > S.length) continue;
      const ids = Array.from({length: k}, (_, t) => j + t);
      if (!ids.every(t => leftS.has(t))) continue;
      if (strokeCost(P[i], ids.flatMap(t => S[t])).cost <= o.match) {ids.forEach(t => leftS.delete(t));joined = true;break;}
    }
    if (!joined) extra++;
  }
  for (const j of [...leftS]) {
    const host = pairs.find(q => meanDistTo(S[j], P[q.p]) <= o.cover &&
      strokeCost(P[q.p], j < q.s ? [...S[j], ...S[q.s]] : [...S[q.s], ...S[j]]).cost < cost[q.p][q.s]);
    if (!host) missing++;
  }
  return {pairs, missing, extra};
}

function solve3(A, b) { // 3x3 linear system, Cramer's rule
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);if (Math.abs(D) < 1e-12) return null;
  return [0, 1, 2].map(c => det(A.map((r, i) => r.map((v, j) => j === c ? b[i] : v))) / D);
}

// pupil: strokes of [x, y] points, y down (canvas); medians: hanzi-writer data (y up).
// {pass, hint, residual, missing, extra}, or null when there is nothing to judge
// (no data, or too few strokes matched to fit the map): the caller then lets it pass.
export function judgeNeatness(pupil, medians, o = NEATNESS) {
  pupil = Array.isArray(pupil) ? pupil.filter(s => Array.isArray(s) && s.length) : [];
  if (!pupil.length || !Array.isArray(medians) || !medians.length) return null;
  const P = normalise(pupil.map(s => s.map(([x, y]) => [x, -y]))), S = normalise(medians);
  const {pairs, missing, extra} = matchStrokes(P, S, o), src = [], dst = [];
  for (const q of pairs) {
    const a = resample(q.reversed ? [...P[q.p]].reverse() : P[q.p], 16), b = resample(S[q.s], 16);
    a.forEach((p, i) => {src.push(p);dst.push(b[i]);});
  }
  const structural = missing >= o.structural || extra >= o.structural;
  let residual = null;
  if (src.length >= 3) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    src.forEach(([x, y], i) => {const v = [x, y, 1];for (let j = 0; j < 3; j++) {for (let k = 0; k < 3; k++) M[j][k] += v[j] * v[k];bx[j] += v[j] * dst[i][0];by[j] += v[j] * dst[i][1];}});
    const ax = solve3(M, bx), ay = solve3(M, by);
    if (ax && ay) {
      const d = src.map(([x, y], i) => Math.hypot(ax[0] * x + ax[1] * y + ax[2] - dst[i][0], ay[0] * x + ay[1] * y + ay[2] - dst[i][1]));
      residual = Math.sqrt(d.reduce((t, v) => t + v * v, 0) / d.length);
    }
  }
  if (residual === null && !structural) return null;
  const messy = residual !== null && residual >= o.fail;
  return {pass: !messy && !structural, hint: !messy && !structural && residual !== null && residual >= o.hint,
    residual: residual === null ? null : Math.round(residual * 1000) / 1000, missing, extra};
}
