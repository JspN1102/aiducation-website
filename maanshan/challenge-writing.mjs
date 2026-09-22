import {createHandwritingPad} from './handwriting-pad.mjs?v=20260921-school10';
import {loadHanziWriter} from './hanzi-library.mjs?v=20260922-school12b';

// First submitted recognition is the assessment. Later stroke demonstrations
// and free practice never change that result. Only the top candidate counts.
export function mountChallengeWriting(holder, {
  target,
  recognize,
  onSubmit = () => {},
  onCorrection = () => {},
  onAdvanceStateChange = () => {},
  onResearch = () => {},
  isAnswered = () => false,
  initialResult = null,
  initialCorrection = null
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
  const character = target.char;
  let destroyed = false, busy = false, pad = null, writer = null, animationRequest = null;
  let operation = 0, strokeOperation = 0, practising = false, result = null;
  let eraseCount = 0, lastStrokeCount = 0, recognitionCount = 0, correctionCount = 0, correction = null, advanceKey = '';
  const externalAnswered = () => typeof isAnswered === 'function' ? isAnswered() : Boolean(isAnswered);
  const canSubmit = () => !destroyed && !busy && (result ? practising : !externalAnswered());
  const canContinue = () => !destroyed && !busy && Boolean(result && (result.correct || ['corrected','skipped'].includes(correction?.status)));
  const auditWriting=(type,fields={})=>onResearch(type,{...fields,...(result?{context:{...fields.context,mode:'review'}}:{})});
  const locked = () => destroyed || busy || (Boolean(result) ? !practising : externalAnswered());

  const root = doc.createElement('section');
  root.className = 'challenge-writing cw-expanded';
  // Deliberately generic before submission: no target in text, attributes,
  // hidden markup, a background image, or the accessibility tree.
  root.innerHTML = `<style>
.challenge-writing{width:100%;max-width:430px;margin-inline:auto;color:#233d32}
.challenge-writing .cw-board{position:relative;width:min(100%,220px);aspect-ratio:1;margin:4px auto 8px;border:1px solid #bfcfc3;border-radius:20px;overflow:hidden;background-color:#fff;background-image:linear-gradient(90deg,transparent calc(50% - .5px),#dce4d9 calc(50% - .5px),#dce4d9 calc(50% + .5px),transparent calc(50% + .5px)),linear-gradient(transparent calc(50% - .5px),#dce4d9 calc(50% - .5px),#dce4d9 calc(50% + .5px),transparent calc(50% + .5px))}
.challenge-writing.is-answered .cw-board{width:min(100%,176px)}
.challenge-writing canvas{position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:crosshair;background:#fff}
.challenge-writing .cw-board,.challenge-writing .cw-board *{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.challenge-writing .cw-animation{position:absolute;inset:0;min-width:0;min-height:0;background:#fff;display:grid;place-items:center;font-family:'Noto Serif TC',serif;line-height:1}
.challenge-writing .cw-animation[hidden],.challenge-writing [hidden]{display:none!important}
.challenge-writing .cw-animation svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.challenge-writing .cw-tools,.challenge-writing .cw-controls,.challenge-writing .cw-review-actions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}
.challenge-writing .cw-tools{flex-wrap:nowrap}
.challenge-writing button{font:inherit;min-height:44px;padding:10px 15px;border-radius:14px;border:1px solid #d9e3d9;background:#fffef8;color:#294c3b;cursor:pointer;touch-action:manipulation}
.challenge-writing button:focus-visible{outline:3px solid #528b76;outline-offset:3px}
.challenge-writing button:disabled{opacity:.45;cursor:default}
.challenge-writing .cw-primary{color:#fff;background:#286650;border-color:#286650;font-weight:700;min-width:110px}
.challenge-writing .cw-submit{display:contents}
.challenge-writing .cw-skip{background:transparent;border-color:transparent;font-size:18px;flex-basis:100%;min-height:44px;padding:6px 10px}
.challenge-writing .cw-status{font-size:18px;line-height:1.6;text-align:center;min-height:29px;margin:10px 0 4px}
.challenge-writing .cw-review{padding:0;text-align:center}
@media(max-height:700px){.challenge-writing .cw-board{width:min(100%,188px)}.challenge-writing.is-answered .cw-board{width:min(100%,158px)}}
/* Keep the same usable square for an answer, its model and its correction.
   These selectors override the old phone rules that shrank review to 105px. */
.challenge-writing.cw-expanded{max-width:520px;display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start}
.challenge-writing.cw-expanded .cw-board{width:min(100%,360px);max-width:none}
.challenge-writing.cw-expanded .cw-correction-skip{min-height:44px;background:#f5f6ef;border-color:#d9e3d9;font-size:17px}
.challenge-writing.cw-expanded .cw-status{overflow-wrap:anywhere}
.challenge-writing.cw-expanded .cw-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;min-width:0}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-board{grid-column:1;grid-row:2;width:min(100%,360px);max-width:none;margin:0 auto}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-actions{grid-column:1;grid-row:3}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-controls{grid-area:auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,.65fr);gap:8px;align-items:stretch}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-review{grid-area:auto}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-submit{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded button{min-width:0;min-height:48px;padding:10px 8px;font-size:19px;line-height:1.35;border-radius:13px}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-status{grid-column:1;grid-row:1;margin:0;min-height:29px;font-size:19px!important;line-height:1.45;color:#365846;text-align:center}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-status:empty{display:none}
.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-review-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
@media(max-width:700px){
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-layout{gap:8px;justify-content:center}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-board{width:min(100%,340px);margin:0 auto}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded button{font-size:18px;padding-inline:6px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-status{font-size:18px!important}
}
@media(min-width:701px) and (orientation:portrait){
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-layout{grid-template-columns:1fr;gap:18px;max-width:680px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-heading{text-align:center;padding:0}
}
@media(min-width:701px){
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded{display:grid;max-width:none;grid-template-columns:minmax(0,430px) 156px;justify-content:center;gap:12px 18px;align-items:start}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-status{grid-column:1/-1;grid-row:1;font-size:20px!important}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-board{grid-column:1;grid-row:2;width:min(100%,430px);margin:0;justify-self:center}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-actions{grid-column:2;grid-row:2;align-self:center;gap:12px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-controls{grid-template-columns:minmax(0,1fr);gap:12px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-review-actions{grid-template-columns:minmax(0,1fr);gap:12px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-review-actions button,.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-primary{min-height:52px;font-size:20px}
}
@media(min-width:701px) and (orientation:landscape){
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-layout{grid-template-columns:minmax(160px,.48fr) minmax(0,1.52fr);gap:20px;max-width:1280px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-board{width:min(100%,430px,max(270px,calc(100cqh - 68px)))}
}
@media(min-width:701px) and (max-height:560px) and (orientation:landscape){
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-layout{grid-template-columns:minmax(140px,.5fr) minmax(0,1.5fr);gap:14px;align-items:start}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-heading{padding:0}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-heading .challenge-prompt{font-size:21px;line-height:1.4;margin:0 0 6px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing-heading .challenge-audio-status{font-size:15px;line-height:1.3;margin-top:6px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded{grid-template-columns:minmax(0,1fr) 230px;gap:8px 12px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-board{width:min(100%,max(150px,calc(100cqh - 54px)));margin:0;align-self:start}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-actions{grid-template-columns:repeat(2,minmax(0,1fr));align-self:start;gap:8px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-tools{grid-template-columns:minmax(0,1fr);gap:6px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-actions,.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-controls,.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-review-actions{gap:6px}
 .workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded button,.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-review-actions button,.workspace.view-quiz .challenge-shell.challenge-type-dictation .challenge-writing.cw-expanded .cw-primary{min-height:44px;font-size:17px;padding:6px}
}
</style>
<p class="cw-status" role="status" aria-live="polite"></p>
<div class="cw-board">
  <canvas width="560" height="560" aria-label="手寫答題區"></canvas>
  <div class="cw-animation" role="img" aria-label="筆順示範" hidden></div>
</div>
<div class="cw-actions"><div class="cw-controls"><div class="cw-tools">
  <button type="button" data-cw="undo" aria-label="撤銷上一筆">撤銷</button>
  <button type="button" data-cw="clear">清空</button>
</div>
<div class="cw-submit">
  <button type="button" data-cw="submit" class="cw-primary">寫好了</button>
  <button type="button" data-cw="skip" class="cw-skip">不會寫，學一學</button>
</div></div>
<div class="cw-review" hidden></div></div>`;
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
    // Keep the instruction and square together when a review button is tapped.
    // Scrolling only the square used to hide the feedback immediately above it.
    if(!destroyed) root.scrollIntoView({block:'nearest',inline:'nearest'});
  }

  function updateControls() {
    if (destroyed) return;
    const hasInk = Boolean(pad?.getStrokes().length);
    $('[data-cw="undo"]').disabled = locked() || !hasInk;
    $('[data-cw="clear"]').disabled = locked() || !hasInk;
    $('[data-cw="submit"]').disabled = !canSubmit() || !hasInk;
    $('[data-cw="submit"]').textContent = result ? '檢查' : '寫好了';
    $('[data-cw="skip"]').disabled = Boolean(result) || !canSubmit();
    $('[data-cw="skip"]').hidden = Boolean(result);
    // Keep the controls in the same layout while a model turns into writing.
    // Showing them on touch-down used to move the square under that finger.
    $('.cw-submit').hidden = false;
    $('.cw-tools').hidden = false;
    const skipCorrectionButton = $('[data-cw="skip-correction"]');
    if (skipCorrectionButton) {
      skipCorrectionButton.hidden = result.correct || ['corrected','skipped'].includes(correction?.status);
      skipCorrectionButton.disabled = busy;
    }
    root.querySelectorAll('[data-cw="strokes"],[data-cw="practise"]').forEach(button=>button.disabled=busy);
    canvas.setAttribute('aria-disabled', String(locked()));
    root.setAttribute('aria-busy', String(busy));
    const reason = busy ? 'recognizing' : !result ? 'unanswered' : result.correct ? 'independent-correct' : correction?.status === 'corrected' ? 'corrected' : correction?.status === 'skipped' ? 'explicitly-skipped' : 'correction-required';
    root.dataset.advance = canContinue() ? 'ready' : 'blocked';
    const key = `${canContinue()}:${reason}`;
    if (key !== advanceKey) {
      advanceKey = key;
      onAdvanceStateChange({canContinue:canContinue(),reason,correction:correction?{...correction,candidates:[...correction.candidates]}:null});
    }
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
    const actions = doc.createElement('div');
    actions.className = 'cw-review-actions';
    for (const [action, label] of [['strokes', '看筆順'], ['practise', '再寫一次'], ['skip-correction', '先跳過']]) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.cw = action;
      if (action === 'skip-correction') button.className = 'cw-correction-skip';
      button.textContent = label;
      actions.append(button);
    }
    review.append(actions);
    status.textContent = result.status === 'skipped' ? '先看筆順，再在田字格寫一次。'
      : result.correct ? '寫對了！也可以看看這個字的筆順。'
        : result.recognized ? `辨認為「${result.recognized}」，請再寫一次。`
          : '請再寫一次，需要時可以看筆順。';
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
    const correcting = Boolean(result), count = correcting ? ++correctionCount : ++recognitionCount;
    auditWriting(count>1?'retry':'attempt_started',{retryCount:count-1,metrics:{strokeCount:strokes.length,eraseCount}});
    const request = ++operation;
    status.textContent = '正在辨認你的字…';
    updateControls();
    let candidates;
    try {
      const response = await recognize(ink,{mode:correcting?'review':'standard',phase:correcting?'correction':'assessment',attemptNo:count});
      if (destroyed || request !== operation || (!correcting && (result || externalAnswered()))) return;
      candidates = Array.isArray(response?.candidates) ? response.candidates
        .filter(value => typeof value === 'string' && value.trim())
        .map(normalize) : [];
      if (!candidates.length) {
        auditWriting('error',{error:{code:'invalid_response',retryable:true},metrics:{strokeCount:strokes.length}});
        status.textContent = '這次未能辨認，不計對錯。可以寫大一點，再試一次。';
        return;
      }
    } catch {
      auditWriting('error',{error:{code:'provider_unavailable',retryable:true},metrics:{strokeCount:strokes.length}});
      if (!destroyed && request === operation && (correcting || !result && !externalAnswered())) {
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
    if (correcting) {
      const correct = accepted.has(candidates[0]);
      const latest = Object.freeze({status:correct?'corrected':'incorrect',correct,independent:false,mode:'review',recognized:candidates[0],candidates:Object.freeze(candidates.slice(0,10)),attemptNo:count,submittedAt:Date.now()});
      if (correct || !['corrected','skipped'].includes(correction?.status)) correction = latest;
      status.textContent = correct ? '這次寫對了！可以繼續下一題。' : `辨認為「${candidates[0]}」，請再寫一次。`;
      auditWriting('feedback_shown',{attemptNo:count,result:{status:correct?'correct':'incorrect',correct,score:null}});
      onCorrection({...latest,candidates:[...latest.candidates]});
      updateControls();
    } else commit(accepted.has(candidates[0]) ? 'correct' : 'incorrect', candidates.slice(0, 10));
  }

  async function showStrokes() {
    if (destroyed || busy || !result) return;
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
      const resource = new URL(`./vendor/hanzi-data/${character.codePointAt(0).toString(16)}.json`, import.meta.url);
      const signal = animationRequest.signal;
      const [HanziWriter, data] = await Promise.all([
        loadHanziWriter(view, {signal}),
        view.fetch(resource, {signal}).then(response => {
          if (!response.ok) throw new Error('Stroke data is unavailable.');
          return response.json();
        })
      ]);
      if (destroyed || request !== strokeOperation) return;
      animation.replaceChildren();
      writer = HanziWriter.create(animation, character, {
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
        status.textContent = '看完了，直接在田字格練一遍。';
      }
    } catch {
      if (!destroyed && request === strokeOperation) {
        animation.replaceChildren();
        showCharacter();
        status.textContent = '筆順暫時無法播放，可以先觀察字形，或稍後再試。';
      }
    }
  }

  function practise({reveal=true}={}) {
    if (destroyed || busy || !result) return;
    stopAnimation();
    practising = true;
    pad.clear();
    $('.cw-tools').hidden = false;
    status.textContent = '在田字格再寫一次，寫好後按「檢查」。';
    updateControls();
    if (reveal) revealBoard();
  }

  function skipCorrection() {
    if (destroyed || busy || !result || canContinue()) return;
    correction = Object.freeze({status:'skipped',correct:false,independent:false,mode:'review',recognized:null,candidates:Object.freeze([]),attemptNo:correctionCount,submittedAt:Date.now()});
    practising = false;
    stopAnimation();
    status.textContent = '這次先跳過，原來的聽寫紀錄已保留。';
    auditWriting('feedback_shown',{result:{status:'skipped',correct:null,score:null}});
    onCorrection({...correction,candidates:[]});
    updateControls();
  }

  // A shown answer or completed stroke demonstration is still a writing
  // surface. The first touch enters free practice, preserving the assessment.
  // Capture runs before the pad sees that same gesture, so its first stroke
  // is not swallowed by the character/animation overlay.
  const beginPractice = event => {
    if (!destroyed && result && !practising && !busy && event.button !== 2) practise({reveal:false});
  };
  for (const type of ['pointerdown','touchstart']) $('.cw-board').addEventListener(type,beginPractice,{capture:true,signal:controller.signal,passive:true});
  pad = createHandwritingPad(canvas, {isLocked: locked, onChange: strokes=>{if(strokes.length>lastStrokeCount)auditWriting('item_interacted',{interaction:'stroke_finished',metrics:{strokeCount:strokes.length,eraseCount}});lastStrokeCount=strokes.length;updateControls();}, interactionSurface: $('.cw-board')});
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-cw]');
    if (!button || !root.contains(button) || button.disabled || destroyed) return;
    if (button.dataset.cw === 'undo') {eraseCount++;pad.undo();auditWriting('item_interacted',{interaction:'stroke_undone',metrics:{eraseCount,strokeCount:pad.getStrokes().length}});}
    if (button.dataset.cw === 'clear') {eraseCount++;pad.clear();auditWriting('item_interacted',{interaction:'ink_cleared',metrics:{eraseCount,strokeCount:0}});}
    if (button.dataset.cw === 'submit') void submit();
    if (button.dataset.cw === 'skip' && canSubmit()) { pad.finish(); commit('skipped'); }
    if (button.dataset.cw === 'strokes') {auditWriting('hint_used',{hint:{kind:'stroke',count:1}});void showStrokes();}
    if (button.dataset.cw === 'practise') practise();
    if (button.dataset.cw === 'skip-correction') skipCorrection();
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
    if (initialCorrection && ['corrected','skipped'].includes(initialCorrection.status)) {
      correction = Object.freeze({status:initialCorrection.status,correct:initialCorrection.status==='corrected',independent:false,mode:'review',recognized:typeof initialCorrection.recognized==='string'?initialCorrection.recognized:null,candidates:Object.freeze([]),attemptNo:Number.isSafeInteger(initialCorrection.attemptNo)&&initialCorrection.attemptNo>=0?initialCorrection.attemptNo:0,submittedAt:initialCorrection.submittedAt});
      correctionCount = correction.attemptNo;
    }
    showResult();
    if (correction) status.textContent = correction.status === 'corrected' ? '這個字已訂正，可以繼續下一題。' : '這次先跳過，原來的聽寫紀錄已保留。';
  } else {
    updateControls();
  }

  return {
    getResult() { return result ? {...result, candidates: [...result.candidates]} : null; },
    getCorrection() { return correction ? {...correction,candidates:[...correction.candidates]} : null; },
    canContinue,
    skipCorrection,
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
