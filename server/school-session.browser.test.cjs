// Synthetic browser coverage; no school accounts or production API are used.
// PLAYWRIGHT_MODULE may point to an existing local Playwright installation.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '..');
const evidence = process.env.SCHOOL_AUTH_EVIDENCE_DIR;
const signedOut = { enabled: true, authenticated: false };
const signedIn = { enabled: true, authenticated: true,
  user: { id: 's_' + '1'.repeat(24), role: 'student', displayName: 'Test pupil', grade: 2, cls: 'A' }, csrfToken: 'x'.repeat(43) };
const fixture = '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.bundle.css"><body><header class="site-header"><button id="profile-open">學習檔案</button></header><div id="app">Private learning screen</div><script type="module">import * as session from "./school-session.mjs";window.session=session;window.ready=false;session.initializeSchoolSession(document.querySelector("#app")).then(()=>window.ready=true).catch(e=>window.initError=e.message);</script></body></html>';
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/maanshan/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
  const file = path.resolve(repo, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(repo + path.sep) || !url.pathname.startsWith('/maanshan/') || !mime[path.extname(file)]) { res.writeHead(404).end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.setHeader('Content-Type', mime[path.extname(file)]); res.end(data); });
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const reply = (route, data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) });

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [], origin = `http://127.0.0.1:${server.address().port}`;
  async function run(name, work) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(2500);
    page.on('pageerror', error => errors.push(error.message));
    try { await work(page, context); assert.deepEqual(errors, []); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
    finally { await context.close(); }
  }
  async function open(page, handler) { await page.route('**/api/school-auth/**', handler); await page.goto(origin + '/maanshan/fixture'); }
  async function enter(page) { await page.locator('input[name=login]').fill('test-pupil'); await page.locator('input[name=password]').fill('synthetic-password'); }
  try {
    await run('teacher uses the common login and can load private study progress without automatic dashboard redirect',async page=>{
      const teacher={...signedIn,user:{...signedIn.user,id:'t_'+'2'.repeat(24),role:'teacher',grade:null,cls:null,learningScope:'all-grades',researchEnabled:false}};let progressReads=0;
      await open(page,route=>{
        if(route.request().url().includes('action=progress')){progressReads++;return reply(route,{enabled:true,userId:teacher.user.id,poems:{6:{reading:{learningState:{reading:[]}}}}});}
        return reply(route,route.request().method()==='POST'?teacher:signedOut);
      });
      await enter(page);await page.locator('[type=submit]').click();await page.waitForFunction(()=>window.ready);assert(page.url().endsWith('/maanshan/fixture'));
      const progress=await page.evaluate(()=>window.session.loadSchoolProgress());assert(progress[6]);assert.equal(progressReads,1);assert.equal(await page.evaluate(()=>session.schoolState().user.role),'teacher');
    });
    await run('one failing cleanup cannot leave the old pupil screen visible', async page => {
      await open(page, route => reply(route, signedIn));
      await page.waitForFunction(() => window.ready);
      const result = await page.evaluate(() => {
        window.session.onSchoolSessionInvalid(() => { throw new Error('synthetic disposal failure'); });
        window.session.onSchoolSessionInvalid(() => { window.cleaned = true; });
        let thrown = false; try { window.session.invalidateSchoolSession(); } catch { thrown = true; }
        return { thrown, cleaned: window.cleaned, panel: !!document.querySelector('.school-session-expired'),
          cleared: !document.querySelector('#app').textContent.trim(), authenticated: window.session.schoolState().authenticated };
      });
      assert.deepEqual(result, { thrown: false, cleaned: true, panel: true, cleared: true, authenticated: false });
    });
    await run('account switching discards an in-flight login result', async page => {
      const sent = deferred(), finish = deferred();
      await open(page, async route => {
        if (route.request().method() === 'GET') return reply(route, signedOut);
        sent.resolve(); await finish.promise; await reply(route, signedIn).catch(() => {});
      });
      await enter(page); await page.locator('[type=submit]').click(); await sent.promise;
      await page.evaluate(() => { window.otherTab = new BroadcastChannel('maanshan-school-session'); window.otherTab.postMessage({ kind: 'signed-in' }); });
      await page.waitForSelector('.school-session-expired'); finish.resolve();
      await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(() => ({ ready: window.ready, authenticated: window.session.schoolState().authenticated })), { ready: false, authenticated: false });
    });
    await run('login cannot be edited or submitted twice during route startup', async page => {
      const sent = deferred(), finish = deferred(); let posts = 0;
      await open(page, async route => {
        if (route.request().method() === 'GET') return reply(route, signedOut);
        posts++; sent.resolve(); await finish.promise; await reply(route, signedIn);
      });
      await enter(page); await page.locator('[type=submit]').click(); await sent.promise;
      const pending = await page.evaluate(() => {
        const form = document.querySelector('form'); form.requestSubmit();
        return { busy: form.getAttribute('aria-busy'), locked: form.elements.login.readOnly && form.elements.password.readOnly };
      });
      finish.resolve(); await page.waitForFunction(() => window.ready);
      assert.deepEqual(pending, { busy: 'true', locked: true });
      assert.equal(await page.locator('[type=submit]').isDisabled(), true);
      await page.evaluate(() => document.querySelector('form').requestSubmit());
      await page.waitForTimeout(50); assert.equal(posts, 1);
      assert.equal(await page.locator('input[name=password]').inputValue(), '');
    });
    for (const item of [
      { label: 'wrong password', status: 401, data: { code: 'INVALID_CREDENTIALS' }, message: /登入名稱或密碼不正確/, keepPassword: false },
      { label: 'temporary outage', status: 503, data: { error: 'sensitive provider details' }, message: /服務.*暫時/, keepPassword: true },
      { label: 'updated account', status: 409, data: { code: 'ACCOUNT_CHANGED' }, message: /帳戶已更新/, keepPassword: false },
      { label: 'rate limit', status: 429, data: { code: 'LOGIN_THROTTLED' }, headers: { 'Retry-After': '120' }, message: /2 分鐘/, keepPassword: true },
      { label: 'missing session token', status: 200, data: { ...signedIn, csrfToken: undefined }, message: /回覆不完整/, keepPassword: false }
    ]) await run(`login error: ${item.label}`, async page => {
      await open(page, route => reply(route, route.request().method() === 'GET' ? signedOut : item.data,
        route.request().method() === 'GET' ? 200 : item.status, item.headers));
      await enter(page); await page.locator('[type=submit]').click();
      await page.waitForFunction(() => document.querySelector('#school-login-error').textContent.length > 0);
      assert.match(await page.locator('#school-login-error').textContent(), item.message);
      assert.equal(await page.locator('input[name=password]').inputValue(), item.keepPassword ? 'synthetic-password' : '');
      assert.equal(await page.locator('[type=submit]').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.ready || !!window.initError), false);
    });
    await run('initial service failure retries in place', async page => {
      let gets = 0, navigations = 0;
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      await open(page, route => { gets++; return reply(route, gets === 1 ? { code: 'AUTH_UNAVAILABLE' } : signedOut, gets === 1 ? 503 : 200); });
      await page.getByRole('button', { name: '再試一次', exact: true }).click();
      await page.waitForSelector('input[name=login]');
      assert.equal(gets, 2); assert.equal(navigations, 1);
    });
    await run('expired progress cannot apply to a cleared identity', async page => {
      const sent = deferred(), finish = deferred();
      await open(page, async route => {
        if (!route.request().url().includes('action=progress')) return reply(route, signedIn);
        sent.resolve(); await finish.promise; return reply(route, { userId: signedIn.user.id, poems: {} });
      });
      await page.waitForFunction(() => window.ready);
      await page.evaluate(() => { window.session.loadSchoolProgress().then(() => window.progress = 'applied').catch(e => window.progress = e.code || e.name); });
      await sent.promise; await page.evaluate(() => window.session.invalidateSchoolSession()); finish.resolve();
      await page.waitForFunction(() => window.progress); assert.equal(await page.evaluate(() => window.progress), 'AUTH_REQUIRED');
    });
    await run('mobile tablet and desktop login controls stay readable without horizontal overflow', async page => {
      await open(page, route => reply(route, signedOut)); await page.waitForSelector('input[name=login]');
      for (const [width, height] of [[375, 667], [390, 844], [768, 1024], [1366, 900]]) {
        await page.setViewportSize({ width, height });
        const box = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          controls: [...document.querySelectorAll('.school-login input,.school-login button')].map(el => {
            const b = el.getBoundingClientRect(); return { width: b.width, height: b.height, left: b.left, right: b.right };
          })
        }));
        assert.equal(box.overflow, false, `${width}px overflow`);
        assert.ok(box.controls.every(b => b.width >= 44 && b.height >= 44 && b.left >= 0 && b.right <= width), `${width}px touch targets`);
        if (evidence) { fs.mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, `auth-login-${width}.png`), fullPage: true }); }
      }
    });
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const output = { ok: results.every(result => result.pass), syntheticOnly: true, results };
  if (evidence) { fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'auth-browser-results.json'), JSON.stringify(output, null, 2)); }
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
