const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { soeResult, poem } = req.body || {};
  if (!soeResult) return res.status(400).json({ error: 'Missing soeResult' });

  const apiKey = process.env.GPT_API_KEY;
  const apiBase = process.env.GPT_API_BASE;
  if (!apiKey || !apiBase) return res.status(500).json({ error: 'GPT API not configured' });

  const wordDetail = (soeResult.words || []).map(w =>
    `${w.c}(${w.p}) ${w.score}分 ${w.status === 'ok' ? '正確' : w.error || '偏誤'}`
  ).join('、');

  const prompt = `你是普通話語音教師，為香港小四學生寫朗讀診斷。
學生朗讀唐詩《${poem || '楓橋夜泊'}》：
總分${soeResult.total_score}/100（${soeResult.grade}），聲韻${soeResult.dimensions.phone_score}，聲調${soeResult.dimensions.tone_score}，流暢度${soeResult.dimensions.fluency_score}，完整度${soeResult.dimensions.integrity_score}。
逐字：${wordDetail}

用繁體中文寫診斷報告（200字內），包含：
1. 整體評價（1句）
2. 哪些字發音有問題，具體什麼問題
3. 針對每個問題字的練習建議
4. 一句鼓勵語
語氣親切專業，純文字不要markdown。`;

  const payload = JSON.stringify({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 800
  });

  return new Promise((resolve) => {
    const url = new URL(apiBase);
    const reqOpts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: (url.pathname === '/' ? '' : url.pathname) + '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.from(payload).length
      }
    };

    const apiReq = https.request(reqOpts, (apiRes) => {
      let body = '';
      apiRes.on('data', chunk => body += chunk);
      apiRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          const report = data.choices?.[0]?.message?.content || '';
          res.status(200).json({ report });
        } catch (e) {
          res.status(502).json({ error: 'Invalid GPT response', detail: body.slice(0, 300) });
        }
        resolve();
      });
    });

    apiReq.on('error', (e) => {
      res.status(502).json({ error: e.message });
      resolve();
    });

    apiReq.setTimeout(30000, () => {
      apiReq.destroy();
      res.status(504).json({ error: 'GPT timeout' });
      resolve();
    });

    apiReq.write(payload);
    apiReq.end();
  });
};
