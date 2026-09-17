import {CHALLENGE_SETS} from './challenge-data.mjs?v=20260918a';
import {newAttempt, readAttempt, recordAnswer, challengeSummary} from './challenge-state.mjs?v=20260918a';
import {mountChallengeWriting} from './challenge-writing.mjs?v=20260918a';
import {mountChallengeModel} from './challenge-model.mjs?v=20260914e';
import {mountLivingField} from './living-field.mjs?v=20260914f';
import {mountPoetryCard} from './poetry-card.mjs?v=20260914f';

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
const KIND = {sound:'聽音小鋪', dictation:'聽寫一個字', match:'動手解詩', sequence:'故事排一排', 'scene-builder':'種一片詩田'};
const soundIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
const tone = shape => shape ? `<svg class="challenge-tone" viewBox="0 0 70 35" aria-hidden="true"><path d="${{level:'M8 10H62', rising:'M8 28 62 6', dipping:'M8 13 32 29 62 6', falling:'M8 6 62 28'}[shape]}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` : '';
const makeURL = path => new URL(path, import.meta.url).href;

export function mountChallenge(container, {poem, saved, onChange, onComplete, playAudio, stopAudio, recognize} = {}) {
  const set = CHALLENGE_SETS[poem.slug];
  if (!set) throw new Error('missing-challenge');
  let attempt = readAttempt(saved, set), started = false, dead = false, screen = 0, reviewing = false, practicing = false;
  let heard = false, playing = false, selected = null, placements = {}, density = {}, writing = null, model = null, livingField = null, poetryCard = null;
  let pageEvents = null, renderGeneration = 0, audioGeneration = 0, practiceResult = null;
  const q = selector => container.querySelector(selector);
  const save = () => onChange?.(structuredClone(attempt));
  const ordered = item => (attempt.orders[item.id] || []).map(id => (item.options || item.cards).find(card => card.id === id));
  const currentAnswer = () => practicing ? practiceResult : attempt?.answers[screen];
  function release() {renderGeneration++; audioGeneration++; pageEvents?.abort(); writing?.destroy(); writing = null; model?.destroy(); model = null; livingField?.destroy();livingField=null;poetryCard?.destroy();poetryCard=null;stopAudio?.(); playing = false;}
  function startPage(html) {
    release(); pageEvents = new AbortController(); container.innerHTML = html;
    container.addEventListener('click', click, {signal: pageEvents.signal});
    container.addEventListener('error', event => {if (event.target.matches?.('img')) event.target.classList.add('challenge-image-error');}, {capture:true, signal:pageEvents.signal});
    container.querySelectorAll('.challenge-pod img').forEach(img=>{if(img.complete&&img.naturalWidth)img.dataset.loaded='true';else img.addEventListener('load',()=>img.dataset.loaded='true',{once:true,signal:pageEvents.signal});});
    container.scrollTop = 0;
  }
  function intro() {
    const progress = attempt?.answers.length || 0;
    startPage(`<section class="challenge-shell challenge-intro"><div class="challenge-intro-art"><img src="media/challenges/sound-market-v1.webp" alt="木製的聲音小鋪" width="960" height="800"><img class="challenge-intro-motif" src="media/poetry-motifs/${['goose','boat','mountain','moon','sprout','swallow'][poem.grade-1]}.svg" alt="" width="70" height="70"></div><div class="challenge-intro-copy"><p class="challenge-eyebrow">練一練</p><h2>帶着耳朵和小手，<br>一起試試五道題。</h2><p>聽字音，寫漢字，<br>再動手玩一玩。</p><div class="challenge-trip" aria-label="五道小練習"><span>聽</span><span>寫</span><span>聽</span><span>寫</span><span>玩</span></div><p class="challenge-kind-note">慢慢想，隨時可以再聽一次。</p><button class="challenge-primary" data-ch="start">${progress===5?'看看我的收穫':progress?`繼續第 ${Math.min(5,attempt.cursor+1)} 題`:'開始練一練'} <span aria-hidden="true">→</span></button>${progress ? '<button class="challenge-text-button" data-ch="restart">重新練五題</button>' : ''}</div></section>`);
  }
  function header(item) {
    return `<header class="challenge-header"><div><span class="challenge-eyebrow">${practicing?'再練一次':reviewing?'回看小發現':KIND[item.type]}</span><span class="challenge-count">${screen+1}<small> / 5</small></span></div><div class="challenge-steps" aria-label="第 ${screen+1} 題，共五題">${set.items.map((_,i)=>`<i class="${i<screen?'done':i===screen?'current':''}"></i>`).join('')}</div></header>`;
  }
  function soundBody(item) {
    return `<div class="challenge-sound-layout"><div class="challenge-sound-stage"><img class="challenge-market" src="media/challenges/sound-market-v1.webp" alt="" width="960" height="800"><button class="challenge-pod" data-ch="listen" aria-label="播放題目聲音"><img src="media/challenges/sound-pod-v1.webp" alt="" width="433" height="800">${soundIcon}</button><span class="challenge-stage-note">點一下，聽聽它的聲音</span><button class="challenge-model-link" data-ch="pod-model">轉轉聲音果實</button></div><div class="challenge-sound-work"><h2 class="challenge-prompt" tabindex="-1">${esc(prompt(item))}</h2><p class="challenge-instruction">先聽聲音，再選貨架。</p><div class="challenge-shelves">${ordered(item).map(option=>`<button class="challenge-shelf" data-ch="choose" data-option="${option.id}" aria-pressed="false" disabled>${tone(option.contour)}<span>${esc(option.label)}</span><i aria-hidden="true"></i></button>`).join('')}</div><p class="challenge-audio-status" role="status">聲音可以重複聽。</p></div></div>`;
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
    const item = set.items[screen];
    if (!item) {summary(); return;}
    heard = false; selected = null; placements = {}; density = {}; practiceResult = null;
    const answer = currentAnswer();
    if (answer?.response && item.type === 'sound') selected = answer.response;
    else if (answer?.response && item.type === 'scene-builder') density = {...answer.response};
    else if (answer?.response && item.type !== 'dictation') placements = {...answer.response};
    startPage(`<section class="challenge-shell challenge-poem-${poem.grade} challenge-type-${item.type}">${header(item)}<div class="challenge-body">${item.type==='sound'?soundBody(item):item.type==='dictation'?writingBody(item):handsBody(item)}</div><footer class="challenge-footer"><div class="challenge-feedback" role="status"></div><div class="challenge-footer-actions"><button class="challenge-text-button" data-ch="skip" ${answer?'hidden':''}>${item.type==='dictation'?'先學一學':'看提示'}</button><button class="challenge-primary" data-ch="submit" disabled ${item.type==='dictation'?'hidden':''}>放好了</button><button class="challenge-primary" data-ch="next" hidden>下一題 <span aria-hidden="true">→</span></button></div></footer></section>`);
    if (item.type === 'dictation') {
      const holder = q('.challenge-writing-holder');
      holder.inert = !answer;
      writing = mountChallengeWriting(holder, {target: item.target, recognize, initialResult: answer || null,
        onSubmit: result => submit(result)});
    } else if (item.type === 'sound') {
      installDrag(q('.challenge-pod'), '[data-option]', button => chooseSound(button.dataset.option));
      updateSound();
    } else if (item.type === 'scene-builder') updateField();
    else {
      const poster = item.cards.find(c=>c.image)?.image || `media/exploration/${poem.slug}/scene.webp`;
      if(poem.grade===1) q('[data-observation]').innerHTML=gooseHTML(item);
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
      if (event.button !== 0 || currentAnswer() || (button.matches('.challenge-pod') && !heard)) return;
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
    const item = set.items[screen], generation = renderGeneration, playback = ++audioGeneration;
    playing = true;
    const status = q('.challenge-audio-status'), button = q('[data-ch="listen"]');
    if (status) status.textContent = '聽一聽…';
    button?.classList.add('is-playing');button?.setAttribute('aria-busy','true');
    let success = false;
    try {success = await playAudio(item.audio) === true;} catch {}
    if (dead || generation !== renderGeneration || playback !== audioGeneration) return;
    playing = false;button?.classList.remove('is-playing');button?.removeAttribute('aria-busy');
    if (success) heard = true;
    if (status) status.textContent = success ? item.type==='sound'?'聽到了嗎？把聲音放到合適的貨架。':'現在可以寫了，也可以再聽一次。' : '剛才沒有播完，再點一次聽聲音。';
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
      button.classList.toggle('is-correct',!!answer && button.dataset.option===set.items[screen].answerId);
    });
    const submitButton=q('[data-ch="submit"]');if(submitButton){submitButton.disabled=!heard||!selected||!!answer;submitButton.textContent='選好了';}
  }
  function place(slot) {
    if (!selected || currentAnswer()) return;
    for (const key of Object.keys(placements)) if (placements[key]===selected) delete placements[key];
    placements[slot]=selected;selected=null;updatePlacements();
  }
  function updatePlacements() {
    const item=set.items[screen],answer=currentAnswer();
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
    q('[data-ch="submit"]').disabled=!!answer||!set.items[screen].layers.every(layer=>density[layer.id]);
  }
  function submit(result) {
    if (dead || currentAnswer()) return;
    if (practicing) practiceResult={...result,submittedAt:Date.now()};
    else {
      if(!recordAnswer(attempt,set,screen,result))return;
      save();if(attempt.answers.length===set.items.length)onComplete?.(challengeSummary(attempt,set));
    }
    audioGeneration++;stopAudio?.();playing=false;
    container.querySelectorAll('.is-playing').forEach(button=>{button.classList.remove('is-playing');button.removeAttribute('aria-busy');});
    const type=set.items[screen].type;
    if(type==='sound')updateSound();else if(type==='scene-builder')updateField();else if(type!=='dictation')updatePlacements();
    feedback(currentAnswer());
  }
  function feedback(answer) {
    const item=set.items[screen], correct=answer.status==='correct';
    q('[data-ch="skip"]').hidden=true;q('[data-ch="submit"]').hidden=true;
    const next=q('[data-ch="next"]');next.hidden=false;
    next.textContent=reviewing||practicing?'回到收穫':screen===4?'看看我的收穫':'下一題 →';
    q('.challenge-feedback').innerHTML=`<strong>${correct?'你找到了！':answer.status==='skipped'?'一起學一學':'差一點，一起看看。'}</strong>${item.type==='dictation'?'':`<p>${esc(item.explanation)}</p>`}${!correct && item.type!=='dictation'?'<button class="challenge-text-button" data-ch="show-solution">看看怎樣放</button>':''}`;
    q('.challenge-footer').classList.add('has-feedback');
    if(item.type==='dictation' && answer.status==='skipped' && !writing?.getResult?.()) {
      writing?.destroy();q('.challenge-writing-holder').inert=false;
      writing=mountChallengeWriting(q('.challenge-writing-holder'),{target:item.target,recognize,initialResult:answer,onSubmit:()=>{}});
    }
  }
  function summary() {
    const result=challengeSummary(attempt,set);
    if(!result.completed){screen=attempt.answers.length;reviewing=false;practicing=false;showQuestion();return;}
    const entries=set.items.map((item,i)=>`<button class="challenge-result-row" data-ch="review" data-index="${i}"><span class="challenge-result-number">${i+1}</span><span>${KIND[item.type]}<small>${item.type==='dictation'?esc(item.target.char):item.type==='sound'?esc(item.focus):'把詩意放進畫面'}</small></span><em>${attempt.answers[i].correct?'自己完成':attempt.answers[i].status==='skipped'?'一起學過':'再練一練'}</em><span aria-hidden="true">›</span></button>`).join('');
    const nextPractice=attempt.answers.findIndex(a=>!a.correct);
    const finding=['白鵝的顏色，藏在詩句裏。','送別的聲音，留下朋友的心意。','換一個角度，就有不同的山。','眼前的風景，也藏着思念。','野草和豆苗，長得很不一樣。','走近一點，春色又有新模樣。'][poem.grade-1];
    startPage(`<section class="challenge-shell challenge-results"><header class="challenge-results-heading"><img src="media/poetry-motifs/${['goose','boat','mountain','moon','sprout','swallow'][poem.grade-1]}.svg" alt="" width="72" height="72"><div><p class="challenge-eyebrow">五道練習都試過了</p><h2>今天又進步了！</h2><p>${finding}</p><p class="challenge-result-detail">這次 ${result.correct} 題自己完成，其餘一起學過。</p></div></header><div class="challenge-result-list">${entries}</div><div class="challenge-results-actions">${nextPractice>=0?`<button class="challenge-primary" data-ch="recommended" data-index="${nextPractice}">${set.items[nextPractice].type==='dictation'?'再試寫一個字':set.items[nextPractice].type==='sound'?'再聽一題':'再動手試一次'}</button>`:`<a class="challenge-primary" href="#${poem.slug}/record">再讀一次古詩</a>`}<button class="challenge-text-button" data-ch="postcard">做張詩意明信片</button></div><nav class="challenge-result-extras" aria-label="繼續學習"><a href="#${poem.slug}/write">寫一寫</a><a href="#${poem.slug}/explore">找一找</a><a href="#${poem.slug}/chat">找詩人</a><button class="challenge-text-button" data-ch="restart">再練一次</button></nav><div class="poetry-card-host"></div></section>`);
  }
  function restart() {attempt=newAttempt(set);screen=0;started=true;reviewing=false;practicing=false;save();showQuestion();}
  function click(event) {
    const button=event.target.closest('[data-ch]');if(!button||button.disabled||dead)return;
    const action=button.dataset.ch,item=set.items[screen];
    if(action==='start'){if(!attempt)attempt=newAttempt(set);started=true;save();screen=attempt.cursor;if(attempt.answers.length===5)summary();else showQuestion();}
    if(action==='restart')restart();
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
      let correct=false,response;
      if(item.type==='sound'){if(!heard||!selected)return;response=selected;correct=selected===item.answerId;}
      else if(item.type==='scene-builder'){if(!item.layers.every(l=>density[l.id]))return;response={...density};correct=Object.entries(item.answer).every(([key,value])=>density[key]===value);}
      else {if(!item.slots.every(slot=>placements[slot.id]))return;response={...placements};correct=item.slots.every(slot=>placements[slot.id]===slot.accepts);}
      submit({status:correct?'correct':'incorrect',response});
    }
    if(action==='skip')submit({status:'skipped',response:item.type==='sound'?selected:item.type==='scene-builder'?{...density}:{...placements}});
    if(action==='next'){
      if(reviewing||practicing){reviewing=false;practicing=false;summary();}
      else if(currentAnswer()){attempt.cursor=screen+1;save();screen++;screen===5?summary():showQuestion();}
    }
    if(action==='review'){screen=Number(button.dataset.index);reviewing=true;practicing=false;showQuestion();q('.challenge-footer-actions').insertAdjacentHTML('afterbegin','<button class="challenge-text-button" data-ch="practice">自己再試一次</button>');}
    if(action==='practice'){practicing=true;practiceResult=null;showQuestion();}
    if(action==='recommended'){screen=Number(button.dataset.index);reviewing=false;practicing=true;practiceResult=null;showQuestion();}
    if(action==='postcard'){poetryCard?.destroy();poetryCard=mountPoetryCard(q('.poetry-card-host'),{poem,onClose:()=>{poetryCard=null;q('[data-ch="postcard"]')?.focus({preventScroll:true});}});}
    if(action==='show-solution'){
      if(item.type==='scene-builder'){density={...item.answer};updateField();}
      else if(item.type!=='sound'){placements=Object.fromEntries(item.slots.map(slot=>[slot.id,slot.accepts]));updatePlacements();}
      button.hidden=true;
    }
    if(action==='pod-model'){
      const stage=q('.challenge-sound-stage');
      model?.destroy();stage.innerHTML='<div class="challenge-pod-viewer"></div>';
      model=mountChallengeModel(q('.challenge-pod-viewer'),{modelURL:'media/challenges/sound-pod-v1.glb',poster:'media/challenges/sound-pod-v1.webp',label:'轉一轉',onListen:listen});
      q('[data-model="load"]').click();
    }
  }
  intro();
  return {destroy(){dead=true;release();container.replaceChildren();},pause(){stopAudio?.();},getAttempt(){return attempt;}};
}
