import {createProcessResearch} from './research.mjs?v=20260920a';
import {createPracticeFrame, esc, hanOf, count} from './practice-common.mjs?v=20261029-school74';
import {PRACTICE_GAMES} from '../practice-games-data.mjs?v=20261029-school74';

/** 小老師找錯: 書童小墨 reads, the pupil is the teacher.
 * judge (grades 1-2): one word at a time, 讀對了 or 讀錯了.
 * find (grades 3-6): one line with one misread character; tap it, then pick its reading.
 * A wrong choice is logged and tried again, so every pupil ends having found each mistake. */
export function mountTeacherSpot(holder, {content, slug, researchPrefix, initialState, readOnly = false, playAudio, onState, onComplete, onResearch, reducedMotion = false} = {}) {
  content ??= PRACTICE_GAMES[slug]?.spot;
  if (!content) throw new TypeError('Unknown practice game');
  const {mode, rounds} = content, judge = mode === 'judge', last = rounds.length - 1;
  const saved = initialState?.version === 1 ? initialState : null;
  let round = count(saved?.round, last), heard = saved?.heard === true, found = !judge && saved?.found === true, cleared = saved?.cleared === true;
  let done = saved?.completed === true, solved = false, ready = false, busy = false, reported = done;
  if (done) {round = last;heard = true;found = true;cleared = true;}
  const research = createProcessResearch(onResearch, {prefix: researchPrefix || `game.spot.${slug}`, alive: () => !frame.dead});
  const frame = createPracticeFrame(holder, {kind: 'spot', title: '小老師找錯', reducedMotion, onRetryAssets: () => frame.load(research, start),
    poses: {read: 'spot-read-20261029.webp', oops: 'spot-oops-20261029.webp', thanks: 'spot-thanks-20261029.webp'},
    alt: {read: '小書童小墨拿着竹簡大聲朗讀。', oops: '小墨讀錯了，不好意思地抓抓頭。', thanks: '小墨拱手謝謝小老師。'}});
  const {q, root} = frame;
  const item = () => rounds[round];
  const isWrong = value => value.said !== undefined;
  const step = () => `r${round}.${judge ? 'judge' : found ? 'fix' : 'char'}`;
  const state = () => ({version: 1, round, heard, found, cleared, completed: done});
  const save = () => {if (!readOnly && !solved && !frame.dead) onState?.(state());};
  const available = () => ready && !readOnly && !solved && !done && !busy;
  const clipId = kind => `${slug}-spot-${round}-${kind}`;
  const wrongChar = value => hanOf(value.text)[value.wrong];
  const fixed = value => value.right[value.wrong];

  function present() {
    if (!ready || readOnly || done || solved || !heard || cleared) return;
    research.present(step(), {position: judge ? round : round * 2 + (found ? 1 : 0), total: judge ? rounds.length : rounds.length * 2,
      optionOrder: judge ? ['right', 'wrong'] : found ? item().options.map((_, i) => `o${i}`) : hanOf(item().text).map((_, i) => `c${i}`)});
  }
  function work() {
    const value = item(), chars = hanOf(value.text);
    if (judge) return `<div class="pg-phrase" data-pg-phrase>${chars.map((char, i) => `<span class="pg-char${cleared && isWrong(value) && i === value.wrong ? ' is-caught' : ''}">${esc(char)}${cleared ? `<small>${esc(value.right[i])}</small>` : ''}</span>`).join('')}</div>
      <div class="pg-verdicts"><button type="button" class="pg-verdict is-right" data-pg-verdict="right"><span aria-hidden="true">✓</span>讀對了</button><button type="button" class="pg-verdict is-wrong" data-pg-verdict="wrong"><span aria-hidden="true">✗</span>讀錯了</button></div>`;
    let at = -1;
    const line = Array.from(value.text).map(char => /\p{Script=Han}/u.test(char)
      ? (at++, `<button type="button" class="pg-tile${found && at === value.wrong ? ' is-caught' : ''}" data-pg-tile="${at}">${esc(char)}${cleared && at === value.wrong ? `<small>${esc(fixed(value))}</small>` : ''}</button>`)
      : `<span class="pg-punct">${esc(char)}</span>`).join('');
    return `<div class="pg-line">${line}</div>${found && !cleared ? `<div class="pg-options" aria-label="「${esc(wrongChar(value))}」應該怎樣讀？">${value.options.map((option, i) => `<button type="button" class="pg-option" data-pg-option="${i}">${esc(option)}</button>`).join('')}</div>` : ''}`;
  }
  function update() {
    present();
    root.dataset.mode = mode;root.dataset.complete = String(done || solved);
    q('h3').textContent = done || solved ? '謝謝小老師！' : judge ? '小墨讀得對不對？' : found ? '應該怎樣讀？' : '小墨哪個字讀錯了？';
    q('.pg-progress').textContent = `${round + 1} / ${rounds.length}`;
    q('.pg-task').textContent = done || solved ? '每個讀錯的字，你都找到了。'
      : !heard ? '先聽小墨讀一讀。' : judge ? '小墨讀得對，按「讀對了」；有一個字讀錯，按「讀錯了」。'
      : found ? `「${wrongChar(item())}」小墨讀成了 ${item().said}。正確的讀音是哪個？` : '點一下讀錯的那個字。';
    const workEl = q('.pg-work');workEl.innerHTML = work();workEl.hidden = !heard && !done && !solved;
    root.querySelectorAll('[data-pg-verdict],[data-pg-tile],[data-pg-option]').forEach(el => {el.disabled = !available() || cleared || !heard;});
    const listen = q('[data-pg-listen]');listen.disabled = !ready || busy || solved;listen.setAttribute('aria-busy', String(busy));
    listen.querySelector('span').textContent = busy ? '仔細聽…' : cleared && isWrong(item()) ? '聽正確讀法' : heard ? '再聽小墨讀' : '聽小墨讀';
    q('[data-pg-next]').hidden = !(cleared && round < last && !done && !readOnly && !solved);q('[data-pg-next]').disabled = !ready || busy;
    frame.pose(done || solved ? 'thanks' : cleared ? (isWrong(item()) ? 'oops' : 'thanks') : 'read');
  }
  async function listen() {
    if (!ready || busy || solved) return;
    const replayRight = cleared && isWrong(item());
    busy = true;update();research.hint(step(), 'audio');
    const ok = await frame.play(playAudio, clipId(replayRight ? 'right' : 'said'));
    if (ok === null) return;
    busy = false;
    if (ok === false) research.error(step(), 'audio_unavailable');
    if (!heard && !readOnly && !done) {heard = true;save();}
    update();
    if (ok === false) frame.tell('朗讀暫時未能播放，可以再按一次。');
    else if (!cleared && !done) frame.tell(judge ? '你聽到了甚麼？讀對了還是讀錯了？' : found ? '選出正確的讀音。' : '哪個字聽起來不對？點一下它。');
  }
  function clearRound(message) {
    cleared = true;
    if (round === last) {done = true;update();save();frame.tell(message + ' 全部找完了，謝謝小老師！');
      if (!reported) {reported = true;research.complete();onComplete?.({correct: true, response: state()});}
      return;}
    update();save();frame.tell(message);
  }
  function verdict(choice) {
    if (!available() || !judge || cleared || !heard) return;
    const value = item(), correct = (choice === 'wrong') === isWrong(value);
    research.answer(step(), choice, correct);
    if (!correct) {research.hint(step());frame.tell(choice === 'wrong' ? '再聽一次，每個字都讀得準嗎？' : '再聽一次，有一個字的讀音不太對喔。');return;}
    if (isWrong(value)) {
      clearRound(`抓到了！小墨把「${wrongChar(value)}」讀成 ${value.said[value.wrong]}，應該讀 ${fixed(value)}。`);
      busy = true;update();
      frame.play(playAudio, clipId('right')).then(ok => {if (ok === null) return;busy = false;update();});
    } else clearRound('對！小墨這次讀得很準。');
  }
  function tile(index) {
    if (!available() || judge || found || cleared || !heard) return;
    const correct = index === item().wrong;
    research.answer(step(), `c${index}`, correct);
    if (!correct) {research.hint(step());frame.tell(`「${hanOf(item().text)[index]}」讀得沒錯。再聽一次，找找別的字。`);return;}
    found = true;update();save();frame.tell(`對，就是「${wrongChar(item())}」！小墨讀成了 ${item().said}。`);
  }
  function option(index) {
    if (!available() || judge || !found || cleared) return;
    const value = item(), correct = value.options[index] === fixed(value);
    research.answer(step(), `o${index}`, correct);
    if (!correct) {research.hint(step());frame.tell(value.options[index] === value.said ? '這是小墨讀錯的讀音，再選一次。' : '不是這個，再想一想。');return;}
    clearRound(`對！「${wrongChar(value)}」讀 ${fixed(value)}。聽小墨讀一次正確的。`);
    busy = true;update();
    frame.play(playAudio, clipId('right')).then(ok => {if (ok === null) return;busy = false;update();});
  }
  function next() {
    if (!ready || busy || readOnly || solved || !cleared || round >= last) return;
    round++;heard = false;found = false;cleared = false;update();save();frame.tell('');q('[data-pg-listen]').focus({preventScroll: true});
  }
  root.addEventListener('click', event => {
    const target = event.target;
    if (target.closest('[data-pg-listen]')) void listen();
    if (target.closest('[data-pg-next]')) next();
    const verdictEl = target.closest('[data-pg-verdict]');if (verdictEl) verdict(verdictEl.dataset.pgVerdict);
    const tileEl = target.closest('[data-pg-tile]');if (tileEl) tile(+tileEl.dataset.pgTile);
    const optionEl = target.closest('[data-pg-option]');if (optionEl) option(+optionEl.dataset.pgOption);
  }, {signal: frame.signal});
  function start() {ready = true;update();}
  update();frame.tell(done ? '每個讀錯的字，你都找到了。' : '');void frame.load(research, start);
  return {
    showSolution() {if (frame.dead || solved) return;research.hint('game', 'reveal');solved = true;busy = false;update();
      frame.tell(rounds.filter(isWrong).map(value => `「${wrongChar(value)}」讀 ${fixed(value)}`).join('；') + '。');},
    destroy() {frame.destroy();}
  };
}
