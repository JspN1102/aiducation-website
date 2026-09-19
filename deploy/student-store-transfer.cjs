'use strict';

// Export/import is dry-run unless --apply is present. Credentials are read only
// from the invoking process environment; no command-line secret is accepted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const store = require('../api/_lib/student-store.js');

const FORMAT = 'maanshan-private-student-export-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const identity = record => JSON.stringify([record.student_id, record.grade, record.cls, record.poem_id, record.section]);
function validateExport(data) {
  if (!data || data.format !== FORMAT || data.namespace !== store.NAMESPACE ||
      !Array.isArray(data.records) || data.records.length > store.MAX_EXPORT_RECORDS ||
      data.records.some(record => !store.validRecord(record)) ||
      data.sha256 !== hash(JSON.stringify(data.records))) throw new Error('Invalid export');
  if (new Set(data.records.map(identity)).size !== data.records.length ||
      new Set(data.records.map(record => record.sync_id)).size !== data.records.length) throw new Error('Duplicate export record');
  return data.records;
}

function privateOutput(filename) {
  const directory = path.dirname(filename);
  // A new dedicated directory avoids silently changing permissions on an existing
  // shared folder. For subsequent exports use a new timestamped destination.
  fs.mkdirSync(directory, { mode: 0o700 });
  if (process.platform === 'win32') {
    const query = `
$ErrorActionPreference = 'Stop'
$target = $env:MAANSHAN_EXPORT_DIRECTORY
$sids = @((Get-Acl -LiteralPath $target).Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })
@{ user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; sids = $sids } | ConvertTo-Json -Compress
`;
    const queryAcl = () => JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], {
      env: { ...process.env, MAANSHAN_EXPORT_DIRECTORY: directory }, stdio: 'pipe', encoding: 'utf8'
    }));
    const permissions = queryAcl(), allowed = new Set([permissions.user, 'S-1-5-18']);
    // icacls edits the DACL without requiring the SeSecurityPrivilege that a
    // full Set-Acl operation may request on Windows. Remove explicit grants too.
    execFileSync('icacls', [directory, '/inheritance:r', '/grant:r',
      `*${permissions.user}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe' });
    const extra = [...new Set(queryAcl().sids)].filter(sid => !allowed.has(sid));
    if (extra.length) execFileSync('icacls', [directory, '/remove', ...extra.map(sid => '*' + sid)], { stdio: 'pipe' });
    const checked = new Set(queryAcl().sids);
    if (checked.size !== allowed.size || [...checked].some(sid => !allowed.has(sid))) {
      throw new Error('Unable to restrict the private export directory');
    }
  }
}

async function exportBlob({ apply, output }) {
  if (!store.configured()) throw new Error('Blob export configuration missing');
  const records = await store.exportRecords();
  const data = { format: FORMAT, namespace: store.NAMESPACE, exportedAt: new Date().toISOString(),
    records, sha256: hash(JSON.stringify(records)) };
  validateExport(data);
  if (apply) {
    if (!output || !path.isAbsolute(output)) throw new Error('An absolute --output path is required');
    privateOutput(output);
    fs.writeFileSync(output, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
  }
  return { ok: true, operation: 'export', dryRun: !apply, records: records.length,
    sha256: data.sha256, sourceDeleted: false, ...(apply ? { output } : {}) };
}

function makePlan(records, existing) {
  const bySync = new Map(existing.map(record => [record.sync_id, record]));
  const latest = new Map();
  for (const record of existing) {
    const key = identity(record), time = new Date(record.updated_at).getTime();
    if (!latest.has(key) || latest.get(key) < time) latest.set(key, time);
  }
  return records.map(record => {
    const previous = bySync.get(record.sync_id);
    if (previous && identity(previous) !== identity(record)) throw new Error('Existing sync identifier belongs to another record');
    const sourceTime = Date.parse(record.source_at);
    const action = previous ? 'already-present' : (latest.get(identity(record)) || 0) > sourceTime ? 'newer-in-postgres' : 'insert';
    return { record, action };
  });
}

async function importPostgres({ apply, input }) {
  if (!input || !path.isAbsolute(input)) throw new Error('An absolute --input path is required');
  const info = fs.statSync(input);
  if (!info.isFile() || info.size > store.MAX_EXPORT_BYTES + 1024 * 1024) throw new Error('Export file size limit exceeded');
  const records = validateExport(JSON.parse(fs.readFileSync(input, 'utf8')));
  if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER) throw new Error('PostgreSQL configuration missing');
  const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER, password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME, max: 1, connectionTimeoutMillis: 5000,
    statement_timeout: 15000, application_name: 'maanshan-bridge-import' });
  let connection;
  try {
    connection = await pool.connect();
    await connection.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    if (apply) {
      // Briefly serialize against live saves as well as another import. Do not
      // mutate the Blob source or replace newer PostgreSQL work.
      await connection.query("SET LOCAL lock_timeout = '5s'");
      await connection.query('LOCK TABLE student_data IN SHARE ROW EXCLUSIVE MODE');
    }
    const existing = (await connection.query('SELECT student_id, grade, cls, poem_id, section, sync_id, updated_at FROM student_data')).rows;
    const plan = makePlan(records, existing);
    if (apply) {
      for (const item of plan) {
        if (item.action !== 'insert') continue;
        const record = item.record;
        await connection.query(`INSERT INTO student_data
          (student_id, name, grade, cls, poem_id, section, payload, sync_id, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9)
          ON CONFLICT (sync_id) DO NOTHING`, [record.student_id, record.name, record.grade,
          record.cls, record.poem_id, record.section, JSON.stringify(record.payload), record.sync_id, record.source_at]);
      }
    }
    await connection.query('COMMIT');
    const counts = Object.fromEntries(['insert', 'already-present', 'newer-in-postgres'].map(action =>
      [action, plan.filter(item => item.action === action).length]));
    return { ok: true, operation: 'import-postgres', dryRun: !apply, records: records.length, counts, sourceDeleted: false };
  } catch (error) {
    await connection?.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { connection?.release(); await pool.end(); }
}

async function main() {
  const args = process.argv.slice(2), operation = args.shift();
  const options = { apply: false };
  while (args.length) {
    const argument = args.shift();
    if (argument === '--apply') options.apply = true;
    else if (argument === '--dry-run') options.apply = false;
    else if (argument === '--input' || argument === '--output') options[argument.slice(2)] = args.shift();
    else throw new Error('Invalid transfer arguments');
  }
  if (operation === 'export') return exportBlob(options);
  if (operation === 'import-postgres') return importPostgres(options);
  throw new Error('Use export or import-postgres; --dry-run is the default');
}
if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    // Never echo database errors, credentials, source rows or response bodies.
    console.error(JSON.stringify({ ok: false, error: 'Student transfer failed', kind: error.name }));
    process.exitCode = 1;
  });
}
module.exports = { FORMAT, validateExport, makePlan, exportBlob, importPostgres };
