// 上週學習報告 (school70): a 「我的週報」 button beside the pupil's name in the
// header. Every Sunday 06:00 (Hong Kong) the server publishes last week's report
// (Sunday to Saturday); the button shows a red dot until the pupil has opened it.
// Only encouragement is shown: what was practised, the best line, the biggest
// rise and the characters now read well. No ranking, no comparison.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg = (body, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  read: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  write: '<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  challenge: '<path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978"/><path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978"/><path d="M18 9h1.5a1 1 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6 9H4.5a1 1 0 0 1 0-5H6"/>',
  chat: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  prev: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>', close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
};
const DAYS = ['日', '一', '二', '三', '四', '五', '六'];
// Earned when the week reaches them; each badge is drawn, never a photo.
const BADGES = {
  days: {name: '堅持之星', note: n => `練習了 ${n} 天`, hue: 'gold'},
  reader: {name: '朗讀小達人', note: n => `朗讀 ${n} 句`, hue: 'jade'},
  rise: {name: '進步之星', note: n => `一句進步 ${n} 分`, hue: 'rose'},
  writer: {name: '默寫小能手', note: n => `默寫 ${n} 個字`, hue: 'navy'},
  voice: {name: '好聲音', note: n => `一句讀到 ${n} 分`, hue: 'gold'}
};
const dateLabel = iso => { const [, m, d] = iso.split('-').map(Number); return `${m}月${d}日`; };
const medal = (key, value) => {
  const badge = BADGES[key];
  if (!badge) return '';
  return `<li class="weekly-medal" data-hue="${badge.hue}"><span class="weekly-medal-disc" aria-hidden="true"><svg viewBox="0 0 64 64"><path class="ribbon" d="M20 40 14 62l10-5 6 6 4-21M44 40l6 22-10-5-6 6-4-21"/><circle class="rim" cx="32" cy="27" r="22"/><circle class="face" cx="32" cy="27" r="17"/><path class="star" d="m32 15 3.6 7.4 8.1 1.2-5.9 5.7 1.4 8.1L32 33.6l-7.2 3.8 1.4-8.1-5.9-5.7 8.1-1.2z"/></svg></span><b>${badge.name}</b><small>${esc(badge.note(value))}</small></li>`;
};
function encouragement(r) {
  if (!r.days.some(Boolean)) return '上星期我們沒有見面呢。這星期一起讀一首詩，好嗎？';
  if (r.improved && r.improved.to - r.improved.from >= 20) return `《${r.improved.title}》那一句，你從 ${r.improved.from} 分讀到 ${r.improved.to} 分，詩詩都聽出來了！`;
  if (!r.reading.lines && (r.writing.chars || r.challenge.count)) return '默寫、挑戰都做了，下星期也來讀一讀詩吧！';
  if (r.best?.score >= 90) return `你把「${r.best.line}」讀得又準又好聽，詩詩很喜歡！`;
  return '每一次開口讀，都是在進步。下星期我們再一起加油！';
}
function card(r, name, nav) {
  const practised = r.days.filter(Boolean).length, great = practised >= 3 || r.reading.lines >= 30;
  const stats = [
    ['read', '朗讀', r.reading.lines, '句'], ['write', '默寫', r.writing.chars, '個字'],
    ['challenge', '小挑戰', r.challenge.count, '次'], ['chat', '和詩人聊天', r.chat.count, '次']
  ];
  const rise = r.improved ? Math.max(0, r.improved.to - r.improved.from) : 0;
  return `<article class="weekly-card" aria-labelledby="weekly-title">
  <div class="weekly-hero"><img src="media/weekly/hero-20261017.webp" width="1200" height="800" alt="" decoding="async"></div>
  <button class="weekly-close" type="button" data-weekly="close" aria-label="關閉" title="關閉">${svg(ICONS.close)}</button>
  <header class="weekly-head">
   <p class="weekly-ribbon"><span>${r.preview ? '上週學習報告（預覽）' : '上週學習報告'}</span></p>
   <p class="weekly-range">${dateLabel(r.week.start)}（星期日）至 ${dateLabel(r.week.end)}（星期六）</p>
   <h2 id="weekly-title">${esc(name)}，${great ? '這一週你真棒！' : practised ? '這一週你有在練習！' : '新的一週，我們一起來！'}</h2>
  </header>
  <section class="weekly-week" aria-label="練習的日子"><ol>${r.days.map((on, i) => `<li class="${on ? 'on' : ''}"><span>${DAYS[i]}</span><i aria-hidden="true">${on ? '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7"/></svg>' : ''}</i></li>`).join('')}</ol><p>這星期練習了 <b>${practised}</b> 天</p></section>
  <ul class="weekly-stats">${stats.map(([key, label, n, unit]) => `<li data-kind="${key}">${svg(ICONS[key])}<span>${label}</span><b>${n}<small>${unit}</small></b></li>`).join('')}</ul>
  ${r.best ? `<section class="weekly-best"><div class="weekly-score" style="--score:${r.best.score}"><b>${r.best.score}</b><small>分</small></div><div><p class="weekly-label">本週讀得最好的一句</p><p class="weekly-line">${esc(r.best.line)}</p><p class="weekly-from">《${esc(r.best.title)}》${esc(r.best.label)}</p></div></section>` : ''}
  ${r.improved && rise > 0 ? `<section class="weekly-rise"><p class="weekly-label">進步最多的一句</p><p class="weekly-line">${esc(r.improved.line)}<span>《${esc(r.improved.title)}》</span></p><div class="weekly-bar" style="--from:${r.improved.from};--to:${r.improved.to}"><span class="from">${r.improved.from}</span><i></i><span class="to">${r.improved.to}</span></div><p class="weekly-up">進步了 <b>${rise}</b> 分</p></section>` : ''}
  ${r.fixedChars?.length ? `<section class="weekly-chars"><p class="weekly-label">這些字，你現在讀準了</p><ul>${r.fixedChars.map(w => `<li><ruby>${esc(w.c)}<rt>${esc(w.p)}</rt></ruby></li>`).join('')}</ul></section>` : ''}
  ${r.badges?.length ? `<section class="weekly-badges"><p class="weekly-label">本週成就</p><ul>${r.badges.map(b => medal(b.key, b.value)).join('')}</ul></section>` : ''}
  <footer class="weekly-shishi"><img src="media/shishi-guide.webp" width="614" height="800" alt="" decoding="async"><p>${esc(encouragement(r))}</p></footer>
  ${nav}
 </article>`;
}
export function mountWeeklyReport({anchor, userId, studentName, load}) {
  if (!anchor || document.querySelector('.weekly-bell')) return;
  const SEEN = 'ms_weekly_seen:' + userId;
  const bell = document.createElement('button');
  bell.type = 'button'; bell.className = 'weekly-bell'; bell.title = '上週學習報告';
  bell.innerHTML = '<span class="weekly-word"><span>我的</span><span>週報</span></span><span class="weekly-dot" hidden></span>';
  anchor.after(bell);
  let reports = [], index = 0;
  const seen = () => { try { return localStorage.getItem(SEEN) || ''; } catch { return ''; } };
  const mark = () => { const dot = bell.querySelector('.weekly-dot'), fresh = reports[0] && reports[0].id !== seen(); dot.hidden = !fresh; bell.classList.toggle('has-new', !!fresh); bell.setAttribute('aria-label', fresh ? '我的週報（有新報告）' : '我的週報'); };
  const dialog = document.createElement('dialog');
  dialog.className = 'weekly-dialog'; dialog.setAttribute('aria-labelledby', 'weekly-title');
  document.body.append(dialog);
  const render = () => {
    const r = reports[index];
    if (!r) { dialog.innerHTML = `<article class="weekly-card weekly-empty"><button class="weekly-close" type="button" data-weekly="close" aria-label="關閉" title="關閉">${svg(ICONS.close)}</button><img src="media/weekly/reading-20261017.webp" width="640" height="640" alt="" decoding="async"><h2 id="weekly-title">第一份週報快到了</h2><p>每個星期日早上，詩詩會把上一週的學習成果送到這裏。</p></article>`; return; }
    const nav = reports.length > 1 ? `<nav class="weekly-nav"><button type="button" data-weekly="older" ${index >= reports.length - 1 ? 'disabled' : ''}>${svg(ICONS.prev)}更早</button><span>${index + 1} / ${reports.length}</span><button type="button" data-weekly="newer" ${index ? '' : 'disabled'}>較新${svg(ICONS.next)}</button></nav>` : '';
    dialog.innerHTML = card(r, r.sampleName || studentName, nav);
    dialog.scrollTop = 0;
  };
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-weekly]')?.dataset.weekly;
    if (event.target === dialog || action === 'close') dialog.close();
    else if (action === 'older' && index < reports.length - 1) { index++; render(); }
    else if (action === 'newer' && index > 0) { index--; render(); }
  });
  bell.addEventListener('click', () => {
    index = 0; render(); dialog.showModal();
    if (reports[0]) { try { localStorage.setItem(SEEN, reports[0].id); } catch {} mark(); }
  });
  const refresh = () => load().then(list => { if (Array.isArray(list)) { reports = list; mark(); } }).catch(() => {});
  refresh();
  // A tab left open over the weekend picks up Sunday's report when it is shown again.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  return {refresh};
}
