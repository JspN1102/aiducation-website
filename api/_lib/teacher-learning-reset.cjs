'use strict';
const crypto = require('node:crypto');
const auth = require('./school-auth.cjs');
const INITIAL = 'initial';
const validEpoch = value => value === INITIAL || typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

// A reset changes only this teacher's private practice namespace. Historical
// generations remain intact; late writes to them cannot resurrect new progress.
function createTeacherLearning({ service = auth, store = () => service.getStore(), now = Date.now } = {}) {
  const fail = (status, code) => { throw new auth.AuthError(status, code); };
  function key(actor) {
    if (actor?.role !== 'teacher' || !/^t_[a-f0-9]{24}$/.test(actor.id)) fail(403, 'ROLE_FORBIDDEN');
    return 'learning/' + actor.id;
  }
  async function read(actor) {
    const row = await store().get(key(actor));
    if (row && (!row.value || row.value.version !== 1 || row.value.actorId !== actor.id ||
      !validEpoch(row.value.epoch) || row.value.epoch === INITIAL || !validEpoch(row.value.previousEpoch) ||
      !/^[a-f0-9-]{36}$/.test(row.value.requestId) || !Number.isFinite(Date.parse(row.value.resetAt)))) throw new Error('Invalid learning generation');
    return row;
  }
  function storageId(actor, epoch) {
    return epoch === INITIAL ? actor.id : 'v_' + crypto.createHash('sha256').update(actor.id + ':' + epoch).digest('hex').slice(0, 28);
  }
  async function scope(actor, options = {}) {
    if (actor.role !== 'teacher') return { studentId: actor.id };
    const row = await read(actor), learningEpoch = row?.value.epoch || INITIAL;
    // Old clients may save generation zero only. After reset they must reload.
    if (options.forSave && (options.learningEpoch ?? INITIAL) !== learningEpoch) fail(409, 'LEARNING_RESET');
    return { studentId: storageId(actor, learningEpoch), learningEpoch };
  }
  async function withState(state) {
    if (!state.authenticated || state.user?.role !== 'teacher') return state;
    const { learningEpoch } = await scope(state.user);
    return { ...state, learningEpoch };
  }
  async function reset(req) {
    const actor = await service.requireActor(req, { roles: ['teacher'], csrf: true });
    key(actor);
    const body = req.body;
    if (!body || Array.isArray(body) || body.action !== 'reset_my_progress' || body.confirm !== true ||
      !validEpoch(body.learningEpoch) || typeof body.requestId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.requestId) ||
      Object.keys(body).some(field => !['action', 'confirm', 'learningEpoch', 'requestId'].includes(field))) fail(400, 'INVALID_REQUEST');
    const receipt = value => ({ ok: true, userId: actor.id, learningEpoch: value.epoch, resetAt: value.resetAt });
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await read(actor), previousEpoch = row?.value.epoch || INITIAL;
      if (row?.value.requestId === body.requestId && row.value.previousEpoch === body.learningEpoch) return receipt(row.value);
      if (previousEpoch !== body.learningEpoch) fail(409, 'LEARNING_RESET');
      const value = { version: 1, actorId: actor.id, epoch: crypto.randomBytes(16).toString('hex'), previousEpoch,
        requestId: body.requestId, resetAt: new Date(now()).toISOString() };
      try { await store().cas(key(actor), value, row?.version); return receipt(value); }
      catch (error) { if (!(error instanceof auth.Conflict)) throw error; }
    }
    fail(409, 'LEARNING_RESET');
  }
  return { scope, withState, reset };
}
module.exports = { INITIAL, validEpoch, createTeacherLearning, ...createTeacherLearning() };
