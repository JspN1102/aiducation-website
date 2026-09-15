const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const POEM_DETAILS = Object.freeze({
  'yong-e': {motif:'goose'},
  'zeng-wang-lun': {motif:'boat'},
  'ti-xi-lin-bi': {motif:'mountain'},
  'bo-chuan-gua-zhou': {motif:'moon'},
  'gui-yuan-tian-ju': {motif:'sprout'},
  'zao-chun': {motif:'swallow'}
});
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  record:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  animation:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>',
  quiz:'<path d="M5 21V4m0 0c5-5 9 5 14 0v9c-5 5-9-5-14 0"/>',
  write:'<path d="m15 4 5 5M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15l-1 5ZM4 20h16"/>',
  explore:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9"/>',
  chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 0 1-1-5 9 9 0 0 1 18 0Z"/><path d="M8 10h8M8 14h5"/>',
  report:'<path d="M5 3h14v18H5zM9 16v2M12 12v6M15 8v10"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'
}[name] || ''}</svg>`;
const allowedViews = new Set(['record','quiz','write','explore','chat','report']);
const count = (value, maximum) => Math.max(0, Math.min(maximum, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));

/** A navigation hub: completion comes only from actual reading/writing/quiz work. */
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
    const writingTotal = Array.isArray(poem.dictation) ? poem.dictation.length : 0;
    const written = count(current.writingCompleted,writingTotal);
    const answered = count(current.challengeAnswered,5);
    const completed = current.challengeCompleted === true;
    const readingLabel = done ? `已讀 ${done} / ${total} 句` : '聽示範，再開口';
    const challengeLabel = completed ? '五題都練過了' : answered ? `已練 ${answered} / 5 題` : '聽音、寫字、玩';
    const canResume = latestResume && allowedViews.has(latestResume.view);
    const steps = [
      {view:'record',title:'聽一聽・讀一讀',status:readingLabel,done:done===total},
      {view:'animation',title:'看一看',status:'動畫準備中',pending:true},
      {view:'explore',title:'找一找',status:'動手找小發現'},
      {view:'quiz',title:'練一練',status:challengeLabel,done:completed}
    ];
    root.innerHTML = `<header class="lesson-map-hero"><img class="lesson-map-motif" src="media/poetry-motifs/${details.motif}.svg" width="48" height="48" alt=""><h2>一起學古詩</h2></header>
      <nav class="lesson-map-steps" aria-label="四步學古詩">${steps.map((step,index)=>{
        const tag=step.pending?'div':'a';
        const attributes=step.pending?'role="group" aria-label="看一看，動畫準備中"':`href="${route(step.view)}" data-lesson-view="${step.view}"`;
        const resume=canResume&&latestResume.view===step.view;
        return `<${tag} class="lesson-map-step lesson-map-step-${step.view}${step.done?' is-complete':''}${step.pending?' is-pending':''}${resume?' is-resume':''}" ${attributes}><div class="lesson-map-step-top"><span class="lesson-map-number">${index+1}</span><span class="lesson-map-step-icon">${icon(step.view)}</span>${step.pending?'':`<span class="lesson-map-step-arrow">${icon('arrow')}</span>`}</div><div class="lesson-map-step-copy"><h3>${step.title}</h3><span class="lesson-map-status">${esc(step.status)}</span></div></${tag}>`;
      }).join('')}</nav>
      <nav class="lesson-map-extras" aria-label="也可以試試">${[['write','寫一寫'],['chat','找詩人'],['report','看成果']].map(([view,label])=>`<a href="${route(view)}" data-lesson-view="${view}"${view==='write'&&written?` aria-label="寫一寫，已練 ${written} / ${writingTotal} 字"`:''}>${icon(view)}<span>${label}</span></a>`).join('')}</nav>`;
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
