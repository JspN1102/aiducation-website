'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const blob = require('@vercel/blob');
const pg = require('pg');
const studentStore = require('../api/_lib/student-store.js');
const transfer = require('../deploy/student-store-transfer.cjs');
const { createApiServer } = require('./index.cjs');

const NOW = Date.parse('2026-09-20T00:00:00Z');
const input = (overrides = {}) => ({ studentId: 'S-test', name: '測試', grade: 6, cls: 'A', poemId: 6,
  section: 'reading', syncId: 'first-sync', queuedAt: NOW - 1000, payload: { totalScore: 80 }, ...overrides });
function fakeBlob() {
  const objects = new Map(); const calls = []; let revision = 0;
  const client = {
    async get(pathname, options) {
      calls.push({ method: 'get', pathname, options });
      const object = objects.get(pathname);
      if (!object) return null;
      return { statusCode: 200, blob: { size: object.bytes.length, etag: object.etag },
        stream: new ReadableStream({ start(controller) { controller.enqueue(object.bytes); controller.close(); } }) };
    },
    async put(pathname, body, options) {
      calls.push({ method: 'put', pathname, options });
      const existing = objects.get(pathname);
      if (existing && (!options.allowOverwrite || options.ifMatch !== existing.etag)) throw new blob.BlobPreconditionFailedError();
      objects.set(pathname, { bytes: Buffer.from(body), etag: `etag-${++revision}` });
      return {};
    },
    async list(options) {
      calls.push({ method: 'list', options });
      return { hasMore: false, blobs: [...objects].filter(([name]) => name.startsWith(options.prefix))
        .map(([pathname, object]) => ({ pathname, size: object.bytes.length })) };
    }
  };
  return { client, objects, calls, store: studentStore.createStudentStore({ client, now: () => NOW }) };
}

test('private student records are scoped, durable and retry-idempotent', async () => {
  const fake = fakeBlob();
  await fake.store.save(input());
  await fake.store.save(input());
  assert.equal(fake.objects.size, 1);
  assert.equal(fake.calls.filter(call => call.method === 'put').length, 1);
  const put = fake.calls.find(call => call.method === 'put');
  assert.match(put.pathname, /^mandarin-bridge-v1\/class\/6\/A\/poem\/6\/[a-f0-9]{64}\/reading\.json$/);
  assert.equal(put.pathname.includes('S-test'), false);
  assert.equal(put.options.access, 'private');
  assert.equal(put.options.addRandomSuffix, false);
  const rows = await fake.store.readClass(6, 'A', 6);
  assert.equal(rows[0].payload.totalScore, 80);
  assert.equal(rows[0].updated_at, new Date(NOW - 1000).toISOString());
  assert.ok(fake.calls.filter(call => call.method === 'get').every(call => call.options.useCache === false));
});

test('older retry cannot overwrite newer work and CAS races preserve the newest source time', async () => {
  const fake = fakeBlob();
  await Promise.all([
    fake.store.save(input()),
    fake.store.save(input({ syncId: 'newer-sync', queuedAt: NOW, payload: { totalScore: 95 } }))
  ]);
  await fake.store.save(input({ syncId: 'older-retry', queuedAt: NOW - 2000, payload: { totalScore: 20 } }));
  const rows = await fake.store.readClass(6, 'A', 6);
  assert.equal(rows[0].payload.totalScore, 95);
  assert.equal(fake.objects.size, 1);
  assert.ok(fake.calls.filter(call => call.method === 'put').some(call => call.options.ifMatch));
});

test('teacher reads only the selected class and poem, with separate sections', async () => {
  const fake = fakeBlob();
  await fake.store.save(input());
  await fake.store.save(input({ section: 'writing', syncId: 'writing' }));
  await fake.store.save(input({ cls: 'B', syncId: 'other-class' }));
  await fake.store.save(input({ poemId: 5, syncId: 'other-poem' }));
  const rows = await fake.store.readClass(6, 'A', 6);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.section), ['reading', 'writing']);
  assert.equal(fake.calls.filter(call => call.method === 'list').at(-1).options.prefix, 'mandarin-bridge-v1/class/6/A/poem/6/');
});

test('pagination is bounded and unexpected namespace, repeated cursor and excess records fail closed', async () => {
  for (const kind of ['outside', 'cursor', 'limit']) {
    const fake = fakeBlob();
    if (kind === 'outside') fake.client.list = async () => ({ hasMore: false, blobs: [{ pathname: 'speech/private.wav', size: 50 }] });
    if (kind === 'cursor') fake.client.list = async () => ({ hasMore: true, cursor: 'loop', blobs: [] });
    if (kind === 'limit') fake.client.list = async () => ({ hasMore: false, blobs: Array.from({ length: 601 }, (_, i) => ({
      pathname: `mandarin-bridge-v1/class/6/A/poem/6/${i.toString(16).padStart(64, '0')}/reading.json`, size: 100
    })) });
    await assert.rejects(fake.store.readClass(6, 'A', 6));
  }
});

test('oversized or mismatched stored objects never reach teacher aggregation', async () => {
  const fake = fakeBlob();
  await fake.store.save(input());
  const [pathname, object] = [...fake.objects][0];
  object.bytes = Buffer.alloc(studentStore.MAX_RECORD_BYTES + 1);
  await assert.rejects(fake.store.readClass(6, 'A', 6));
  object.bytes = Buffer.from(JSON.stringify(studentStore.makeRecord(input({ cls: 'B' }), NOW)));
  assert.equal(fake.objects.has(pathname), true);
  await assert.rejects(fake.store.readClass(6, 'A', 6));
});

test('failed Blob writes reject rather than acknowledge local-only data as durable', async () => {
  const fake = fakeBlob();
  fake.client.put = async () => { throw new Error('upstream failure'); };
  await assert.rejects(fake.store.save(input()));
  assert.equal(fake.objects.size, 0);
});

test('Blob HTTP mode requires teacher protection, saves and reads the same durable records', async t => {
  const keys = ['STUDENT_STORE', 'BLOB_READ_WRITE_TOKEN', 'DATA_READ_TOKEN', 'DB_HOST'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => keys.forEach(key => previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]));
  process.env.STUDENT_STORE = 'blob'; process.env.BLOB_READ_WRITE_TOKEN = 'test-private-token';
  delete process.env.DATA_READ_TOKEN; delete process.env.DB_HOST;
  const fake = fakeBlob();
  for (const method of ['get', 'put', 'list']) t.mock.method(blob, method, fake.client[method]);
  const server = createApiServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = () => fetch(base + '/api/maanshan-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
  assert.equal((await post()).status, 503);
  assert.equal((await fetch(base + '/api/maanshan-data')).status, 403);
  process.env.DATA_READ_TOKEN = 'test-teacher-code';
  let response = await post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, stored: 'blob' });
  assert.equal((await fetch(base + '/api/maanshan-data')).status, 403);
  response = await fetch(base + '/api/maanshan-data?grade=6&cls=A&poemId=6', { headers: { Authorization: 'Bearer test-teacher-code' } });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.students[0].score, 80);
  assert.equal(data.students[0].name, '測試');
});

test('browser queue removes only acknowledged db/blob records, preserving local-only failures', async () => {
  const { createSyncQueue } = await import(pathToFileURL(path.join(__dirname, '../maanshan/core.mjs')));
  for (const stored of ['db', 'blob', 'local-only', 'unknown']) {
    let pending = [{ syncId: 'queue-id' }];
    const queue = createSyncQueue({ read: () => pending, write: value => { pending = value; },
      send: async () => ({ ok: true, json: async () => ({ ok: true, stored }) }) });
    await queue.flush();
    assert.equal(pending.length, ['db', 'blob'].includes(stored) ? 0 : 1);
  }
});

test('browser progress queue discards only explicit permanent off-grade rejection and drains subsequent/new work',async()=>{
 const {createSyncQueue}=await import(pathToFileURL(path.join(__dirname,'../maanshan/core.mjs')));
 let pending=[{syncId:'old-other-grade'},{syncId:'own-grade'}],sent=[];
 const queue=createSyncQueue({read:()=>pending,write:value=>{pending=value;return true;},send:async item=>{
  sent.push(item.syncId);
  if(item.syncId==='old-other-grade'){queue.add({syncId:'enqueued-during-rejection'});return {ok:false,status:422,json:async()=>({code:'POEM_GRADE_FORBIDDEN',retryable:false})};}
  return {ok:true,status:200,json:async()=>({ok:true,stored:'db'})};
 }});
 await queue.flush();assert.deepEqual(sent,['old-other-grade','own-grade','enqueued-during-rejection']);assert.deepEqual(pending,[]);
});

test('browser progress queue retains ambiguous or unrelated errors including malformed rejection bodies',async()=>{
 const {createSyncQueue}=await import(pathToFileURL(path.join(__dirname,'../maanshan/core.mjs')));
 for(const [status,body]of [[422,{code:'POEM_GRADE_FORBIDDEN'}],[422,{code:'POEM_GRADE_FORBIDDEN',retryable:true}],[422,{code:'OTHER',retryable:false}],[403,{code:'POEM_GRADE_FORBIDDEN',retryable:false}],[503,{code:'POEM_GRADE_FORBIDDEN',retryable:false}],[422,null]]){
  const original=[{syncId:'retain'},{syncId:'later'}];let pending=structuredClone(original),sends=0,writes=0;
  const queue=createSyncQueue({read:()=>pending,write:value=>{writes++;pending=value;},send:async()=>{sends++;return {ok:false,status,json:async()=>{if(body===null)throw Error('invalid JSON');return body;}};}});
  await queue.flush();assert.equal(sends,1);assert.equal(writes,0);assert.deepEqual(pending,original);
 }
});

test('browser progress queue keeps a permanently rejected item if durable removal fails and can retry later',async()=>{
 const {createSyncQueue}=await import(pathToFileURL(path.join(__dirname,'../maanshan/core.mjs')));
 for(const failure of ['false','throw']){
  let pending=[{syncId:'old-other-grade'},{syncId:'own-grade'}],writable=false;const sent=[];
  const queue=createSyncQueue({read:()=>pending,write:value=>{if(!writable){if(failure==='throw')throw Error('storage unavailable');return false;}pending=value;return true;},send:async item=>{sent.push(item.syncId);return item.syncId==='old-other-grade'?{ok:false,status:422,json:async()=>({code:'POEM_GRADE_FORBIDDEN',retryable:false})}:{ok:true,status:200,json:async()=>({ok:true,stored:'blob'})};}});
  await queue.flush();assert.deepEqual(sent,['old-other-grade']);assert.equal(pending.length,2);
  writable=true;await queue.flush();assert.deepEqual(sent,['old-other-grade','old-other-grade','own-grade']);assert.deepEqual(pending,[]);
 }
});

test('export checksum and record identities validate before PostgreSQL migration', () => {
  const records = [studentStore.makeRecord(input(), NOW)];
  const data = { format: transfer.FORMAT, namespace: studentStore.NAMESPACE, records,
    sha256: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex') };
  assert.equal(transfer.validateExport(data).length, 1);
  assert.throws(() => transfer.validateExport({ ...data, sha256: 'corrupted' }));
  const existing = [{ ...records[0], updated_at: new Date(NOW) }];
  assert.equal(transfer.makePlan(records, existing)[0].action, 'already-present');
  assert.equal(transfer.makePlan(records, [{ ...existing[0], sync_id: 'newer-postgres' }])[0].action, 'newer-in-postgres');
  assert.equal(transfer.makePlan(records, [])[0].action, 'insert');
  assert.throws(() => transfer.makePlan(records, [{ ...existing[0], student_id: 'different-student' }]));
});

test('PostgreSQL import dry-run is read-only; apply is atomic, repeatable and never deletes Blob', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maanshan-student-import-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'records.json');
  const records = [studentStore.makeRecord(input(), NOW)];
  fs.writeFileSync(filename, JSON.stringify({ format: transfer.FORMAT, namespace: studentStore.NAMESPACE, records,
    sha256: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex') }));
  const keys = ['DB_HOST', 'DB_NAME', 'DB_USER'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => process.env[key] = 'test-only');
  t.after(() => keys.forEach(key => before[key] === undefined ? delete process.env[key] : process.env[key] = before[key]));
  let commands = [], existing = [];
  t.mock.method(pg.Pool.prototype, 'connect', async () => ({ release() {}, async query(sql) {
    commands.push(sql);
    if (sql.startsWith('SELECT')) return { rows: existing };
    if (sql.startsWith('INSERT')) existing = [{ ...records[0], updated_at: records[0].source_at }];
    return { rows: [] };
  } }));
  t.mock.method(pg.Pool.prototype, 'end', async () => {});
  let result = await transfer.importPostgres({ input: filename, apply: false });
  assert.equal(result.counts.insert, 1);
  assert.equal(commands[0], 'BEGIN READ ONLY');
  assert.ok(commands.every(sql => !/INSERT|UPDATE|DELETE|LOCK/.test(sql)));
  commands = [];
  result = await transfer.importPostgres({ input: filename, apply: true });
  assert.equal(result.counts.insert, 1);
  assert.ok(commands.some(sql => sql.startsWith('LOCK TABLE')));
  assert.equal(commands.at(-1), 'COMMIT');
  commands = [];
  result = await transfer.importPostgres({ input: filename, apply: true });
  assert.equal(result.counts['already-present'], 1);
  assert.ok(commands.every(sql => !sql.startsWith('INSERT')));
  assert.equal(result.sourceDeleted, false);
});
