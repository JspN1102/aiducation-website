'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const store = require('../api/_lib/student-store.js');
const transfer = require('./student-store-transfer.cjs');
const standby = require('./standby-import.cjs');
const NOW = Date.now();
function record(overrides = {}) {
  return store.makeRecord({ studentId: 'standby-test', name: 'Test', grade: 6, cls: 'A', poemId: 6,
    section: 'reading', syncId: 'standby-sync', queuedAt: NOW - 1000, payload: { score: 92 }, ...overrides }, NOW);
}
function exportFile(t, records = [record()], overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maanshan-standby-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'records.json');
  fs.writeFileSync(input, JSON.stringify({ format: transfer.FORMAT, namespace: store.NAMESPACE,
    exportedAt: new Date(NOW).toISOString(), records,
    sha256: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex'), ...overrides }), { mode: 0o600 });
  return input;
}
const env = { DB_DRIVER: 'postgres', DB_HOST: '127.0.0.1', DB_NAME: 'maanshan_db', DB_USER: 'test', MAANSHAN_STANDBY_ENABLE: '1' };
function fakePool({ sync = [], latest = [], failInsert = false } = {}) {
  const queries = [];
  class PoolClass {
    async connect() { return { release() {}, async query(sql, args) {
      queries.push({ sql, args });
      if (sql.startsWith('SELECT student_id')) return { rows: sync };
      if (sql.startsWith('SELECT DISTINCT')) return { rows: latest };
      if (sql.startsWith('INSERT')) {
        if (failInsert) throw new Error('secret-payload-must-not-be-logged');
        return { rowCount: args.length / 9 };
      }
      return { rows: [] };
    } }; }
    async end() {}
  }
  return { PoolClass, queries };
}

test('full export validation rejects tampering, stale/future dates and duplicate records', t => {
  assert.equal(standby.readExport(exportFile(t)).records.length, 1);
  for (const overrides of [{ sha256: 'bad' }, { exportedAt: 'invalid' },
    { exportedAt: new Date(NOW - 32 * 3600000).toISOString() },
    { exportedAt: new Date(NOW + 3600000).toISOString() }]) {
    assert.throws(() => standby.readExport(exportFile(t, [record()], overrides)));
  }
  assert.throws(() => standby.readExport(exportFile(t, [record(), record()])));
});

test('newest incomplete export is rejected instead of silently reusing yesterday', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'standby-latest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const older = path.join(root, '20260919T031500000000000Z'), latest = path.join(root, '20260920T031500000000000Z');
  fs.mkdirSync(older); fs.mkdirSync(latest);
  fs.writeFileSync(path.join(older, 'records.json'), '{}');
  assert.equal(standby.latestExport(root), path.join(latest, 'records.json'));
  assert.throws(() => standby.readExport(standby.latestExport(root)));
});

test('newer PG work survives; equal-time or conflicting identities/payloads fail closed', () => {
  const r = record();
  assert.equal(standby.planImport([r], [], [])[0].action, 'insert');
  assert.equal(standby.planImport([r], [{ ...r, payload: { score: 92 } }], [r])[0].action, 'already-present');
  assert.equal(standby.planImport([r], [], [{ ...r, sync_id: 'new', updated_at: new Date(NOW) }])[0].action, 'newer-in-postgres');
  assert.throws(() => standby.planImport([r], [], [{ ...r, sync_id: 'equal-time' }]));
  assert.throws(() => standby.planImport([r], [{ ...r, student_id: 'other' }], []));
  assert.throws(() => standby.planImport([r], [{ ...r, payload: { score: 1 } }], []));
  const complex = { ...r, payload: { a: 1, b: { c: 3, d: 4 } } };
  assert.equal(standby.planImport([complex], [{ ...r, payload: { b: { d: 4, c: 3 }, a: 1 } }], [])[0].action, 'already-present');
});

test('writes require explicit enable, local target and matching verified export hash', async t => {
  const input = exportFile(t), fake = fakePool();
  await assert.rejects(standby.importStandby({ input, apply: true, env: { ...env, MAANSHAN_STANDBY_ENABLE: undefined }, ...fake }));
  await assert.rejects(standby.importStandby({ input, apply: true, expectedSha256: 'changed', env, ...fake }));
  assert.equal(fake.queries.length, 0);
  for (const overrides of [{ DB_HOST: 'public-db.test' }, { DB_NAME: 'other' }, { DB_DRIVER: 'mysql' }, { DB_PORT: '65439' }]) {
    assert.throws(() => standby.pgConfig({ ...env, ...overrides }));
  }
});

test('preview is read-only; apply locks, inserts atomically and preserves source timestamps', async t => {
  const input = exportFile(t);
  let fake = fakePool();
  let result = await standby.importStandby({ input, env, ...fake });
  assert.equal(result.dryRun, true);
  assert.equal(fake.queries[0].sql, 'BEGIN READ ONLY');
  assert.ok(fake.queries.every(q => !/INSERT|UPDATE|DELETE|LOCK TABLE/.test(q.sql)));
  fake = fakePool();
  result = await standby.importStandby({ input, apply: true, env, ...fake });
  assert.equal(result.inserted, 1);
  assert.equal(result.sourceDeleted, false);
  assert.ok(fake.queries.some(q => q.sql.startsWith('LOCK TABLE')));
  assert.equal(fake.queries.find(q => q.sql.startsWith('INSERT')).args.at(-1), record().source_at);
  assert.equal(fake.queries.at(-1).sql, 'COMMIT');
});

test('reruns perform no insertion; any failed insert rolls back the whole import', async t => {
  const input = exportFile(t);
  let fake = fakePool({ sync: [record()], latest: [record()] });
  let result = await standby.importStandby({ input, apply: true, env, ...fake });
  assert.equal(result.counts['already-present'], 1);
  assert.ok(fake.queries.every(q => !q.sql.startsWith('INSERT')));
  fake = fakePool({ failInsert: true });
  await assert.rejects(standby.importStandby({ input, apply: true, env, ...fake }));
  assert.equal(fake.queries.at(-1).sql, 'ROLLBACK');
  assert.ok(fake.queries.every(q => q.sql !== 'COMMIT'));
});

test('multi-batch import remains one transaction and reports actual inserted counts', async t => {
  const records = Array.from({ length: 205 }, (_, i) => record({ studentId: 'test-' + i, syncId: 'sync-' + i }));
  const input = exportFile(t, records), fake = fakePool();
  const result = await standby.importStandby({ input, apply: true, env, ...fake });
  assert.equal(result.inserted, 205);
  assert.equal(fake.queries.filter(q => q.sql.startsWith('INSERT')).length, 3);
  assert.equal(fake.queries.filter(q => q.sql === 'COMMIT').length, 1);
});
