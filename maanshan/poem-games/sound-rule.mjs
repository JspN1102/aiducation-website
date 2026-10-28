import {createProcessResearch} from './research.mjs?v=20260920a';
import {createPracticeFrame, SPEAKER, esc, count} from './practice-common.mjs?v=20261029-school74';
import {PRACTICE_GAMES} from '../practice-games-data.mjs?v=20261029-school74';

/** 讀音小偵探: the pupil finds a sound rule by listening, then uses it.
 * pick (grades 1-2): hear two readings of a word, choose the right one; the rule is shown at the end.
 * sort (grades 3-6): hear word cards, put each in a basket, name the pattern, then read a new word with it.
 * Wrong choices are logged and tried again; every pupil ends with the rule in front of them. */
export function mountSoundRule(holder, {content, slug, researchPrefix, initialState, readOnly = false, playAudio, onState, onComplete, onResearch, reducedMotion = false} = {}) {
  content ??= PRACTICE_GAMES[slug]?.rule;
  if (!content) throw new TypeError('Unknown practice game');
  const pick = content.mode === 'pick', rounds = content.rounds || [], cards = content.cards || [];
  const PHASES = pick ? ['pick'] : ['sort', 'question', 'transfer'];
  const saved = initialState?.version === 1 ? initialState : null;
  let phase = PHASES.includes(saved?.phase) ? saved.phase : PHASES[0], round = count(saved?.round, Math.max(0, rounds.length - 1));
  let heard = Array.isArray(saved?.heard) ? saved.heard.filter(value => typeof value === 'string').slice(0, 8) : [];
  const placed = {};
  if (!pick && saved?.placed && typeof saved.placed === 'object') for (const [index, basket] of Object.entries(saved.placed)) if (cards[index]?.basket === basket) placed[index] = basket;
  let done = saved?.completed === true, solved = false, ready = false, busy = false, reported = done, selected = null;
  const research = createProcessResearch(onResearch, {prefix: researchPrefix || `game.rule.${slug}`, alive: () => !frame.dead});
  const frame = createPracticeFrame(holder, {kind: 'rule', title: '讀音小偵探', reducedMotion, onRetryAssets: () => frame.load(research, start),
    poses: {look: 'rule-look-20261029.webp', found: 'rule-found-20261029.webp'},
    alt: {look: '小墨拿着放大鏡，側耳細聽，旁邊有兩個竹籃。', found: '小墨舉起放大鏡，開心地跳起來。'}});
  const {q, root} = frame;
  const state = () => ({version: 1, phase, round, heard: heard.slice(), placed: {...placed}, completed: done});
  const save = () => {if (!readOnly && !solved && !frame.dead) onState?.(state());};
  const available = () => ready && !readOnly && !solved && !done && !busy;
  const sorted = () => cards.every((_, i) => placed[i]);
  const basketLabel = id => content.baskets.find(basket => basket.id === id)?.label || '';
  const pickOrder = () => rounds[round].rightFirst ? ['right', 'other'] : ['other', 'right'];
  const transferPrompt = () => content.transfer.prompt || `「${Array.from(content.transfer.text)[0]}」在這裏讀哪個？`;
  const step = () => pick ? `r${round}` : phase === 'sort' ? `card${selected ?? 0}` : phase;

  function present() {
    if (!ready || readOnly || done || solved) return;
    if (pick && heard.length >= 2) research.present(step(), {position: round, total: rounds.length, optionOrder: pickOrder()});
    if (phase === 'question') research.present('question', {position: 0, total: 1, optionOrder: content.options.map((_, i) => `o${i}`)});
    if (phase === 'transfer' && heard.includes('transfer')) research.present('transfer', {position: 0, total: 1, optionOrder: content.transfer.options.map((_, i) => `o${i}`)});
  }
  function ruleCard() {return `<div class="pg-rule"><span>小偵探發現</span><p>${esc(content.rule)}</p></div>`;}
  function work() {
    if (done || solved) return ruleCard();
    if (pick) {
      const value = rounds[round];
      return `<p class="pg-word">${esc(value.text)}</p><div class="pg-pair">${pickOrder().map((kind, i) => `<div class="pg-choice${heard.includes(kind) ? ' is-heard' : ''}">
        <button type="button" class="pg-hear" data-pg-hear="${kind}">${SPEAKER}<span>聽讀法${i ? '二' : '一'}</span></button>
        <button type="button" class="pg-take" data-pg-take="${kind}">選讀法${i ? '二' : '一'}</button></div>`).join('')}</div>`;
    }
    if (phase === 'sort') return `<div class="pg-cards">${cards.map((card, i) => placed[i] ? '' : `<button type="button" class="pg-card${selected === i ? ' is-selected' : ''}${heard.includes(`c${i}`) ? ' is-heard' : ''}" data-pg-card="${i}" aria-pressed="${selected === i}">${SPEAKER}<span>${esc(card.text)}</span></button>`).join('')}</div>
      <div class="pg-baskets">${content.baskets.map(basket => `<button type="button" class="pg-basket" data-pg-basket="${basket.id}"><b>${esc(basket.label)}</b><span>${cards.map((card, i) => placed[i] === basket.id ? `<i>${esc(card.text)}</i>` : '').join('')}</span></button>`).join('')}</div>`;
    const sortedView = `<div class="pg-baskets is-done">${content.baskets.map(basket => `<div class="pg-basket"><b>${esc(basket.label)}</b><span>${cards.filter(card => card.basket === basket.id).map(card => `<i>${esc(card.text)}</i>`).join('')}</span></div>`).join('')}</div>`;
    if (phase === 'question') return `${sortedView}<p class="pg-ask">${esc(content.question)}</p><div class="pg-options">${content.options.map((option, i) => `<button type="button" class="pg-option" data-pg-option="${i}">${esc(option)}</button>`).join('')}</div>`;
    return `${ruleCard()}<p class="pg-word">${esc(content.transfer.text)}</p><button type="button" class="pg-hear is-wide" data-pg-hear="transfer">${SPEAKER}<span>聽一聽「${esc(content.transfer.text)}」</span></button>
      ${heard.includes('transfer') ? `<p class="pg-ask">${esc(transferPrompt())}</p><div class="pg-options">${content.transfer.options.map((option, i) => `<button type="button" class="pg-option" data-pg-option="${i}">${esc(option)}</button>`).join('')}</div>` : ''}`;
  }
  function update() {
    present();
    root.dataset.mode = content.mode;root.dataset.phase = phase;root.dataset.complete = String(done || solved);
    q('h3').textContent = done || solved ? '找到規律了！' : pick ? '哪個讀法是對的？' : phase === 'sort' ? '聽一聽，放進籃子' : phase === 'question' ? '你發現了甚麼？' : '用規律讀新詞';
    q('.pg-progress').textContent = pick ? `${Math.min(round + 1, rounds.length)} / ${rounds.length}` : `${PHASES.indexOf(phase) + 1} / ${PHASES.length}`;
    q('.pg-task').textContent = done || solved ? '記住這個規律，讀詩的時候用得上。'
      : pick ? (heard.length < 2 ? '兩個讀法都聽一聽，再選對的那個。' : '哪個讀法是對的？')
      : phase === 'sort' ? (selected === null ? '點一張詞卡，聽它怎樣讀。' : `「${cards[selected].text}」放進哪個籃子？`)
      : phase === 'question' ? '看看兩個籃子裏的詞，想一想。' : '先聽，再選。';
    q('.pg-work').innerHTML = work();
    root.querySelectorAll('[data-pg-take]').forEach(el => {el.disabled = !available() || heard.length < 2;});
    root.querySelectorAll('[data-pg-hear],[data-pg-card]').forEach(el => {el.disabled = !ready || busy || solved || readOnly && !done;});
    root.querySelectorAll('[data-pg-basket]').forEach(el => {el.disabled = !available() || selected === null;});
    root.querySelectorAll('[data-pg-option]').forEach(el => {el.disabled = !available();});
    const listen = q('[data-pg-listen]');listen.hidden = true;
    q('[data-pg-next]').hidden = true;
    frame.pose(done || solved ? 'found' : 'look');
  }
  async function hear(kind, clip) {
    if (!ready || busy || solved) return;
    busy = true;update();research.hint(step(), 'audio');
    const ok = await frame.play(playAudio, clip);
    if (ok === null) return;
    busy = false;
    if (ok === false) {research.error(step(), 'audio_unavailable');update();frame.tell('讀音暫時未能播放，可以再按一次。');return;}
    if (!heard.includes(kind) && !readOnly && !done) {heard.push(kind);save();}
    update();
  }
  function finish(message) {
    done = true;selected = null;update();save();frame.tell(message);
    if (!reported) {reported = true;research.complete();onComplete?.({correct: true, response: state()});}
  }
  function take(kind) {
    if (!available() || !pick || heard.length < 2) return;
    const value = rounds[round], correct = kind === 'right';
    research.answer(step(), kind, correct);
    if (!correct) {research.hint(step());frame.tell('再聽一次兩個讀法，仔細比一比。');return;}
    const sound = value.right.join(' ');
    if (round === rounds.length - 1) {finish(`對！「${value.text}」讀 ${sound}。`);return;}
    round++;heard = [];update();save();frame.tell(`對！「${value.text}」讀 ${sound}。下一個詞。`);
  }
  function card(index) {
    if (!ready || busy || solved || placed[index]) return;
    if (!readOnly && !done) selected = index;
    void hear(`c${index}`, `${slug}-rule-${index}-card`);
  }
  function basket(id) {
    if (!available() || selected === null) return;
    const index = selected, value = cards[index], correct = value.basket === id;
    research.answer(`card${index}`, id, correct);
    if (!correct) {research.hint(`card${index}`);frame.tell(`再聽一次「${value.text}」，${content.baskets[0].id === 'change' ? '前一個字變了嗎？' : '它讀哪個音？'}`);return;}
    placed[index] = id;selected = null;
    if (sorted()) {phase = 'question';update();save();frame.tell('全部放好了！看看籃子，想一想。');return;}
    update();save();frame.tell(`放對了，「${value.text}」放進「${basketLabel(id)}」。`);
  }
  function option(index) {
    if (!available()) return;
    if (phase === 'question') {
      const correct = index === content.answer;
      research.answer('question', `o${index}`, correct);
      if (!correct) {research.hint('question');frame.tell('再看看籃子裏的詞，聽一聽也可以。');return;}
      phase = 'transfer';update();save();frame.tell('說得對！用這個規律，讀一個新詞。');return;
    }
    if (phase !== 'transfer' || !heard.includes('transfer')) return;
    const correct = index === content.transfer.answer;
    research.answer('transfer', `o${index}`, correct);
    if (!correct) {research.hint('transfer');frame.tell('再想想規律，聽一次也可以。');return;}
    finish(`對！「${content.transfer.text}」讀 ${content.transfer.right.join(' ')}。你是讀音小偵探！`);
  }
  root.addEventListener('click', event => {
    const target = event.target;
    const hearEl = target.closest('[data-pg-hear]');
    if (hearEl) {const kind = hearEl.dataset.pgHear;void hear(kind, kind === 'transfer' ? `${slug}-rule-transfer` : `${slug}-rule-${round}-${kind}`);}
    const takeEl = target.closest('[data-pg-take]');if (takeEl) take(takeEl.dataset.pgTake);
    const cardEl = target.closest('[data-pg-card]');if (cardEl) card(+cardEl.dataset.pgCard);
    const basketEl = target.closest('[data-pg-basket]');if (basketEl) basket(basketEl.dataset.pgBasket);
    const optionEl = target.closest('[data-pg-option]');if (optionEl) option(+optionEl.dataset.pgOption);
  }, {signal: frame.signal});
  function start() {ready = true;update();}
  update();frame.tell(done ? '記住這個規律，讀詩的時候用得上。' : '');void frame.load(research, start);
  return {
    showSolution() {if (frame.dead || solved) return;research.hint('game', 'reveal');solved = true;busy = false;update();frame.tell(content.rule);},
    destroy() {frame.destroy();}
  };
}
