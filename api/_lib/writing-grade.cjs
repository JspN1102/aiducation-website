'use strict';
// Server copy of maanshan/writing-grade.mjs so the research record agrees with
// what the pupil saw; server/writing-grade.test.cjs checks both stay identical.
const fs = require('node:fs');
const path = require('node:path');
const LENIENCY = Object.freeze({minTargetStrokes: 8, wholeRatio: 0.75, componentRatio: 0.6, depth: 3});
const FIRST = 0x4E00, LAST = 0x9FFF;
const TABLE = path.join(__dirname, '..', '..', 'maanshan', 'vendor', 'stroke-counts.json');

function gradeCandidates(candidates, accepted, {drawn = 0, strokeOf = null} = {}) {
  const first = candidates[0] || null;
  if (!first) return {correct: false, recognized: null, pending: false};
  if (accepted.has(first)) return {correct: true, recognized: first, pending: false};
  const target = candidates.slice(1, LENIENCY.depth).find(value => accepted.has(value)) || null;
  if (!target || !(drawn >= Math.ceil(LENIENCY.minTargetStrokes * LENIENCY.wholeRatio))) return {correct: false, recognized: first, pending: false};
  if (typeof strokeOf !== 'function') return {correct: false, recognized: first, pending: true};
  const total = strokeOf(target);
  const whole = total >= LENIENCY.minTargetStrokes && drawn >= Math.ceil(total * LENIENCY.wholeRatio);
  const part = Array.from(first).length > 1 || strokeOf(first) > 0 && strokeOf(first) <= total * LENIENCY.componentRatio;
  const correct = whole && part;
  return {correct, recognized: correct ? target : first, pending: false};
}

function strokeReader(table) {
  if (typeof table !== 'string' || table.length !== LAST - FIRST + 1) throw new Error('Stroke counts are unavailable.');
  return value => {
    if (typeof value !== 'string' || Array.from(value).length !== 1) return 0;
    const point = value.codePointAt(0);
    return point < FIRST || point > LAST ? 0 : Math.max(0, table.charCodeAt(point - FIRST) - 33);
  };
}

let reader = null;
// Unknown characters read as 0 strokes, which keeps grading strict.
function strokeCount(value) {
  if (!reader) {
    try { reader = strokeReader(JSON.parse(fs.readFileSync(TABLE, 'utf8'))); }
    catch { reader = () => 0; }
  }
  return reader(value);
}

module.exports = {LENIENCY, gradeCandidates, strokeReader, strokeCount};
