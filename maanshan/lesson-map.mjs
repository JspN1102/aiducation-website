const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const POEM_DETAILS = Object.freeze({
  'yong-e': {motif:'goose',question:'白鵝怎樣游進詩裏？'},
  'zeng-wang-lun': {motif:'boat',question:'友情，能有多深？'},
  'ti-xi-lin-bi': {motif:'mountain',question:'換個角度，會看見甚麼？'},
  'bo-chuan-gua-zhou': {motif:'moon',question:'明月照着誰的思念？'},
  'gui-yuan-tian-ju': {motif:'sprout',question:'月下歸來，心裏有甚麼願望？'},
  'zao-chun': {motif:'swallow',question:'春天，藏在哪一點新綠裏？'}
});
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  record:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  read:'<path d="M12 6C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2ZM12 6v15M5 8h3M16 8h3M5 12h3M16 12h3"/>',
  quiz:'<path d="M5 21V4m0 0c5-5 9 5 14 0v9c-5 5-9-5-14 0"/>',
  write:'<path d="m15 4 5 5M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15l-1 5ZM4 20h16"/>',
  explore:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9"/>',
  chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 0 1-1-5 9 9 0 0 1 18 0Z"/><path d="M8 10h8M8 14h5"/>',
  report:'<path d="M5 3h14v18H5zM9 16v2M12 12v6M15 8v10"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'
}[name] || ''}</svg>`;
const allowedViews = new Set(['record','read','quiz','write','explore','chat','report']);
const count = (value, maximum) => Math.max(0, Math.min(maximum, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));

/** A navigation hub only: watching a story is never inferred as completed. */
export function mountLessonMap(holder, {poem, progress = {}, resume = null, onNavigate} = {}) {
  if (!holder?.ownerDocument || !poem || !POEM_DETAILS[poem.slug]) throw new TypeError('A holder and supported poem are required.');
  const details = POEM_DETAILS[poem.slug], doc = holder.ownerDocument;
  const controller = new doc.defaultView.AbortController();
  let dead = false, latestProgress = progress, latestResume = resume;
  const root = doc.createElement('section');
  root.className = 'lesson-map';
  root.setAttribute('aria-label','這首詩的學習路線');
  const route = view => `#${poem.slug}/${view}`;
  function render() {
    if (dead) return;
    const current = latestProgress || {};
    const fallbackTotal = Array.isArray(poem.lines) ? poem.lines.length : 4;
    const total = count(current.readingTotal, 20) || fallbackTotal;
    const done = count(current.readingCompleted,total);
    const answered = count(current.challengeAnswered,5);
    const completed = current.challengeCompleted === true;
    const readingLabel = done ? `${done} / ${total} 句已跟讀` : `一起讀好 ${total} 句詩`;
    const challengeLabel = completed ? '五題已完成・可以再試' : answered ? `已答 ${answered} / 5 題` : '聽兩次・寫兩字・動手玩';
    const canResume = latestResume && allowedViews.has(latestResume.view);
    const resumeLabel = canResume ? (String(latestResume.label || '').trim() || ({record:'跟讀古詩',read:'看懂詩意',quiz:'五題挑戰',write:'練字',explore:'探索',chat:'聊天',report:'看成果'})[latestResume.view]) : '';
    const steps = [
      {view:'record',title:'跟讀古詩',description:'聽一句，讀一句',status:readingLabel,done:done===total},
      {view:'read',title:'看懂詩意',description:'走進詩裏的故事',status:'看畫卷，說故事',done:false},
      {view:'quiz',title:'五題挑戰',description:'帶着耳朵和小手',status:challengeLabel,done:completed}
    ];
    root.innerHTML = `<header class="lesson-map-hero"><div class="lesson-map-picture"><img src="media/${esc(poem.slug)}/cover-final.webp" width="800" height="450" alt="${esc(poem.title)}的最後一幅畫卷"></div><div class="lesson-map-welcome"><div class="lesson-map-kicker"><img src="media/poetry-motifs/${details.motif}.svg" width="48" height="48" alt=""><span>今天，讀懂一首詩</span></div><h2>${details.question}</h2><p>聽一聽，想一想，再試一試。</p></div></header>
      <nav class="lesson-map-steps" aria-label="三個學習板塊">${steps.map((step,index)=>`<a class="lesson-map-step lesson-map-step-${step.view}${step.done?' is-complete':''}" href="${route(step.view)}" data-lesson-view="${step.view}"><div class="lesson-map-step-top"><span class="lesson-map-number">${index+1}</span><span class="lesson-map-step-icon">${icon(step.view)}</span><span class="lesson-map-step-arrow">${icon('arrow')}</span></div><div class="lesson-map-step-copy"><h3>${step.title}</h3><p>${step.description}</p><span class="lesson-map-status">${step.done?'<i aria-hidden="true">✓</i>':''}${esc(step.status)}</span></div></a>`).join('')}</nav>
      ${canResume?`<div class="lesson-map-resume"><a href="${route(latestResume.view)}" data-lesson-view="${latestResume.view}"><span>${/^繼續|^继续/.test(resumeLabel)?esc(resumeLabel):'繼續'+esc(resumeLabel)}</span>${icon('arrow')}</a></div>`:''}
      <nav class="lesson-map-extras" aria-label="也可以自由探索">${[['write','練字'],['explore','探索'],['chat','找詩人'],['report','看成果']].map(([view,label])=>`<a href="${route(view)}" data-lesson-view="${view}">${icon(view)}<span>${label}</span></a>`).join('')}</nav>`;
  }
  root.addEventListener('click', event => {
    const link = event.target.closest('[data-lesson-view]');
    if (!link || !root.contains(link) || dead || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    if (typeof onNavigate === 'function') {event.preventDefault();onNavigate(link.dataset.lessonView);}
  }, {signal:controller.signal});
  holder.replaceChildren(root);
  render();
  return {
    update(nextProgress = latestProgress, nextResume = latestResume) {latestProgress=nextProgress;latestResume=nextResume;render();},
    destroy() {if(dead)return;dead=true;controller.abort();root.remove();}
  };
}
