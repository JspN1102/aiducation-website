'use strict';

// A single function keeps the school deployment within its current plan.
// Each internal handler enforces teacher permissions and CSRF independently.
const analysis = require('./_lib/teacher-assistant-handler.cjs');
const documentExport = require('./_lib/teacher-export-handler.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const tool = req.query?.tool;
  if (!['analysis', 'export'].includes(tool)) {
    return res.status(400).json({ ok: false, code: 'INVALID_TEACHER_TOOL', error: '請使用教師後台的匯出或分析按鈕。' });
  }
  // Internal handlers validate their own query contract without routing keys.
  req.query = Object.fromEntries(Object.entries(req.query || {}).filter(([key]) => key !== 'tool'));
  return (tool === 'analysis' ? analysis : documentExport)(req, res);
};
