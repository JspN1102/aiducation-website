'use strict';
// Import only an already-reviewed private hashed snapshot. Dry-run is default.
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const blob = require('@vercel/blob');
const auth = require('../api/_lib/school-auth.cjs');

function readSnapshot(input) {
  if (!input || !path.isAbsolute(input)) throw new Error('Absolute snapshot path required');
  const info = fs.lstatSync(input);
  if (!info.isFile() || info.isSymbolicLink() || info.size > auth.MAX_OBJECT ||
      (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('Invalid private snapshot');
  return auth.validateDirectory(JSON.parse(fs.readFileSync(input, 'utf8')));
}
function validateReplacement(previous, next) {
  if (!previous) return;
  auth.validateDirectory(previous);
  const current = new Map(next.accounts.map(a => [a.login, a]));
  for (const before of previous.accounts) {
    const after = current.get(before.login);
    if (!after || after.id !== before.id || after.researchId !== before.researchId || after.role !== before.role) {
      throw new Error('Replacement would lose or reassign stable identities; build with --previous');
    }
    if ((after.authGeneration || 0) < (before.authGeneration || 0)) throw new Error('Replacement would roll back a password generation');
  }
}
async function run({ input, driver, apply = false, replace = false, exportOutput, auditDay, env = process.env }) {
  if (!['blob', 'postgres'].includes(driver)) throw new Error('Explicit --store blob|postgres required');
  const snapshot = !exportOutput ? readSnapshot(input) : null;
  let pool, store, existing;
  if (driver === 'blob') {
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error('Private Blob credentials missing');
    store = auth.createBlobStore();
  } else {
    if (!['postgres', 'postgresql'].includes(env.DB_DRIVER) || !env.DB_HOST || !env.DB_USER || !env.DB_NAME) throw new Error('PostgreSQL configuration missing');
    pool = new Pool({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, user: env.DB_USER,
      password: env.DB_PASS || env.DB_PASSWORD, database: env.DB_NAME, max: 1,
      connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: 'maanshan-school-account-import' });
    store = auth.createPostgresStore(pool);
  }
  try {
    if (pool) {
      const present = (await pool.query("SELECT to_regclass('public.school_auth_objects') AS present")).rows[0].present;
      if (present) existing = await store.get('directory/current');
      else if (apply && !exportOutput) await pool.query(auth.SCHEMA);
    } else existing = await store.get('directory/current');
    if (exportOutput) {
      if (auditDay) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(auditDay) || !Number.isFinite(Date.parse(auditDay))) throw new Error('Invalid UTC audit day');
        const prefix = 'audit/' + auditDay.replace(/-/g, '') + '/';
        let events;
        if (pool) {
          events = (await pool.query('SELECT document FROM school_auth_objects WHERE object_key LIKE $1 ORDER BY object_key LIMIT 10001', [prefix + '%'])).rows.map(r => r.document);
        } else {
          const keys = [], seen = new Set(); let cursor;
          do {
            const page = await blob.list({ prefix: auth.NAMESPACE + '/' + prefix, limit: 200, cursor, abortSignal: AbortSignal.timeout(10000) });
            if (!Array.isArray(page.blobs)) throw new Error('Invalid audit listing');
            for (const item of page.blobs) {
              const key = item.pathname.slice(auth.NAMESPACE.length + 1).replace(/\.json$/, '');
              if (!new RegExp('^' + prefix + '[a-f0-9]{32}$').test(key) || seen.has(key) || item.size > 4096) throw new Error('Invalid audit object');
              keys.push(key); seen.add(key); if (keys.length > 10000) throw new Error('Audit day limit exceeded');
            }
            const next = page.hasMore ? page.cursor : undefined;
            if (page.hasMore && (!next || next === cursor)) throw new Error('Invalid audit pagination');
            cursor = next;
          } while (cursor);
          events = new Array(keys.length); let next = 0;
          await Promise.all(Array.from({ length: 6 }, async () => {
            while (next < keys.length) { const index = next++; events[index] = (await store.get(keys[index]))?.value; }
          }));
        }
        if (events.length > 10000 || events.some(e => !e || e.version !== 1 || typeof e.action !== 'string' || !e.at?.startsWith(auditDay))) throw new Error('Invalid audit export');
        const content = JSON.stringify({ format: 'maanshan-school-audit-v1', day: auditDay, exportedAt: new Date().toISOString(), events });
        if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw new Error('Audit export size limit');
        if (apply) privateWrite(exportOutput, content);
        return { ok: true, dryRun: !apply, operation: 'export-security-audit', day: auditDay, events: events.length, sourceDeleted: false };
      }
      const snapshot = auth.validateDirectory(existing?.value);
      if (!path.isAbsolute(exportOutput)) throw new Error('Absolute private export destination required');
      if (apply) {
        privateWrite(exportOutput, JSON.stringify(snapshot));
      }
      return { ok: true, dryRun: !apply, operation: 'export-account-directory', accounts: snapshot.accounts.length,
        sha256: snapshot.sha256, sessionsIncluded: false, sourceDeleted: false };
    }
    validateReplacement(existing?.value, snapshot);
    const identical = existing?.value.sha256 === snapshot.sha256;
    if (existing && !identical && !replace) throw new Error('Existing directory differs; explicit --replace required');
    if (apply && !identical) await store.cas('directory/current', snapshot, existing?.version);
    if (apply && existing) {
      // Reconcile small account revocation records too. A failed replacement can
      // be resumed by repeating the same snapshot; initial imports have none.
      let next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < snapshot.accounts.length) {
          const account = snapshot.accounts[next++], key = 'account/' + account.id;
          for (let attempt = 0; attempt < 5; attempt++) {
            const state = await store.get(key);
            if (!state) break; // created lazily on first login
            if ((state.value.generation || 0) > (account.authGeneration || 0)) throw new Error('Account state is newer than snapshot');
            const value = { active: account.active, authVersion: account.authVersion, generation: account.authGeneration || 0, user: auth.publicActor(account) };
            if (JSON.stringify(state.value) === JSON.stringify(value)) break;
            try { await store.cas(key, value, state.version); break; }
            catch (error) { if (!(error instanceof auth.Conflict) || attempt === 4) throw error; }
          }
        }
      }));
    }
    return { ok: true, dryRun: !apply, operation: 'import-account-directory', store: driver, changed: !identical,
      accounts: snapshot.accounts.length, students: snapshot.accounts.filter(a => a.active && a.role === 'student').length,
      teachers: snapshot.accounts.filter(a => a.active && a.role === 'teacher').length,
      sha256: snapshot.sha256, sourceDeleted: false };
  } finally { await pool?.end(); }
}
function privateWrite(output, content) {
  if (!path.isAbsolute(output)) throw new Error('Absolute private export destination required');
  const parent = fs.lstatSync(path.dirname(output));
  if (parent.isSymbolicLink() || !parent.isDirectory() ||
      (process.platform !== 'win32' && (parent.mode & 0o077))) throw new Error('Private export directory required');
  fs.writeFileSync(output, content, { flag: 'wx', mode: 0o600 });
}
if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const key = args.shift();
    if (key === '--input') options.input = args.shift();
    else if (key === '--store') options.driver = args.shift();
    else if (key === '--export-output') options.exportOutput = args.shift();
    else if (key === '--export-audit-day') options.auditDay = args.shift();
    else if (key === '--apply') options.apply = true;
    else if (key === '--replace') options.replace = true;
    else if (key === '--dry-run') options.apply = false;
    else { console.error('{"ok":false,"error":"Invalid account import arguments"}'); process.exit(1); }
  }
  run(options).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('{"ok":false,"error":"Private account import/export failed; no source deleted"}'); process.exitCode = 1;
  });
}
module.exports = { readSnapshot, validateReplacement, run };
