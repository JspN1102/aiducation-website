import {createHandwritingPad} from './handwriting-pad.mjs?v=20260908i';

// First submitted recognition is the assessment. Later stroke demonstrations
// and free practice never change that result. Only the top candidate counts.
export function mountChallengeWriting(holder, {
  target,
  recognize,
  onSubmit = () => {},
  isAnswered = () => false,
  initialResult = null
} = {}) {
  if (!holder?.ownerDocument || !target || Array.from(target.char || '').length !== 1) {
    throw new TypeError('A holder and a single target character are required.');
  }
  if (typeof recognize !== 'function') throw new TypeError('A recognition function is required.');

  const doc = holder.ownerDocument, view = doc.defaultView;
  const controller = new view.AbortController();
  const normalize = value => String(value).trim().normalize('NFC');
  const accepted = new Set([target.char, ...(Array.isArray(target.accept) ? target.accept : [])]
    .filter(value => typeof value === 'string' && Array.from(normalize(value)).length === 1).map(normalize));
  const character = target.char, pinyin = typeof target.pinyin === 'string' ? target.pinyin : '';
  let destroyed = false, busy = false, pad = null, writer = null, animationRequest = null;
  let operation = 0, strokeOperation = 0, practising = false, result = null;
  const externalAnswered = () => typeof isAnswered === 'function' ? isAnswered() : Boolean(isAnswered);
  const canSubmit = () => !destroyed && !busy && !result && !externalAnswered();
  const locked = () => destroyed || busy || (Boolean(result) ? !practising : externalAnswered());

  const root = doc.createElement('section');
  root.className = 'challenge-writing';
  // Deliberately generic before submission: no target in text, attributes,
  // hidden markup, a background image, or the accessibility tree.
  root.innerHTML = `<style>
.challenge-writing{width:100%;max-width:430px;margin-inline:auto;color:#233d32}
.challenge-writing .cw-board{position:relative;width:min(100%,220px);aspect-ratio:1;margin:4px auto 8px;border:1px solid #bfcfc3;border-radius:20px;overflow:hidden;background-color:#fffef8;background-image:linear-gradient(90deg,transparent calc(50% - .5px),#dce4d9 calc(50% - .5px),#dce4d9 calc(50% + .5px),transparent calc(50% + .5px)),linear-gradient(transparent calc(50% - .5px),#dce4d9 calc(50% - .5px),#dce4d9 calc(50% + .5px),transparent calc(50% + .5px))}
.challenge-writing.is-answered .cw-board{width:min(100%,176px)}
.challenge-writing canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:crosshair}
.challenge-writing .cw-animation{position:absolute;inset:0;min-width:0;min-height:0;background:#fffef8;display:grid;place-items:center;font-family:'Noto Serif TC',serif;line-height:1}
.challenge-writing .cw-animation[hidden],.challenge-writing [hidden]{display:none!important}
.challenge-writing .cw-animation svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.challenge-writing .cw-tools,.challenge-writing .cw-controls,.challenge-writing .cw-review-actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}
.challenge-writing .cw-tools{flex-wrap:nowrap}
.challenge-writing button{font:inherit;min-height:44px;padding:10px 15px;border-radius:14px;border:1px solid #d9e3d9;background:#fffef8;color:#294c3b;cursor:pointer;touch-action:manipulation}
.challenge-writing button:focus-visible{outline:3px solid #528b76;outline-offset:3px}
.challenge-writing button:disabled{opacity:.45;cursor:default}
.challenge-writing .cw-primary{color:#fff;background:#286650;border-color:#286650;font-weight:700;min-width:110px}
.challenge-writing .cw-submit{display:contents}
.challenge-writing .cw-skip{background:transparent;border-color:transparent;font-size:14px;flex-basis:100%;min-height:36px;padding:6px 10px}
.challenge-writing .cw-status{font-size:14px;line-height:1.6;text-align:center;min-height:23px;margin:10px 0 4px}
.challenge-writing .cw-review{padding-top:2px;text-align:center}
.challenge-writing .cw-answer{display:flex;align-items:center;justify-content:center;gap:14px;margin:6px 0 12px}
.challenge-writing .cw-answer strong{font-family:'Noto Serif TC',serif;font-size:44px;line-height:1.2;font-weight:500}
.challenge-writing .cw-answer span{font-size:18px;color:#557263}
@media(max-height:700px){.challenge-writing .cw-board{width:min(100%,188px)}.challenge-writing.is-answered .cw-board{width:min(100%,158px)}}
</style>
<div class="cw-board">
  <canvas width="560" height="560" aria-label="手寫答題區"></canvas>
  <div class="cw-animation" role="img" aria-label="筆順示範" hidden></div>
</div>
<div class="cw-controls"><div class="cw-tools">
  <button type="button" data-cw="undo" aria-label="撤銷上一筆">撤銷</button>
  <button type="button" data-cw="clear">清空</button>
</div>
<div class="cw-submit">
  <button type="button" data-cw="submit" class="cw-primary">寫好了</button>
  <button type="button" data-cw="skip" class="cw-skip">不會寫，學一學</button>
</div></div>
<p class="cw-status" role="status" aria-live="polite"></p>
<div class="cw-review" hidden></div>`;
  holder.replaceChildren(root);
  const $ = selector => root.querySelector(selector);
  const canvas = $('canvas'), animation = $('.cw-animation'), status = $('.cw-status');

  function showCharacter() {
    // One coordinate system at every board size, including the small review
    // state. A fixed CSS font size used to exceed the phone's review square.
    const ns='http://www.w3.org/2000/svg';
    const svg=doc.createElementNS(ns,'svg'),glyph=doc.createElementNS(ns,'text');
    svg.setAttribute('viewBox','0 0 560 560');
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    glyph.setAttribute('x','280');glyph.setAttribute('y','280');
    glyph.setAttribute('text-anchor','middle');glyph.setAttribute('dominant-baseline','central');
    glyph.setAttribute('font-size','380');glyph.setAttribute('fill','#286650');
    glyph.textContent=character;svg.append(glyph);animation.replaceChildren(svg);
  }

  function revealBoard() {
    // Short landscape screens scroll the activity body. Bring the square back
    // after a lower review button is tapped, so it is ready to watch or write.
    if(!destroyed) $('.cw-board').scrollIntoView({block:'nearest',inline:'nearest'});
  }

  function updateControls() {
    if (destroyed) return;
    const hasInk = Boolean(pad?.getStrokes().length);
    $('[data-cw="undo"]').disabled = locked() || !hasInk;
    $('[data-cw="clear"]').disabled = locked() || !hasInk;
    $('[data-cw="submit"]').disabled = !canSubmit() || !hasInk;
    $('[data-cw="skip"]').disabled = !canSubmit();
    canvas.setAttribute('aria-disabled', String(locked()));
    root.setAttribute('aria-busy', String(busy));
  }

  function stopAnimation() {
    strokeOperation += 1;
    animationRequest?.abort();
    animationRequest = null;
    if (writer) {
      try { writer.pauseAnimation(); } catch { /* Vendor may still be loading. */ }
      try { writer.cancelQuiz(); } catch { /* No quiz is active. */ }
      writer = null;
    }
    animation.replaceChildren();
    animation.hidden = true;
  }

  function showResult() {
    root.classList.add('is-answered');
    $('.cw-submit').hidden = true;
    $('.cw-tools').hidden = true;
    const review = $('.cw-review');
    review.hidden = false;
    review.replaceChildren();
    const answer = doc.createElement('div');
    answer.className = 'cw-answer';
    const glyph = doc.createElement('strong'), pronunciation = doc.createElement('span');
    glyph.textContent = character;
    pronunciation.textContent = pinyin;
    answer.append(glyph, pronunciation);
    const actions = doc.createElement('div');
    actions.className = 'cw-review-actions';
    for (const [action, label] of [['strokes', '看筆順'], ['practise', '自己練一遍']]) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.cw = action;
      button.textContent = label;
      actions.append(button);
    }
    review.append(answer, actions);
    status.textContent = result.status === 'skipped' ? '這題記作學習，先看看怎樣寫。'
      : result.correct ? '寫對了！也可以看看這個字的筆順。'
        : result.recognized ? `這次辨認為「${result.recognized}」。看看下面的字，一起學一學。`
          : '看看下面的字，一起學一學。';
    if (result.status === 'skipped') {
      showCharacter();
      animation.hidden = false;
    }
    updateControls();
  }

  function commit(statusValue, candidates = []) {
    if (destroyed || result || externalAnswered()) return;
    practising = false;
    result = Object.freeze({
      status: statusValue,
      correct: statusValue === 'correct',
      skipped: statusValue === 'skipped',
      independent: statusValue === 'correct',
      char: character,
      recognized: candidates[0] || null,
      candidates: Object.freeze([...candidates]),
      submittedAt: Date.now()
    });
    showResult();
    // State is locked before notifying the parent, which may immediately route
    // away or remount this component with initialResult.
    onSubmit({...result, candidates: [...result.candidates]});
  }

  async function submit() {
    if (!canSubmit()) return;
    const strokes = pad.finish();
    if (!strokes.length) {
      status.textContent = '先在田字格寫下你的答案。';
      return;
    }
    const start = strokes[0][0].t;
    const ink = strokes.map(stroke => [
      stroke.map(point => Math.round(point.x)),
      stroke.map(point => Math.round(point.y)),
      stroke.map(point => point.t - start)
    ]);
    busy = true;
    const request = ++operation;
    status.textContent = '正在辨認你的字…';
    updateControls();
    let candidates;
    try {
      const response = await recognize(ink);
      if (destroyed || request !== operation || result || externalAnswered()) return;
      candidates = Array.isArray(response?.candidates) ? response.candidates
        .filter(value => typeof value === 'string' && value.trim())
        .map(normalize) : [];
      if (!candidates.length) {
        status.textContent = '這次未能辨認，不計對錯。可以寫大一點，再試一次。';
        return;
      }
    } catch {
      if (!destroyed && request === operation && !result && !externalAnswered()) {
        status.textContent = '辨認暫時未能連線，這次不計對錯。筆跡已保留，請再試一次。';
      }
      return;
    } finally {
      if (!destroyed && request === operation) {
        busy = false;
        updateControls();
      }
    }
    // Never accept a target merely appearing elsewhere in a word or among
    // lower-ranked alternatives. Explicit accepted single-character variants
    // are allowed, using the service's first non-empty candidate only.
    commit(accepted.has(candidates[0]) ? 'correct' : 'incorrect', candidates.slice(0, 10));
  }

  async function showStrokes() {
    if (destroyed || !result) return;
    practising = false;
    stopAnimation();
    const request = strokeOperation;
    animation.hidden = false;
    showCharacter();
    $('.cw-tools').hidden = true;
    status.textContent = '正在準備筆順…';
    updateControls();
    revealBoard();
    animationRequest = new view.AbortController();
    try {
      if (!view.HanziWriter) throw new Error('Stroke animation is unavailable.');
      const resource = new URL(`./vendor/hanzi-data/${character.codePointAt(0).toString(16)}.json`, import.meta.url);
      const response = await view.fetch(resource, {signal: animationRequest.signal});
      if (!response.ok) throw new Error('Stroke data is unavailable.');
      const data = await response.json();
      if (destroyed || request !== strokeOperation) return;
      animation.replaceChildren();
      writer = view.HanziWriter.create(animation, character, {
        width: 560, height: 560, padding: 45,
        showCharacter: false, showOutline: true,
        strokeColor: '#286650', outlineColor: '#e1eae4',
        strokeAnimationSpeed: 1, delayBetweenStrokes: 180,
        charDataLoader: (_char, onLoad) => onLoad(data)
      });
      const svg = animation.querySelector('svg');
      svg?.setAttribute('viewBox', '0 0 560 560');
      svg?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      status.textContent = '看一看每一筆從哪裏開始。';
      await writer.animateCharacter();
      if (!destroyed && request === strokeOperation) {
        status.textContent = '看完了，可以自己練一遍。這次練習不會改動答題結果。';
      }
    } catch {
      if (!destroyed && request === strokeOperation) {
        animation.replaceChildren();
        showCharacter();
        status.textContent = '筆順暫時無法播放，可以先觀察字形，或稍後再試。';
      }
    }
  }

  function practise() {
    if (destroyed || !result) return;
    stopAnimation();
    practising = true;
    pad.clear();
    $('.cw-tools').hidden = false;
    status.textContent = '照着正確的字練一遍，這次練習不會改動答題結果。';
    updateControls();
    revealBoard();
  }

  pad = createHandwritingPad(canvas, {isLocked: locked, onChange: updateControls});
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-cw]');
    if (!button || !root.contains(button) || button.disabled || destroyed) return;
    if (button.dataset.cw === 'undo') pad.undo();
    if (button.dataset.cw === 'clear') pad.clear();
    if (button.dataset.cw === 'submit') void submit();
    if (button.dataset.cw === 'skip' && canSubmit()) { pad.finish(); commit('skipped'); }
    if (button.dataset.cw === 'strokes') void showStrokes();
    if (button.dataset.cw === 'practise') practise();
  }, {signal: controller.signal});
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      pad.finish();
      if (writer) {
        stopAnimation();
        status.textContent = '可以再按「看筆順」，或自己練一遍。';
      }
    }
  }, {signal: controller.signal});

  if (initialResult && ['correct', 'incorrect', 'skipped'].includes(initialResult.status)) {
    result = Object.freeze({
      ...initialResult,
      char: character,
      correct: initialResult.status === 'correct',
      skipped: initialResult.status === 'skipped',
      independent: initialResult.status === 'correct',
      recognized: typeof initialResult.recognized === 'string' ? initialResult.recognized : null,
      candidates: Object.freeze(Array.isArray(initialResult.candidates) ? [...initialResult.candidates] : [])
    });
    showResult();
  } else {
    updateControls();
  }

  return {
    getResult() { return result ? {...result, candidates: [...result.candidates]} : null; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      operation += 1;
      stopAnimation();
      controller.abort();
      pad.destroy();
      root.remove();
    }
  };
}
