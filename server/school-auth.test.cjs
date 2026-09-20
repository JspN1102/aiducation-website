'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const auth = require('../api/_lib/school-auth.cjs');
const { validateReplacement } = require('../deploy/school-accounts-import.cjs');
const vercelBlob = require('@vercel/blob');
const NOW = Date.parse('2026-09-20T00:00:00Z');
let accounts;
before(async () => {
  accounts = await Promise.all(['student', 'student', 'teacher'].map(async (role, i) => ({
    id: (role === 'student' ? 's_' : 't_') + String(i + 1).repeat(24), researchId: 'r_' + String(i + 1).repeat(24),
    role, login: 'test' + i, displayName: 'Test ' + i, active: true,
    grade: role === 'student' ? 2 : null, cls: role === 'student' ? 'A' : null, classNo: role === 'student' ? i + 1 : null,
    authVersion: String(i + 1).repeat(32), password: await auth.hashPassword('test-password-' + i)
  })));
});
function fixture() {
  const records = new Map(); let version = 0, time = NOW;
  const snapshot = { format: auth.FORMAT, generatedAt: new Date(NOW).toISOString(), accounts: structuredClone(accounts), sha256: auth.directoryHash(accounts) };
  records.set('directory/current', { value: snapshot, version: String(++version) });
  const store = {
    async get(key) { return structuredClone(records.get(key) || null); },
    async cas(key, value, expected) {
      if (records.get(key)?.version !== expected) throw new auth.Conflict();
      records.set(key, { value: structuredClone(value), version: String(++version) });
    }
  };
  const env = { SCHOOL_AUTH_ENABLED: '1', SCHOOL_AUTH_SECRET: 'test-only-secret-'.repeat(4), SCHOOL_AUTH_ORIGIN: 'https://school.test' };
  const service = auth.createAuth({ env, store, now: () => time });
  return { service, store, records, env, advance: ms => { time += ms; } };
}
function request({ method = 'POST', login = 'test0', password = 'test-password-0', cookie, csrf, origin = 'https://school.test' } = {}) {
  return { method, headers: { origin, ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    body: { action: 'login', login, password }, socket: { remoteAddress: '127.0.0.1' } };
}
function response() {
  const headers = {};
  return { headers, setHeader: (key, value) => { headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
}
async function login(f, options = {}) {
  const res = response(), state = await f.service.login(request(options), res);
  return { state, cookie: res.headers['Set-Cookie'].split(';')[0], res };
}

test('scrypt uses independent salts, verifies exact secrets and never returns credential fields', async () => {
  const a = await auth.hashPassword('same'), b = await auth.hashPassword('same');
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.hash, b.hash);
  assert.equal(await auth.verifyPassword('same', { password: a }), true);
  assert.equal(await auth.verifyPassword('other', { password: a }), false);
  const f = fixture(), result = await login(f);
  assert.equal(result.state.user.role, 'student');
  assert.equal(JSON.stringify(result.state).includes('password'), false);
  assert.match(result.res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Lax/);
  assert.match(result.res.headers['Set-Cookie'], /Path=\/.*Max-Age=43200/);
});

test('learning capability comes only from stored identity, with teacher/test access separated from research and roster',async()=>{
 const f=fixture(),directory=f.records.get('directory/current').value;
 Object.assign(directory.accounts[1],{isTest:true,learningScope:'all-grades'});directory.sha256=auth.directoryHash(directory.accounts);
 const forged=request();Object.assign(forged.body,{isTest:true,learningScope:'all-grades',researchEnabled:false,grade:6});
 const pupil=await f.service.login(forged,response());assert.equal(pupil.user.learningScope,'own-grade');assert.equal(pupil.user.isTest,false);assert.equal(pupil.user.researchEnabled,true);
 assert.deepEqual(auth.allowedPoemIds(pupil.user),[2]);assert.throws(()=>auth.assertPoemAccess(pupil.user,6),e=>e.status===422&&e.code==='POEM_GRADE_FORBIDDEN');
 const demo=await login(f,{login:'test1',password:'test-password-1'});assert.equal(demo.state.user.learningScope,'all-grades');assert.equal(demo.state.user.researchEnabled,false);assert.deepEqual(auth.allowedPoemIds(demo.state.user),[1,2,3,4,5,6]);
 assert.equal((await f.service.state(request({method:'GET',cookie:demo.cookie}))).user.isTest,true);
 const teacher=await login(f,{login:'test2',password:'test-password-2'});assert.equal(teacher.state.user.learningScope,'all-grades');assert.equal(teacher.state.user.researchEnabled,false);assert.equal(auth.assertPoemAccess(teacher.state.user,6).grade,6);
 const roster=await f.service.roster(request({method:'GET',cookie:teacher.cookie}));assert.deepEqual(roster.students.map(p=>p.id),[accounts[0].id]);assert.equal(roster.teachers.length,1);
 assert.equal(auth.validAccount({...accounts[0],learningScope:'all-grades'}),false);assert.equal(auth.validAccount({...accounts[0],isTest:'true'}),false);
 assert.equal(auth.publicActor({...accounts[0],researchEnabled:false}).researchEnabled,true);
});

test('unknown and wrong passwords fail identically, including disabled accounts', async () => {
  const f = fixture();
  for (const options of [{ login: 'absent' }, { password: 'wrong' }]) {
    await assert.rejects(login(f, options), e => e.status === 401 && e.code === 'INVALID_CREDENTIALS');
  }
  const directory = f.records.get('directory/current').value;
  directory.accounts[0].active = false; directory.sha256 = auth.directoryHash(directory.accounts); f.service.clearCache();
  await assert.rejects(login(f), e => e.status === 401);
});

test('roles and CSRF enforce student/teacher boundary, across changed shared-device cookies', async () => {
  const f = fixture(), first = await login(f), second = await login(f, { login: 'test1', password: 'test-password-1', cookie: first.cookie });
  assert.equal((await f.service.state(request({ method: 'GET', cookie: first.cookie }))).authenticated, false);
  await assert.rejects(f.service.requireActor(request({ cookie: second.cookie, csrf: first.state.csrfToken })), e => e.code === 'CSRF_REJECTED');
  await assert.rejects(f.service.requireActor(request({ method: 'GET', cookie: second.cookie }), { roles: ['teacher'] }), e => e.status === 403);
  assert.equal((await f.service.requireActor(request({ cookie: second.cookie, csrf: second.state.csrfToken }), { roles: ['student'] })).id, accounts[1].id);
});

test('failed shared-device login revokes previous identity; logout requires CSRF and revokes on server', async () => {
  const f = fixture(), first = await login(f);
  await assert.rejects(login(f, { login: 'test1', password: 'wrong', cookie: first.cookie }));
  assert.equal((await f.service.state(request({ method: 'GET', cookie: first.cookie }))).authenticated, false);
  const second = await login(f);
  await assert.rejects(f.service.logout(request({ cookie: second.cookie, csrf: 'wrong' }), response()), e => e.code === 'CSRF_REJECTED');
  assert.equal((await f.service.state(request({ method: 'GET', cookie: second.cookie }))).authenticated, true);
  await f.service.logout(request({ cookie: second.cookie, csrf: second.state.csrfToken }), response());
  assert.equal((await f.service.state(request({ method: 'GET', cookie: second.cookie }))).authenticated, false);
});

test('expiry, password change, malformed cookies and session fixation are refused', async () => {
  const f = fixture(), first = await login(f);
  f.advance(auth.SESSION_MS + 1);
  assert.equal((await f.service.state(request({ method: 'GET', cookie: first.cookie }))).authenticated, false);
  const second = await login(f);
  const directory = f.records.get('directory/current').value;
  directory.accounts[0].authVersion = 'a'.repeat(32); directory.sha256 = auth.directoryHash(directory.accounts); f.service.clearCache();
  f.records.get('account/' + accounts[0].id).value.authVersion = 'a'.repeat(32);
  assert.equal((await f.service.state(request({ method: 'GET', cookie: second.cookie }))).authenticated, false);
  for (const cookie of [auth.COOKIE + '=injected', second.cookie + '; ' + second.cookie]) {
    assert.equal((await f.service.state(request({ method: 'GET', cookie }))).authenticated, false);
  }
});

test('login origin checking precedes mutation, and durable limits span independent server instances', async () => {
  const f = fixture();
  await assert.rejects(login(f, { origin: 'https://attacker.test' }), e => e.code === 'ORIGIN_REJECTED');
  assert.equal(f.records.size, 1);
  const limit = { attempts: 12, until: NOW + 900000 };
  const key = 'limit/' + crypto.createHmac('sha256', f.env.SCHOOL_AUTH_SECRET).update('account:test0').digest('hex');
  f.records.set(key, { value: limit, version: 'existing-limit' });
  const other = auth.createAuth({ env: f.env, store: f.store, now: () => NOW });
  await assert.rejects(other.login(request(), response()), e => e.status === 429);
  f.advance(825000);
  await assert.rejects(login(f), error => {
    const res = response(); auth.sendError(res, error);
    assert.equal(res.statusCode, 429); assert.equal(res.headers['Retry-After'], '75');
    assert.equal(res.body.retryAfter, 75); return true;
  });
  f.advance(75001); assert.equal((await login(f)).state.authenticated, true);
});

test('teacher roster is whole-school and individually audited without hashes or passwords', async () => {
  const f = fixture(), student = await login(f);
  await assert.rejects(f.service.roster(request({ method: 'GET', cookie: student.cookie })), e => e.status === 403);
  const teacher = await login(f, { login: 'test2', password: 'test-password-2' });
  const roster = await f.service.roster(request({ method: 'GET', cookie: teacher.cookie }));
  assert.equal(roster.students.length, 2); assert.equal(roster.teachers.length, 1);
  assert.equal(JSON.stringify(roster).includes('password'), false);
  const logs = [...f.records].filter(([key]) => key.startsWith('audit/')).map(([, row]) => row.value);
  assert.ok(logs.some(log => log.action === 'roster_read' && log.actorId === accounts[2].id));
  assert.ok(logs.every(log => !('login' in log) && !('displayName' in log) && !('ip' in log)));
});

test('directory checksum survives PostgreSQL JSONB key ordering and import prevents reassigned IDs', () => {
  const f = fixture(), directory = f.records.get('directory/current').value;
  const reordered = { ...directory, accounts: directory.accounts.map(a => Object.fromEntries(Object.entries(a).reverse())) };
  assert.equal(auth.validateDirectory(reordered).accounts.length, 3);
  const changed = structuredClone(directory); changed.accounts[0].id = 's_' + 'a'.repeat(24); changed.sha256 = auth.directoryHash(changed.accounts);
  assert.throws(() => validateReplacement(directory, changed));
});

test('disabled auth preserves legacy, missing config and storage outages fail closed', async () => {
  const f = fixture(); f.env.SCHOOL_AUTH_ENABLED = '0';
  assert.equal(await f.service.requireActor(request()), null);
  assert.deepEqual(await f.service.state(request()), { enabled: false, authenticated: false });
  f.env.SCHOOL_AUTH_ENABLED = '1'; delete f.env.SCHOOL_AUTH_SECRET;
  await assert.rejects(f.service.requireActor(request()), e => e.status === 503);
  f.env.SCHOOL_AUTH_SECRET = 'test-only-secret-'.repeat(4);
  f.store.get = async () => { throw new Error('sensitive upstream message'); };
  await assert.rejects(f.service.requireActor(request({ cookie: auth.COOKIE + '=' + 'a'.repeat(43) })), e => e.status === 503 && !e.message.includes('sensitive'));
});

test('self password change invalidates all sessions across independent instances and requires current password', async () => {
  const f = fixture(), first = await login(f), second = await login(f);
  const other = auth.createAuth({ env: f.env, store: f.store, now: () => NOW });
  const req = request({ cookie: first.cookie, csrf: first.state.csrfToken });
  req.body = { action: 'change_password', currentPassword: 'wrong', newPassword: 'new-password-value' };
  await assert.rejects(f.service.changePassword(req, response()), error => {
    const res = response(); auth.sendError(res, error);
    assert.equal(res.statusCode, 400); assert.equal(res.body.code, 'CURRENT_PASSWORD_INVALID');
    assert.match(res.body.error, /目前密碼不正確/); return true;
  });
  assert.equal((await other.state(request({ method: 'GET', cookie: first.cookie }))).authenticated, true);
  assert.equal((await other.state(request({ method: 'GET', cookie: second.cookie }))).authenticated, true);
  req.body.currentPassword = 'test-password-0';
  assert.equal((await f.service.changePassword(req, response())).passwordChanged, true);
  assert.equal((await other.state(request({ method: 'GET', cookie: second.cookie }))).authenticated, false);
  await assert.rejects(login(f), e => e.status === 401);
  assert.equal((await login(f, { password: 'new-password-value' })).state.authenticated, true);
});

test('only teachers reset a student, generated password is unique and audit never stores it', async () => {
  const f = fixture(), student = await login(f), teacher = await login(f, { login: 'test2', password: 'test-password-2' });
  const bad = request({ cookie: student.cookie, csrf: student.state.csrfToken }); bad.body = { studentId: accounts[1].id };
  await assert.rejects(f.service.resetStudentPassword(bad), e => e.status === 403);
  const req = request({ cookie: teacher.cookie, csrf: teacher.state.csrfToken }); req.body = { studentId: accounts[0].id };
  const reset = await f.service.resetStudentPassword(req);
  assert.equal(reset.reset, true); assert.ok(reset.initialPassword.length >= 18);
  assert.equal((await f.service.state(request({ method: 'GET', cookie: student.cookie }))).authenticated, false);
  assert.equal((await login(f, { password: reset.initialPassword })).state.authenticated, true);
  const logs = [...f.records].filter(([key]) => key.startsWith('audit/')).map(([, row]) => row.value);
  assert.ok(logs.some(log => log.action === 'student_password_reset' && log.actorId === accounts[2].id && log.targetResearchId === accounts[0].researchId));
  assert.equal(JSON.stringify(logs).includes(reset.initialPassword), false);
  req.body.studentId = accounts[2].id;
  await assert.rejects(f.service.resetStudentPassword(req), e => e.status === 404);
});

test('private Blob adapter enforces CAS and never publishes sessions or account snapshots', async () => {
  const objects = new Map(), calls = []; let version = 0;
  const client = {
    async get(key, options) {
      calls.push({ operation: 'get', key, options }); const found = objects.get(key); if (!found) return null;
      return { statusCode: 200, blob: { size: found.bytes.length, etag: found.etag },
        stream: new ReadableStream({ start(controller) { controller.enqueue(found.bytes); controller.close(); } }) };
    },
    async put(key, text, options) {
      calls.push({ operation: 'put', key, options }); const old = objects.get(key);
      if (old && (!options.allowOverwrite || old.etag !== options.ifMatch)) throw new vercelBlob.BlobPreconditionFailedError();
      objects.set(key, { bytes: Buffer.from(text), etag: String(++version) });
    }
  };
  const store = auth.createBlobStore(client);
  await store.cas('session/' + 'a'.repeat(64), { revoked: false });
  const initial = await store.get('session/' + 'a'.repeat(64));
  await store.cas('session/' + 'a'.repeat(64), { revoked: true }, initial.version);
  await assert.rejects(store.cas('session/' + 'a'.repeat(64), { revoked: false }, initial.version), e => e instanceof auth.Conflict);
  assert.equal((await store.get('session/' + 'a'.repeat(64))).value.revoked, true);
  assert.ok(calls.every(c => c.options.access === 'private'));
  assert.ok(calls.filter(c => c.operation === 'get').every(c => c.options.useCache === false));
  assert.ok(calls.every(c => c.key.startsWith(auth.NAMESPACE + '/')));
  await assert.rejects(store.get('../public/other'));
});

test('private Blob compressed GET tags allow account updates while stale revisions still conflict', async () => {
  for (const weak of [false, true]) {
    let current, revision = 0;
    const writes = [], client = {
      async get() {
        if (!current) return null;
        return { statusCode: 200, blob: { size: current.bytes.length, etag: (weak ? 'W/' : '') + current.tag },
          stream: new ReadableStream({ start(controller) { controller.enqueue(current.bytes); controller.close(); } }) };
      },
      async put(key, value, options) {
        writes.push(options);
        if (current && (!options.allowOverwrite || options.ifMatch !== current.tag)) throw new vercelBlob.BlobPreconditionFailedError();
        current = { bytes: Buffer.from(value), tag: `"revision-${++revision}"` };
      }
    };
    const store = auth.createBlobStore(client), key = 'account/s_' + 'a'.repeat(24);
    await store.cas(key, { generation: 1, authVersion: 'old' });
    const original = await store.get(key);
    assert.equal(original.version, '"revision-1"');
    await store.cas(key, { generation: 2, authVersion: 'new' }, original.version);
    assert.equal(writes[1].ifMatch, '"revision-1"');
    await assert.rejects(store.cas(key, { generation: 1, authVersion: 'stale' }, original.version), error => error instanceof auth.Conflict);
    assert.deepEqual((await store.get(key)).value, { generation: 2, authVersion: 'new' });
  }
});

test('durable CAS rate counter cannot be bypassed by simultaneous login attempts', async () => {
  const f = fixture();
  const key = 'limit/' + crypto.createHmac('sha256', f.env.SCHOOL_AUTH_SECRET).update('account:test0').digest('hex');
  f.records.set(key, { value: { attempts: 11, until: NOW + 900000 }, version: 'existing-limit' });
  const other = auth.createAuth({ env: f.env, store: f.store, now: () => NOW });
  const results = await Promise.allSettled([f.service.login(request(), response()), other.login(request(), response())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 429).length, 1);
});

function delayedStore(store, milliseconds = 4) {
  const wait = () => new Promise(resolve => setTimeout(resolve, milliseconds));
  const get = store.get, cas = store.cas;
  store.get = async key => { const snapshot = await get(key); await wait(); return snapshot; };
  store.cas = async (...args) => { await wait(); return cas(...args); };
}

test('thirty distinct students sharing one NAT can log in across independent delayed CAS instances', async () => {
  const f = fixture();
  const pupils = Array.from({ length: 30 }, (_, index) => ({ ...structuredClone(accounts[0]),
    id: 's_' + (index + 100).toString(16).padStart(24, '0'), researchId: 'r_' + (index + 100).toString(16).padStart(24, '0'),
    login: 'pupil' + index, classNo: index + 1 }));
  f.records.set('directory/current', { version: 'directory-30', value: { format: auth.FORMAT,
    generatedAt: new Date(NOW).toISOString(), accounts: pupils, sha256: auth.directoryHash(pupils) } });
  delayedStore(f.store, 8);
  const results = await Promise.allSettled(pupils.map(pupil => {
    const service = auth.createAuth({ env: f.env, store: f.store, now: () => NOW });
    return service.login(request({ login: pupil.login, password: 'test-password-0' }), response());
  }));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 30);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('session/')).length, 30);
});

test('IP bucket is fixed after username normalization and its 32-attempt ceiling spans instances', async () => {
  const f = fixture(), hmac = value => crypto.createHmac('sha256', f.env.SCHOOL_AUTH_SECRET).update(value).digest('hex');
  const bucket = parseInt(hmac('ip-bucket:test0').slice(0, 2), 16) % 64;
  const key = 'limit/' + hmac('ip:127.0.0.1:bucket:' + bucket);
  f.records.set(key, { value: { attempts: 32, until: NOW + 900000 }, version: 'full-bucket' });
  const other = auth.createAuth({ env: f.env, store: f.store, now: () => NOW });
  await assert.rejects(f.service.login(request(), response()), error => error.status === 429);
  await assert.rejects(other.login(request({ login: ' ＴＥＳＴ０ ' }), response()), error => error.status === 429);
  assert.equal(f.records.get(key).value.attempts, 32);
  assert.equal([...f.records.keys()].some(name => name.startsWith('session/')), false);
});

test('thirty wrong passwords cannot race past the last remaining account attempt', async () => {
  const f = fixture(), key = 'limit/' + crypto.createHmac('sha256', f.env.SCHOOL_AUTH_SECRET).update('account:test0').digest('hex');
  f.records.set(key, { value: { attempts: 11, until: NOW + 900000 }, version: 'last-attempt' });
  delayedStore(f.store);
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => {
    const service = auth.createAuth({ env: f.env, store: f.store, now: () => NOW });
    return service.login(request({ password: 'incorrect' }), response());
  }));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 0);
  assert.equal(results.filter(result => result.reason?.code === 'INVALID_CREDENTIALS').length, 1);
  assert.equal(f.records.get(key).value.attempts, 12);
  assert.ok(results.every(result => ['INVALID_CREDENTIALS', 'LOGIN_THROTTLED', 'AUTH_UNAVAILABLE'].includes(result.reason?.code)));
  assert.equal([...f.records.keys()].some(name => name.startsWith('session/')), false);
});

test('unchanged account login skips its write but concurrent revocation still invalidates the session', async () => {
  const f = fixture(); await login(f);
  const originalGet = f.store.get, originalCas = f.store.cas;
  let accountWrites = 0;
  f.store.cas = async (key, ...args) => { if (key.startsWith('account/')) accountWrites++; return originalCas(key, ...args); };
  await login(f);
  assert.equal(accountWrites, 0);
  let changed = false;
  f.store.get = async key => {
    const snapshot = await originalGet(key);
    if (key === 'account/' + accounts[0].id && !changed) {
      changed = true;
      await originalCas(key, { ...snapshot.value, authVersion: 'f'.repeat(32), generation: 1 }, snapshot.version);
    }
    return snapshot;
  };
  const result = await login(f);
  assert.equal(accountWrites, 0);
  await assert.rejects(f.service.requireActor(request({ method: 'GET', cookie: result.cookie })), error => error.code === 'AUTH_REQUIRED');
});

test('a fresh directory failure during parallel preflight cannot issue a session or restore the old identity', async () => {
  const f = fixture(), previous = await login(f), originalGet = f.store.get;
  const sessionCount = [...f.records.keys()].filter(key => key.startsWith('session/')).length;
  f.store.get = async key => { if (key === 'directory/current') throw new Error('synthetic storage failure'); return originalGet(key); };
  const res = response();
  await assert.rejects(f.service.login(request({ cookie: previous.cookie }), res));
  assert.ok(res.headers['Set-Cookie'].includes('Max-Age=0'));
  assert.equal([...f.records.keys()].filter(key => key.startsWith('session/')).length, sessionCount);
  await assert.rejects(f.service.requireActor(request({ method: 'GET', cookie: previous.cookie })), error => error.code === 'AUTH_REQUIRED');
});

test('one request reuses storage verification but always checks role and CSRF again', async () => {
  const f = fixture(), result = await login(f), original = f.store.get;
  let reads = 0; f.store.get = async key => { reads++; return original(key); };
  const req = request({ cookie: result.cookie, csrf: result.state.csrfToken });
  await f.service.requireActor(req, { roles: ['student'] });
  await f.service.requireActor(req, { roles: ['student'] });
  assert.equal(reads, 2);
  await assert.rejects(f.service.requireActor(req, { roles: ['teacher'] }), e => e.status === 403);
  req.headers['x-csrf-token'] = 'changed';
  await assert.rejects(f.service.requireActor(req), e => e.code === 'CSRF_REJECTED');
  assert.equal(reads, 2);
  await f.service.requireActor(request({ method: 'GET', cookie: result.cookie }));
  assert.equal(reads, 4);
});

test('delayed older reset cannot overwrite a newer account revocation generation', async () => {
  const f = fixture(); await login(f);
  const teacher = await login(f, { login: 'test2', password: 'test-password-2' });
  const original = f.store.cas; let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { reached = resolve; });
  let held = false;
  f.store.cas = async (key, value, version) => {
    if (key === 'account/' + accounts[0].id && value.generation === 1 && !held) {
      held = true; reached(); await gate;
    }
    return original(key, value, version);
  };
  const req = () => ({ ...request({ cookie: teacher.cookie, csrf: teacher.state.csrfToken }), body: { studentId: accounts[0].id } });
  const first = f.service.resetStudentPassword(req());
  await waiting;
  const newer = await f.service.resetStudentPassword(req());
  release(); await first;
  assert.equal(f.records.get('account/' + accounts[0].id).value.generation, 2);
  assert.equal((await login(f, { password: newer.initialPassword })).state.authenticated, true);
});
