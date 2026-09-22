// Grading of handwriting candidates for dictation. The recogniser lists its
// guesses best first; a pupil is right when the first guess is the target.
// Two live quirks are handled here. It sometimes returns nothing for ink it
// reads correctly a moment later (the caller retries once). And a component
// that is itself a character can outrank the whole character it belongs to
// (雨 listed above 霑): a lower-ranked target then counts only when enough
// strokes were drawn for the whole character and the first guess is small
// enough to be one of its parts, so a different full-size character (借 for
// 惜) still fails. The same rule lives in api/_lib/writing-grade.cjs.
export const LENIENCY = Object.freeze({minTargetStrokes: 8, wholeRatio: 0.75, componentRatio: 0.6, depth: 3});
const FIRST = 0x4E00, LAST = 0x9FFF;

export function gradeCandidates(candidates, accepted, {drawn = 0, strokeOf = null} = {}) {
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

export function strokeReader(table) {
  if (typeof table !== 'string' || table.length !== LAST - FIRST + 1) throw new Error('Stroke counts are unavailable.');
  return value => {
    if (typeof value !== 'string' || Array.from(value).length !== 1) return 0;
    const point = value.codePointAt(0);
    return point < FIRST || point > LAST ? 0 : Math.max(0, table.charCodeAt(point - FIRST) - 33);
  };
}

let table = null;
// Unihan total stroke counts (see scripts/build-stroke-counts.py), fetched
// only when a lower-ranked target might count.
export function loadStrokeCounts(view = globalThis) {
  table ||= (async () => {
    const controller = new view.AbortController(), timer = view.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await view.fetch(new URL('./vendor/stroke-counts.json', import.meta.url), {signal: controller.signal});
      if (!response.ok) throw new Error('Stroke counts are unavailable.');
      return strokeReader(await response.json());
    } finally {view.clearTimeout(timer);}
  })().catch(error => {table = null;throw error;});
  return table;
}
