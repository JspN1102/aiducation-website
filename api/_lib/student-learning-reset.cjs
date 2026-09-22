'use strict';
const crypto = require('node:crypto');
const KEY = 'learning/student-cohort';
const validEpoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

// Callers reading a whole roster resolve its generation once, then map identities
// without another database read for every student.
function storageId(actor, cohort) {
  if (actor?.role !== 'student' || !cohort) return actor?.id;
  return 'v_' + crypto.createHash('sha256').update(actor.id + ':' + cohort.epoch).digest('hex').slice(0,28);
}

// The current pointer selects a fresh namespace. Historical progress, audio and
// append-only research records are retained for the owner, never overwritten.
function createStudentLearning({store, enabled} = {}) {
  const auth = () => require('./school-auth.cjs');
  const available = enabled || (() => auth().enabled());
  const storage = store || (() => auth().getStore());
  async function current() {
    if (!available()) return null;
    const row = await storage().get(KEY);
    if (!row) return null;
    const value = row.value;
    if (!value || value.version !== 1 || value.role !== 'student' || !validEpoch(value.epoch) ||
        !(value.previousEpoch === null || validEpoch(value.previousEpoch)) ||
        typeof value.resetAt !== 'string' || !Number.isFinite(Date.parse(value.resetAt))) {
      throw new Error('Invalid student learning generation');
    }
    return value;
  }
  async function scope(actor, options = {}) {
    if (actor?.role !== 'student') return {studentId: actor?.id};
    const cohort = await current();
    if (!cohort) return {studentId: actor.id};
    if (options.forSave && options.learningEpoch !== cohort.epoch) throw new (auth().AuthError)(409, 'LEARNING_RESET');
    return {studentId:storageId(actor, cohort), learningEpoch:cohort.epoch};
  }
  async function requireEpoch(req, actor) {
    if (actor?.role !== 'student' || ['GET','HEAD','OPTIONS'].includes(req.method)) return;
    // Browser queues also send this header; old queued body values must not be
    // silently upgraded by a newer transport after a cohort switch.
    const epoch = req.headers?.['x-learning-epoch'];
    const bodyEpoch = req.body?.learningEpoch;
    if (bodyEpoch !== undefined && epoch !== undefined && bodyEpoch !== epoch) throw new (auth().AuthError)(409, 'LEARNING_RESET');
    await scope(actor, {forSave:true, learningEpoch:epoch ?? bodyEpoch});
  }
  return {current, scope, requireEpoch};
}
module.exports = {KEY, validEpoch, storageId, createStudentLearning, ...createStudentLearning()};
