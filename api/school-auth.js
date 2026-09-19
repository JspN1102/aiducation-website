import auth from './_lib/school-auth.cjs';
import studentStore from './_lib/student-store.js';
import { get as getBlob } from '@vercel/blob';

async function progress(req) {
  const actor = await auth.requireActor(req, { roles: ['student'] });
  if (!actor) throw new auth.AuthError(403, 'AUTH_DISABLED');
  const poems = {};
  if (studentStore.mode()) {
    const targets = Array.from({ length: 6 }, (_, i) => i + 1).flatMap(poem_id =>
      ['reading', 'writing', 'report'].map(section => ({ poem_id, section })));
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < targets.length) {
        const target = targets[next++];
        const path = studentStore.recordPath({ student_id: actor.id, grade: actor.grade, cls: actor.cls, ...target });
        const result = await getBlob(path, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(7000) });
        if (!result) continue;
        if (result.statusCode !== 200 || !result.stream || result.blob.size > studentStore.MAX_RECORD_BYTES) {
          await result.stream?.cancel(); throw new Error('Progress unavailable');
        }
        const reader = result.stream.getReader(), chunks = []; let bytes = 0;
        try {
          while (true) { const part = await reader.read(); if (part.done) break;
            bytes += part.value.byteLength; if (bytes > studentStore.MAX_RECORD_BYTES) throw new Error('Progress unavailable'); chunks.push(Buffer.from(part.value)); }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!studentStore.validRecord(record) || studentStore.recordPath(record) !== path) throw new Error('Progress unavailable');
        (poems[target.poem_id] ||= {})[target.section] = record.payload;
      }
    }));
  } else {
    const pool = auth.getStore().pool;
    if (!pool) throw new Error('Progress database unavailable');
    const rows = (await pool.query(`SELECT DISTINCT ON (poem_id,section) poem_id,section,payload
      FROM student_data WHERE student_id=$1 AND grade=$2 AND cls=$3
      ORDER BY poem_id,section,updated_at DESC,id DESC`, [actor.id, actor.grade, actor.cls])).rows;
    for (const row of rows) (poems[row.poem_id] ||= {})[row.section] = row.payload;
  }
  return { enabled: true, userId: actor.id, poems };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'GET') {
      if (!auth.enabled()) return res.status(200).json({ enabled: false, authenticated: false });
      if (req.query?.action === 'roster') return res.status(200).json(await auth.roster(req));
      if (req.query?.action === 'progress') return res.status(200).json(await progress(req));
      return res.status(200).json(await auth.state(req));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!auth.enabled()) throw new auth.AuthError(403, 'AUTH_DISABLED');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new auth.AuthError(400, 'INVALID_REQUEST');
    if (req.body.action === 'login') return res.status(200).json(await auth.login(req, res));
    if (req.body.action === 'logout') return res.status(200).json(await auth.logout(req, res));
    if (req.body.action === 'change_password') return res.status(200).json(await auth.changePassword(req, res));
    if (req.body.action === 'reset_student_password') return res.status(200).json(await auth.resetStudentPassword(req));
    throw new auth.AuthError(400, 'INVALID_REQUEST');
  } catch (error) { return auth.sendError(res, error); }
}
