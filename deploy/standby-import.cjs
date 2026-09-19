'use strict';

// Local-only standby copy. No network call to Blob and no source deletion.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { validateExport } = require('./student-store-transfer.cjs');
const { MAX_EXPORT_BYTES } = require('../api/_lib/student-store.js');
const BLOB_ROOT = '/home/ubuntu/maanshan-backups/blob';
const identity = r => JSON.stringify([r.student_id, r.grade, r.cls, r.poem_id, r.section]);
const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v)))
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);

function readExport(input, { now = Date.now(), maxAgeMs = 30 * 3600000 } = {}) {
  if (!input || !path.isAbsolute(input)) throw new Error('Absolute input required');
  const info = fs.lstatSync(input);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_EXPORT_BYTES + 1024 * 1024) throw new Error('Invalid export file');
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Export must be private');
  const bytes = fs.readFileSync(input), data = JSON.parse(bytes.toString('utf8'));
  const records = validateExport(data), at = Date.parse(data.exportedAt);
  if (!Number.isFinite(at) || at > now + 300000 || now - at > maxAgeMs) throw new Error('Export is stale or has an invalid time');
  if (records.some(r => Date.parse(r.stored_at) > at + 300000 || Date.parse(r.source_at) > at + 300000)) throw new Error('Record time is invalid');
  return { records, exportedAt: data.exportedAt, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function latestExport(root = BLOB_ROOT) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Backup root must not be a link');
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => /^\d{8}T\d{15}Z$/.test(d.name));
  if (!dirs.length) throw new Error('No Blob backup found');
  dirs.sort((a, b) => b.name.localeCompare(a.name));
  // The newest failed/incomplete snapshot must not silently fall back to an older one.
  if (!dirs[0].isDirectory() || dirs[0].isSymbolicLink()) throw new Error('Invalid backup directory');
  return path.join(root, dirs[0].name, 'records.json');
}

function planImport(records, syncRows, latestRows) {
  const bySync = new Map(syncRows.map(r => [r.sync_id, r]));
  const newest = new Map(latestRows.map(r => [identity(r), r]));
  return records.map(record => {
    const prior = bySync.get(record.sync_id), latest = newest.get(identity(record));
    if (prior && (identity(prior) !== identity(record) || canonical(prior.payload) !== canonical(record.payload))) {
      throw new Error('Sync identity or payload conflict');
    }
    if (prior) return { record, action: 'already-present' };
    const at = latest ? new Date(latest.updated_at).getTime() : 0;
    if (!Number.isFinite(at)) throw new Error('Invalid PostgreSQL record time');
    const source = Date.parse(record.source_at);
    if (at === source) throw new Error('Equal-time distinct-sync conflict requires review');
    return { record, action: at > source ? 'newer-in-postgres' : 'insert' };
  });
}

function pgConfig(env) {
  if (!['postgres', 'postgresql'].includes(env.DB_DRIVER) ||
      !['localhost', '127.0.0.1', '::1', '/var/run/postgresql'].includes(env.DB_HOST) ||
      env.DB_NAME !== 'maanshan_db' || !env.DB_USER || (env.DB_PORT && env.DB_PORT !== '5432')) {
    throw new Error('Explicit local Maanshan PostgreSQL configuration required');
  }
  return { host: env.DB_HOST, port: 5432, user: env.DB_USER, password: env.DB_PASS || env.DB_PASSWORD,
    database: env.DB_NAME, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 15000,
    application_name: 'maanshan-standby-import' };
}

async function importStandby({ input, apply = false, expectedSha256, env = process.env, PoolClass = Pool }) {
  if (apply && env.MAANSHAN_STANDBY_ENABLE !== '1') throw new Error('Standby writes are not enabled');
  // Require today's scheduled backup for unattended imports, not a historical export.
  const data = readExport(input, { maxAgeMs: 4 * 3600000 });
  if (expectedSha256 && data.sha256 !== expectedSha256) throw new Error('Export changed after verification');
  const pool = new PoolClass(pgConfig(env));
  let connection;
  try {
    connection = await pool.connect();
    await connection.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    await connection.query("SET LOCAL lock_timeout = '5s'");
    await connection.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    if (apply) await connection.query('LOCK TABLE student_data IN SHARE ROW EXCLUSIVE MODE');
    const syncRows = (await connection.query('SELECT student_id, grade, cls, poem_id, section, sync_id, payload, updated_at FROM student_data WHERE sync_id = ANY($1::varchar[])',
      [data.records.map(r => r.sync_id)])).rows;
    const keys = data.records.map(({ student_id, grade, cls, poem_id, section }) => ({ student_id, grade, cls, poem_id, section }));
    const latestRows = (await connection.query(`SELECT DISTINCT ON (s.student_id,s.grade,s.cls,s.poem_id,s.section)
      s.student_id,s.grade,s.cls,s.poem_id,s.section,s.sync_id,s.updated_at
      FROM student_data s JOIN jsonb_to_recordset($1::jsonb)
      AS k(student_id varchar,grade smallint,cls char(1),poem_id smallint,section varchar)
      ON s.student_id=k.student_id AND s.grade=k.grade AND s.cls=k.cls AND s.poem_id=k.poem_id AND s.section=k.section
      ORDER BY s.student_id,s.grade,s.cls,s.poem_id,s.section,s.updated_at DESC,s.id DESC`, [JSON.stringify(keys)])).rows;
    const plan = planImport(data.records, syncRows, latestRows);
    let inserted = 0;
    if (apply) {
      const pending = plan.filter(p => p.action === 'insert');
      for (let offset = 0; offset < pending.length; offset += 100) {
        const args = [], tuples = pending.slice(offset, offset + 100).map(({ record: r }) => {
          const start = args.length;
          args.push(r.student_id, r.name, r.grade, r.cls, r.poem_id, r.section, JSON.stringify(r.payload), r.sync_id, r.source_at);
          return `(${Array.from({ length: 9 }, (_, i) => `$${start + i + 1}${i === 6 ? '::jsonb' : ''}`).join(',')},$${start + 9})`;
        });
        const result = await connection.query(`INSERT INTO student_data
          (student_id,name,grade,cls,poem_id,section,payload,sync_id,created_at,updated_at) VALUES ${tuples.join(',')}`, args);
        inserted += result.rowCount;
      }
      if (inserted !== pending.length) throw new Error('Unexpected insert count');
    }
    await connection.query('COMMIT');
    return { ok: true, dryRun: !apply, records: data.records.length, inserted,
      counts: Object.fromEntries(['insert', 'already-present', 'newer-in-postgres'].map(action => [action, plan.filter(p => p.action === action).length])),
      exportSha256: data.sha256, exportedAt: data.exportedAt, sourceDeleted: false };
  } catch (error) {
    await connection?.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { connection?.release(); await pool.end(); }
}

async function main() {
  const args = process.argv.slice(2), mode = args.shift();
  let input, expectedSha256, apply = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--input') input = args.shift();
    else if (arg === '--expected-sha256') expectedSha256 = args.shift();
    else if (arg === '--latest') input = latestExport();
    else if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else throw new Error('Unknown argument');
  }
  if (mode === 'verify' && !apply) {
    const data = readExport(input);
    return { ok: true, records: data.records.length, sha256: data.sha256, exportedAt: data.exportedAt };
  }
  if (mode === 'import') return importStandby({ input, apply, expectedSha256 });
  throw new Error('Use verify or import');
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error(JSON.stringify({ ok: false, error: 'Standby verification or import failed; no source was deleted' }));
  process.exitCode = 1;
});
module.exports = { readExport, latestExport, planImport, pgConfig, importStandby };
