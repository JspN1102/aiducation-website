'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const pg = require('pg');
const { createApiServer } = require('./index.cjs');

const EARLIER = '2026-09-19T10:00:00.000Z';
const LATER = '2026-09-19T11:00:00.000Z';
const answer = (itemId, status, type = 'dictation') => ({ itemId, type, status, focus: null });
const challenge = (answers, overrides = {}) => ({
  version: 2, attemptId: 'test-round', mode: 'standard', completed: true,
  answered: 5, total: 5, correct: 3, completedAt: Date.parse(LATER), answers, ...overrides
});
const row = (section, payload, updated_at = LATER) => ({
  student_id: 'test-student', name: '測試學生', section, payload, updated_at
});
const reading = (summary, overrides = {}) => row('reading', {
  totalScore: 80, phonics: {}, updatedAt: LATER, challenge: summary, ...overrides
});
const legacy = (updatedAt = EARLIER) => row('writing', {
  totalCorrect: 1, totalChars: 4, updatedAt,
  results: [null, { char: '酥', correct: false }, { char: '色', correct: true, hinted: true }]
}, updatedAt);

test('teacher API recovers challenge dictation results and preserves legacy assessments', async t => {
  const envNames = ['DB_HOST', 'DB_DRIVER', 'DATA_READ_TOKEN'];
  const oldEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  process.env.DB_HOST = 'unused-database.test';
  process.env.DB_DRIVER = 'postgres';
  process.env.DATA_READ_TOKEN = 'test-only-teacher-code';
  t.after(() => envNames.forEach(name => {
    if (oldEnv[name] === undefined) delete process.env[name];
    else process.env[name] = oldEnv[name];
  }));
  let rows = [];
  t.mock.method(pg.Pool.prototype, 'query', async () => ({ rows }));
  const server = createApiServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/maanshan-data?grade=6&cls=A&poemId=6`;
  async function report(records) {
    rows = records;
    const response = await fetch(endpoint, { headers: { Authorization: 'Bearer test-only-teacher-code' } });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.hasData, true);
    assert.equal(data.students.length, 1);
    return data;
  }

  await t.test('current challenge counts actual dictation characters, not the five-question total', async () => {
    const data = await report([reading(challenge([
      answer('g6-play-20260918', 'correct', 'microgame'),
      answer('g6-s1', 'correct', 'sound'),
      answer('g6-d1', 'correct'),
      answer('g6-s2', 'correct', 'sound'),
      answer('g6-d2', 'incorrect')
    ]))]);
    assert.equal(data.students[0].writeScore, 50);
    assert.equal(data.students[0].score, 80);
    assert.deepEqual(data.errorChars, [{ c: '遙', type: '聽寫錯誤', count: 1, rate: 100 }]);
  });
  await t.test('retained bank IDs resolve traditional characters and skipped learning is unmeasured', async () => {
    const data = await report([reading(challenge([
      answer('g6-d-9165', 'correct'),
      answer('g6-d1', 'skipped'),
      answer('g6-d-9165', 'incorrect'),
      answer('g6-d-unknown', 'incorrect'),
      answer('g6-s1', 'incorrect')
    ]))]);
    assert.equal(data.students[0].writeScore, 100);
    assert.deepEqual(data.errorChars, []);
  });
  await t.test('sound-only and unmeasured rounds do not fabricate a zero writing score', async () => {
    for (const answers of [[answer('g6-s1', 'correct', 'sound')], [answer('g6-d1', 'skipped')]]) {
      const data = await report([reading(challenge(answers))]);
      assert.equal(data.students[0].writeScore, null);
      assert.deepEqual(data.errorChars, []);
    }
  });
  await t.test('legacy totals and hinted scores stay intact, including sparse results', async () => {
    const data = await report([legacy()]);
    assert.equal(data.students[0].writeScore, 25);
    assert.deepEqual(data.errorChars, [{ c: '酥', type: '書寫錯誤', count: 1, rate: 100 }]);
  });
  await t.test('newer challenge replaces old writing without merging or counting errors twice', async () => {
    const data = await report([reading(challenge([answer('g6-d1', 'correct'), answer('g6-d2', 'incorrect')])), legacy()]);
    assert.equal(data.students[0].writeScore, 50);
    assert.deepEqual(data.errorChars.map(item => item.c), ['遙']);
  });
  await t.test('newer legacy practice wins even when an old challenge is resynced later', async () => {
    const data = await report([reading(challenge([answer('g6-d1', 'correct')], { completedAt: Date.parse(EARLIER) })), legacy(LATER)]);
    assert.equal(data.students[0].writeScore, 25);
    assert.deepEqual(data.errorChars.map(item => item.c), ['酥']);
  });
  await t.test('review and incomplete rounds do not overwrite measured legacy results', async () => {
    for (const overrides of [{ mode: 'review' }, { completed: false }]) {
      const data = await report([reading(challenge([answer('g6-d1', 'correct')], overrides)), legacy()]);
      assert.equal(data.students[0].writeScore, 25);
    }
  });
  await t.test('challengeReview never changes the original challenge assessment', async () => {
    const data = await report([reading(challenge([answer('g6-d1', 'incorrect')]), {
      challengeReview: challenge([answer('g6-d1', 'correct')], { mode: 'review' })
    })]);
    assert.equal(data.students[0].writeScore, 0);
    assert.deepEqual(data.errorChars.map(item => item.c), ['潤']);
  });
  await t.test('teacher protection still rejects requests without the access code', async () => {
    assert.equal((await fetch(endpoint)).status, 403);
  });
});
