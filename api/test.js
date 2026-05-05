module.exports = function handler(req, res) {
  res.status(200).json({
    hasKey: !!process.env.GPT_API_KEY,
    hasBase: !!process.env.GPT_API_BASE,
    baseLen: (process.env.GPT_API_BASE || '').length,
    keyPrefix: (process.env.GPT_API_KEY || '').slice(0, 6),
    nodeVersion: process.version
  });
};
