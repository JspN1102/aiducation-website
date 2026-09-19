'use strict';
// Integration check ONLY for the disposable cluster created by health-restore.
// It refuses the production database name/port and has no credential input.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pg = require('pg');
const store = require('../api/_lib/student-store.js');
const { FORMAT } = require('./student-store-transfer.cjs');
const standby = require('./standby-import.cjs');

async function main() {
  const socket = process.argv[2];
  if (!socket || !/^\/(?:var\/tmp\/mhr-[a-f0-9]+|var\/lib\/maanshan-restore)\/work-[^/]+\/socket$/.test(socket)) throw new Error('Private test socket required');
  const connection = { host: socket, port: 65439, database: 'restore_check', user: 'postgres', max: 1 };
  const pool = new pg.Pool(connection);
  const root = fs.mkdtempSync(path.join(path.dirname(socket), 'standby-fixture-'));
  let tests = 0;
  try {
    const location = (await pool.query('SHOW data_directory')).rows[0].data_directory;
    assert.equal(path.resolve(location), path.join(path.dirname(socket), 'data'));
    const database = (await pool.query('SELECT current_database() AS name, inet_server_addr() AS ip')).rows[0];
    assert.equal(database.name, 'restore_check'); assert.equal(database.ip, null);
    class PrivatePool extends pg.Pool {
      constructor(config) {
        assert.equal(config.database, 'maanshan_db'); assert.equal(config.host, '127.0.0.1');
        super({ ...config, ...connection });
      }
    }
    const now = Date.now();
    const make = (studentId, syncId, payload = { score: 90 }) => store.makeRecord({ studentId, syncId, payload,
      name: 'Test', grade: 6, cls: 'Z', poemId: 6, section: 'reading', queuedAt: now - 1000 }, now);
    const write = records => {
      const input = path.join(root, crypto.randomUUID() + '.json');
      fs.writeFileSync(input, JSON.stringify({ format: FORMAT, namespace: store.NAMESPACE, records,
        exportedAt: new Date(now).toISOString(), sha256: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex') }), { mode: 0o600 });
      return input;
    };
    const env = { DB_DRIVER: 'postgres', DB_HOST: '127.0.0.1', DB_NAME: 'maanshan_db', DB_USER: 'postgres', MAANSHAN_STANDBY_ENABLE: '1' };
    const invoke = (input, apply) => standby.importStandby({ input, apply, env, PoolClass: PrivatePool });
    const a = make('standby-it-a', 'standby-it-sync-a'), b = make('standby-it-b', 'standby-it-sync-b'), c = make('standby-it-c', 'standby-it-sync-c');
    const seed = async (r, sync, at) => pool.query(`INSERT INTO student_data
      (student_id,name,grade,cls,poem_id,section,payload,sync_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9)`,
      [r.student_id,r.name,r.grade,r.cls,r.poem_id,r.section,JSON.stringify(r.payload),sync,at]);
    await seed(b, 'standby-it-pg-newer', new Date(now).toISOString());
    await seed(c, c.sync_id, c.source_at);
    const input = write([a, b, c]);
    let result = await invoke(input, false);
    assert.deepEqual(result.counts, { insert: 1, 'already-present': 1, 'newer-in-postgres': 1 }); tests++;
    assert.equal(Number((await pool.query("SELECT count(*) FROM student_data WHERE student_id='standby-it-a'")).rows[0].count), 0);
    result = await invoke(input, true); assert.equal(result.inserted, 1); tests++;
    const imported = (await pool.query('SELECT payload,updated_at FROM student_data WHERE sync_id=$1', [a.sync_id])).rows[0];
    assert.deepEqual(imported.payload, a.payload); assert.equal(imported.updated_at.toISOString(), a.source_at); tests++;
    result = await invoke(input, true); assert.equal(result.inserted, 0); tests++;
    await assert.rejects(invoke(write([{ ...a, sync_id: 'standby-it-equal-time' }]), true)); tests++;
    await assert.rejects(invoke(write([{ ...a, payload: { score: 1 } }]), true)); tests++;
    await assert.rejects(invoke(write([{ ...a, student_id: 'standby-it-other' }]), true)); tests++;
    await pool.query(`CREATE FUNCTION standby_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.student_id='standby-it-fail' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER standby_test_trigger BEFORE INSERT ON student_data FOR EACH ROW EXECUTE FUNCTION standby_test_fail();`);
    await assert.rejects(invoke(write([make('standby-it-rollback', 'standby-it-sync-rollback'), make('standby-it-fail', 'standby-it-sync-fail')]), true));
    assert.equal(Number((await pool.query("SELECT count(*) FROM student_data WHERE student_id IN ('standby-it-rollback','standby-it-fail')")).rows[0].count), 0); tests++;
    return { ok: true, checks: tests, transport: 'private-unix-socket', productionDatabaseTouched: false };
  } finally { await pool.end(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error('{"ok":false,"error":"isolated_standby_integration_failed"}'); process.exitCode = 1;
});
