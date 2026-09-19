// The cookie is HttpOnly. Only the current user's display profile and CSRF
// token live in memory; passwords and bearer credentials are never persisted.
let current = {enabled: false, authenticated: false, user: null, csrfToken: ''};
let blocked = false;
const listeners = new Set();
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export const schoolState = () => current;
export function schoolHeaders(headers = {}) {
  return {...headers, ...(current.enabled && current.csrfToken ? {'X-CSRF-Token':current.csrfToken} : {})};
}
export function onSchoolSessionInvalid(callback) { listeners.add(callback); return () => listeners.delete(callback); }
export function invalidateSchoolSession() {
  if (!current.enabled || blocked) return;
  blocked = true;
  current = {...current,authenticated:false,user:null,csrfToken:''};
  for (const callback of listeners) callback();
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  document.querySelector('#app')?.replaceChildren();
  const panel = document.createElement('div');
  panel.className = 'school-session-expired';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = '<section><h2>請重新登入</h2><p>帳戶已登出或在另一個分頁切換。重新登入後，就能繼續學習。</p><button class="button primary" type="button">重新登入</button></section>';
  document.body.append(panel);
  panel.querySelector('button').addEventListener('click', () => location.reload());
  panel.querySelector('button').focus();
}
export async function schoolFetch(url, options = {}) {
  if (blocked) throw Object.assign(new Error('請重新登入。'), {code:'AUTH_REQUIRED'});
  const response = await fetch(url, {...options, credentials:'same-origin', headers:schoolHeaders(options.headers)});
  if (current.enabled && [401, 403, 409].includes(response.status)) {
    const data = await response.clone().json().catch(() => null);
    if (response.status === 401 || ['ACTOR_CHANGED','CSRF_INVALID','CSRF_REJECTED','ACCOUNT_CHANGED','AUTH_REQUIRED','SESSION_EXPIRED','INVALID_CSRF'].includes(data?.code)) invalidateSchoolSession();
  }
  return response;
}
export async function loadSchoolProgress() {
  if (!current.enabled || current.user?.role !== 'student') return null;
  const response = await schoolFetch('/api/school-auth/?action=progress', {signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('學習進度暫時未能同步。');
  const data = await response.json();
  if (data.userId !== current.user.id || !data.poems) throw new Error('學習進度未能核對。');
  return data.poems;
}
export async function logoutSchoolSession() {
  const response = await schoolFetch('/api/school-auth/', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'logout'}), signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('暫時未能登出，請再試一次。');
  broadcast('signed-out');
  location.replace(location.pathname);
}
let channel;
function broadcast(kind) { channel?.postMessage({kind}); }
function connectSessionChannel() {
  if (!globalThis.BroadcastChannel) return;
  channel = new BroadcastChannel('maanshan-school-session');
  channel.addEventListener('message', () => invalidateSchoolSession());
}
function ensureStyle() {
  if (document.querySelector('link[data-school-auth-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = 'school-session.css?v=20260920-school1';
  link.dataset.schoolAuthStyle = 'true'; document.head.append(link);
}
async function readSession() {
  const response = await fetch('/api/school-auth/', {credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(15000)});
  // Only the intentionally separate legacy site may lack this new endpoint.
  const legacyHost=['aiducation.asia','www.aiducation.asia'].includes(location.hostname)||/^aiducation-website(?:-[a-z0-9-]+)?\.vercel\.app$/.test(location.hostname);
  if (response.status === 404 && legacyHost) return {enabled:false, authenticated:false, user:null, csrfToken:''};
  if (!response.ok) throw new Error('帳戶服務暫時未能連線。');
  const data = await response.json();
  if (typeof data.enabled !== 'boolean') throw new Error('帳戶服務回覆不完整。');
  if (location.hostname==='mandarin.aiducation.asia'&&!data.enabled) throw new Error('學校帳戶服務尚未就緒。');
  return data;
}
function loginScreen(host, initialError = '') {
  document.body.dataset.screen = 'school-login';
  document.querySelector('#profile-open')?.setAttribute('hidden', '');
  host.innerHTML = `<main class="school-login" id="main"><section class="school-login-card" aria-labelledby="school-login-title"><div class="school-login-art" aria-hidden="true"><img src="media/poetry-motifs/goose.svg" width="88" height="88" alt=""><span>讀一首詩 · 遇見新世界</span></div><p class="school-login-eyebrow">馬鞍山靈糧小學 · 普通話學習平台</p><h1 id="school-login-title">準備好，一起學古詩</h1><p>用學校給你的帳戶登入，接着上次的進度繼續學習。</p><form id="school-login-form"><label>登入名稱<input name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="80" required placeholder="學校提供的登入名稱"></label><label>登入密碼<span class="school-password"><input name="password" type="password" autocomplete="current-password" maxlength="128" required><button type="button" aria-label="顯示密碼" aria-pressed="false" id="school-password-toggle">顯示</button></span></label><p id="school-login-error" role="alert">${escape(initialError)}</p><button class="button primary school-login-submit" type="submit">登入，開始學習</button></form><p class="school-login-help">老師也使用這裏登入，系統會帶你前往教師工作台。<br>忘記密碼時，請向老師查詢。</p></section></main>`;
  const form = host.querySelector('form'), status = host.querySelector('#school-login-error');
  host.querySelector('#school-password-toggle').addEventListener('click', event => {
    const show = form.elements.password.type === 'password';
    form.elements.password.type = show ? 'text' : 'password';
    event.currentTarget.textContent = show ? '隱藏' : '顯示';
    event.currentTarget.setAttribute('aria-pressed', String(show));
    event.currentTarget.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
  });
  return new Promise(resolve => form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true; button.textContent = '正在登入…'; status.textContent = '';
    broadcast('sign-in-attempt');
    try {
      const response = await fetch('/api/school-auth/', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'login', login:form.elements.login.value.trim(), password:form.elements.password.value}), signal:AbortSignal.timeout(20000)});
      form.elements.password.value = '';
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.authenticated || !data.user) {
        status.textContent = response.status === 429 ? '剛才嘗試次數較多，請稍候再登入。' : response.status >= 500 ? '帳戶服務暫時未能連線，請稍後再試。' : '登入名稱或密碼不正確，請核對學校提供的資料。';
        return;
      }
      broadcast('signed-in');
      resolve(data);
    } catch { form.elements.password.value = ''; status.textContent = '暫時未能連線，請檢查網絡後再試。'; }
    finally { button.disabled = false; button.textContent = '登入，開始學習'; }
  }));
}
export async function initializeSchoolSession(host) {
  ensureStyle();
  let data;
  try { data = await readSession(); }
  catch {
    // A service failure must never quietly reopen the school site as a demo.
    host.innerHTML = '<main class="school-login"><section class="school-login-card"><h1>正在等候帳戶服務</h1><p>暫時未能連線。請重新載入，學習資料會保留。</p><button class="button primary" type="button">重新載入</button></section></main>';
    host.querySelector('button').addEventListener('click', () => location.reload());
    return new Promise(() => {});
  }
  current = data;
  if (!data.enabled) return current;
  connectSessionChannel();
  if (!data.authenticated) current = await loginScreen(host);
  if (current.user?.role === 'teacher') { location.replace('teacher.html'); return new Promise(() => {}); }
  if (current.user?.role !== 'student' || !current.csrfToken) throw new Error('Invalid school session');
  document.querySelector('#profile-open')?.removeAttribute('hidden');
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || blocked) return;
    try { const next = await readSession(); if (!next.authenticated || next.user?.id !== current.user.id || next.csrfToken !== current.csrfToken) invalidateSchoolSession(); }
    catch { /* A transient network failure does not discard this user's queue. */ }
  });
  return current;
}
