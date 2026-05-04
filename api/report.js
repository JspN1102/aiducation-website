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
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    stream: true
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

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
      let buf = '';
      apiRes.on('data', chunk => {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              const clean = content.replace(/\*/g, '');
              res.write(`data: ${JSON.stringify({ t: clean })}\n\n`);
            }
          } catch (_) {}
        }
      });
      apiRes.on('end', () => {
        res.end();
        resolve();
      });
    });

    apiReq.on('error', (e) => {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
      resolve();
    });

    apiReq.setTimeout(30000, () => {
      apiReq.destroy();
      res.write(`data: ${JSON.stringify({ error: 'timeout' })}\n\n`);
      res.end();
      resolve();
    });

    apiReq.write(payload);
    apiReq.end();
  });
};
