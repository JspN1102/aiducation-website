import { query, execute, isDbReady } from './_lib/db.js';

/**
 * POST /api/maanshan-save
 *
 * 学生端每完成一个环节就调用一次。
 * localStorage 先存 → POST 这里 → 写入 MySQL。
 *
 * Body: {
 *   syncId, studentId, name, grade, cls, poemId,
 *   section: "reading"|"writing"|"report",
 *   payload: { ... }
 * }
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 数据库未配置时静默成功（数据仍在 localStorage）
  if (!isDbReady()) {
    return res.status(200).json({ ok: true, stored: 'local-only' });
  }

  try {
    const { syncId, studentId, name, grade, cls, poemId, section, payload } = req.body;

    if (!studentId || !grade || !cls || !poemId || !section || !payload) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['reading', 'writing', 'report'].includes(section)) {
      return res.status(400).json({ error: 'Invalid section' });
    }

    // syncId 去重：INSERT IGNORE 利用 UNIQUE KEY
    const result = await execute(
      `INSERT INTO student_data (student_id, name, grade, cls, poem_id, section, payload, sync_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         payload = VALUES(payload),
         name = VALUES(name),
         updated_at = CURRENT_TIMESTAMP`,
      [studentId, name || '', grade, cls, poemId, section, JSON.stringify(payload), syncId || null]
    );

    if (result === false) {
      // DB write failed, but client still has data in localStorage
      return res.status(200).json({ ok: true, stored: 'local-only', dbError: true });
    }

    return res.status(200).json({ ok: true, stored: 'db' });
  } catch (err) {
    console.error('maanshan-save error:', err);
    // 即使服务端出错也返回 200，让客户端标记为已同步
    // 数据仍在 localStorage，不会丢
    return res.status(200).json({ ok: true, stored: 'local-only', error: err.message });
  }
}
