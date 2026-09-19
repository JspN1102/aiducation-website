/** Discrete, content-only process events. Never send pointer paths or scene captures.
 * The parent supplies session/attempt identity and keeps the actual challenge mode.
 * A microgame's correctness is feedback, not an assessment score.
 */
export function createProcessResearch(onResearch, {prefix, activity = 'challenge', context = {}, alive = () => true} = {}) {
  const shown = new Map(), attempts = new Map(), hints = new Map(), retries = new Map();
  let completed = false;
  const itemId = step => `${prefix}.${step}`;
  function emit(type, step, fields = {}) {
    if (!alive() || typeof onResearch !== 'function') return;
    const {context: extraContext, ...extra} = fields;
    try {
      const pending = onResearch(type, {activity, itemId: itemId(step), ...extra,
        context: {itemType: 'microgame', ...(typeof context==='function'?context():context), ...(shown.get(step) || {}), ...extraContext}});
      pending?.catch?.(() => {});
    } catch { /* Optional research transport must never interrupt the activity. */ }
  }
  function present(step, details = {}, {repeat = false} = {}) {
    const previous = shown.has(step);
    shown.set(step, {...details});
    if (!previous || repeat) emit('item_presented', step);
  }
  function retry(step, choiceId) {
    const count = Math.min(1000, (retries.get(step) || 0) + 1);
    retries.set(step, count);
    emit('retry', step, {retryCount: count, ...(choiceId ? {response: {choiceId}} : {})});
  }
  function answer(step, choiceId, correct, details) {
    if (!shown.has(step)) present(step, details);
    const count = Math.min(1000, (attempts.get(step) || 0) + 1);
    if (attempts.has(step)) retry(step);
    attempts.set(step, count);
    const fields = {attemptNo: count, response: {choiceId},
      result: {status: correct ? 'correct' : 'incorrect', correct: Boolean(correct), score: null}};
    emit('answer_submitted', step, fields);
    emit('feedback_shown', step, fields);
  }
  function hint(step, kind = 'explanation') {
    const count = Math.min(10000, (hints.get(step) || 0) + 1);
    hints.set(step, count);
    emit('hint_used', step, {hint: {kind, count:1},metrics:{hintCount:count}});
  }
  function action(step, choiceId, interaction = 'game_action') {
    emit('item_interacted', step, {interaction, response: {choiceId}});
  }
  function error(step, code = 'network', retryable = true) {
    emit('error', step, {error: {code, retryable}, result: {status: 'error', score: null}});
  }
  function complete() {
    if (completed) return;
    completed = true;
    emit('item_interacted', 'game', {interaction: 'game_action', response: {choiceId: 'completed'},
      result: {status: 'completed', score: null}});
  }
  function reset() {
    retry('game', 'replay');
    shown.clear(); attempts.clear(); hints.clear(); completed = false;
  }
  return {emit, present, answer, hint, action, error, retry, complete, reset};
}
