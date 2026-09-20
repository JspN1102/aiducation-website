import {TERMS_VERSION, termsConfirmationMarkup, bindTermsConfirmation} from './platform-terms.mjs?v=20260921-school6';
import {mountShishiSprite} from './shishi-sprite.mjs?v=20260921-school6';
// The cookie is HttpOnly. Only the current user's display profile and CSRF
// token live in memory; passwords and bearer credentials are never persisted.
let current = {enabled: false, authenticated: false, user: null, csrfToken: ''};
let blocked = false;
let loginRequest;
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
  loginRequest?.abort();
  channel?.close();
  // A broken media disposer must not prevent other consumers being stopped,
  // or leave the previous pupil's private screen visible on a shared device.
  for (const callback of listeners) { try { callback()?.catch?.(() => {}); } catch {} }
  document.querySelectorAll('dialog[open]').forEach(dialog=>{ try { dialog.close(); } catch {} });
  document.querySelector('#profile-open')?.setAttribute('hidden', '');
  document.querySelector('#app')?.replaceChildren();
  const panel = document.createElement('div');
  panel.className = 'school-session-expired';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'school-session-expired-title');
  panel.setAttribute('aria-describedby', 'school-session-expired-message');
  panel.innerHTML = '<section><h2 id="school-session-expired-title">請重新登入</h2><p id="school-session-expired-message">帳戶已登出或在另一個分頁切換。重新登入後，就能繼續學習。</p><button class="button primary" type="button">重新登入</button></section>';
  document.body.append(panel);
  panel.querySelector('button').addEventListener('click', () => location.reload());
  panel.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); panel.querySelector('button').focus(); } });
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
  if (!current.enabled || !['student','teacher'].includes(current.user?.role)) return null;
  const actorId = current.user.id;
  const response = await schoolFetch('/api/school-auth/?action=progress', {signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('學習進度暫時未能同步。');
  const data = await response.json();
  if (blocked || current.user?.id !== actorId) throw Object.assign(new Error('請重新登入。'), {code:'AUTH_REQUIRED'});
  if (data.userId !== actorId || !data.poems) throw new Error('學習進度未能核對。');
  if (current.user.role === 'teacher' && (data.learningEpoch || 'initial') !== (current.learningEpoch || 'initial')) throw Object.assign(new Error('試用進度已重設，正在重新載入。'), {code:'LEARNING_RESET'});
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
  if (!globalThis.BroadcastChannel || channel) return;
  channel = new BroadcastChannel('maanshan-school-session');
  channel.addEventListener('message', () => invalidateSchoolSession());
}
function ensureStyle() {
  if (document.querySelector('link[data-school-auth-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = 'school-session.css?v=20260920-ui1';
  link.dataset.schoolAuthStyle = 'true'; document.head.append(link);
}
function validSignedIn(data) {
  return data?.enabled === true && data.authenticated === true &&
    typeof data.user?.id === 'string' && !!data.user.id && ['student','teacher'].includes(data.user.role) &&
    typeof data.csrfToken === 'string' && !!data.csrfToken;
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
  if ((data.enabled && typeof data.authenticated !== 'boolean') || (data.authenticated && !validSignedIn(data))) throw new Error('帳戶服務回覆不完整。');
  return data.authenticated ? data : {enabled:data.enabled,authenticated:false,user:null,csrfToken:''};
}
function loginError(response, data) {
  if (response.status === 429) {
    const seconds = Math.min(900, Math.max(1, Number(response.headers.get('Retry-After')) || Number(data?.retryAfter) || 900));
    return `剛才嘗試次數較多，請約 ${Math.ceil(seconds / 60)} 分鐘後再登入。`;
  }
  if (data?.code === 'TERMS_REQUIRED') return '請先閱讀並同意使用協議及私隱說明。';
  if (data?.code === 'TERMS_VERSION_CHANGED') return '使用協議已更新，請重新整理頁面後閱讀並確認。';
  if (response.status >= 500) return '帳戶服務暫時未能連線，請稍後再試。';
  if (data?.code === 'ACCOUNT_CHANGED') return '帳戶已更新，請核對老師提供的最新密碼後再試。';
  if (response.status === 403) return '請從學校提供的平台網址重新登入。';
  if (response.status === 401) return '登入名稱或密碼不正確，請核對學校提供的資料。';
  return '帳戶服務回覆不完整，請稍後再試。';
}
function loginScreen(host, initialError = '') {
  document.body.dataset.screen = 'school-login';
  document.querySelector('#profile-open')?.setAttribute('hidden', '');
  host.innerHTML = `<main class="school-login" id="main"><section class="school-login-card" aria-labelledby="school-login-title"><header class="school-login-heading"><button type="button" class="school-login-mascot" aria-label="點詩詩，看她翻書"><span class="school-login-sprite" aria-hidden="true"></span></button><div><h1 id="school-login-title">AI普通話學習平台</h1></div></header><form id="school-login-form" aria-busy="false"><label for="school-login-name">登入名稱<input id="school-login-name" name="login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" enterkeyhint="next" required placeholder="學校提供的登入名稱"></label><label for="school-login-password">登入密碼<span class="school-password"><input id="school-login-password" name="password" type="password" autocomplete="current-password" maxlength="128" enterkeyhint="go" required aria-describedby="school-login-error"><button type="button" aria-label="顯示密碼" aria-pressed="false" id="school-password-toggle">顯示</button></span></label>${termsConfirmationMarkup()}<p id="school-login-error" role="alert">${escape(initialError)}</p><button class="button primary school-login-submit" type="submit">登入，開始學習</button></form><p class="school-login-help">忘記密碼？請找老師幫忙。</p></section></main>`;
  const form = host.querySelector('form'), status = host.querySelector('#school-login-error');
  bindTermsConfirmation(form);
  const mascot=host.querySelector('.school-login-mascot');
  const sprite=mountShishiSprite(mascot.querySelector('span'),{canPlay:()=>mascot.isConnected&&!form.querySelector('[type=submit]').disabled&&!form.contains(document.activeElement)});
  mascot.addEventListener('click',()=>void sprite.play('book'));
  form.addEventListener('focusin',()=>sprite.stop());
  const stopMascot=onSchoolSessionInvalid(()=>sprite.destroy());
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
    if (button.disabled || blocked) return;
    if (!form.elements.termsAccepted.checked) { form.elements.termsAccepted.reportValidity(); return; }
    const username = form.elements.login.value.trim(), password = form.elements.password.value;
    let succeeded = false;
    const controller = new AbortController(); loginRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    const waiting = setTimeout(() => { status.dataset.kind = 'pending'; status.textContent = '正在核對帳戶，請稍候…'; }, 3000);
    form.setAttribute('aria-busy', 'true');
    form.elements.login.readOnly = form.elements.password.readOnly = true;
    form.querySelector('#school-password-toggle').disabled = true;
    form.elements.termsAccepted.disabled = true;
    form.elements.password.removeAttribute('aria-invalid');
    status.dataset.kind = 'error';
    button.disabled = true; button.textContent = '正在登入…'; status.textContent = '';
    broadcast('sign-in-attempt');
    try {
      const response = await fetch('/api/school-auth/', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'login', login:username, password, termsAccepted:true, termsVersion:TERMS_VERSION}), signal:controller.signal});
      const data = await response.json().catch(() => null);
      if (blocked || !form.isConnected) return;
      clearTimeout(waiting); status.dataset.kind = 'error';
      if (!response.ok || !validSignedIn(data)) {
        // Keep the retry value only in the visible form after a network
        // or service outage. Credentials are never written to browser storage.
        if (response.status < 500 && response.status !== 429) form.elements.password.value = '';
        status.textContent = loginError(response, data);
        if (response.status === 401 || data?.code === 'ACCOUNT_CHANGED') {
          form.elements.password.setAttribute('aria-invalid', 'true');
          form.elements.password.focus();
        }
        return;
      }
      form.elements.password.value = '';
      sprite.destroy();stopMascot();
      succeeded = true; status.textContent = ''; button.textContent = '登入成功，正在開啟…';
      broadcast('signed-in');
      resolve(data);
    } catch {
      if (!blocked && form.isConnected) { status.dataset.kind = 'error'; status.textContent = '暫時未能連線，請檢查網絡後再試。'; }
    } finally {
      clearTimeout(timeout); clearTimeout(waiting);
      if (loginRequest === controller) loginRequest = undefined;
      if (!succeeded && !blocked && form.isConnected) {
        form.setAttribute('aria-busy', 'false');
        form.elements.login.readOnly = form.elements.password.readOnly = false;
        form.querySelector('#school-password-toggle').disabled = false;
        form.elements.termsAccepted.disabled = false;
        button.disabled = false; button.textContent = '登入，開始學習';
      }
    }
  }));
}
export async function initializeSchoolSession(host) {
  ensureStyle();
  document.querySelector('#profile-open')?.setAttribute('hidden', '');
  let data;
  while (!data) {
    try { data = await readSession(); }
    catch {
      // A service failure never opens the school site as a demo. Retry just
      // the session check, retaining already-loaded code and media assets.
      document.body.dataset.screen = 'school-login';
      host.innerHTML = '<main class="school-login" id="main"><section class="school-login-card school-login-recovery"><h1>正在等候帳戶服務</h1><p role="status">暫時未能連線，學習資料會保留。</p><button class="button primary" type="button">再試一次</button></section></main>';
      const button = host.querySelector('button');
      await new Promise(resolve => button.addEventListener('click', resolve, {once:true}));
      button.disabled = true; button.textContent = '正在連線…';
      host.querySelector('[role="status"]').textContent = '正在重新連線，請稍候…';
    }
  }
  current = data;
  if (!data.enabled) { document.querySelector('#profile-open')?.removeAttribute('hidden'); return current; }
  connectSessionChannel();
  if (!data.authenticated) {
    const signedIn = await loginScreen(host);
    // A later response must never resurrect an identity invalidated by another
    // tab. Its cookie could already belong to the next shared-device user.
    if (blocked) return new Promise(() => {});
    current = signedIn;
  }
  if (!['student','teacher'].includes(current.user?.role) || !current.csrfToken) throw new Error('Invalid school session');
  document.querySelector('#profile-open')?.removeAttribute('hidden');
  let checking = false;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || blocked || checking) return;
    checking = true;
    try { const next = await readSession(); if (!blocked && (!next.authenticated || next.user?.id !== current.user?.id || next.csrfToken !== current.csrfToken)) invalidateSchoolSession(); }
    catch { /* A transient network failure does not discard this user's queue. */ }
    finally { checking = false; }
  });
  return current;
}
