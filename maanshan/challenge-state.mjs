import {CHALLENGE_VERSION} from './challenge-data.mjs?v=20260918a';

export function shuffled(values, random = Math.random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function newAttempt(set) {
  return {version: CHALLENGE_VERSION, attemptId: crypto.randomUUID(), startedAt: Date.now(),
    cursor: 0, answers: [], orders: Object.fromEntries(set.items.map(item => [item.id,
      shuffled((item.options || item.cards || []).map(option => option.id))]))};
}

// Only this assessment version and a consecutive, valid sequence may resume.
// Legacy quiz clicks never count as completing a five-question assessment.
export function readAttempt(saved, set) {
  if (!saved || saved.version !== CHALLENGE_VERSION || typeof saved.attemptId !== 'string' ||
      !Array.isArray(saved.answers) || !saved.orders || !Number.isFinite(saved.startedAt)) return null;
  const attempt = {...saved, answers: [], orders: {}};
  for (const item of set.items) {
    const ids = (item.options || item.cards || []).map(option => option.id);
    const order = saved.orders[item.id];
    if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || order.some(id => !ids.includes(id))) return null;
    attempt.orders[item.id] = [...order];
  }
  for (let i = 0; i < Math.min(saved.answers.length, set.items.length); i++) {
    const answer = saved.answers[i];
    if (answer?.itemId !== set.items[i].id || !['correct', 'incorrect', 'skipped'].includes(answer.status) || !Number.isFinite(answer.submittedAt)) break;
    attempt.answers.push({...answer, correct: answer.status === 'correct'});
  }
  attempt.cursor = Math.max(0, Math.min(Number.isInteger(saved.cursor) ? saved.cursor : attempt.answers.length,
    attempt.answers.length, set.items.length));
  if (attempt.answers.length !== set.items.length) delete attempt.completedAt;
  return attempt;
}

export function recordAnswer(attempt, set, index, result) {
  if (!attempt || index !== attempt.answers.length || !set.items[index] ||
      !['correct', 'incorrect', 'skipped'].includes(result.status)) return false;
  attempt.answers.push({...result, itemId: set.items[index].id, correct: result.status === 'correct', submittedAt: Date.now()});
  if (attempt.answers.length === set.items.length) attempt.completedAt = Date.now();
  return true;
}

export function challengeSummary(saved, set) {
  const attempt = readAttempt(saved, set);
  if (!attempt) return {version: CHALLENGE_VERSION, completed: false, answered: 0, total: set.items.length, correct: 0};
  return {version: CHALLENGE_VERSION, attemptId: attempt.attemptId, completed: attempt.answers.length === set.items.length,
    answered: attempt.answers.length, total: set.items.length, correct: attempt.answers.filter(a => a.correct).length,
    answers: attempt.answers.map((answer, i) => ({itemId: answer.itemId, type: set.items[i].type,
      focus: set.items[i].focus || null, status: answer.status})), completedAt: attempt.completedAt || null};
}
