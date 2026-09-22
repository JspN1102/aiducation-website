import {createHandwritingPad} from './handwriting-pad.mjs?v=20260921-school10';
import {loadHanziWriter} from './hanzi-library.mjs?v=20260922-school12b';

// Demonstration and tracing are local learning activities. Only independent
// handwriting is sent to recognition; later corrections preserve that answer.
export function mountChallengeWriting(holder, {
  target, recognize, onSubmit = () => {}, onCorrection = () => {}, onTraceComplete = () => {},
  onAdvanceStateChange = () => {}, onResearch = () => {},
  isAnswered = () => false, initialResult = null, initialCorrection = null
} = {}) {
  if (!holder?.ownerDocument || !target || Array.from(target.char || '').length !== 1) throw new TypeError('A holder and a single target character are required.');
  if (typeof recognize !== 'function') throw new TypeError('A recognition function is required.');
  const doc = holder.ownerDocument, view = doc.defaultView, controller = new view.AbortController();
  const normalize = value => String(value).trim().normalize('NFC');
  const accepted = new Set([target.char, ...(Array.isArray(target.accept) ? target.accept : [])]
    .filter(value => typeof value === 'string' && Array.from(normalize(value)).length === 1).map(normalize));
  const character = target.char;
  let destroyed = false, busy = false, pad = null, writer = null, animationRequest = null;
  let operation = 0, strokeOperation = 0, practising = false, result = null;
  let phase = 'demonstrating', demonstrationComplete = false, tracingCount = 0, traceCompleted = false;
  let eraseCount = 0, lastStrokeCount = 0, recognitionCount = 0, correctionCount = 0, correction = null, advanceKey = '';
  const externalAnswered = () => typeof isAnswered === 'function' ? isAnswered() : Boolean(isAnswered);
  const canSubmit = () => !destroyed && !busy && animation.hidden && (result ? phase === 'review' && practising : phase === 'assessment' && traceCompleted && !externalAnswered());
  const canContinue = () => !destroyed && !busy && Boolean(result && (result.correct || ['corrected','skipped'].includes(correction?.status)));
  const auditWriting = (type, fields = {}) => onResearch(type, {...fields, ...(result ? {context:{...fields.context, mode:'review'}} : {})});
  const auditLearning = (type, fields = {}) => onResearch(type, {...fields, context:{...fields.context, mode:'review'}});
  const locked = () => !canSubmit();

  const root = doc.createElement('section');root.className = 'challenge-writing cw-expanded';
  root.innerHTML = `<p class="cw-status" role="status" aria-live="polite"></p>
<div class="cw-board"><canvas width="560" height="560" aria-label="手寫答題區"></canvas>
<div class="cw-animation" role="img" aria-label="筆順示範" hidden></div></div>
<div class="cw-actions"><div class="cw-controls">
<button type="button" data-cw="clear">清空</button>
<button type="button" data-cw="submit" class="cw-primary">檢查</button>
<button type="button" data-cw="skip" class="cw-skip">跳過</button>
</div></div>`;
  holder.replaceChildren(root);
  const $ = selector => root.querySelector(selector);
  const board = $('.cw-board'), canvas = $('canvas'), animation = $('.cw-animation'), status = $('.cw-status');
  const heading = holder.closest('.challenge-writing-layout')?.querySelector('.challenge-writing-heading');
  let prompts = heading?.querySelector('.challenge-writing-prompts');
  if (!prompts) {
    prompts = doc.createElement('div');prompts.className = 'challenge-writing-prompts';(heading || root).prepend(prompts);
    const listen = heading?.querySelector('[data-ch="listen"],.challenge-listen');if (listen) prompts.append(listen);
  }
  let strokeButton = prompts.querySelector('[data-cw="strokes"]');
  if (!strokeButton) {
    strokeButton = doc.createElement('button');strokeButton.type = 'button';strokeButton.className = 'challenge-strokes';
    strokeButton.dataset.cw = 'strokes';strokeButton.textContent = '看筆順';prompts.append(strokeButton);
  }
  let review = heading?.querySelector('.cw-review');
  if (!review) {review = doc.createElement('div');review.className = 'cw-review';(heading || root).append(review);}
  review.innerHTML = '<div class="cw-review-actions"><button type="button" data-cw="practise">再寫一次</button></div>';review.hidden = true;
  const retryButton = review.querySelector('button');
  const prompt = heading?.querySelector('.challenge-prompt'), originalPrompt = prompt?.textContent;

  function updateControls() {
    if (destroyed) return;
    const hasInk = Boolean(pad?.getStrokes().length);
    root.dataset.phase = phase;
    $('[data-cw="clear"]').disabled = busy || !(phase === 'tracing' || animation.hidden && (hasInk && phase === 'assessment' || result));
    $('[data-cw="submit"]').disabled = !canSubmit() || !hasInk;
    $('[data-cw="submit"]').textContent = busy ? '辨認中…' : '檢查';
    $('[data-cw="skip"]').hidden = !result && phase !== 'assessment';
    $('[data-cw="skip"]').disabled = busy || canContinue() || !result && !traceCompleted;
    strokeButton.disabled = busy || phase === 'demonstrating';
    review.hidden = !(demonstrationComplete && !practising);retryButton.disabled = busy;
    canvas.setAttribute('aria-disabled',String(locked()));canvas.setAttribute('aria-hidden',String(!animation.hidden));
    root.setAttribute('aria-busy',String(busy));
    if (prompt) prompt.textContent = phase === 'demonstrating' && !result && !traceCompleted ? '先看筆順，再描紅。'
      : phase === 'tracing' ? '跟着淡紅色的字描一遍。' : originalPrompt;
    const reason = busy ? 'recognizing' : !result ? 'unanswered' : result.correct ? 'independent-correct' : correction?.status === 'corrected' ? 'corrected' : correction?.status === 'skipped' ? 'explicitly-skipped' : 'correction-required';
    root.dataset.advance = canContinue() ? 'ready' : 'blocked';
    const key = `${canContinue()}:${reason}`;
    if (key !== advanceKey) {
      advanceKey = key;
      onAdvanceStateChange({canContinue:canContinue(),reason,correction:correction?{...correction,candidates:[...correction.candidates]}:null});
    }
  }
  function stopAnimation() {
    strokeOperation++;animationRequest?.abort();animationRequest = null;
    if (writer) {try {writer.pauseAnimation();} catch {}try {writer.cancelQuiz();} catch {}writer = null;}
    demonstrationComplete = false;animation.replaceChildren();animation.hidden = true;
  }
  function revealBoard() {if (!destroyed) root.scrollIntoView({block:'nearest',inline:'nearest'});}
  function showResult() {
    phase = 'review';root.classList.add('is-answered');
    status.textContent = result.status === 'skipped' ? '這題先跳過。' : result.correct ? '寫對了！可以繼續下一題。'
      : result.recognized ? `辨認為「${result.recognized}」，清空後再試一次。` : '清空後再寫一次，也可以看筆順。';
    updateControls();
  }
  function commit(statusValue,candidates = []) {
    if (destroyed || result || externalAnswered()) return;
    practising = false;
    result = Object.freeze({status:statusValue,correct:statusValue==='correct',skipped:statusValue==='skipped',independent:statusValue==='correct',char:character,
      recognized:candidates[0] || null,candidates:Object.freeze([...candidates]),submittedAt:Date.now(),
      ...(traceCompleted?{flow:'trace-dictation-v1',traceCompleted:true,dictationCompleted:statusValue==='correct'}:{})});
    showResult();onSubmit({...result,candidates:[...result.candidates]});
  }
  async function submit() {
    if (!canSubmit()) return;
    const strokes = pad.finish();if (!strokes.length) {status.textContent = '先在田字格寫下你的答案。';return;}
    const start = strokes[0][0].t;
    const ink = strokes.map(stroke => [stroke.map(p=>Math.round(p.x)),stroke.map(p=>Math.round(p.y)),stroke.map(p=>p.t-start)]);
    busy = true;const correcting = Boolean(result), count = correcting?++correctionCount:++recognitionCount;
    auditWriting(count>1?'retry':'attempt_started',{retryCount:count-1,metrics:{strokeCount:strokes.length,eraseCount}});
    const request = ++operation, started = view.performance.now();status.textContent = '正在辨認你的字…';updateControls();
    let candidates;
    try {
      const response = await recognize(ink,{mode:correcting?'review':'standard',phase:correcting?'correction':'assessment',attemptNo:count});
      if (destroyed || request!==operation || (!correcting && (result || externalAnswered()))) return;
      candidates = Array.isArray(response?.candidates)?response.candidates.filter(v=>typeof v==='string'&&v.trim()).map(normalize):[];
      if (!candidates.length) {
        auditWriting('error',{error:{code:'invalid_response',retryable:true},metrics:{strokeCount:strokes.length}});
        status.textContent = '這次未能辨認，不計對錯。可以寫大一點，再試一次。';return;
      }
    } catch {
      if (!destroyed && request===operation) {
        auditWriting('error',{error:{code:'provider_unavailable',retryable:true},metrics:{strokeCount:strokes.length}});
        status.textContent = '辨認暫時未能連線，筆跡已保留，請再試一次。';
      }return;
    } finally {if (!destroyed && request===operation) {busy=false;updateControls();}}
    const latencyMs = Math.min(600000,Math.round(view.performance.now()-started));
    if (correcting) {
      const correct = accepted.has(candidates[0]);
      const latest = Object.freeze({status:correct?'corrected':'incorrect',correct,independent:false,mode:'review',recognized:candidates[0],candidates:Object.freeze(candidates.slice(0,10)),attemptNo:count,submittedAt:Date.now()});
      if (correct || !['corrected','skipped'].includes(correction?.status)) correction = latest;
      status.textContent = correct?'這次寫對了！可以繼續下一題。':`辨認為「${candidates[0]}」，清空後再試一次。`;
      auditWriting('feedback_shown',{attemptNo:count,result:{status:correct?'correct':'incorrect',correct,score:null},metrics:{latencyMs}});
      onCorrection({...latest,candidates:[...latest.candidates]});updateControls();
    } else {
      auditWriting('item_interacted',{interaction:'game_action',metrics:{latencyMs}});
      commit(accepted.has(candidates[0])?'correct':'incorrect',candidates.slice(0,10));
    }
  }
  function startTracing() {
    if (destroyed || !writer || result) return;
    phase = 'tracing';demonstrationComplete = false;const request = strokeOperation;tracingCount++;
    status.textContent = '沿着淡紅色的字，一筆一筆描紅。';animation.setAttribute('aria-label','描紅練習區');animation.setAttribute('role','group');
    auditLearning('attempt_started',{attemptNo:tracingCount,metrics:{hintCount:1}});updateControls();
    writer.quiz({showHintAfterMisses:2,highlightOnComplete:false,leniency:1,
      onCorrectStroke:data=>{
        if (destroyed || request!==strokeOperation || phase!=='tracing') return;
        status.textContent = data.strokesRemaining?`這一筆對了，還有 ${data.strokesRemaining} 筆。`:'描紅完成！';
        auditLearning('item_interacted',{interaction:'stroke_finished',metrics:{strokeCount:data.strokeNum+1}});
      },
      onMistake:()=>{if (!destroyed && request===strokeOperation && phase==='tracing') status.textContent='這一筆再試一次，跟着淡紅色的筆畫寫。';},
      onComplete:()=>{
        if (destroyed || request!==strokeOperation || phase!=='tracing') return;
        auditLearning('feedback_shown',{context:{flow:'trace-dictation-v1',itemType:'dictation',traceCompleted:true,dictationCompleted:false},result:{status:'completed',score:null,correct:null}});
        // Finish the vendor's callback before cancelling its quiz.
        view.queueMicrotask(()=>{
          if (destroyed || request!==strokeOperation || phase!=='tracing') return;
          stopAnimation();traceCompleted=true;phase='assessment';pad.clear();
          status.textContent='描紅完成！聽詞語，自己寫一次。';onTraceComplete({completed:true});updateControls();
        });
      }
    });
  }
  async function showStrokes() {
    if (destroyed || busy || phase==='demonstrating' && animationRequest) return;
    practising=false;pad?.finish();stopAnimation();phase='demonstrating';const request=strokeOperation;
    animation.hidden=false;animation.setAttribute('role','img');animation.setAttribute('aria-label','筆順示範');
    status.textContent='正在準備筆順…';updateControls();animationRequest=new view.AbortController();
    const signal=animationRequest.signal, timer=view.setTimeout(()=>animationRequest?.abort(),12000);
    auditLearning('hint_used',{hint:{kind:'stroke',count:1}});
    try {
      const resource=new URL(`./vendor/hanzi-data/${character.codePointAt(0).toString(16)}.json`,import.meta.url);
      const [HanziWriter,data]=await Promise.all([loadHanziWriter(view,{signal}),view.fetch(resource,{signal}).then(response=>{if(!response.ok)throw new Error('Stroke data is unavailable.');return response.json();})]);
      view.clearTimeout(timer);if(destroyed||request!==strokeOperation)return;
      const size=Math.max(1,board.clientWidth);
      writer=HanziWriter.create(animation,character,{width:size,height:size,padding:size*45/560,showCharacter:false,showOutline:true,
        strokeColor:'#286650',outlineColor:'#e4a6a0',drawingColor:'#286650',highlightColor:'#b64843',strokeAnimationSpeed:1,delayBetweenStrokes:180,drawingWidth:Math.max(5,size/55),
        charDataLoader:(_char,onLoad)=>onLoad(data)});
      status.textContent='先看完筆順，留意每一筆的方向。';auditLearning('playback_started');await writer.animateCharacter();
      if(destroyed||request!==strokeOperation)return;
      animationRequest=null;auditLearning('playback_ended');
      if(!result&&!traceCompleted)startTracing();
      else{phase=result?'review':'assessment';demonstrationComplete=true;status.textContent='看完了，按「再寫一次」試一試。';updateControls();}
    }catch{
      if(!destroyed&&request===strokeOperation){stopAnimation();phase=result?'review':traceCompleted?'assessment':'interrupted';status.textContent=traceCompleted?'筆順未能播放，可以繼續寫字，或再試一次。':'筆順未能播放，請再按「看筆順」。';auditLearning('error',{error:{code:'stroke_unavailable',retryable:true}});updateControls();}
    }finally{view.clearTimeout(timer);}
  }
  function practise({reveal=true}={}) {
    if(destroyed||busy||!result&&!traceCompleted||!animation.hidden&&!demonstrationComplete)return;
    stopAnimation();phase=result?'review':'assessment';practising=true;pad.clear();status.textContent='在田字格再寫一次，寫好後按「檢查」。';updateControls();if(reveal)revealBoard();
  }
  function skipCorrection() {
    if(destroyed||busy||!result||canContinue())return;
    correction=Object.freeze({status:'skipped',correct:false,independent:false,mode:'review',recognized:null,candidates:Object.freeze([]),attemptNo:correctionCount,submittedAt:Date.now()});
    practising=false;stopAnimation();phase='review';status.textContent='這題先跳過。';
    auditWriting('feedback_shown',{result:{status:'skipped',correct:null,score:null}});onCorrection({...correction,candidates:[]});updateControls();
  }
  const beginPractice=event=>{if(!destroyed&&result&&phase==='review'&&animation.hidden&&!practising&&!busy&&event.button!==2)practise({reveal:false});};
  for(const type of ['pointerdown','touchstart'])board.addEventListener(type,beginPractice,{capture:true,signal:controller.signal,passive:true});
  pad=createHandwritingPad(canvas,{isLocked:locked,interactionSurface:board,onChange:strokes=>{
    if(strokes.length>lastStrokeCount)auditWriting('item_interacted',{interaction:'stroke_finished',metrics:{strokeCount:strokes.length,eraseCount}});
    lastStrokeCount=strokes.length;updateControls();
  }});
  function click(event) {
    const button=event.target.closest?.('[data-cw]');if(!button||button.disabled||destroyed)return;
    if(button.dataset.cw==='clear'){
      eraseCount++;if(phase==='tracing')startTracing();else if(result&&!practising)practise({reveal:false});else pad.clear();
      auditWriting('item_interacted',{interaction:'ink_cleared',metrics:{eraseCount,strokeCount:0}});
    }
    if(button.dataset.cw==='submit')void submit();
    if(button.dataset.cw==='skip'&&!busy&&(result||phase==='assessment'&&traceCompleted)){
      stopAnimation();phase='review';if(!result){pad.finish();commit('skipped');}skipCorrection();
    }
    if(button.dataset.cw==='strokes')void showStrokes();
    if(button.dataset.cw==='practise'&&demonstrationComplete)practise();
  }
  root.addEventListener('click',click,{signal:controller.signal});
  if(!root.contains(prompts))prompts.addEventListener('click',click,{signal:controller.signal});
  if(!root.contains(review))review.addEventListener('click',click,{signal:controller.signal});
  const resize=typeof view.ResizeObserver==='function'?new view.ResizeObserver(()=>{
    if(!destroyed&&writer){const size=Math.max(1,board.clientWidth);writer.updateDimensions({width:size,height:size,padding:size*45/560});}
  }):null;resize?.observe(board);
  doc.addEventListener('visibilitychange',()=>{
    if(doc.visibilityState!=='hidden')return;pad.finish();
    if(phase==='demonstrating'){stopAnimation();phase=result?'review':traceCompleted?'assessment':'interrupted';status.textContent=traceCompleted?'可以繼續寫字，或再看筆順。':'再按「看筆順」，把筆順看完。';updateControls();}
  },{signal:controller.signal});
  if(initialResult&&['correct','incorrect','skipped'].includes(initialResult.status)){
    result=Object.freeze({...initialResult,char:character,correct:initialResult.status==='correct',skipped:initialResult.status==='skipped',independent:initialResult.status==='correct',
      recognized:typeof initialResult.recognized==='string'?initialResult.recognized:null,candidates:Object.freeze(Array.isArray(initialResult.candidates)?[...initialResult.candidates]:[])});
    traceCompleted=initialResult.traceCompleted===true;
    if(initialCorrection&&['corrected','skipped'].includes(initialCorrection.status)){
      correction=Object.freeze({status:initialCorrection.status,correct:initialCorrection.status==='corrected',independent:false,mode:'review',recognized:typeof initialCorrection.recognized==='string'?initialCorrection.recognized:null,candidates:Object.freeze([]),attemptNo:Number.isSafeInteger(initialCorrection.attemptNo)&&initialCorrection.attemptNo>=0?initialCorrection.attemptNo:0,submittedAt:initialCorrection.submittedAt});correctionCount=correction.attemptNo;
    }
    showResult();if(correction)status.textContent=correction.status==='corrected'?'這個字已訂正，可以繼續下一題。':'這題先跳過。';
  }else{updateControls();void showStrokes();}
  return{
    getResult(){return result?{...result,candidates:[...result.candidates]}:null;},
    getCorrection(){return correction?{...correction,candidates:[...correction.candidates]}:null;},canContinue,skipCorrection,
    destroy(){if(destroyed)return;destroyed=true;operation++;stopAnimation();resize?.disconnect();controller.abort();pad.destroy();review.hidden=true;root.remove();if(prompt)prompt.textContent=originalPrompt;}
  };
}
