import { query, isDbReady } from './_lib/db.js';
import { timingSafeEqual } from 'node:crypto';
import poemHelpers from './_lib/poems.js';
import { CHALLENGE_SETS } from '../maanshan/challenge-data.mjs';

function resultTime(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const time = typeof value === 'number' ? value : new Date(value).getTime();
    if (Number.isFinite(time) && time > 0) return time;
  }
  return 0;
}

function writingResult(student, set) {
  const legacy = student.writing;
  const correct = legacy?.totalCorrect;
  const total = legacy?.totalChars;
  const previous = Number.isInteger(correct) && Number.isInteger(total) &&
    total > 0 && correct >= 0 && correct <= total ? {
      totalCorrect: correct,
      totalChars: total,
      results: Array.isArray(legacy.results) ? legacy.results.filter(result =>
        result && typeof result.char === 'string' && typeof result.correct === 'boolean' &&
        result.status !== 'skipped' && result.skipped !== true) : [],
      measuredAt: resultTime(legacy.updatedAt, student.sectionTimes.writing)
    } : null;

  const challenge = student.reading?.challenge;
  if (!set || challenge?.completed !== true || challenge.mode === 'review' ||
      !Array.isArray(challenge.answers)) return previous;
  // Saved summaries contain question IDs and statuses, not the target character.
  // Resolve exact retained IDs so old rounds never use today's random questions.
  const bank = new Map((set.bank || set.items).map(item => [item.id, item]));
  const seen = new Set();
  const results = [];
  for (const answer of challenge.answers) {
    if (!answer || answer.type !== 'dictation' || seen.has(answer.itemId)) continue;
    const item = bank.get(answer.itemId);
    if (item?.type !== 'dictation' || !['correct', 'incorrect'].includes(answer.status)) continue;
    seen.add(answer.itemId);
    results.push({ char: item.target.char, correct: answer.status === 'correct', errorType: '聽寫錯誤' });
  }
  // "先學一學" is unmeasured, not a handwriting error. Reviews also leave the
  // original assessment intact. Use one latest measured result, never add both.
  if (!results.length) return previous;
  const current = {
    totalCorrect: results.filter(result => result.correct).length,
    totalChars: results.length,
    results,
    measuredAt: resultTime(challenge.completedAt, student.reading.updatedAt, student.sectionTimes.reading)
  };
  return previous && previous.measuredAt > current.measuredAt ? previous : current;
}

function canReadData(req) {
  const expected = process.env.DATA_READ_TOKEN;
  if (!expected) return true; // Preserve deployments using their own access layer.
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

/**
 * GET /api/maanshan-data?grade=2&cls=A&poemId=2
 *
 * 教师后台查询。从配置的数据库读取并聚合一个班的数据。
 * DATA_READ_TOKEN 配置后，必须通过 Authorization: Bearer <token> 访问。
 * 数据库未配置时返回 hasData:false，前端自动用 mock 数据。
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!canReadData(req)) return res.status(403).json({ error: 'Forbidden' });

  const params = req.query || {};
  const gradeValue = params.grade ?? '2';
  const poemValue = params.poemId ?? gradeValue;
  const classValue = params.cls ?? 'A';
  if (typeof gradeValue !== 'string' || !/^[1-6]$/.test(gradeValue) ||
      typeof poemValue !== 'string' || !/^[1-6]$/.test(poemValue) ||
      typeof classValue !== 'string' || !/^[A-Za-z]$/.test(classValue)) {
    return res.status(400).json({ error: 'Invalid grade, class or poem' });
  }
  const grade = Number(gradeValue);
  const cls = classValue.toUpperCase();
  const poemId = Number(poemValue);

  if (!isDbReady()) {
    return res.status(200).json({ grade, cls, poemId, hasData: false });
  }

  try {
    // 取该班该诗所有记录，按 student_id + section 分组取最新
    const rows = await query(
      { mysql: `SELECT student_id, name, section, payload, updated_at
       FROM student_data
       WHERE grade = ? AND cls = ? AND poem_id = ?
       ORDER BY student_id, section, updated_at DESC, id DESC`,
        postgres: `SELECT student_id, name, section, payload, updated_at
        FROM student_data
        WHERE grade = $1 AND cls = $2 AND poem_id = $3
        ORDER BY student_id, section, updated_at DESC, id DESC`
      },
      [grade, cls, poemId]
    );

    if (!rows || rows.length === 0) {
      return res.status(200).json({ grade, cls, poemId, hasData: false });
    }

    // 按学生聚合（每个 section 只取最新一条）
    const studentMap = Object.create(null);
    for (const row of rows) {
      const sid = row.student_id;
      if (!studentMap[sid]) studentMap[sid] = { id: sid, name: row.name, sectionTimes: Object.create(null) };
      // 每个 section 只保留第一条（已按 updated_at DESC 排序）
      if (!studentMap[sid][row.section]) {
        studentMap[sid][row.section] = typeof row.payload === 'string'
          ? JSON.parse(row.payload) : row.payload;
        studentMap[sid].sectionTimes[row.section] = row.updated_at;
      }
    }
    const students = Object.values(studentMap);
    const set = CHALLENGE_SETS[poemHelpers.getPoem(poemId, null)?.slug];
    students.forEach(student => { student.writingResult = writingResult(student, set); });

    // 统计
    const scores = students
      .filter(s => s.reading && typeof s.reading.totalScore === 'number')
      .map(s => s.reading.totalScore);

    const tested = scores.length;
    const total = students.length;

    const stats = {
      total,
      tested,
      avg: tested ? +(scores.reduce((a, b) => a + b, 0) / tested).toFixed(1) : 0,
      passRate: tested ? Math.round(scores.filter(s => s >= 60).length / tested * 100) : 0,
      excellentRate: tested ? Math.round(scores.filter(s => s >= 90).length / tested * 100) : 0,
      distribution: [
        { range: '0-59', count: scores.filter(s => s < 60).length },
        { range: '60-69', count: scores.filter(s => s >= 60 && s < 70).length },
        { range: '70-79', count: scores.filter(s => s >= 70 && s < 80).length },
        { range: '80-89', count: scores.filter(s => s >= 80 && s < 90).length },
        { range: '90-100', count: scores.filter(s => s >= 90).length }
      ]
    };

    // 语音知识聚合
    const phonAgg = Object.create(null);
    students.forEach(s => {
      if (!s.reading || !s.reading.phonics) return;
      const ph = typeof s.reading.phonics === 'string'
        ? JSON.parse(s.reading.phonics) : s.reading.phonics;
      Object.entries(ph).forEach(([k, v]) => {
        if (!phonAgg[k]) phonAgg[k] = [];
        phonAgg[k].push(v);
      });
    });
    const phonAvg = Object.create(null);
    Object.entries(phonAgg).forEach(([k, vals]) => {
      phonAvg[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    });

    // 错字聚合
    const errMap = Object.create(null);
    let writeTested = 0;
    students.forEach(s => {
      if (!s.writingResult) return;
      writeTested++;
      const results = s.writingResult.results;
      results.forEach(r => {
        if (!r.correct && r.char) {
          if (!errMap[r.char]) errMap[r.char] = { c: r.char, type: r.errorType || '書寫錯誤', count: 0 };
          errMap[r.char].count++;
        }
      });
    });
    const errorChars = Object.values(errMap)
      .map(e => ({ ...e, rate: writeTested ? Math.round(e.count / writeTested * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);

    return res.status(200).json({
      grade, cls, poemId, hasData: true,
      stats, phonAvg, errorChars,
      students: students.map(s => ({
        id: s.id,
        name: s.name,
        score: s.reading?.totalScore ?? null,
        phonics: s.reading?.phonics ?? {},
        writeScore: s.writingResult
          ? Math.round(s.writingResult.totalCorrect / s.writingResult.totalChars * 100) : null,
        lastUpdated: s.reading?.updatedAt || s.writing?.updatedAt || null
      }))
    });
  } catch (err) {
    console.error('maanshan-data aggregation failed');
    return res.status(200).json({ grade, cls, poemId, hasData: false, error: 'Unable to read data' });
  }
}
