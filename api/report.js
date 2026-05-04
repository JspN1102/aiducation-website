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

  const wordDetail = (soeResult.words || []).map(w => {
    let s = `${w.c}(${w.p}) ${w.score}分`;
    if (w.status === 'ok') s += ' 正確';
    else s += ` ${w.error || '偏誤'}`;
    if (w.phones && w.phones.length > 0) {
      s += ' [' + w.phones.map(p => `${p.phone}:${p.score}`).join(',') + ']';
    }
    return s;
  }).join('、');

  const prompt = `你是普通話語音教師，為香港小四學生寫朗讀診斷報告。
學生朗讀唐詩《${poem || '楓橋夜泊'}》，AI評測數據如下：
總分${soeResult.total_score}/100（${soeResult.grade}），聲韻${soeResult.dimensions.phone_score}，聲調${soeResult.dimensions.tone_score}，流暢度${soeResult.dimensions.fluency_score}，完整度${soeResult.dimensions.integrity_score}。
逐字評分（含音素級數據，方括號內為各音素得分）：${wordDetail}

用繁體中文寫約300字的診斷報告，結構如下：
1. 整體評價（2句，概括表現和主要問題方向）
2. 逐字問題分析：列出每個有問題的字，根據音素數據精確指出是聲母、韻母還是聲調問題，正確讀法是什麼
3. 練習建議：針對每個問題字給出具體練習方法（如跟讀詞語、對比練習等）
4. 最後用一句溫暖的話鼓勵學生繼續努力（不要寫"鼓勵語"這個標題，直接寫鼓勵的話）
語氣親切專業，適合家長和老師閱讀。純文字，不要用markdown格式，不要用星號*或任何符號標記。`;

  const payload = JSON.stringify({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
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
      const chunks = [];
      apiRes.on('data', chunk => chunks.push(chunk));
      apiRes.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          const report = (data.choices?.[0]?.message?.content || '').replace(/\*/g, '');
          res.status(200).json({ report });
        } catch (e) {
          const body = Buffer.concat(chunks).toString('utf8');
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
