import {imageAsset} from './media-images.mjs?v=20261007-school46';
import {CHALLENGE_SETS} from './challenge-data.mjs?v=20261006-school43';
import {newAttempt, newReviewAttempt, prepareAttempt, recordAnswer, challengeSummary, attemptItems, safeGameState} from './challenge-state.mjs?v=20261006-school43';
import {mountChallengeWriting} from './challenge-writing.mjs?v=20260929-hk1';
import {mountChallengeModel} from './challenge-model.mjs?v=20261006-school43';
import {mountLivingField} from './living-field.mjs?v=20261007-school46';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COMPACT_PROMPTS = {
  'g1-s2':'這個字是第幾聲？',
  'g1-m1':'替白鵝、水面和腳掌配色。',
  'g2-m1':'把三張故事卡依次放好。',
  'g3-s1':'聽開頭，找聲母。',
  'g3-s2':'這次聽到哪個聲母？',
  'g3-m1':'照片是橫看，還是側看？',
  'g4-s2':'「我」的韻母是哪個？',
  'g4-m1':'替畫片配上心聲。',
  'g5-s1':'聽字音，找聲母。',
  'g5-s2':'這次聽到哪個聲母？',
  'g5-m1':'詩裏的野草和豆苗長得怎樣？',
  'g6-s1':'只聽聲音，找出聲母。',
  'g6-s2':'再聽一次，找出聲母。',
  'g6-m1':'哪張是近看？哪張是遠看？',
  'p7-s2':'再聽一個字，這個字是第幾聲？',
  'p9-s1':'聽開頭，找聲母。',
  'p10-s2':'「三國」的「國」，韻母是哪一個？',
  'p11-s1':'只靠耳朵，找出這個字的聲母。',
  'p11-s2':'留意字音的開頭，這次聽到哪個聲母？',
  'p12-s2':'再分辨一次，這次聽到哪個聲母？'
};
const prompt = item => COMPACT_PROMPTS[item.id] || item.prompt;
const KIND = {sound:'聽音小鋪', dictation:'描紅與聽寫', microgame:'詩裏玩一玩', match:'動手解詩', sequence:'故事排一排', 'scene-builder':'種一片詩田'};
// 聽音選擇題的答題形式只在這裏決定，題目、答案、計分和記錄都不受影響。
// 四種形式：警察抓犯人、小醫生問診、海灘尋寶（開寶箱）、超市採購。
// 每個年級有兩首詩：第一期（id 1-6）和第二期（id 7-12，SOUND_ROUND_TWO）。按一輪裏有幾題聽音選擇題 n、
// 這題是其中第幾題 i（由 0 起）決定：
//   n=1：第一期抓犯人，第二期問診；
//   n=2：第一期 [抓犯人, 問診]，第二期 [開寶箱, 購物]；
//   n=3：第一期 [抓犯人, 問診, 開寶箱]，第二期 [抓犯人, 問診, 購物]；
//   n≥4：兩期都依次 [抓犯人, 問診, 開寶箱, 購物]。
// 一輪的題目次序在開始時已存進記錄（itemIds），重新載入不會變；錯題重做沿用原來那一輪的次序，
// 所以同一題重做時仍是同一個形式。找不到這題時：第一期抓犯人，第二期開寶箱。
// scene is the question picture; a right answer fades in solved, a wrong or skipped one fades in missed.
const SOUND_ROUND_TWO = new Set(['yong-xue', 'hua-ji', 'qi-bu-shi', 'jue-ju', 'zheng-ren-mai-lu', 'ke-zhi']);
const SOUND_FORMS = {
  clinic: {id:'clinic', kind:'小醫生問診', scene:'media/challenges/clinic-v1.webp', solved:'media/challenges/clinic-well-v1.webp', missed:'media/challenges/clinic-cry-v1.webp', cast:'media/challenges/clinic-bottles-v1.webp',
    cue:'問一問，聽一聽', again:'再點一次，再聽一聽', listen:'問診：點一點，聽題目聲音', listenAgain:'再點一次，再聽題目聲音',
    instruction:'先問診聽一聽，再選一種藥。', group:'選一種藥', start:'先點上面問診，聽一聽，再選藥。', ready:'聽好了，選一種藥。',
    retry:'聲音還沒播完，請再點一次問診。', submit:'開藥', right:'藥開對了，好起來了！', wrong:'差一點，一起看看。'},
  police: {id:'police', kind:'警察抓犯人', scene:'media/challenges/police-v1.webp', solved:'media/challenges/police-caught-v1.webp', missed:'media/challenges/police-sad-v1.webp', cast:'media/challenges/police-lineup-v1.webp',
    cue:'聽聽線索', again:'再點一次，再聽線索', listen:'點對講機，聽線索聲音', listenAgain:'再點對講機，再聽一次線索',
    instruction:'先聽線索，再找出犯人。', group:'找出犯人', start:'先點對講機聽線索，再找犯人。', ready:'聽好了，找出犯人。',
    retry:'聲音還沒播完，請再點對講機聽一次。', submit:'就是他！', right:'抓到了！就是他！', wrong:'不是他，一起看看。'},
  // 只有一個寶箱有寶藏（正確答案），其餘都是彈簧陷阱。
  chest: {id:'chest', kind:'海灘尋寶', scene:'media/challenges/chest-v1.webp', solved:'media/challenges/chest-found-v1.webp', missed:'media/challenges/chest-trap-v1.webp', cast:'media/challenges/chest-boxes-v1.webp',
    cue:'貝殼聽一聽', again:'再點一次，再聽貝殼', listen:'點貝殼，聽題目聲音', listenAgain:'再點貝殼，再聽一次',
    instruction:'先聽貝殼，再選一個寶箱。', group:'選一個寶箱', start:'先點貝殼聽一聽，再選寶箱。', ready:'聽好了，選一個寶箱。',
    retry:'聲音還沒播完，請再點一次貝殼。', submit:'打開寶箱', right:'找到寶藏了！', wrong:'是陷阱！一起看看。'},
  shop: {id:'shop', kind:'超市採購', scene:'media/challenges/shop-v1.webp', solved:'media/challenges/shop-happy-v1.webp', missed:'media/challenges/shop-sad-v1.webp', cast:'media/challenges/shop-goods-v1.webp',
    cue:'聽聽購物單', again:'再點一次，再聽購物單', listen:'點購物單，聽題目聲音', listenAgain:'再點購物單，再聽一次',
    instruction:'先聽購物單，再選一樣貨品。', group:'選一樣貨品', start:'先點購物單聽一聽，再選貨品。', ready:'聽好了，選一樣貨品。',
    retry:'聲音還沒播完，請再點一次購物單。', submit:'買這個', right:'買對了，謝謝你！', wrong:'買錯了，一起看看。'}
};
const SOUND_ORDER = Object.freeze({1:[['police'],['clinic']], 2:[['police','clinic'],['chest','shop']], 3:[['police','clinic','chest'],['police','clinic','shop']]});
// Pure rule: which form the index-th of count listening questions in a round uses.
export function soundFormId(roundTwo, count, index) {
  if (!Number.isInteger(count) || !Number.isInteger(index) || index < 0 || index >= count) return roundTwo ? 'chest' : 'police';
  return count >= 4 ? ['police', 'clinic', 'chest', 'shop'][index % 4] : SOUND_ORDER[count][roundTwo ? 1 : 0][index];
}
// roundIds: the round's item ids in their saved order (attempt.itemIds; for 錯題重做 the source round's).
// Without them the poem's canonical item list is used.
export const soundForm = (poem, item, roundIds) => {
  const set = CHALLENGE_SETS[poem?.slug], bank = set ? set.bank || set.items : [];
  const ids = (Array.isArray(roundIds) && roundIds.length ? roundIds : (set?.items || []).map(value => value.id))
    .filter(id => bank.some(value => value.id === id && value.type === 'sound'));
  return SOUND_FORMS[soundFormId(SOUND_ROUND_TWO.has(poem?.slug), ids.length, ids.indexOf(item?.id))];
};
const markIcon = {
  clinic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg>',
  police:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.5" cy="16" r="4"/><circle cx="17.5" cy="16" r="4"/><path d="M6.5 12V8.6a1.6 1.6 0 0 1 1.6-1.6h1.4m8 5V8.6A1.6 1.6 0 0 0 15.9 7h-1.4m-4.5 0h4"/></svg>',
  chest:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10l4 5.5L12 20 3 9.5Z"/><path d="M3 9.5h18M9.5 4 8 9.5l4 10.5 4-10.5L14.5 4"/></svg>',
  shop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8.5h14l-1.2 11.5H6.2Z"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/></svg>'
};
const soundIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const tone = shape => shape ? `<svg class="challenge-tone" viewBox="0 0 70 35" aria-hidden="true"><path d="${{level:'M8 10H62', rising:'M8 28 62 6', dipping:'M8 13 32 29 62 6', falling:'M8 6 62 28'}[shape]}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` : '';
const makeURL = path => new URL(path, import.meta.url).href;

export function mountChallenge(container, {poem, saved, onChange, onComplete, playAudio, stopAudio, recognize, prewarm = () => {}, prefetchAudio = () => {}, onResearch = () => {}, onAnswer = () => {}, onCorrectionProgress = () => {}} = {}) {
  const set = CHALLENGE_SETS[poem.slug];
  if (!set) throw new Error('missing-challenge');
  let attempt = prepareAttempt(set, saved), dead = false, screen = attempt.cursor;
  let items = attemptItems(attempt, set);
  let game = null, gameEpoch = 0, draftTimer = null, pendingGameSolution = false;
  let heard = false, playing = false, selected = null, placements = {}, density = {}, writing = null, model = null, livingField = null;
  let pageEvents = null, renderGeneration = 0, audioGeneration = 0, writingAdvance = false, writingTraced = false;
  const q = selector => container.querySelector(selector);
  const save = () => onChange?.(structuredClone(attempt));
  const saveDraftSoon = () => {clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftTimer=null;save();},120);};
  const flushDraft = () => {if(draftTimer!==null){clearTimeout(draftTimer);draftTimer=null;save();}};
  const ordered = item => (attempt.orders[item.id] || []).map(id => (item.options || item.cards).find(card => card.id === id));
  const currentAnswer = () => attempt?.answers[screen];
  // The form follows the round's saved order; a 錯題重做 round keeps the form of the round it came from.
  const formOf = item => soundForm(poem, item, attempt.mode === 'review' ? attempt.sourceAttempt?.itemIds : attempt.itemIds);
  let itemPresentedAt = performance.now(), selectionChanges = 0;
  function researchContext(){
    const item=items[screen];
    return {attemptId:attempt.attemptId,itemId:item?.id||'challenge-summary',activity:item?.type==='dictation'?'writing':'challenge',
      context:{mode:attempt.mode||'standard',itemType:item?.type||'microgame',position:Math.min(screen+1,items.length),total:items.length,
        ...(item?.type==='dictation'&&(!currentAnswer()||currentAnswer().flow==='trace-dictation-v1')?{flow:'trace-dictation-v1',traceCompleted:writingTraced,dictationCompleted:currentAnswer()?.dictationCompleted===true||storedCorrection(item)?.status==='corrected'}:{}),
        optionOrder:(attempt.orders[item?.id]||[]).map(String),...(attempt.sourceAttempt?.attemptId?{sourceAttemptId:attempt.sourceAttempt.attemptId}:{})}};
  }
  function audit(type,fields={}){const base=researchContext();onResearch(type,{...base,...fields,context:{...base.context,...(fields.context||{})}});}
  // Correction recognition is practice evidence, never a second first answer.
  const recognizeItem=(ink,options={})=>{
    const context=researchContext();
    const correction=options.phase==='correction'||options.mode==='review';
    return recognize(ink,{...context,context:{...context.context,...(correction?{mode:'review'}:{})}});
  };
  const storedCorrection = item => {
    const value=attempt.writingCorrections?.[item.id];
    return value&&['corrected','skipped'].includes(value.status)?value:null;
  };
  const pendingWriting = () => items.findIndex((item,index)=>item.type==='dictation'&&attempt.answers[index]&&attempt.answers[index].status!=='correct'&&!storedCorrection(item));
  function updateWritingAdvance() {
    const next=q('[data-ch="next"]');
    if(!next||items[screen]?.type!=='dictation')return;
    const ready=!!currentAnswer()&&(writing?.canContinue?.()??writingAdvance);
    next.hidden=!ready;next.disabled=!ready;
    q('.challenge-footer').hidden=!ready;
  }
  function mountWriting(answer=null) {
    const item=items[screen],generation=renderGeneration,initialCorrection=storedCorrection(item);
    writingTraced=answer?.traceCompleted===true;
    prewarm();
    writingAdvance=answer?.status==='correct'||!!initialCorrection;
    writing=mountChallengeWriting(q('.challenge-writing-holder'),{target:item.target,recognize:recognizeItem,onResearch:audit,
      initialResult:answer,initialCorrection,onSubmit:result=>submit(result),
      onTraceComplete:()=>{
        if(dead||generation!==renderGeneration)return;
        writingTraced=true;prewarm();
        onAnswer({...researchContext(),status:'completed'});
      },
      onAdvanceStateChange:state=>{
        if(dead||generation!==renderGeneration)return;
        writingAdvance=state.canContinue===true;
        if(writingAdvance&&state.correction&&['corrected','skipped'].includes(state.correction.status)&&currentAnswer()){
          const previous=storedCorrection(item);
          if(previous?.status!==state.correction.status){
            attempt.writingCorrections={...attempt.writingCorrections,[item.id]:{status:state.correction.status}};save();
            onCorrectionProgress({attemptId:attempt.attemptId,itemId:item.id,status:state.correction.status});
            if(currentAnswer()?.flow==='trace-dictation-v1'&&(currentAnswer().status!=='skipped'||state.correction.status==='corrected')){
              const context=researchContext();
              onAnswer({...context,status:state.correction.status==='corrected'?'correct':'skipped',context:{...context.context,flow:'trace-dictation-v1',traceCompleted:true,dictationCompleted:state.correction.status==='corrected'}});
            }
          }
        }
        updateWritingAdvance();
      }});
    updateWritingAdvance();
  }
  function release() {flushDraft();renderGeneration++; audioGeneration++; gameEpoch++;game?.destroy();game=null;pendingGameSolution=false;pageEvents?.abort(); writing?.destroy(); writing = null; model?.destroy(); model = null; livingField?.destroy();livingField=null;stopAudio?.(); playing = false;}
  function startPage(html) {
    release(); pageEvents = new AbortController(); container.innerHTML = html;
    container.addEventListener('click', click, {signal: pageEvents.signal});
    container.addEventListener('error', event => {if (event.target.matches?.('img')) event.target.classList.add('challenge-image-error');}, {capture:true, signal:pageEvents.signal});
    window.addEventListener('pagehide',flushDraft,{signal:pageEvents.signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)flushDraft();},{signal:pageEvents.signal});
    container.scrollTop = 0;
  }
  function gameBody() {
    return '<div class="challenge-game-holder"><p class="challenge-game-loading" role="status">把小世界打開中…</p></div>';
  }
  async function loadGame() {
    const holder = q('.challenge-game-holder'), item = items[screen];
    if (!holder || item.type !== 'microgame') return;
    const epoch = ++gameEpoch, generation = renderGeneration;
    game?.destroy();game=null;
    const answer = currentAnswer();
    const state = safeGameState(answer?.response || attempt.gameDrafts?.[item.id]);
    const locked = !!answer;
    const active = () => !dead && epoch === gameEpoch && generation === renderGeneration;
    try {
      const {mountPoemGame} = await import('./poem-games/index.mjs?v=20261007-school46');
      if (!active()) return;
      let completionReceived = false;
      const mounted = mountPoemGame(holder, {slug: poem.slug, initialState: state, readOnly: locked,
        onResearch:(type,fields)=>{if(active())audit(type,fields);},
        playAudio: async audio => active() ? await playAudio?.(audio,researchContext()) : false,
        onState: value => {
          if (!active() || locked || completionReceived || currentAnswer()) return;
          const draft = safeGameState(value);
          if (!draft) return;
          attempt.gameDrafts[item.id] = draft;saveDraftSoon();
        },
        onComplete: result => {
          if (!active() || locked || completionReceived || result?.correct !== true || currentAnswer()) return;
          const response = safeGameState(result.response);
          if (!response) return;
          completionReceived = true;
          const finished = {...safeGameState(attempt.gameDrafts[item.id]), ...response, gameCompleted:true};
          attempt.gameDrafts[item.id] = finished;
          submit({status:'correct',response:finished});
        }});
      if (!active()) mounted?.destroy(); else {game = mounted;if(pendingGameSolution)game?.showSolution?.();}
    } catch {
      if (active()) holder.innerHTML='<div class="challenge-game-loading" role="status"><p>小世界還沒打開，再試一次吧。</p><button class="challenge-secondary" data-ch="retry-game">重新打開</button></div>';
    }
  }
  function header(item) {
    return `<header class="challenge-header"><div><span class="challenge-eyebrow">${attempt.mode==='review'?'錯題重做':attempt.mode==='advanced'?'高階挑戰':item.type==='sound'?formOf(item).kind:KIND[item.type]}</span><span class="challenge-count">${screen+1}<small> / ${items.length}</small></span></div><div class="challenge-steps" aria-label="第 ${screen+1} 題，共 ${items.length} 題">${items.map((_,i)=>`<i class="${i<screen?'done':i===screen?'current':''}"></i>`).join('')}</div></header>`;
  }
  function soundBody(item) {
    const form=formOf(item);
    return `<div class="sound-case is-${form.id}" data-sound-form="${form.id}"><button type="button" class="sound-case-scene" data-ch="listen" aria-label="${form.listen}" draggable="false"><img class="sound-case-picture" src="${esc(imageAsset(form.scene))}" alt="" draggable="false"><img class="sound-case-picture is-after" src="${esc(imageAsset(form.solved))}" alt="" draggable="false"><img class="sound-case-picture is-missed-pic" src="${esc(imageAsset(form.missed))}" alt="" draggable="false"><span class="sound-case-cue">${soundIcon}<span class="sound-case-cue-text">${form.cue}</span></span></button><div class="sound-case-work"><h2 class="challenge-prompt" tabindex="-1">${esc(prompt(item))}</h2><p class="challenge-instruction">${form.instruction}</p><div class="sound-case-options" role="group" aria-label="${form.group}">${ordered(item).map((option,index)=>`<button type="button" class="sound-case-option" data-ch="choose" data-option="${option.id}" aria-pressed="false" disabled><span class="sound-case-figure"><span class="sound-case-art is-cell-${index%4}" aria-hidden="true"><img src="${esc(imageAsset(form.cast))}" alt="" draggable="false"></span><span class="sound-case-tag">${tone(option.contour)}<span>${esc(option.label)}</span></span><span class="sound-case-mark" aria-hidden="true">${markIcon[form.id]}</span></span></button>`).join('')}</div><p class="challenge-audio-status" role="status" aria-live="polite">${form.start}</p></div></div>`;
  }
  function writingBody(item) {
    return `<div class="challenge-writing-layout"><div class="challenge-writing-heading"><h2 class="challenge-prompt" tabindex="-1">${esc(prompt(item))}</h2><div class="challenge-writing-prompts"><button class="challenge-listen" data-ch="listen">${soundIcon}<span>聽詞語</span></button><button type="button" class="challenge-strokes" data-cw="strokes"><span>看筆順</span></button></div><p class="challenge-audio-status" role="status"></p><div class="cw-review" hidden></div></div><div class="challenge-writing-holder"></div></div>`;
  }
  function cardHTML(card) {
    return `${card.image ? `<img src="${esc(makeURL(card.image))}" alt="${esc(card.label)}" decoding="async">` : card.color ? `<i class="challenge-color" style="--card-color:${esc(card.color)}" aria-hidden="true"></i>` : ''}<span>${esc(card.label)}</span>`;
  }
  function fieldHTML() {
    // Each change visibly rebuilds a different field. Plant spacing is stable,
    // so the child sees the effect of density rather than a random shuffle.
    const grass = density.grass === 'dense' ? 72 : density.grass === 'sparse' ? 8 : 0;
    const beans = density.beans === 'dense' ? 18 : density.beans === 'sparse' ? 3 : 0;
    const plants = [];
    for (let i=0;i<grass;i++) {const x=7+(i*37%86),y=24+(i*29%57);plants.push(`<img class="living-grass" src="media/living-scenes/grass-v1.webp" alt="" style="left:${x}%;top:${y}%;transform:translate(-50%,-80%) scale(${.68+y/190}) rotate(${i%3*10-10}deg)" aria-hidden="true">`);}
    for (let i=0;i<beans;i++) {const x=18+(i*31%65),y=35+(i*23%43);plants.push(`<img class="living-bean" src="media/living-scenes/bean-v1.webp" alt="" style="left:${x}%;top:${y}%" aria-hidden="true">`);}
    return `<div class="challenge-field-ground">${plants.join('')}</div><div class="challenge-field-caption">${density.grass && density.beans ? '這是你種的田地' : '調一調，田地就會長出植物'}</div>`;
  }
  function gooseHTML(item) {
    const color = slot => item.cards.find(card=>card.id===placements[slot])?.color || '#e2e1d5';
    return `<div class="challenge-goose"><svg viewBox="0 0 120 106" role="img" aria-label="由你配色的白鵝畫面"><g stroke="#6d7f6c" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round"><ellipse cx="57" cy="79" rx="48" ry="18" fill="${color('three')}"/><path d="m40 78-11 5 4 5 18-5m10-4-7 10 8 2 10-10" fill="${color('one')}"/><path d="M17 55c9 7 19 9 29 6 9-3 13-10 14-18 1-5-1-10 1-16 2-8 10-11 16-7 5 3 5 8 2 12l8 3-9 5c-4 2-5 5-5 10-2 14-13 23-28 23-13 0-23-6-28-18Z" fill="${color('two')}"/><path d="m79 32 8 3-9 5-1-5Z" fill="#c5ad86"/><path d="M30 60c8 3 18 2 25-4-3 9-15 14-25 4ZM62 48c2-5 2-9 2-12" fill="none"/><circle cx="74" cy="27" r="1.3" fill="#455445" stroke="none"/><path d="M16 83h9m61-7h14M79 88h13" stroke-opacity=".4"/></g></svg></div>`;
  }
  function handsBody(item) {
    if (item.type === 'scene-builder') return `<div class="challenge-hands-layout challenge-field-layout"><div class="living-field-wrap"><div class="challenge-field"><div class="living-field-picture" role="img" aria-label="隨選擇變化的田地">${fieldHTML()}</div><div class="living-field-canvas" hidden></div></div><div class="living-field-tools"><button data-ch="field-3d">立體種植</button><button data-ch="field-picture" hidden>回到插畫</button><span class="living-field-status" role="status"></span></div></div><div class="challenge-hands-work"><h2 class="challenge-prompt" tabindex="-1">${esc(prompt(item))}</h2><p class="challenge-instruction">想想詩裏的田地，讓植物長出來。</p>${item.layers.map(layer=>`<fieldset class="challenge-density"><legend>${esc(layer.label)}</legend>${layer.choices.map(choice=>`<button data-ch="density" data-layer="${layer.id}" data-density="${choice.id}" aria-pressed="false">${esc(choice.label)}</button>`).join('')}</fieldset>`).join('')}<p class="challenge-manipulation-status" role="status">兩種都選好，再按「放好了」。</p></div></div>`;
    return `<div class="challenge-hands-layout"><div class="challenge-observation"><div class="challenge-observation-art" data-observation></div></div><div class="challenge-hands-work"><h2 class="challenge-prompt" tabindex="-1">${esc(prompt(item))}</h2><p class="challenge-instruction">點一張卡，再點位置。</p><div class="challenge-cards" aria-label="待放的卡片">${ordered(item).map(card=>`<button class="challenge-card" data-ch="card" data-card="${card.id}" aria-pressed="false">${cardHTML(card)}</button>`).join('')}</div><div class="challenge-slots ${item.type==='sequence'?'is-sequence':''}">${item.slots.map((slot,i)=>`<button class="challenge-slot" data-ch="slot" data-slot="${slot.id}"><span class="challenge-slot-label">${item.type==='sequence'?`<b>${i+1}</b>`:''}${esc(slot.label)}</span><span class="challenge-slot-content">放在這裏</span></button>`).join('')}</div><p class="challenge-manipulation-status" role="status">卡片放好後還可以移動。</p></div></div>`;
  }
  function showQuestion() {
    const item = items[screen];
    if (!item) {summary(); return;}
    try {prefetchAudio([item.audio, items[screen + 1]?.audio].filter(Boolean));} catch {}
    writingTraced=currentAnswer()?.traceCompleted===true;
    itemPresentedAt=performance.now();audit('item_presented');
    heard = false; selected = null; placements = {}; density = {}; selectionChanges = 0;
    const answer = currentAnswer();
    if (answer?.response && item.type === 'sound') selected = answer.response;
    else if (answer?.response && item.type === 'scene-builder') density = {...answer.response};
    else if (answer?.response && item.type !== 'dictation') placements = {...answer.response};
    startPage(`<section class="challenge-shell challenge-poem-${poem.id} challenge-type-${item.type}">${header(item)}<div class="challenge-body">${item.type==='sound'?soundBody(item):item.type==='dictation'?writingBody(item):item.type==='microgame'?gameBody():handsBody(item)}</div><footer class="challenge-footer"><div class="challenge-feedback" role="status"></div><div class="challenge-footer-actions"><button class="challenge-text-button" data-ch="skip" ${answer||['dictation','sound'].includes(item.type)?'hidden':''}>跳過</button><button class="challenge-primary" data-ch="submit" disabled ${['dictation','microgame'].includes(item.type)?'hidden':''}>放好了</button><button class="challenge-primary" data-ch="next" hidden>下一題 <span aria-hidden="true">→</span></button></div></footer></section>`);
    if (item.type === 'microgame') loadGame();
    else if (item.type === 'dictation') {
      // Writing is local input. A slow, interrupted or unavailable audio
      // demonstration must not disable the pad or its learning controls.
      mountWriting(answer||null);
    } else if (item.type === 'sound') {
      updateSound();
    } else if (item.type === 'scene-builder') updateField();
    else {
      const poster = item.cards.find(c=>c.image)?.image || (poem.preview ? `media/${poem.slug}/poster.webp` : `media/exploration/${poem.slug}/scene.webp`);
      if(poem.slug==='yong-e') q('[data-observation]').innerHTML=gooseHTML(item);
      // Preview poems show the picture at every grade; their models open in the AR tab.
      else if (poem.grade <= 3 || poem.preview) q('[data-observation]').innerHTML=`<img class="challenge-observation-picture" src="${esc(makeURL(poster))}" alt="觀察畫面">`;
      else model = mountChallengeModel(q('[data-observation]'), {slug: poem.slug, poster: makeURL(poster),
        label: poem.grade === 3 ? '轉一轉山' : poem.grade === 6 ? '遠近看一看' : '走進畫面',
        controls: poem.grade===3 ? [{id:'side',label:'橫看'},{id:'front',label:'側看'}] : poem.grade===6 ? [{id:'far',label:'遠看'},{id:'near',label:'近看'}] : []});
      container.querySelectorAll('[data-card]').forEach(button => installDrag(button,'[data-slot]', slot => {selected = button.dataset.card;place(slot.dataset.slot);}));
      updatePlacements();
    }
    if (answer) feedback(answer);
    q('.challenge-prompt')?.focus({preventScroll:true});
  }
  function installDrag(button, selector, drop) {
    let point = null, dragging = false, suppress = false;
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || currentAnswer()) return;
      point = {x:event.clientX,y:event.clientY,id:event.pointerId}; dragging = false;
      button.setPointerCapture(event.pointerId);
    }, {signal:pageEvents.signal});
    button.addEventListener('pointermove', event => {
      if (!point) return;
      const dx=event.clientX-point.x,dy=event.clientY-point.y;
      if (Math.hypot(dx,dy)>10) dragging=true;
      if (dragging) {button.classList.add('is-dragging');button.style.translate=`${dx}px ${dy}px`;}
    }, {signal:pageEvents.signal});
    function finish(event) {
      if (!point) return;
      if (dragging && event.type==='pointerup') {
        button.style.pointerEvents='none';
        const target = document.elementFromPoint(event.clientX,event.clientY)?.closest(selector);
        button.style.pointerEvents='';
        if (target && container.contains(target)) drop(target);
        suppress=true;setTimeout(()=>suppress=false,0);
      }
      button.style.translate='';button.classList.remove('is-dragging');point=null;dragging=false;
    }
    button.addEventListener('pointerup',finish,{signal:pageEvents.signal});
    button.addEventListener('pointercancel',finish,{signal:pageEvents.signal});
    button.addEventListener('click',event=>{if(suppress){event.stopPropagation();event.preventDefault();}}, {capture:true,signal:pageEvents.signal});
  }
  async function listen() {
    if (playing || dead) return;
    const item = items[screen], generation = renderGeneration, playback = ++audioGeneration;
    playing = true;
    const status = q('.challenge-audio-status'), button = q('[data-ch="listen"]');
    if (status) status.textContent = '聽一聽…';
    button?.classList.add('is-playing');button?.setAttribute('aria-busy','true');
    let success = false;
    try {success = await playAudio(item.audio,researchContext()) === true;} catch {}
    if (dead || generation !== renderGeneration || playback !== audioGeneration) return;
    playing = false;button?.classList.remove('is-playing');button?.removeAttribute('aria-busy');
    if (success) heard = true;
    if (status) status.textContent = success ? item.type==='sound'?formOf(item).ready:'聽到了，可以寫字，也可以再聽一次。' : item.type==='dictation'?'聲音暫時未能播放，可以先寫字，稍後再聽。':heard?'這次未播完，可以再聽一次，或照剛才的聲音選答案。':formOf(item).retry;
    if(success&&item.type==='sound'){
      button?.setAttribute('aria-label',formOf(item).listenAgain);
      const note=q('.sound-case-cue-text');if(note)note.textContent=formOf(item).again;
    }
    if (item.type === 'sound') updateSound();
  }
  function chooseSound(id) {
    if (!heard || currentAnswer()||!items[screen].options.some(option=>option.id===id)) return;
    if(id!==selected)selectionChanges++;
    selected=id;updateSound();
    const option=items[screen].options.find(value=>value.id===id),status=q('.challenge-audio-status');
    if(status)status.textContent=`已選「${option.label}」，點「${formOf(items[screen]).submit}」。`;
  }
  function updateSound() {
    const answer=currentAnswer(),stage=q('.sound-case');
    stage?.classList.toggle('is-heard',heard);stage?.classList.toggle('is-answered',!!answer);
    stage?.classList.toggle('is-solved',answer?.status==='correct');stage?.classList.toggle('is-missed',!!answer&&answer.status!=='correct');
    container.querySelectorAll('[data-option]').forEach(button=>{
      button.disabled=!heard||!!answer;button.setAttribute('aria-pressed',String(button.dataset.option===selected));
      button.classList.toggle('is-correct',!!answer && button.dataset.option===items[screen].answerId);
    });
    const submitButton=q('[data-ch="submit"]');if(submitButton){submitButton.disabled=!heard||!selected||!!answer;submitButton.textContent=formOf(items[screen]).submit;}
    if(answer){const status=q('.sound-case .challenge-audio-status');if(status)status.textContent='';}
  }
  function place(slot) {
    if (!selected || currentAnswer()) return;
    selectionChanges++;
    for (const key of Object.keys(placements)) if (placements[key]===selected) delete placements[key];
    placements[slot]=selected;selected=null;updatePlacements();
  }
  function updatePlacements() {
    const item=items[screen],answer=currentAnswer();
    if(poem.slug==='yong-e' && q('[data-observation]'))q('[data-observation]').innerHTML=gooseHTML(item);
    container.querySelectorAll('[data-card]').forEach(button=>{
      button.disabled=!!answer;button.setAttribute('aria-pressed',String(button.dataset.card===selected));
      button.classList.toggle('is-placed',Object.values(placements).includes(button.dataset.card));
    });
    container.querySelectorAll('[data-slot]').forEach(button=>{
      const id=button.dataset.slot,card=item.cards.find(c=>c.id===placements[id]);
      button.disabled=!!answer;
      button.querySelector('.challenge-slot-content').innerHTML=card?cardHTML(card):'放在這裏';
      button.classList.toggle('is-filled',!!card);
    });
    q('[data-ch="submit"]').disabled=!!answer||!item.slots.every(slot=>placements[slot.id]);
    if(selected)q('.challenge-manipulation-status').textContent='現在點一下要放的位置。';
    else if(Object.keys(placements).length)q('.challenge-manipulation-status').textContent='可以換位置，準備好再提交。';
  }
  function updateField() {
    const answer=currentAnswer();q('.living-field-picture').innerHTML=fieldHTML();livingField?.setDensity(density);
    container.querySelectorAll('[data-density]').forEach(button=>{button.disabled=!!answer;button.setAttribute('aria-pressed',String(density[button.dataset.layer]===button.dataset.density));});
    q('[data-ch="submit"]').disabled=!!answer||!items[screen].layers.every(layer=>density[layer.id]);
  }
  function submit(result) {
    if (dead || currentAnswer()) return;
    if(!recordAnswer(attempt,set,screen,result))return;
    const response=typeof result.response==='string'?{choiceId:result.response}:result.response&&['match','sequence','scene-builder'].includes(items[screen].type)?{placements:Object.entries(result.response).filter(([,value])=>typeof value==='string').map(([slotId,choiceId])=>({slotId,choiceId}))}:undefined;
    const measured=['correct','incorrect'].includes(result.status)&&items[screen].type!=='microgame';
    audit('answer_submitted',{result:{status:items[screen].type==='microgame'&&result.status==='correct'?'completed':result.status,score:measured?(result.status==='correct'?100:0):null,correct:measured?result.status==='correct':null},metrics:{elapsedMs:Math.min(21600000,Math.round(performance.now()-itemPresentedAt)),...(['sound','match','sequence','scene-builder'].includes(items[screen].type)?{selectionChanges:Math.min(1000,selectionChanges)}:{})},...(response?{response}:{})});
    onAnswer({...researchContext(),status:result.status,...(response?{response}:{})});
    save();if(attempt.answers.length===items.length)onComplete?.(challengeSummary(attempt,set));
    audioGeneration++;stopAudio?.();playing=false;
    container.querySelectorAll('.is-playing').forEach(button=>{button.classList.remove('is-playing');button.removeAttribute('aria-busy');});
    const type=items[screen].type;
    if(type==='sound')updateSound();else if(type==='scene-builder')updateField();else if(type==='microgame'){if(result.status==='skipped')loadGame();}else if(type!=='dictation')updatePlacements();
    feedback(currentAnswer());
  }
  function feedback(answer) {
    const item=items[screen], correct=answer.status==='correct';
    audit('feedback_shown',{result:{status:answer.status,score:null,correct:null}});
    q('[data-ch="skip"]').hidden=true;q('[data-ch="submit"]').hidden=true;
    const next=q('[data-ch="next"]');next.hidden=false;
    next.textContent=screen===items.length-1?'查看成果':'下一題 →';
    q('.challenge-feedback').innerHTML=`<strong>${correct?item.type==='microgame'?'完成啦！':item.type==='sound'?formOf(item).right:'你找到了！':answer.status==='skipped'?item.type==='microgame'?'這次先收好，下次再玩。':'一起學一學':item.type==='sound'?formOf(item).wrong:'差一點，一起看看。'}</strong>${['dictation','microgame'].includes(item.type)?'':`<p>${esc(item.explanation)}</p>`}${!correct && !['dictation','sound'].includes(item.type)?`<button class="challenge-text-button" data-ch="show-solution">${item.type==='microgame'?'看看小提示':'看看怎樣放'}</button>`:''}`;
    q('.challenge-footer').classList.add('has-feedback');
    if(item.type==='dictation' && answer.status==='skipped' && !writing?.getResult?.()) {
      writing?.destroy();q('.challenge-writing-holder').inert=false;
      mountWriting(answer);
    }
    if(item.type==='dictation')updateWritingAdvance();
    if(item.type==='dictation')q('.challenge-feedback').replaceChildren();
  }
  function summary() {
    const pendingCorrection=pendingWriting();
    if(pendingCorrection!==-1){screen=pendingCorrection;attempt.cursor=pendingCorrection;save();showQuestion();return;}
    const result=challengeSummary(attempt,set);
    if(!result.completed){screen=attempt.answers.length;showQuestion();return;}
    const entries=items.map((item,i)=>{
      const answer=attempt.answers[i], number=attempt.mode==='review'?attempt.sourceAttempt.itemIds.indexOf(item.id)+1:i+1;
      const guided=answer.flow==='trace-dictation-v1',done=guided&&(answer.dictationCompleted||attempt.writingCorrections?.[item.id]?.status==='corrected');
      const focus=item.type==='dictation'?`${guided?'描紅與聽寫':'聽寫'}「${item.target.char}」`:item.type==='sound'?`${poem.grade===1?'聲調':poem.grade===2||poem.grade===4?'韻母':'聲母'}・${item.focus}`:item.type==='microgame'?item.title:KIND[item.type];
      const detail=item.type==='dictation'?item.target.pinyin:item.type==='sound'?`${item.audio.char} ${item.audio.pinyin}`:{'yong-e':'白毛・紅掌・綠水','zeng-wang-lun':'乘舟・踏歌・送別','ti-xi-lin-bi':'橫看成嶺，側看成峯','bo-chuan-gua-zhou':'江水・春意・思鄉','gui-yuan-tian-ju':'草盛豆苗稀','zao-chun':'小・酥・色・是・勝｜x、s、sh','yong-xue':'一片・千片・梅花','hua-ji':'紅冠・雪白・一叫','qi-bu-shi':'煮豆・燃萁・同根','jue-ju':'近景・中景・遠景','zheng-ren-mai-lu':'度足・忘度・試足','ke-zhi':'迎客・待客・呼鄰'}[poem.slug];
      return `<div class="challenge-result-row"><span class="challenge-result-number" aria-label="原第 ${number} 題">${number}</span><span class="challenge-result-knowledge">${esc(focus)}<small>${esc(detail)}</small></span><em class="${(guided?done:answer.correct)?'is-correct':'needs-practice'}">${guided?done?'已完成':'未完成':answer.correct?'答對':answer.status==='skipped'?'未作答':'答錯'}</em></div>`;
    }).join('');
    const guidedDone=answer=>answer.dictationCompleted||attempt.writingCorrections?.[answer.itemId]?.status==='corrected';
    const hasGuided=attempt.answers.some(answer=>answer.flow==='trace-dictation-v1');
    const allCorrect=attempt.answers.every(answer=>answer.flow==='trace-dictation-v1'?guidedDone(answer):answer.correct), pending=attempt.reviewPending?.length || 0;
    const completedN=attempt.answers.filter(answer=>answer.flow==='trace-dictation-v1'?guidedDone(answer):answer.status!=='skipped').length;
    startPage(`<section class="challenge-shell challenge-results"><header class="challenge-results-heading"><img src="media/poetry-motifs/${['goose','boat','mountain','moon','sprout','swallow','snow','rooster','beans','oriole','shoe','cup'][poem.id-1]}.svg" alt="" width="72" height="72"><div><p class="challenge-eyebrow">${attempt.mode==='review'?'錯題複習成果':'小遊戲練習成果'}</p><h2>${hasGuided?'這一輪練習結束了！':allCorrect?pending?'這一組答對了！':'全部答對了！':'把小發現帶走。'}</h2><p class="challenge-result-detail">${hasGuided?`已完成 ${completedN} / ${items.length} 題。`:pending?`還有 ${pending} 道錯題，下次接着練。`:allCorrect?'每一題都完成得很好。':`答對 ${result.correct} / ${result.total} 題，再看看這些知識點。`}</p></div></header><div class="challenge-result-list" aria-label="每題結果與知識點">${entries}</div><div class="challenge-results-actions"><button class="challenge-primary" data-ch="new-round">再練五題 <span aria-hidden="true">→</span></button>${!allCorrect||pending?'<button class="challenge-secondary" data-ch="redo-wrong">錯題重做</button>':''}</div></section>`);
  }
  function restart(mode='standard') {flushDraft();attempt=newAttempt(set,{previous:attempt,mode});items=attemptItems(attempt,set);screen=0;audit('attempt_started',{metrics:{itemCount:items.length}});save();showQuestion();}
  function click(event) {
    const button=event.target.closest('[data-ch]');if(!button||button.disabled||dead)return;
    const action=button.dataset.ch,item=items[screen];
    if(['listen','show-solution'].includes(action))audit('hint_used',{hint:{kind:action==='listen'?'audio':action==='skip'?'explanation':'reveal',count:1}});
    if(['retry-game','redo-wrong'].includes(action))audit('retry',{retryCount:1});
    if(action==='retry-game'){loadGame();return;}
    if(action==='new-round'){restart();return;}
    if(action==='redo-wrong'){const review=newReviewAttempt(set,attempt);if(review){attempt=review;items=attemptItems(attempt,set);screen=0;audit('attempt_started',{metrics:{itemCount:items.length}});save();showQuestion();}}
    if(action==='listen')listen();
    if(action==='choose')chooseSound(button.dataset.option);
    if(action==='card'&&!currentAnswer()){selected=button.dataset.card;updatePlacements();}
    if(action==='slot')place(button.dataset.slot);
    if(action==='density'&&!currentAnswer()){if(density[button.dataset.layer]!==button.dataset.density)selectionChanges++;density[button.dataset.layer]=button.dataset.density;updateField();}
    if(action==='field-3d'){
      const generation=renderGeneration;livingField?.destroy();q('.living-field-canvas').hidden=false;q('.living-field-picture').hidden=false;
      button.hidden=true;q('[data-ch="field-picture"]').hidden=false;
      livingField=mountLivingField(q('.living-field-canvas'),{density,onStatus:(message,{state}={})=>{
        if(dead||generation!==renderGeneration)return;
        q('.living-field-status').textContent=message;
        if(state==='ready')q('.living-field-picture').hidden=true;
        if(['error','timeout','context-lost'].includes(state)){
          q('.living-field-canvas').hidden=true;q('.living-field-picture').hidden=false;
          q('[data-ch="field-3d"]').hidden=false;q('[data-ch="field-picture"]').hidden=true;
          q('.living-field-status').textContent='先用插畫繼續種，也可以重試立體畫面。';
        }
      }});
    }
    if(action==='field-picture'){livingField?.destroy();livingField=null;q('.living-field-canvas').hidden=true;q('.living-field-picture').hidden=false;button.hidden=true;q('[data-ch="field-3d"]').hidden=false;q('.living-field-status').textContent='';}
    if(action==='submit'&&!currentAnswer()){
      if(item.type==='microgame')return;
      let correct=false,response;
      if(item.type==='sound'){if(!heard||!selected)return;response=selected;correct=selected===item.answerId;}
      else if(item.type==='scene-builder'){if(!item.layers.every(l=>density[l.id]))return;response={...density};correct=Object.entries(item.answer).every(([key,value])=>density[key]===value);}
      else {if(!item.slots.every(slot=>placements[slot.id]))return;response={...placements};correct=item.slots.every(slot=>placements[slot.id]===slot.accepts);}
      submit({status:correct?'correct':'incorrect',response});
    }
    if(action==='skip'&&!['dictation','sound'].includes(item.type))submit({status:'skipped',response:item.type==='microgame'?safeGameState(attempt.gameDrafts[item.id])||{}:item.type==='scene-builder'?{...density}:{...placements}});
    if(action==='next'){
      if(item?.type==='dictation'&&!(writing?.canContinue?.()??writingAdvance))return;
      if(currentAnswer()){attempt.cursor=screen+1;save();screen++;screen===items.length?summary():showQuestion();}
    }
    if(action==='show-solution'){
      if(item.type==='microgame'){pendingGameSolution=true;game?.showSolution?.();}
      else if(item.type==='scene-builder'){density={...item.answer};updateField();}
      else if(item.type!=='sound'){placements=Object.fromEntries(item.slots.map(slot=>[slot.id,slot.accepts]));updatePlacements();}
      button.hidden=true;
    }

  }
  save();
  if(saved?.attemptId!==attempt.attemptId)audit('attempt_started',{metrics:{itemCount:items.length}});
  const pending=pendingWriting();
  if(pending!==-1){screen=pending;attempt.cursor=pending;save();showQuestion();}
  else if(attempt.answers.length===items.length)summary();else showQuestion();
  return {destroy(){dead=true;release();container.replaceChildren();},pause(){flushDraft();stopAudio?.();},getAttempt(){return attempt;}};
}
