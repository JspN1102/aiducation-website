// school74 study design: two within-pupil reading conditions, assigned per line.
// Every pupil meets both arms of each condition in every poem, so nobody gets less
// of the platform; the split is fixed per account and line, the same on every device.
//   先讀後聽 (attempt-first): on half the lines 聽示範 waits until the pupil has read
//     the line once that day (Hong Kong day, from 06:00 like the chat quota).
//   拼音漸隱 (pinyin fading): a line read well (>=80) on an earlier day starts with the
//     pinyin hidden on half the lines; 顯示拼音 still brings it back at once.
export const STUDY_DESIGN = Object.freeze({attemptFirst: true, pinyinFade: true});
export const FADE_SCORE = 80;

// FNV-1a; deterministic and the same in every browser.
function hash(text) {
  let h = 0x811c9dc5;
  for (const char of String(text)) {h ^= char.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0;}
  return h;
}
// The lines of one poem in the treated half: exactly floor(n/2) (odd n: the extra line stays open),
// chosen by sorting the lines on a per-pupil hash.
export function treatedLines(userId, poemId, lineCount, salt) {
  const order = Array.from({length: lineCount}, (_, index) => index)
    .sort((a, b) => hash(userId + '|' + poemId + '|' + a + '|' + salt) - hash(userId + '|' + poemId + '|' + b + '|' + salt) || a - b);
  return new Set(order.slice(0, Math.floor(lineCount / 2)));
}
// The study day changes at 06:00 Hong Kong time, as the chat quota does.
export function studyDay(now = Date.now()) {
  return new Date(now + (8 - 6) * 3600000).toISOString().slice(0, 10);
}
function lineLog(state) {
  const log = state.study && typeof state.study === 'object' && !Array.isArray(state.study) ? state.study : (state.study = {});
  for (const key of ['tried', 'good']) if (!log[key] || typeof log[key] !== 'object' || Array.isArray(log[key])) log[key] = {};
  return log;
}
// Called when a recording of the line is long enough to count (the self-check rule: >=1.5 s).
export function noteAttempt(state, lineIndex, now = Date.now()) {
  lineLog(state).tried[lineIndex] = studyDay(now);
}
// Called with each score; the first day the line reached FADE_SCORE is kept.
export function noteScore(state, lineIndex, score, now = Date.now()) {
  const log = lineLog(state);
  if (Number(score) >= FADE_SCORE && !/^\d{4}-\d\d-\d\d$/.test(log.good[lineIndex] || '')) log.good[lineIndex] = studyDay(now);
}
// 'attempt-first' | 'open' for analysis, and whether 聽示範 waits right now.
export function demoArm(userId, poem, lineIndex) {
  if (!STUDY_DESIGN.attemptFirst || !userId) return 'open';
  return treatedLines(userId, poem.id, poem.lines.length, 'attempt-first').has(lineIndex) ? 'attempt-first' : 'open';
}
export function demoWaits(state, userId, poem, lineIndex, now = Date.now()) {
  return demoArm(userId, poem, lineIndex) === 'attempt-first' && lineLog(state).tried[lineIndex] !== studyDay(now);
}
// 'faded' | 'kept' once the line is eligible (read well on an earlier day), else 'ineligible'.
export function pinyinArm(state, userId, poem, lineIndex, now = Date.now()) {
  if (!STUDY_DESIGN.pinyinFade || !userId) return 'ineligible';
  const good = lineLog(state).good[lineIndex];
  if (!/^\d{4}-\d\d-\d\d$/.test(good || '') || good >= studyDay(now)) return 'ineligible';
  return treatedLines(userId, poem.id, poem.lines.length, 'pinyin-fade').has(lineIndex) ? 'faded' : 'kept';
}
