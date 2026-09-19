import { isDbReady, initializeSchema } from './_lib/db.js';
import { timingSafeEqual } from 'node:crypto';

/**
 * POST /api/maanshan-init with Authorization: Bearer <INIT_KEY>
 * Legacy GET /api/maanshan-init?key=xxx remains supported.
 *
 * 初始化数据库表。部署后访问一次即可。
 * 需要 INIT_KEY 环境变量作为简单鉴权。
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'POST or GET only' });
  }
  const auth = req.headers?.authorization;
  const key = typeof auth === 'string' && auth.startsWith('Bearer ')
    ? auth.slice(7) : req.query?.key;
  const expected = process.env.INIT_KEY;
  if (!expected || typeof key !== 'string' ||
      Buffer.byteLength(key) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!isDbReady()) {
    return res.status(500).json({ error: 'DB not configured. Set DB_HOST, DB_USER, DB_PASS env vars.' });
  }
  if (!await initializeSchema()) {
    return res.status(500).json({ error: 'Failed to create table' });
  }
  return res.status(200).json({ ok: true, message: 'Table student_data created/verified' });
}
