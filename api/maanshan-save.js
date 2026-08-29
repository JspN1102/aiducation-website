import { kv } from '@vercel/kv';

/**
 * POST /api/maanshan-save
 *
 * 学生端每完成一个环节就调用一次，增量写入。
 * localStorage 先存 → 再 POST 这里 → 写入 Vercel KV (Redis)。
 *
 * Body: {
 *   syncId:    string (UUID, 用于去重),
 *   studentId: string (e.g. "S20260001"),
 *   name:      string (e.g. "陳思琪"),
 *   grade:     number (1-6),
 *   cls:       string ("A"-"F"),
 *   poemId:    number (1-6, 与年级对应),
 *   section:   "reading" | "writing" | "report",
 *   payload:   object (该环节的数据)
 * }
 *
 * Redis key 设计:
 *   ms:s:{studentId}:p:{poemId}       → 该学生该诗的完整数据 (HASH)
 *   ms:idx:{grade}{cls}               → 该班所有做过测评的学生ID (SET)
 *   ms:dedup:{syncId}                 → 去重标记 (60s TTL)
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

  try {
    const { syncId, studentId, name, grade, cls, poemId, section, payload } = req.body;

    // 参数校验
    if (!studentId || !grade || !cls || !poemId || !section || !payload) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['reading', 'writing', 'report'].includes(section)) {
      return res.status(400).json({ error: 'Invalid section' });
    }

    // 去重：同一个 syncId 60秒内不重复写
    if (syncId) {
      const dupKey = `ms:dedup:${syncId}`;
      const exists = await kv.get(dupKey);
      if (exists) return res.status(200).json({ ok: true, dedup: true });
      await kv.set(dupKey, 1, { ex: 60 });
    }

    // 写入学生数据（合并到已有记录）
    const dataKey = `ms:s:${studentId}:p:${poemId}`;
    const existing = (await kv.get(dataKey)) || {};

    const updated = {
      ...existing,
      studentId,
      name: name || existing.name,
      grade,
      cls,
      poemId,
      [section]: {
        ...(existing[section] || {}),
        ...payload,
        updatedAt: new Date().toISOString()
      },
      lastUpdated: new Date().toISOString()
    };

    await kv.set(dataKey, updated);

    // 维护班级索引
    const idxKey = `ms:idx:${grade}${cls}`;
    await kv.sadd(idxKey, studentId);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('maanshan-save error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
