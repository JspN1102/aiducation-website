import {CHALLENGE_VERSION} from './challenge-data.mjs?v=20260921-school7';

const TOTAL = 5;
const LEGACY_PLAN = ['sound', 'dictation', 'sound', 'dictation', 'other'];
const group = item => ['sound', 'dictation'].includes(item.type) ? item.type : 'other';
const bankOf = set => set.bank || set.items;
export const CHALLENGE_SCHEDULE = 'game-first-20260919';
// Existing saved rounds keep their original order. Only new, untouched rounds
// use the game-first route; never reinterpret old answers against a new plan.
const previousPlan = (set, variant = 'hands', mode = 'standard') => set.grade >= 4 && mode === 'advanced'
  ? ['sound', 'dictation', 'sound', 'dictation', 'dictation'] : set.grade <= 3
  ? variant === 'hands' ? ['sound', 'sound', 'sound', 'sound', 'other'] : ['sound', 'sound', 'dictation', 'sound', 'sound']
  : set.grade === 4 ? variant === 'hands' ? ['sound', 'sound', 'dictation', 'sound', 'other'] : ['sound', 'dictation', 'sound', 'dictation', 'sound']
  : variant === 'hands' ? LEGACY_PLAN : ['sound', 'dictation', 'sound', 'dictation', 'dictation'];

export const challengePlan = (set, _variant = 'hands', mode = 'standard') => set.grade <= 3
  ? ['other', 'sound', 'sound', 'sound', 'sound']
  : mode === 'advanced' ? ['other', 'dictation', 'sound', 'dictation', 'dictation']
  : set.grade === 4 ? ['other', 'sound', 'dictation', 'sound', 'sound']
  : ['other', 'sound', 'dictation', 'sound', 'dictation'];

export function shuffled(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) state = Math.imul(state ^ char.codePointAt(0), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function attemptItems(attempt, set) {
  const ids = attempt?.itemIds || set.items.map(item => item.id);
  const bank = bankOf(set);
  return ids.map(id => bank.find(item => item.id === id)).filter(Boolean);
}

function validHistory(value, bank, type) {
  return [...new Set(Array.isArray(value) ? value.filter(id => bank.some(item => item.id === id && group(item) === type)) : [])];
}

// Game drafts must stay small, serializable and inert. A damaged game draft is
// discarded independently of the child's existing assessment answers.
export function safeGameState(value) {
  let nodes = 0;
  function copy(part, depth = 0) {
    if (++nodes > 5000 || depth > 10) throw new Error('game-state-size');
    if (part === null || typeof part === 'boolean') return part;
    if (typeof part === 'number' && Number.isFinite(part)) return part;
    if (typeof part === 'string' && part.length <= 4096) return part;
    if (Array.isArray(part) && part.length <= 2048) return part.map(child => copy(child, depth + 1));
    if (part && typeof part === 'object' && Object.getPrototypeOf(part) === Object.prototype) {
      const entries = Object.entries(part);
      if (entries.length > 256 || entries.some(([key]) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('game-state-key');
      return Object.fromEntries(entries.map(([key, child]) => [key, copy(child, depth + 1)]));
    }
    throw new Error('game-state-value');
  }
  try {
    if (!value || Array.isArray(value) || typeof value !== 'object') return null;
    const result = copy(value);
    return JSON.stringify(result).length <= 98304 ? result : null;
  } catch { return null; }
}
function gameDrafts(value, set) {
  return Object.fromEntries(bankOf(set).filter(item => item.type === 'microgame').flatMap(item => {
    const draft = safeGameState(value?.[item.id]);
    return draft ? [[item.id, draft]] : [];
  }));
}
function archivedResult(attempt) {
  if (!attempt || attempt.answers.length !== attempt.itemIds.length) return null;
  const {resultArchive, freePlayDrafts, gameDrafts, legacyArchive, ...result} = attempt;
  return result;
}

export function newAttempt(set, {previous = null, seed = crypto.randomUUID(), mode = 'standard'} = {}) {
  mode = mode === 'advanced' ? 'advanced' : 'standard';
  const legacyArchive = previous?.legacyArchive || (previous?.selection === 'legacy-v1' ? previous : previous?.sourceAttempt?.selection === 'legacy-v1' ? previous.sourceAttempt : null);
  const variant = mode === 'advanced' ? 'writing' : 'hands';
  const bank = bankOf(set), random = seededRandom(seed), history = {}, picked = {}, plan = challengePlan(set, variant, mode);
  for (const type of ['sound', 'dictation', 'other']) {
    const pool = bank.filter(item => group(item) === type && (type !== 'other' || item.type === 'microgame') && (type !== 'sound' || (item.difficulty || 1) === (mode === 'advanced' ? 2 : 1))), count = plan.filter(part => part === type).length;
    if (!count) {history[type] = validHistory(previous?.history?.[type], bank, type);picked[type] = [];continue;}
    if (pool.length < count) throw new Error('Incomplete challenge bank');
    const seen = validHistory(previous?.history?.[type] || attemptItems(previous, set).filter(item => group(item) === type).map(item => item.id), bank, type);
    const unused = previous ? pool.filter(item => !seen.includes(item.id)) : pool;
    const fresh = shuffled(unused, random);
    const older = shuffled(pool.filter(item => !unused.includes(item)), random);
    picked[type] = [...fresh, ...older].slice(0, count);
    history[type] = unused.length >= count ? [...(previous ? seen : []), ...picked[type].map(item => item.id)] : picked[type].map(item => item.id);
  }
  const offsets = {sound: 0, dictation: 0, other: 0};
  const items = plan.map(type => picked[type][offsets[type]++]);
  return {version: CHALLENGE_VERSION, attemptId: crypto.randomUUID(), seed: String(seed), startedAt: Date.now(),
    selection: 'grade-bank', schedule: CHALLENGE_SCHEDULE, mode, variant, cursor: 0, itemIds: items.map(item => item.id), history, answers: [], gameDrafts: {},
    freePlayDrafts: gameDrafts(previous?.freePlayDrafts, set),
    resultArchive: [...(previous?.resultArchive || []), archivedResult(previous?.mode === 'review' ? previous.sourceAttempt : previous)].filter(Boolean).slice(-24),
    ...(legacyArchive ? {legacyArchive: structuredClone(legacyArchive)} : {}),
    orders: Object.fromEntries(items.map(item => [item.id, shuffled((item.options || item.cards || []).map(option => option.id), random)]))};
}

// Opening practice has no choice screen. Preserve answered or review rounds
// exactly; a never-answered old round can safely start with its poem's game.
export function prepareAttempt(set, saved, options = {}) {
  const previous = readAttempt(saved, set);
  if (previous && (previous.answers.length || previous.mode === 'review' || previous.schedule === CHALLENGE_SCHEDULE)) return previous;
  const attempt = newAttempt(set, {...options, previous, mode: previous?.mode || 'standard'});
  if (previous) {
    const game = attemptItems(attempt, set)[0];
    const draft = safeGameState(previous.gameDrafts?.[game.id] || previous.freePlayDrafts?.[game.id]);
    // A finished casual game is not an assessment answer. Start it afresh;
    // retain the old casual record without automatically awarding a point.
    if (draft && draft.gameCompleted !== true) attempt.gameDrafts[game.id] = draft;
  }
  return attempt;
}

// Review is deliberately shorter: never mix correct questions into a wrong-answer
// review just to reach five. Keep the original five-question result intact.
export function newReviewAttempt(set, saved, {seed = crypto.randomUUID()} = {}) {
  const previous = readAttempt(saved, set);
  if (!previous || previous.answers.length !== previous.itemIds.length) return null;
  const wrongIds = [...new Set([...(previous.reviewPending || []), ...previous.answers.filter(answer => !answer.correct).map(answer => answer.itemId)])];
  if (!wrongIds.length) return null;
  let nonchoices = 0;
  const ids = wrongIds.filter(id => {
    const item = bankOf(set).find(value => value.id === id);
    if (set.grade > 3 || item.type === 'sound') return true;
    return nonchoices++ === 0;
  }).slice(0, TOTAL);
  const sourceAttempt = structuredClone(previous.mode === 'review' ? previous.sourceAttempt : previous);
  const items = attemptItems({itemIds: ids}, set), random = seededRandom(seed);
  return {version: CHALLENGE_VERSION, attemptId: crypto.randomUUID(), seed: String(seed), startedAt: Date.now(),
    selection: 'wrong-review', mode: 'review', variant: previous.variant, sourceAttempt,
    reviewPending: wrongIds.filter(id => !ids.includes(id)),
    ...(previous.legacyArchive ? {legacyArchive: structuredClone(previous.legacyArchive)} : {}),
    reviewOf: previous.attemptId, cursor: 0, itemIds: ids, history: structuredClone(previous.history), answers: [],
    gameDrafts: {}, freePlayDrafts: gameDrafts(previous.freePlayDrafts, set), resultArchive: structuredClone(previous.resultArchive || []),
    orders: Object.fromEntries(items.map(item => [item.id, shuffled((item.options || item.cards || []).map(option => option.id), random)]))};
}

// Version one had one fixed set. Resolve those exact IDs before migrating so a
// resumed or completed record never gets reinterpreted against newly drawn items.
export function readAttempt(saved, set) {
  if (!saved || ![1, CHALLENGE_VERSION].includes(saved.version) || typeof saved.attemptId !== 'string' ||
      !Array.isArray(saved.answers) || !saved.orders || !Number.isFinite(saved.startedAt)) return null;
  const legacy = saved.version === 1 || saved.selection === 'legacy-v1';
  const mode = legacy ? 'standard' : saved.mode || 'standard';
  if (!['standard', 'advanced', 'review'].includes(mode)) return null;
  const itemIds = saved.version === 1 ? set.items.map(item => item.id) : saved.itemIds;
  const total = mode === 'review' ? itemIds?.length : TOTAL;
  if (!Array.isArray(itemIds) || !Number.isInteger(total) || total < 1 || total > TOTAL || itemIds.length !== total || new Set(itemIds).size !== total) return null;
  const items = attemptItems({itemIds}, set);
  let sourceAttempt = null;
  if (mode === 'review') {
    if (!saved.sourceAttempt || saved.sourceAttempt.mode === 'review' || saved.sourceAttempt.sourceAttempt) return null;
    sourceAttempt = readAttempt(saved.sourceAttempt, set);
    if (!sourceAttempt || sourceAttempt.answers.length !== TOTAL || !itemIds.every(id => sourceAttempt.answers.some(answer => answer.itemId === id && !answer.correct))) return null;
    if (set.grade <= 3 && items.filter(item => item.type !== 'sound').length > 1) return null;
    if (!Array.isArray(saved.reviewPending) || new Set(saved.reviewPending).size !== saved.reviewPending.length || saved.reviewPending.some(id => itemIds.includes(id) || !sourceAttempt.answers.some(answer => answer.itemId === id && !answer.correct))) return null;
  }
  if (legacy && itemIds.some((id, index) => id !== set.items[index]?.id)) return null;
  const variant = legacy ? 'hands' : saved.variant;
  if (!['hands', 'writing'].includes(variant)) return null;
  const gameFirst = saved.schedule === CHALLENGE_SCHEDULE;
  const plan = legacy ? LEGACY_PLAN : gameFirst ? challengePlan(set, variant, mode) : previousPlan(set, variant, saved.schedule === 'games-20260918' ? mode : 'standard');
  if (items.length !== total || (mode !== 'review' && items.some((item, i) => group(item) !== plan[i]))) return null;
  if (!legacy && gameFirst && mode !== 'review' && items[0].type !== 'microgame') return null;
  if (mode === 'advanced' && items.some(item => item.type === 'sound' && item.difficulty !== 2)) return null;
  const attempt = {...saved, version: CHALLENGE_VERSION, selection: legacy ? 'legacy-v1' : mode === 'review' ? 'wrong-review' : 'grade-bank', mode, variant, itemIds: [...itemIds], seed: saved.seed || `legacy:${saved.attemptId}`, answers: [], orders: {}, history: {}};
  attempt.gameDrafts = gameDrafts(saved.gameDrafts, set);
  attempt.freePlayDrafts = gameDrafts(saved.freePlayDrafts, set);
  // The original result is retained when a new round begins. Avoid recursive
  // archives and never interpret an archived result as today's selected items.
  attempt.resultArchive = Array.isArray(saved.resultArchive) ? saved.resultArchive.slice(-24).flatMap(record => {
    if (!record || record.resultArchive || record.sourceAttempt || record.mode === 'review') return [];
    const checked = readAttempt({...record, resultArchive: undefined}, set);
    return checked && checked.answers.length === checked.itemIds.length ? [archivedResult(checked)] : [];
  }) : [];
  if (sourceAttempt) attempt.sourceAttempt = sourceAttempt;
  for (const type of ['sound', 'dictation', 'other']) {
    attempt.history[type] = validHistory(saved.history?.[type] || items.filter(item => group(item) === type).map(item => item.id), bankOf(set), type);
  }
  for (const item of items) {
    const ids = (item.options || item.cards || []).map(option => option.id), order = saved.orders[item.id];
    if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || order.some(id => !ids.includes(id))) return null;
    attempt.orders[item.id] = [...order];
  }
  for (let i = 0; i < Math.min(saved.answers.length, total); i++) {
    const answer = saved.answers[i];
    if (answer?.itemId !== items[i].id || !['correct', 'incorrect', 'skipped'].includes(answer.status) || !Number.isFinite(answer.submittedAt)) break;
    if (items[i].type === 'microgame' && answer.status === 'correct' && safeGameState(answer.response)?.gameCompleted !== true) break;
    attempt.answers.push({...answer, correct: answer.status === 'correct'});
  }
  attempt.cursor = Math.max(0, Math.min(Number.isInteger(saved.cursor) ? saved.cursor : attempt.answers.length, attempt.answers.length, total));
  if (attempt.answers.length !== total) delete attempt.completedAt;
  return attempt;
}

export function recordAnswer(attempt, set, index, result) {
  const items = attemptItems(attempt, set);
  if (!attempt || !items.length || items.length > TOTAL || index !== attempt.answers.length || !items[index] ||
      !['correct', 'incorrect', 'skipped'].includes(result.status)) return false;
  if (items[index].type === 'microgame' && result.status === 'correct' && safeGameState(result.response)?.gameCompleted !== true) return false;
  attempt.answers.push({...result, itemId: items[index].id, correct: result.status === 'correct', submittedAt: Date.now()});
  if (attempt.answers.length === items.length) attempt.completedAt = Date.now();
  return true;
}

export function challengeSummary(saved, set) {
  const attempt = readAttempt(saved, set);
  if (!attempt) return {version: CHALLENGE_VERSION, completed: false, answered: 0, total: TOTAL, correct: 0};
  const items = attemptItems(attempt, set);
  return {version: CHALLENGE_VERSION, attemptId: attempt.attemptId, mode: attempt.mode, completed: attempt.answers.length === items.length,
    answered: attempt.answers.length, total: items.length, correct: attempt.answers.filter(a => a.correct).length,
    answers: attempt.answers.map((answer, i) => ({itemId: answer.itemId, type: items[i].type,
      focus: items[i].focus || null, status: answer.status})), completedAt: attempt.completedAt || null};
}
