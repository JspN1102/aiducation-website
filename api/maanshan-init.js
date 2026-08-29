import { execute, isDbReady, INIT_SQL } from './_lib/db.js';

/**
 * GET /api/maanshan-init?key=xxx
 *
 * 初始化数据库表。部署后访问一次即可。
 * 需要 INIT_KEY 环境变量作为简单鉴权。
 */
export default async function handler(req, res) {
  const key = req.query.key;
  if (!process.env.INIT_KEY || key !== process.env.INIT_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!isDbReady()) {
    return res.status(500).json({ error: 'DB not configured. Set DB_HOST, DB_USER, DB_PASS env vars.' });
  }
  const result = await execute(INIT_SQL);
  if (result === false) {
    return res.status(500).json({ error: 'Failed to create table' });
  }
  return res.status(200).json({ ok: true, message: 'Table student_data created/verified' });
}
