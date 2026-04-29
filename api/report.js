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

  const prompt = `你是一位專業的普通話語音教師，正在為香港小學四年級學生撰寫朗讀診斷報告。

學生剛朗讀了唐詩《${poem || '楓橋夜泊'}》，以下是AI語音評測的數據：

總分：${soeResult.total_score}/100（等第：${soeResult.grade}）
聲韻準確度：${soeResult.dimensions.phone_score}
聲調準確度：${soeResult.dimensions.tone_score}
流暢度：${soeResult.dimensions.fluency_score}
完整度：${soeResult.dimensions.integrity_score}

逐字評分：${wordDetail}

請用繁體中文撰寫一份詳細的診斷報告，包含：
1. 整體表現評價（2-3句）
2. 聲母韻母分析：哪些字的聲母或韻母發音有問題，具體是什麼問題
3. 聲調分析：哪些字的聲調不準確，正確聲調是什麼，學生可能的偏誤模式
4. 流暢度與節奏分析
5. 具體改進建議（針對每個問題字給出練習方法）
6. 鼓勵語（適合小學生的正面鼓勵）

語氣要專業但親切，適合給家長和老師看。不要用markdown格式，用純文字。`;

  const payload = JSON.stringify({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1500
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
