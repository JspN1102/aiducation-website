import { execute, isDbReady } from './_lib/db.js';
import poemHelpers from './_lib/poems.js';
import studentStore from './_lib/student-store.js';
import schoolAuth from './_lib/school-auth.cjs';
import teacherLearning from './_lib/teacher-learning-reset.cjs';

const { getPoem } = poemHelpers;

/**
 * POST /api/maanshan-save
 *
 * 学生端每完成一个环节就调用一次。
 * localStorage 先存 → POST 这里 → 写入配置的数据库。
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

  if(schoolAuth.enabled()){
    try{
      const actor=await schoolAuth.requireActor(req,{roles:['student','teacher'],csrf:true});
      if(req.body?.studentId!==actor.id)return res.status(409).json({ok:false,code:'ACTOR_CHANGED',error:'Account changed'});
      const poem=schoolAuth.assertPoemAccess(actor,req.body?.poemId);
      const learning=await teacherLearning.scope(actor,{forSave:true,learningEpoch:req.body?.learningEpoch});
      req.body={...req.body,studentId:learning.studentId,name:actor.displayName,grade:poem.grade,cls:actor.cls||'T'};
    }catch(error){return schoolAuth.sendError(res,error);}
  }

  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ ok: false, error: 'Invalid request body' });
    }
    const { syncId, studentId, name = '', grade, cls, poemId, section, payload } = req.body;
    if (typeof studentId !== 'string' || !studentId.trim() || studentId.length > 32 ||
        typeof name !== 'string' || name.length > 64 ||
        !Number.isInteger(grade) || grade < 1 || grade > 6 ||
        typeof cls !== 'string' || !/^[A-Za-z]$/.test(cls) || !getPoem(poemId, null) ||
        !['reading', 'writing', 'report'].includes(section) ||
        !payload || typeof payload !== 'object' || Array.isArray(payload) ||
        (syncId != null && (typeof syncId !== 'string' || !syncId || syncId.length > 64))) {
      return res.status(400).json({ ok: false, error: 'Invalid student, poem or payload fields' });
    }
    const payloadJson = JSON.stringify(payload);
    if (Buffer.byteLength(payloadJson) > 256 * 1024 || Buffer.byteLength(JSON.stringify(req.body)) > 320 * 1024) {
      return res.status(413).json({ ok: false, error: 'Payload too large' });
    }
    if (studentStore.mode()) {
      if (!studentStore.configured()) {
        res.setHeader('Retry-After', '30');
        return res.status(503).json({ ok: false, stored: 'local-only', error: 'Student storage unavailable' });
      }
      await studentStore.save(req.body);
      return res.status(200).json({ ok: true, stored: 'blob' });
    }
    if (!isDbReady()) {
      res.setHeader('Retry-After', '30');
      return res.status(503).json({ ok: false, stored: 'local-only', error: 'Database unavailable' });
    }

    // Preserve the sync identifier so a retry updates the same record.
    const result = await execute(
      { mysql: `INSERT INTO student_data (student_id, name, grade, cls, poem_id, section, payload, sync_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         payload = VALUES(payload),
         name = VALUES(name),
         updated_at = CURRENT_TIMESTAMP`,
        postgres: `INSERT INTO student_data (student_id, name, grade, cls, poem_id, section, payload, sync_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (sync_id) DO UPDATE SET
          payload = EXCLUDED.payload,
          name = EXCLUDED.name,
          updated_at = CURRENT_TIMESTAMP
        WHERE student_data.student_id = EXCLUDED.student_id
          AND student_data.grade = EXCLUDED.grade AND student_data.cls = EXCLUDED.cls
          AND student_data.poem_id = EXCLUDED.poem_id AND student_data.section = EXCLUDED.section`
      },
      [studentId, name, grade, cls.toUpperCase(), poemId, section, payloadJson, syncId || null]
    );

    if (result === false || result?.rowCount === 0) {
      res.setHeader('Retry-After', '30');
      return res.status(503).json({ ok: false, stored: 'local-only', dbError: true });
    }

    return res.status(200).json({ ok: true, stored: 'db' });
  } catch (err) {
    res.setHeader('Retry-After', '30');
    return res.status(503).json({ ok: false, stored: 'local-only', error: 'Unable to save data' });
  }
}
