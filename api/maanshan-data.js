import { kv } from '@vercel/kv';

/**
 * GET /api/maanshan-data?grade=2&cls=A&poemId=2
 *
 * 教师后台读取一个班的完整测评数据。
 * 从 Redis SET 拿学生ID列表 → 批量 GET 每个学生的数据 → 服务端聚合统计。
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const grade = parseInt(req.query.grade) || 2;
    const cls = (req.query.cls || 'A').toUpperCase();
    const poemId = parseInt(req.query.poemId) || grade; // 默认与年级对应

    // 拿班级所有已测学生ID
    const idxKey = `ms:idx:${grade}${cls}`;
    const studentIds = await kv.smembers(idxKey);

    if (!studentIds || studentIds.length === 0) {
      return res.status(200).json({ grade, cls, poemId, total: 0, students: [], hasData: false });
    }

    // 批量获取学生数据
    const keys = studentIds.map(id => `ms:s:${id}:p:${poemId}`);
    const raw = await Promise.all(keys.map(k => kv.get(k)));
    const students = raw.filter(Boolean);

    // 聚合统计
    const scores = students
      .filter(s => s.reading && typeof s.reading.totalScore === 'number')
      .map(s => s.reading.totalScore);

    const stats = {
      total: studentIds.length,
      tested: scores.length,
      avg: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0,
      passRate: scores.length ? Math.round(scores.filter(s => s >= 60).length / scores.length * 100) : 0,
      excellentRate: scores.length ? Math.round(scores.filter(s => s >= 90).length / scores.length * 100) : 0,
      distribution: [
        { range: '0-59', count: scores.filter(s => s < 60).length },
        { range: '60-69', count: scores.filter(s => s >= 60 && s < 70).length },
        { range: '70-79', count: scores.filter(s => s >= 70 && s < 80).length },
        { range: '80-89', count: scores.filter(s => s >= 80 && s < 90).length },
        { range: '90-100', count: scores.filter(s => s >= 90).length }
      ]
    };

    // 语音知识聚合
    const phonAgg = {};
    students.forEach(s => {
      if (!s.reading || !s.reading.phonics) return;
      Object.entries(s.reading.phonics).forEach(([k, v]) => {
        if (!phonAgg[k]) phonAgg[k] = [];
        phonAgg[k].push(v);
      });
    });
    const phonAvg = {};
    Object.entries(phonAgg).forEach(([k, vals]) => {
      phonAvg[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    });

    // 高频错字聚合
    const errMap = {};
    students.forEach(s => {
      if (!s.writing || !s.writing.results) return;
      s.writing.results.forEach(r => {
        if (!r.correct) {
          if (!errMap[r.char]) errMap[r.char] = { c: r.char, type: r.errorType || '書寫錯誤', count: 0 };
          errMap[r.char].count++;
        }
      });
    });
    const writeTested = students.filter(s => s.writing && s.writing.results).length;
    const errorChars = Object.values(errMap)
      .map(e => ({ ...e, rate: writeTested ? Math.round(e.count / writeTested * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5);

    return res.status(200).json({
      grade, cls, poemId, hasData: true,
      stats,
      phonAvg,
      errorChars,
      students: students.map(s => ({
        id: s.studentId,
        name: s.name,
        score: s.reading?.totalScore ?? null,
        phonics: s.reading?.phonics ?? {},
        writeScore: s.writing ? Math.round((s.writing.results?.filter(r => r.correct).length || 0) / (s.writing.results?.length || 1) * 100) : null,
        lastUpdated: s.lastUpdated
      }))
    });
  } catch (err) {
    console.error('maanshan-data error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
