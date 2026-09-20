import {imageAsset} from './media-images.mjs?v=20260920-art2';
import {CHALLENGE_SETS} from './challenge-data.mjs?v=20260921-school4';
import {newAttempt, newReviewAttempt, prepareAttempt, recordAnswer, challengeSummary, attemptItems, safeGameState} from './challenge-state.mjs?v=20260919d';
import {mountChallengeWriting} from './challenge-writing.mjs?v=20260921-school4';
import {mountChallengeModel} from './challenge-model.mjs?v=20260921-school4';
import {mountLivingField} from './living-field.mjs?v=20260921-school4';

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
  'g6-m1':'哪張是近看？哪張是遠看？'
};
const prompt = item => COMPACT_PROMPTS[item.id] || item.prompt;
const KIND = {sound:'聽音小鋪', dictation:'聽寫一個字', microgame:'詩裏玩一玩', match:'動手解詩', sequence:'故事排一排', 'scene-builder':'種一片詩田'};
const soundIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const tone = shape => shape ? `<svg class="challenge-tone" viewBox="0 0 70 35" aria-hidden="true"><path d="${{level:'M8 10H62', rising:'M8 28 62 6', dipping:'M8 13 32 29 62 6', falling:'M8 6 62 28'}[shape]}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` : '';
const makeURL = path => new URL(path, import.meta.url).href;

export function mountChallenge(container, {poem, saved, onChange, onComplete, playAudio, stopAudio, recognize, onResearch = () => {}, onAnswer = () => {}} = {}) {
  const set = CHALLENGE_SETS[poem.slug];
  if (!set) throw new Error('missing-challenge');
  let attempt = prepareAttempt(set, saved), dead = false, screen = attempt.cursor;
  let items = attemptItems(attempt, set);
  let game = null, gameEpoch = 0, draftTimer = null, pendingGameSolution = false;
  let heard = false, playing = false, selected = null, placements = {}, density = {}, writing = null, model = null, livingField = null;
  let pageEvents = null, renderGeneration = 0, audioGeneration = 0;
  const q = selector => container.querySelector(selector);
  const save = () => onChange?.(structuredClone(attempt));
  const saveDraftSoon = () => {clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftTimer=null;save();},120);};
  const flushDraft = () => {if(draftTimer!==null){clearTimeout(draftTimer);draftTimer=null;save();}};
  const ordered = item => (attempt.orders[item.id] || []).map(id => (item.options || item.cards).find(card => card.id === id));
  const currentAnswer = () => attempt?.answers[screen];
  let itemPresentedAt = performance.now();
  function researchContext(){
    const item=items[screen];
    return {attemptId:attempt.attemptId,itemId:item?.id||'challenge-summary',activity:item?.type==='dictation'?'writing':'challenge',
      context:{mode:attempt.mode||'standard',itemType:item?.type||'microgame',position:Math.min(screen+1,items.length),total:items.length,
        optionOrder:(attempt.orders[item?.id]||[]).map(String),...(attempt.sourceAttempt?.attemptId?{sourceAttemptId:attempt.sourceAttempt.attemptId}:{})}};
  }
  function audit(type,fields={}){const base=researchContext();onResearch(type,{...base,...fields,context:{...base.context,...(fields.context||{})}});}
  const recognizeItem=ink=>recognize(ink,researchContext());
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
      const {mountPoemGame} = await import('./poem-games/index.mjs?v=20260921-school4');
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
    return `<header class="challenge-header"><div><span class="challenge-eyebrow">${attempt.mode==='review'?'錯題重做':attempt.mode==='advanced'?'高階挑戰':KIND[item.type]}</span><span class="challenge-count">${screen+1}<small> / ${items.length}</small></span></div><div class="challenge-steps" aria-label="第 ${screen+1} 題，共 ${items.length} 題">${items.map((_,i)=>`<i class="${i<screen?'done':i===screen?'current':''}"></i>`).join('')}</div></header>`;
  }
  function soundBody(item) {
    return `<div class="challenge-sound-layout"><div class="challenge-sound-stage is-walnut-market"><img class="challenge-market" src="${esc(imageAsset('media/challenges/sound-market-v1.webp'))}" alt="" draggable="false"><button class="challenge-sound-token is-walnut" data-ch="listen" aria-label="點核桃，聽題目聲音"><img src="${esc(imageAsset('media/challenges/sound-pod-v1.webp'))}" alt="" draggable="false">${soundIcon}</button><p class="challenge-stage-note">點核桃，聽一聽</p></div><div class="challenge-sound-work"><h2 class="challenge-prompt" tabindex="-1">${esc(prompt(item))}</h2><p class="challenge-instruction">先聽聲音，再選一個小站。</p><div class="challenge-shelves">${ordered(item).map(option=>`<button class="challenge-shelf" data-ch="choose" data-option="${option.id}" aria-pressed="false" disabled>${tone(option.contour)}<span>${esc(option.label)}</span><i aria-hidden="true"></i></button>`).join('')}</div><p class="challenge-audio-status" role="status">聽完後，也可以把核桃拖到小站。</p></div></div>`;
  }
  function writingBody(item) {
    return `<div class="challenge-writing-layout"><div class="challenge-writing-heading"><h2 class="challenge-prompt" tabindex="-1">${esc(prompt(item))}</h2><button class="challenge-listen" data-ch="listen">${soundIcon}<span>聽詞語</span></button><p class="challenge-audio-status" role="status">先聽詞語，再動筆。</p></div><div class="challenge-writing-holder" inert></div></div>`;
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
    itemPresentedAt=performance.now();audit('item_presented');
    heard = false; selected = null; placements = {}; density = {};
    const answer = currentAnswer();
    if (answer?.response && item.type === 'sound') selected = answer.response;
    else if (answer?.response && item.type === 'scene-builder') density = {...answer.response};
    else if (answer?.response && item.type !== 'dictation') placements = {...answer.response};
    startPage(`<section class="challenge-shell challenge-poem-${poem.grade} challenge-type-${item.type}">${header(item)}<div class="challenge-body">${item.type==='sound'?soundBody(item):item.type==='dictation'?writingBody(item):item.type==='microgame'?gameBody():handsBody(item)}</div><footer class="challenge-footer"><div class="challenge-feedback" role="status"></div><div class="challenge-footer-actions"><button class="challenge-text-button" data-ch="skip" ${answer?'hidden':''}>${item.type==='microgame'?'這次先跳過':item.type==='dictation'?'先學一學':'看提示'}</button><button class="challenge-primary" data-ch="submit" disabled ${['dictation','microgame'].includes(item.type)?'hidden':''}>放好了</button><button class="challenge-primary" data-ch="next" hidden>下一題 <span aria-hidden="true">→</span></button></div></footer></section>`);
    if (item.type === 'microgame') loadGame();
    else if (item.type === 'dictation') {
      const holder = q('.challenge-writing-holder');
      holder.inert = !answer;
      writing = mountChallengeWriting(holder, {target: item.target, recognize:recognizeItem, onResearch:audit, initialResult: answer || null,
        onSubmit: result => submit(result)});
    } else if (item.type === 'sound') {
      installDrag(q('.challenge-sound-token'), '[data-option]', button => chooseSound(button.dataset.option));
      updateSound();
    } else if (item.type === 'scene-builder') updateField();
    else {
      const poster = item.cards.find(c=>c.image)?.image || `media/exploration/${poem.slug}/scene.webp`;
      if(poem.grade===1) q('[data-observation]').innerHTML=gooseHTML(item);
      else if (poem.grade <= 3) q('[data-observation]').innerHTML=`<img class="challenge-observation-picture" src="${esc(makeURL(poster))}" alt="觀察畫面">`;
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
      if (event.button !== 0 || currentAnswer() || (button.matches('.challenge-sound-token') && !heard)) return;
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
    if (status) status.textContent = success ? item.type==='sound'?'聽到了嗎？選一個小站，也可以拖過去。':'現在可以寫了，也可以再聽一次。' : '剛才沒有播完，再點一次聽聲音。';
    if (item.type === 'sound') updateSound();
    if (item.type === 'dictation') q('.challenge-writing-holder').inert = !heard && !currentAnswer();
  }
  function chooseSound(id) {
    if (!heard || currentAnswer()) return;
    selected=id;updateSound();
  }
  function updateSound() {
    const answer=currentAnswer();
    container.querySelectorAll('[data-option]').forEach(button=>{
      button.disabled=!heard||!!answer;button.setAttribute('aria-pressed',String(button.dataset.option===selected));
      button.classList.toggle('is-correct',!!answer && button.dataset.option===items[screen].answerId);
    });
    const submitButton=q('[data-ch="submit"]');if(submitButton){submitButton.disabled=!heard||!selected||!!answer;submitButton.textContent='選好了';}
  }
  function place(slot) {
    if (!selected || currentAnswer()) return;
    for (const key of Object.keys(placements)) if (placements[key]===selected) delete placements[key];
    placements[slot]=selected;selected=null;updatePlacements();
  }
  function updatePlacements() {
    const item=items[screen],answer=currentAnswer();
    if(poem.grade===1 && q('[data-observation]'))q('[data-observation]').innerHTML=gooseHTML(item);
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
    audit('answer_submitted',{result:{status:items[screen].type==='microgame'&&result.status==='correct'?'completed':result.status,score:measured?(result.status==='correct'?100:0):null,correct:measured?result.status==='correct':null},metrics:{elapsedMs:Math.min(21600000,Math.round(performance.now()-itemPresentedAt))},...(response?{response}:{})});
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
    q('.challenge-feedback').innerHTML=`<strong>${correct?item.type==='microgame'?'完成啦！':'你找到了！':answer.status==='skipped'?item.type==='microgame'?'這次先收好，下次再玩。':'一起學一學':'差一點，一起看看。'}</strong>${['dictation','microgame'].includes(item.type)?'':`<p>${esc(item.explanation)}</p>`}${!correct && !['dictation','sound'].includes(item.type)?`<button class="challenge-text-button" data-ch="show-solution">${item.type==='microgame'?'看看小提示':'看看怎樣放'}</button>`:''}`;
    q('.challenge-footer').classList.add('has-feedback');
    if(item.type==='dictation' && answer.status==='skipped' && !writing?.getResult?.()) {
      writing?.destroy();q('.challenge-writing-holder').inert=false;
      writing=mountChallengeWriting(q('.challenge-writing-holder'),{target:item.target,recognize:recognizeItem,onResearch:audit,initialResult:answer,onSubmit:()=>{}});
    }
  }
  function summary() {
    const result=challengeSummary(attempt,set);
    if(!result.completed){screen=attempt.answers.length;showQuestion();return;}
    const entries=items.map((item,i)=>{
      const answer=attempt.answers[i], number=attempt.mode==='review'?attempt.sourceAttempt.itemIds.indexOf(item.id)+1:i+1;
      const focus=item.type==='dictation'?`聽寫「${item.target.char}」`:item.type==='sound'?`${poem.grade===1?'聲調':poem.grade===2||poem.grade===4?'韻母':'聲母'}・${item.focus}`:item.type==='microgame'?item.title:KIND[item.type];
      const detail=item.type==='dictation'?item.target.pinyin:item.type==='sound'?`${item.audio.char} ${item.audio.pinyin}`:{'yong-e':'白毛・紅掌・綠水','zeng-wang-lun':'乘舟・踏歌・送別','ti-xi-lin-bi':'橫看成嶺，側看成峯','bo-chuan-gua-zhou':'江水・春意・思鄉','gui-yuan-tian-ju':'草盛豆苗稀','zao-chun':'小・酥・色・是・勝｜x、s、sh'}[poem.slug];
      return `<div class="challenge-result-row"><span class="challenge-result-number" aria-label="原第 ${number} 題">${number}</span><span class="challenge-result-knowledge">${esc(focus)}<small>${esc(detail)}</small></span><em class="${answer.correct?'is-correct':'needs-practice'}">${answer.correct?'答對':answer.status==='skipped'?'未作答':'答錯'}</em></div>`;
    }).join('');
    const allCorrect=result.correct===result.total, pending=attempt.reviewPending?.length || 0;
    startPage(`<section class="challenge-shell challenge-results"><header class="challenge-results-heading"><img src="media/poetry-motifs/${['goose','boat','mountain','moon','sprout','swallow'][poem.grade-1]}.svg" alt="" width="72" height="72"><div><p class="challenge-eyebrow">${attempt.mode==='review'?'錯題複習成果':'小遊戲練習成果'}</p><h2>${allCorrect?pending?'這一組答對了！':'全部答對了！':'把小發現帶走。'}</h2><p class="challenge-result-detail">${pending?`還有 ${pending} 道錯題，下次接着練。`:allCorrect?'每一題都完成得很好。':`答對 ${result.correct} / ${result.total} 題，再看看這些知識點。`}</p></div></header><div class="challenge-result-list" aria-label="每題結果與知識點">${entries}</div><div class="challenge-results-actions"><button class="challenge-primary" data-ch="new-round">再練五題 <span aria-hidden="true">→</span></button>${!allCorrect||pending?'<button class="challenge-secondary" data-ch="redo-wrong">錯題重做</button>':''}</div></section>`);
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
    if(action==='density'&&!currentAnswer()){density[button.dataset.layer]=button.dataset.density;updateField();}
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
    if(action==='skip')submit({status:'skipped',response:item.type==='microgame'?safeGameState(attempt.gameDrafts[item.id])||{}:item.type==='sound'?selected:item.type==='scene-builder'?{...density}:{...placements}});
    if(action==='next'){
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
  if(attempt.answers.length===items.length)summary();else showQuestion();
  return {destroy(){dead=true;release();container.replaceChildren();},pause(){flushDraft();stopAudio?.();},getAttempt(){return attempt;}};
}
