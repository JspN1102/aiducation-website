// aiducation.hk.cn (the ICP-filed domain) is a public showcase of the school
// platform: every grade's poems, readings, animations, games and AR open without
// an account, like a teacher's view without the teacher dashboard. It has no
// school API at all (nginx refuses /api/ there), so features that need the
// school server - recording assessment, poet chat, reports, handwriting
// recognition, synthesised speech - explain that instead of failing midway.
// Nothing is sent or stored about the visitor. The page carries no school
// badge, name or label: index.html marks the showcase before the first paint
// and pack.css hides the header.
export const SHOWCASE = /^(?:www\.)?aiducation\.hk\.cn$/.test(location.hostname);

// Actions that would start work only the school server can finish.
const SERVER_ACTIONS = new Set(['record-start', 'record-send', 'report-generate', 'chat-suggestion', 'chat-retry', 'chat-voice', 'chat-speak']);
const NOTICE = '展示版可以瀏覽全部古詩、示範朗讀、動畫、練習小遊戲和 AR 體驗。錄音評分、與詩人對話、朗讀報告和手寫辨認需要學校帳戶，請使用學校提供的正式平台。';
let lastNotice = 0;

function showNotice() {
  // One explanation per burst: a failed fallback right after a blocked tap must not stack dialogs.
  if (Date.now() - lastNotice < 1500) return;
  lastNotice = Date.now();
  let dialog = document.getElementById('showcase-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'showcase-dialog'; dialog.className = 'account-dialog showcase-dialog';
    dialog.setAttribute('aria-labelledby', 'showcase-title');
    dialog.innerHTML = '<div class="dialog-heading"><h2 id="showcase-title">展示版</h2></div><p></p><button class="button primary" type="button">知道了</button>';
    dialog.querySelector('p').textContent = NOTICE;
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    document.body.append(dialog);
  }
  if (!dialog.open) dialog.showModal();
}

export function installShowcase() {
  if (!SHOWCASE) return;
  document.documentElement.dataset.showcase = 'true';
  // Any request for the school API is answered here, at once, without leaving the browser.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href); } catch { return nativeFetch(input, init); }
    if (url.origin !== location.origin || !/^\/(?:api|school-api)\//.test(url.pathname)) return nativeFetch(input, init);
    // Reading the account state is part of opening the page; only other requests explain themselves.
    if (!/^\/(?:api|school-api)\/school-auth\/?$/.test(url.pathname)) showNotice();
    return Promise.resolve(new Response(JSON.stringify({error: 'SHOWCASE', code: 'SHOWCASE'}), {status: 503, headers: {'Content-Type': 'application/json'}}));
  };
  // Capture before the platform's own handlers, so a recording or chat never begins.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-action]');
    if (!button || !SERVER_ACTIONS.has(button.dataset.action)) return;
    event.preventDefault(); event.stopImmediatePropagation(); showNotice();
  }, true);
  document.addEventListener('submit', event => {
    if (event.target?.id !== 'chat-form') return;
    event.preventDefault(); event.stopImmediatePropagation(); showNotice();
  }, true);
}
