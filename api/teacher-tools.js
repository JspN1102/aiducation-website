'use strict';

// A single function keeps the school deployment within its current plan.
// Each internal handler enforces teacher permissions and CSRF independently.
const analysis = require('./_lib/teacher-assistant-handler.cjs');
const documentExport = require('./_lib/teacher-export-handler.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const tool = req.query?.tool;
  if (!['analysis', 'export', 'demo-analysis', 'demo-export', 'demo-data', 'site-status', 'activity-log', 'reading-log'].includes(tool)) {
    return res.status(400).json({ ok: false, code: 'INVALID_TEACHER_TOOL', error: '請使用教師後台的匯出或分析按鈕。' });
  }
  // Internal handlers validate their own query contract without routing keys.
  req.query = Object.fromEntries(Object.entries(req.query || {}).filter(([key]) => key !== 'tool'));
  // 網站後台 (site administrator only); loaded on first use.
  if (tool === 'site-status') return require('./_lib/site-monitor-handler.cjs')(req, res);
  if (tool === 'activity-log') return require('./_lib/activity-log-handler.cjs')(req, res);
  // 朗讀測評次數 (jasper and molly).
  if (tool === 'reading-log') return require('./_lib/reading-log-handler.cjs')(req, res);
  if(tool.startsWith('demo-')){
    const demo=require('./_lib/teacher-demo-handler.cjs');
    return (tool==='demo-analysis'?demo.assistant:tool==='demo-export'?demo.exporter:demo.demoData)(req,res);
  }
  return (tool === 'analysis' ? analysis : documentExport)(req, res);
};

// Only the persistent Guangzhou API starts this worker. Public Vercel entry
// points relay requests and never own the lifetime of report generation.
module.exports.startBackgroundWorker = function () {
  require('./_lib/teacher-demo-handler.cjs');
  return require('./_lib/teacher-analysis.cjs').startBackgroundWorker();
};
