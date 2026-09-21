// Temporary student persistence for the Mandarin Vercel bridge. This namespace
// never overlaps the existing speech cache and every object is private.
const crypto = require('node:crypto');
const blob = require('@vercel/blob');

const NAMESPACE = 'mandarin-bridge-v1';
const MAX_RECORD_BYTES = 320 * 1024;
const MAX_CLASS_RECORDS = 600;
const MAX_CLASS_BYTES = 16 * 1024 * 1024;
const MAX_EXPORT_RECORDS = 20000;
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
const SECTIONS = new Set(['reading', 'writing', 'report']);
const mode = () => process.env.STUDENT_STORE === 'blob';
const configured = () => !!process.env.BLOB_READ_WRITE_TOKEN && !!process.env.DATA_READ_TOKEN;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const classPrefix = (grade, cls, poemId) => `${NAMESPACE}/class/${grade}/${cls}/poem/${poemId}/`;
const recordPath = record => `${classPrefix(record.grade, record.cls, record.poem_id)}${hash(record.student_id)}/${record.section}.json`;

function validRecord(record) {
  return !!record && record.version === 1 && typeof record.student_id === 'string' &&
    !!record.student_id.trim() && record.student_id.length <= 32 &&
    typeof record.name === 'string' && record.name.length <= 64 &&
    Number.isInteger(record.grade) && record.grade >= 1 && record.grade <= 6 &&
    typeof record.cls === 'string' && /^[A-Z]$/.test(record.cls) &&
    Number.isInteger(record.poem_id) && record.poem_id >= 1 && record.poem_id <= 6 &&
    SECTIONS.has(record.section) && !!record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) &&
    typeof record.sync_id === 'string' && record.sync_id.length > 0 && record.sync_id.length <= 64 &&
    typeof record.source_at === 'string' && Number.isFinite(Date.parse(record.source_at)) &&
    typeof record.updated_at === 'string' && record.updated_at === record.source_at &&
    typeof record.stored_at === 'string' && Number.isFinite(Date.parse(record.stored_at)) &&
    Buffer.byteLength(JSON.stringify(record)) <= MAX_RECORD_BYTES;
}

function sourceTime(input, now) {
  const value = Number.isFinite(input.queuedAt) ? input.queuedAt : Date.parse(input.payload?.updatedAt);
  // A broken device clock must not permanently outrank all subsequent saves.
  return Number.isFinite(value) && value > 0 && value <= now + 300000 ? value : now;
}

function makeRecord(input, now = Date.now()) {
  const at = new Date(sourceTime(input, now)).toISOString();
  const record = {
    version: 1, student_id: input.studentId, name: input.name || '', grade: input.grade,
    cls: input.cls.toUpperCase(), poem_id: input.poemId, section: input.section,
    payload: input.payload, source_at: at, updated_at: at,
    stored_at: new Date(now).toISOString(),
    sync_id: input.syncId || hash(JSON.stringify([input.studentId, input.grade, input.cls, input.poemId, input.section, at, input.payload]))
  };
  if (!validRecord(record)) throw new Error('Invalid student record');
  return record;
}

function newerThan(left, right) {
  const timeDifference = Date.parse(left.source_at) - Date.parse(right.source_at);
  return timeDifference ? timeDifference > 0 : left.sync_id > right.sync_id;
}

function createStudentStore({ client = blob, now = Date.now } = {}) {
  async function read(pathname, signal) {
    const response = await client.get(pathname, { access: 'private', useCache: false, abortSignal: signal });
    if (!response) return null;
    if (response.statusCode !== 200 || !response.stream || response.blob.size > MAX_RECORD_BYTES || !response.blob.etag) {
      await response.stream?.cancel();
      throw new Error('Student record unavailable');
    }
    const reader = response.stream.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RECORD_BYTES) throw new Error('Student record too large');
        chunks.push(Buffer.from(part.value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!validRecord(record) || recordPath(record) !== pathname) throw new Error('Invalid stored record');
    return { record, etag: response.blob.etag, size };
  }

  async function save(input) {
    const submitted = makeRecord(input, now());
    let record = submitted;
    const pathname = recordPath(record);
    const signal = AbortSignal.timeout(7500);
    for (let attempt = 0; attempt < 4; attempt++) {
      signal.throwIfAborted();
      const existing = await read(pathname, signal);
      if (existing?.record.sync_id === submitted.sync_id) return;
      const stale = existing && !newerThan(submitted, existing.record);
      if (stale && submitted.section !== 'reading') return;
      record = stale ? {...existing.record} : {...submitted};
      if (existing && record.section === 'reading') {
        record.payload = await require('./practice-progress.cjs').mergePracticePayload(record.payload, stale ? submitted.payload : existing.record.payload, record.poem_id);
        if (stale && JSON.stringify(record.payload) === JSON.stringify(existing.record.payload)) return;
      }
      if (!validRecord(record)) throw new Error('Invalid merged student record');
      try {
        await client.put(pathname, JSON.stringify(record), {
          access: 'private', addRandomSuffix: false, allowOverwrite: !!existing,
          ...(existing ? { ifMatch: existing.etag } : {}),
          contentType: 'application/json', cacheControlMaxAge: 60, abortSignal: signal
        });
        return;
      } catch (error) {
        // Create races and stale ETags both mean re-read the winning version.
        if (!(error instanceof blob.BlobPreconditionFailedError) &&
            !/already exists/i.test(String(error?.message || ''))) throw error;
      }
    }
    throw new Error('Concurrent student save; retry later');
  }

  async function readPrefix(prefix, { maxRecords, maxBytes, timeoutMs }) {
    const signal = AbortSignal.timeout(timeoutMs);
    const objects = [], paths = new Set(), cursors = new Set();
    let cursor;
    do {
      signal.throwIfAborted();
      const result = await client.list({ prefix, limit: 200, cursor, abortSignal: signal });
      if (!result || !Array.isArray(result.blobs)) throw new Error('Invalid student listing');
      for (const item of result.blobs) {
        if (typeof item.pathname !== 'string' || !item.pathname.startsWith(prefix) ||
            !new RegExp(`^${NAMESPACE}/class/[1-6]/[A-Z]/poem/[1-6]/[a-f0-9]{64}/(?:reading|writing|report)\\.json$`).test(item.pathname) ||
            !Number.isFinite(item.size) || item.size < 1 || item.size > MAX_RECORD_BYTES || paths.has(item.pathname)) {
          throw new Error('Invalid student listing item');
        }
        objects.push(item); paths.add(item.pathname);
        if (objects.length > maxRecords) throw new Error('Student listing limit exceeded');
      }
      cursor = result.hasMore ? result.cursor : undefined;
      if (result.hasMore && (typeof cursor !== 'string' || !cursor || cursors.has(cursor))) throw new Error('Invalid student listing cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (objects.reduce((total, item) => total + item.size, 0) > maxBytes) throw new Error('Student data size limit exceeded');
    const records = new Array(objects.length); let next = 0, bytes = 0;
    async function worker() {
      while (next < objects.length) {
        const index = next++;
        const result = await read(objects[index].pathname, signal);
        if (!result) throw new Error('Student record disappeared; retry');
        bytes += result.size;
        if (bytes > maxBytes) throw new Error('Student data size limit exceeded');
        records[index] = result.record;
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, objects.length) }, worker));
    return records;
  }

  async function readClass(grade, cls, poemId) {
    if (!Number.isInteger(grade) || grade < 1 || grade > 6 || !/^[A-Z]$/.test(cls) ||
        !Number.isInteger(poemId) || poemId < 1 || poemId > 6) throw new Error('Invalid class');
    const records = await readPrefix(classPrefix(grade, cls, poemId), {
      maxRecords: MAX_CLASS_RECORDS, maxBytes: MAX_CLASS_BYTES, timeoutMs: 11500
    });
    return records.sort((a, b) => a.student_id.localeCompare(b.student_id) ||
      a.section.localeCompare(b.section) || Date.parse(b.source_at) - Date.parse(a.source_at));
  }

  async function exportRecords() {
    return readPrefix(`${NAMESPACE}/class/`, {
      maxRecords: MAX_EXPORT_RECORDS, maxBytes: MAX_EXPORT_BYTES, timeoutMs: 180000
    });
  }
  return { save, readClass, exportRecords };
}

module.exports = { NAMESPACE, MAX_RECORD_BYTES, MAX_CLASS_RECORDS, MAX_CLASS_BYTES,
  MAX_EXPORT_RECORDS, MAX_EXPORT_BYTES, mode, configured, validRecord, recordPath,
  makeRecord, newerThan, createStudentStore, ...createStudentStore() };
