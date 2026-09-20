'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const blob = require('@vercel/blob');
const { Pool } = require('pg');
const scrypt = promisify(crypto.scrypt);
const NAMESPACE = 'maanshan-school-auth-v1';
const COOKIE = '__Host-maanshan_session';
const SESSION_MS = 12 * 3600000;
const TERMS_VERSION = '2026-09-20-v1';
const FORMAT = 'maanshan-school-accounts-v1';
const MAX_OBJECT = 2 * 1024 * 1024;
const ID = /^(?:s|t)_[a-f0-9]{24}$/;
const RESEARCH_ID = /^r_[a-f0-9]{24}$/;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const canonical = value => JSON.stringify(value && typeof value === 'object' ?
  Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) :
    Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
const directoryHash = accounts => hash(canonical(accounts));
const enabled = (env = process.env) => env.SCHOOL_AUTH_ENABLED === '1';
const normalizeLogin = login => typeof login === 'string' ? login.trim().normalize('NFKC').toLowerCase() : '';

class AuthError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
class Conflict extends Error {}
const fail = (status, code) => { throw new AuthError(status, code); };
function same(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 1 || Buffer.byteLength(password) > 256) throw new Error('Invalid password length');
  const derived = await scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { algorithm: 'scrypt', N: 32768, r: 8, p: 1, salt, hash: derived.toString('hex') };
}
function validPassword(value) {
  return value && value.algorithm === 'scrypt' && value.N === 32768 && value.r === 8 && value.p === 1 &&
    /^[a-f0-9]{32}$/.test(value.salt) && /^[a-f0-9]{128}$/.test(value.hash);
}
async function verifyPassword(password, account) {
  const spec = account?.password || { salt: '0'.repeat(32), hash: '0'.repeat(128) };
  const derived = await hashPassword(password, spec.salt);
  return same(derived.hash, spec.hash) && !!account;
}
function validAccount(a) {
  return a && ID.test(a.id) && RESEARCH_ID.test(a.researchId) && ['student', 'teacher'].includes(a.role) &&
    a.id.startsWith(a.role === 'student' ? 's_' : 't_') && typeof a.login === 'string' &&
    a.login.length >= 1 && a.login.length <= 64 && normalizeLogin(a.login) === a.login &&
    typeof a.displayName === 'string' && a.displayName.length > 0 && a.displayName.length <= 128 &&
    typeof a.active === 'boolean' && /^[a-f0-9]{32}$/.test(a.authVersion) && validPassword(a.password) &&
    (a.authGeneration === undefined || (Number.isSafeInteger(a.authGeneration) && a.authGeneration >= 0)) &&
    (a.isTest === undefined || typeof a.isTest === 'boolean') &&
    (a.learningScope === undefined || ['own-grade','all-grades'].includes(a.learningScope)) &&
    (a.learningScope !== 'all-grades' || a.role === 'teacher' || a.isTest === true) &&
    (a.role === 'teacher' ? a.grade === null && a.cls === null && a.classNo === null :
      Number.isInteger(a.grade) && a.grade >= 1 && a.grade <= 6 && /^[A-Z]$/.test(a.cls) &&
      Number.isInteger(a.classNo) && a.classNo >= 1 && a.classNo <= 99);
}
function validateDirectory(data) {
  if (!data || data.format !== FORMAT || !Array.isArray(data.accounts) || data.accounts.length < 1 || data.accounts.length > 10000 ||
      !Number.isFinite(Date.parse(data.generatedAt)) || data.accounts.some(a => !validAccount(a)) ||
      !same(data.sha256, directoryHash(data.accounts))) throw new Error('Invalid account directory');
  for (const key of ['id', 'researchId', 'login']) if (new Set(data.accounts.map(a => a[key])).size !== data.accounts.length) throw new Error('Duplicate account identity');
  return data;
}
function publicActor(account) {
  return {...Object.fromEntries(['id', 'researchId', 'role', 'login', 'displayName', 'grade', 'cls', 'classNo'].map(key => [key, account[key]])),
    isTest: account.isTest === true, learningScope: allGrades(account) ? 'all-grades' : 'own-grade', researchEnabled: researchEligible(account)};
}
function allGrades(actor) { return actor?.role === 'teacher' || actor?.role === 'student' && actor.isTest === true && actor.learningScope === 'all-grades'; }
function researchEligible(actor) { return actor?.role === 'student' && actor.isTest !== true; }
function allowedPoemIds(actor) { return require('../../maanshan/poems.json').poems.filter(poem => allGrades(actor) || actor?.role === 'student' && poem.grade === actor.grade).map(poem => poem.id); }
function assertPoemAccess(actor, poemId) {
  const poem = require('./poems.js').getPoem(poemId, null);
  if (!poem) fail(400, 'INVALID_LEARNING_CONTEXT');
  if (!['student','teacher'].includes(actor?.role)) fail(403, 'ROLE_FORBIDDEN');
  if (!allGrades(actor) && poem.grade !== actor.grade) fail(422, 'POEM_GRADE_FORBIDDEN');
  return poem;
}

function createBlobStore(client = blob) {
  const pathname = key => {
    if (!/^(?:directory\/current|account\/[st]_[a-f0-9]{24}|session\/[a-f0-9]{64}|limit\/[a-f0-9]{64}|audit\/\d{8}\/[a-f0-9]{32})$/.test(key)) throw new Error('Invalid auth key');
    return `${NAMESPACE}/${key}.json`;
  };
  return {
    async get(key) {
      const response = await client.get(pathname(key), { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(7000) });
      if (!response) return null;
      if (response.statusCode !== 200 || !response.stream || response.blob.size > MAX_OBJECT || !response.blob.etag) {
        await response.stream?.cancel(); throw new Error('Invalid auth object');
      }
      const reader = response.stream.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > MAX_OBJECT) throw new Error('Auth object too large'); chunks.push(Buffer.from(part.value));
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      // Private GET may weaken the same object ETag when serving compressed JSON;
      // Blob's conditional PUT expects its original, still-quoted object tag.
      return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), version: response.blob.etag.replace(/^W\//, '') };
    },
    async cas(key, value, version) {
      const bytes = JSON.stringify(value); if (Buffer.byteLength(bytes) > MAX_OBJECT) throw new Error('Auth object too large');
      try {
        await client.put(pathname(key), bytes, { access: 'private', addRandomSuffix: false,
          allowOverwrite: !!version, ...(version ? { ifMatch: version } : {}), contentType: 'application/json',
          cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(7000) });
      } catch (error) {
        if (error instanceof blob.BlobPreconditionFailedError || /already exists/i.test(String(error?.message || ''))) throw new Conflict();
        throw error;
      }
    }
  };
}
const SCHEMA = `CREATE TABLE IF NOT EXISTS school_auth_objects (
  object_key varchar(100) PRIMARY KEY, document jsonb NOT NULL, revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
function createPostgresStore(pool) {
  return {
    async get(key) {
      const rows = (await pool.query('SELECT document,revision FROM school_auth_objects WHERE object_key=$1', [key])).rows;
      return rows.length ? { value: rows[0].document, version: String(rows[0].revision) } : null;
    },
    async cas(key, value, version) {
      const result = version ? await pool.query(`UPDATE school_auth_objects SET document=$2::jsonb,revision=revision+1,updated_at=CURRENT_TIMESTAMP
          WHERE object_key=$1 AND revision=$3`, [key, JSON.stringify(value), version]) :
        await pool.query('INSERT INTO school_auth_objects(object_key,document) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING', [key, JSON.stringify(value)]);
      if (result.rowCount !== 1) throw new Conflict();
    }, pool
  };
}
let runtimeStore, runtimeKey;
function getStore(env = process.env) {
  const driver = env.SCHOOL_AUTH_STORE || (env.STUDENT_STORE === 'blob' ? 'blob' : 'postgres');
  const key = hash(JSON.stringify([driver, env.BLOB_READ_WRITE_TOKEN, env.DB_HOST, env.DB_PORT, env.DB_USER, env.DB_NAME]));
  if (runtimeStore && runtimeKey === key) return runtimeStore;
  if (driver === 'blob') {
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error('Missing private storage');
    runtimeStore = createBlobStore();
  } else if (driver === 'postgres') {
    if (!env.DB_HOST || !env.DB_USER || !env.DB_NAME || !['postgres', 'postgresql'].includes(env.DB_DRIVER)) throw new Error('Missing PostgreSQL');
    const pool = new Pool({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, user: env.DB_USER,
      password: env.DB_PASS || env.DB_PASSWORD, database: env.DB_NAME, max: 3,
      connectionTimeoutMillis: 5000, statement_timeout: 8000, idleTimeoutMillis: 30000,
      application_name: 'maanshan-school-auth' });
    pool.on('error', () => {});
    runtimeStore = createPostgresStore(pool);
  } else throw new Error('Invalid auth store');
  runtimeKey = key; return runtimeStore;
}

function createAuth({ env = process.env, store: suppliedStore, now = Date.now, randomBytes = crypto.randomBytes } = {}) {
  let directoryCache;
  const requestSessions = new WeakMap();
  const store = () => suppliedStore || getStore(env);
  const config = () => {
    if (typeof env.SCHOOL_AUTH_SECRET !== 'string' || env.SCHOOL_AUTH_SECRET.length < 32) fail(503, 'AUTH_UNAVAILABLE');
    let origin; try { origin = new URL(env.SCHOOL_AUTH_ORIGIN); } catch { fail(503, 'AUTH_UNAVAILABLE'); }
    if (origin.protocol !== 'https:' || origin.origin !== env.SCHOOL_AUTH_ORIGIN) fail(503, 'AUTH_UNAVAILABLE');
    return origin.origin;
  };
  const digest = value => crypto.createHmac('sha256', env.SCHOOL_AUTH_SECRET).update(value).digest('hex');
  const token = () => randomBytes(32).toString('base64url');
  const checkOrigin = req => {
    const expected = config();
    if (req.headers?.origin !== expected || req.headers?.['sec-fetch-site'] === 'cross-site') fail(403, 'ORIGIN_REJECTED');
  };
  async function directory(fresh = false) {
    config();
    if (!fresh && directoryCache && now() - directoryCache.loadedAt < 30000) return directoryCache.value;
    const result = await store().get('directory/current');
    const value = validateDirectory(result?.value);
    directoryCache = { value, loadedAt: now() }; return value;
  }
  async function retry(key, transform, { attempts = 5, jitterMs = 0 } = {}) {
    for (let i = 0; i < attempts; i++) {
      const previous = await store().get(key);
      const value = transform(previous?.value);
      if (value === null) return;
      try { await store().cas(key, value, previous?.version); return value; }
      catch (error) {
        if (!(error instanceof Conflict)) throw error;
        if (jitterMs && i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, crypto.randomInt(10, jitterMs + 1)));
      }
    }
    fail(503, 'AUTH_UNAVAILABLE');
  }
  async function audit(action, actor, details = {}) {
    if (!/^[a-z_]{1,48}$/.test(action)) throw new Error('Invalid audit action');
    const target = RESEARCH_ID.test(details.targetResearchId || '') ? { targetResearchId: details.targetResearchId } : {};
    // Research interaction events are separate. Security audits retain teacher
    // identity and account changes; ordinary student login/logout is omitted to
    // avoid unneeded private Blob writes and security-log growth.
    if (actor?.role !== 'teacher' && ['login', 'logout', 'login_failed'].includes(action)) return;
    const day = new Date(now()).toISOString().slice(0, 10).replace(/-/g, '');
    await store().cas('audit/' + day + '/' + randomBytes(16).toString('hex'), {
      version: 1, action, at: new Date(now()).toISOString(), actorId: actor?.id || null,
      researchId: actor?.researchId || null, role: actor?.role || null, ...target
    });
  }
  const readToken = req => {
    const matches = (req.headers?.cookie || '').split(';').map(p => p.trim()).filter(p => p.startsWith(COOKIE + '='));
    if (matches.length !== 1) return null;
    const value = matches[0].slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  };
  function setCookie(res, value, expires = 0) {
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${expires}; Priority=High`);
  }
  async function revoke(req, res) {
    const value = readToken(req);
    setCookie(res, '', 0);
    if (value) await retry('session/' + hash(value), old => old ? { ...old, revoked: true, revokedAt: now() } : null);
    requestSessions.delete(req);
  }
  async function readSessionRecord(req) {
    config();
    const value = readToken(req);
    if (!value) return null;
    const record = (await store().get('session/' + hash(value)))?.value;
    if (!record || record.version !== 1 || record.revoked !== false || !Number.isFinite(record.expiresAt) || record.expiresAt <= now() ||
        !Number.isFinite(record.issuedAt) || record.issuedAt > now() + 300000 || record.expiresAt <= record.issuedAt ||
        record.expiresAt - record.issuedAt > SESSION_MS || !/^[A-Za-z0-9_-]{43}$/.test(record.csrf)) return null;
    if (!ID.test(record.actorId)) return null;
    const account = (await store().get('account/' + record.actorId))?.value;
    if (!account?.active || !same(account.authVersion, record.authVersion) || account.user?.id !== record.actorId ||
        !RESEARCH_ID.test(account.user?.researchId) || !['student', 'teacher'].includes(account.user?.role)) return null;
    return { actor: Object.freeze(publicActor(account.user)), csrfToken: record.csrf };
  }
  function session(req) {
    // Reuse only within one incoming HTTP request. Provider wrappers and event
    // recording see the same authenticated actor without repeating two Blob
    // reads; every new request still checks server expiry and revocation.
    if (!requestSessions.has(req)) requestSessions.set(req, readSessionRecord(req));
    return requestSessions.get(req);
  }
  async function requireActor(req, { roles, csrf = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) } = {}) {
    if (!enabled(env)) return null;
    try {
      const found = await session(req);
      if (!found) fail(401, 'AUTH_REQUIRED');
      if (roles && !roles.includes(found.actor.role)) fail(403, 'ROLE_FORBIDDEN');
      if (csrf) { checkOrigin(req); if (!same(req.headers?.['x-csrf-token'], found.csrfToken)) fail(403, 'CSRF_REJECTED'); }
      return found.actor;
    } catch (error) { if (error instanceof AuthError) throw error; fail(503, 'AUTH_UNAVAILABLE'); }
  }
  async function consumeLimit(key, max, milliseconds) {
    await retry('limit/' + digest(key), old => {
      const start = old && Number.isFinite(old.until) && old.until > now() ? old : { attempts: 0, until: now() + milliseconds };
      if (!Number.isInteger(start.attempts) || start.attempts >= max) {
        throw Object.assign(new AuthError(429, 'LOGIN_THROTTLED'), { retryAfter: Math.max(1, Math.ceil((start.until - now()) / 1000)) });
      }
      return { attempts: start.attempts + 1, until: start.until };
    }, key.startsWith('ip:') ? { attempts: 8, jitterMs: 100 } : undefined);
  }
  function clientIp(req) {
    // Trust only headers supplied by the known frontend proxy. No raw IP is stored.
    if (env.VERCEL === '1' && typeof req.headers?.['x-vercel-forwarded-for'] === 'string') return req.headers['x-vercel-forwarded-for'].split(',')[0].trim();
    const peer = req.socket?.remoteAddress || '';
    if (env.SCHOOL_AUTH_TRUST_PROXY === '1' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return req.headers?.['x-real-ip'] || peer;
    return peer || 'unknown';
  }
  async function state(req) {
    if (!enabled(env)) return { enabled: false, authenticated: false };
    const found = await session(req);
    return found ? { enabled: true, authenticated: true, user: found.actor, csrfToken: found.csrfToken } : { enabled: true, authenticated: false };
  }
  async function login(req, res) {
    checkOrigin(req);
    // Clear previous identity even if a pupil mistypes the next account password.
    await revoke(req, res);
    // Platform terms are a login acknowledgement, not research or guardian consent.
    // Existing sessions remain valid; only a new login requires the current terms.
    if (req.body?.termsAccepted !== true) fail(400, 'TERMS_REQUIRED');
    if (req.body?.termsVersion !== TERMS_VERSION) fail(400, 'TERMS_VERSION_CHANGED');
    const username = normalizeLogin(req.body?.login), password = req.body?.password;
    if (!username || username.length > 64 || typeof password !== 'string' || !password || Buffer.byteLength(password) > 256) fail(401, 'INVALID_CREDENTIALS');
    // Fixed HMAC buckets spread a school's shared NAT across independent CAS
    // objects. 64 x 32 attempts per 15-minute bucket window; an account always
    // selects the same bucket and still has its separate 12-attempt limit.
    const ipBucket = parseInt(digest('ip-bucket:' + username).slice(0, 2), 16) % 64;
    await consumeLimit('ip:' + clientIp(req) + ':bucket:' + ipBucket, 32, 15 * 60000);
    const [, currentDirectory] = await Promise.all([
      consumeLimit('account:' + username, 12, 15 * 60000), directory(true)
    ]);
    const account = currentDirectory.accounts.find(a => a.login === username);
    if (!await verifyPassword(password, account) || !account.active) {
      await audit('login_failed', account); fail(401, 'INVALID_CREDENTIALS');
    }
    const value = token(), csrf = token();
    await retry('account/' + account.id, previous => {
      if (previous && !same(previous.authVersion, account.authVersion)) fail(409, 'ACCOUNT_CHANGED');
      const current = { active: account.active, authVersion: account.authVersion, generation: account.authGeneration || 0, user: publicActor(account) };
      // A fresh read still checks revocation/version. Do not rewrite an
      // identical account on every login; session validity remains checked
      // against this durable account record on every subsequent request.
      if (previous && previous.active === current.active && previous.generation === current.generation &&
          same(previous.authVersion, current.authVersion) && canonical(previous.user) === canonical(current.user)) return null;
      return current;
    });
    await audit('login', account);
    const issuedAt = now();
    await store().cas('session/' + hash(value), { version: 1, actorId: account.id, authVersion: account.authVersion,
      issuedAt, expiresAt: issuedAt + SESSION_MS, csrf, revoked: false,
      termsAcceptance: { version: TERMS_VERSION, acceptedAt: issuedAt, kind: 'platform_terms' } });
    setCookie(res, value, SESSION_MS / 1000);
    return { enabled: true, authenticated: true, user: publicActor(account), csrfToken: csrf };
  }
  async function logout(req, res) {
    checkOrigin(req);
    const found = await session(req);
    if (found && !same(req.headers?.['x-csrf-token'], found.csrfToken)) fail(403, 'CSRF_REJECTED');
    await revoke(req, res);
    if (found) await audit('logout', found.actor);
    return { enabled: true, authenticated: false };
  }
  async function roster(req) {
    const actor = await requireActor(req, { roles: ['teacher'] });
    if (!actor) fail(403, 'AUTH_DISABLED');
    const data = await directory();
    await audit('roster_read', actor);
    const accounts = data.accounts.filter(a => a.active && a.isTest !== true).map(publicActor);
    return { enabled: true, students: accounts.filter(a => a.role === 'student'), teachers: accounts.filter(a => a.role === 'teacher'), updatedAt: data.generatedAt };
  }
  async function listAccounts(req, filters = {}) {
    const data = await roster(req);
    return data.students.filter(a => (!filters.grade || a.grade === filters.grade) && (!filters.cls || a.cls === filters.cls));
  }
  async function updatePassword(account, password, actor, action) {
    const derived = await hashPassword(password), version = randomBytes(16).toString('hex');
    await audit(action + '_attempt', actor, { targetResearchId: account.researchId });
    const changed = await retry('directory/current', old => {
      const data = validateDirectory(old), target = data.accounts.find(a => a.id === account.id);
      if (!target || !same(target.authVersion, account.authVersion)) fail(409, 'ACCOUNT_CHANGED');
      const accounts = data.accounts.map(a => a.id === account.id ? { ...a, password: derived, authVersion: version,
        authGeneration: (target.authGeneration || 0) + 1,
        passwordSource: action === 'student_password_reset' ? 'teacher_reset' : 'self_changed' } : a);
      return { ...data, accounts, generatedAt: new Date(now()).toISOString(), sha256: directoryHash(accounts) };
    });
    directoryCache = undefined;
    const current = changed.accounts.find(a => a.id === account.id);
    // This small per-account server record is read for every session use, so
    // password changes revoke old sessions across Vercel instances immediately.
    await retry('account/' + account.id, old => {
      // Another reset can finish while this request waits on Blob. Never let
      // the delayed older transition restore a superseded password generation.
      if ((old?.generation || 0) > current.authGeneration) return null;
      return { active: current.active, authVersion: current.authVersion, generation: current.authGeneration, user: publicActor(current) };
    });
    await audit(action, actor, { targetResearchId: account.researchId });
  }
  async function changePassword(req, res) {
    const actor = await requireActor(req, { csrf: true });
    if (!actor) fail(403, 'AUTH_DISABLED');
    const currentPassword = req.body?.currentPassword, newPassword = req.body?.newPassword;
    if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 256 ||
        typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword) > 128) fail(400, 'PASSWORD_REQUIREMENTS');
    await consumeLimit('change:' + actor.id, 10, 15 * 60000);
    const account = (await directory(true)).accounts.find(a => a.id === actor.id);
    // The session is still valid: a typo in this form must not trigger the
    // clients' 401 handling and discard the current authenticated workspace.
    if (!await verifyPassword(currentPassword, account)) fail(400, 'CURRENT_PASSWORD_INVALID');
    await updatePassword(account, newPassword, actor, 'password_change');
    await revoke(req, res);
    return { enabled: true, authenticated: false, passwordChanged: true };
  }
  async function resetStudentPassword(req) {
    const actor = await requireActor(req, { roles: ['teacher'], csrf: true });
    if (!actor) fail(403, 'AUTH_DISABLED');
    const studentId = req.body?.studentId;
    if (!ID.test(studentId || '')) fail(400, 'INVALID_REQUEST');
    await consumeLimit('reset:' + actor.id, 100, 15 * 60000);
    const account = (await directory(true)).accounts.find(a => a.id === studentId && a.role === 'student' && a.active);
    if (!account) fail(404, 'ACCOUNT_NOT_FOUND');
    const password = 'S!' + randomBytes(12).toString('base64url');
    await updatePassword(account, password, actor, 'student_password_reset');
    return { enabled: true, reset: true, studentId: account.id, initialPassword: password };
  }
  return { enabled: () => enabled(env), requireActor, state, login, logout, roster, listAccounts, directory, audit,
    changePassword, resetStudentPassword,
    clearCache: () => { directoryCache = undefined; } };
}

function sendError(res, error) {
  const status = error instanceof AuthError ? error.status : 503;
  const code = error instanceof AuthError ? error.code : 'AUTH_UNAVAILABLE';
  const messages = { INVALID_CREDENTIALS: '登入名稱或密碼不正確', AUTH_REQUIRED: '請先登入', LOGIN_THROTTLED: '嘗試次數較多，請稍後再試',
    ROLE_FORBIDDEN: '此帳戶沒有權限', AUTH_UNAVAILABLE: '登入服務暫時未能使用，請稍後再試', CSRF_REJECTED: '帳戶已變更，請重新整理後再試', ORIGIN_REJECTED: '請從學校平台登入',
    PASSWORD_REQUIREMENTS: '新密碼請使用至少 8 個字元', CURRENT_PASSWORD_INVALID: '目前密碼不正確，請再核對一次', ACCOUNT_CHANGED: '帳戶已更新，請重新登入',
    TERMS_REQUIRED: '請先閱讀並同意平台使用條款及私隱說明', TERMS_VERSION_CHANGED: '平台使用條款已更新，請重新整理、閱讀並同意後登入',
    POEM_GRADE_FORBIDDEN: '請練習自己年級的古詩', INVALID_LEARNING_CONTEXT: '請重新選擇古詩練習' };
  const retryAfter = status === 429 ? Math.min(900, Math.max(1, Math.ceil(Number(error.retryAfter) || 900))) : undefined;
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(status).json({ ok: false, error: messages[code] || '未能完成操作', code, ...(retryAfter ? { retryAfter } : {}), ...(code==='POEM_GRADE_FORBIDDEN'?{retryable:false}:{}) });
}
const singleton = createAuth();
module.exports = { NAMESPACE, COOKIE, SESSION_MS, TERMS_VERSION, FORMAT, SCHEMA, AuthError, Conflict, MAX_OBJECT,
  hashPassword, verifyPassword, normalizeLogin, validateDirectory, directoryHash, validAccount, publicActor, allGrades, researchEligible, allowedPoemIds, assertPoemAccess,
  createBlobStore, createPostgresStore, getStore, createAuth, sendError, ...singleton };
