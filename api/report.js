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

  const badList = (soeResult.words || []).filter(w => w.status !== 'ok');
  const topBad = badList.slice(0, 8);
  const topBadStr = topBad.map(w => {
    let s = `${w.c}(${w.p}) ${w.score}分 ${w.error || '偏誤'}`;
    if (w.phones && w.phones.length > 0) {
      s += ' [' + w.phones.map(p => `${p.phone}:${p.score}`).join(',') + ']';
    }
    return s;
  }).join('\n');

  const prompt = `你是普通話語音教師，為香港小四學生寫簡短朗讀診斷報告。
學生朗讀唐詩《${poem || '楓橋夜泊'}》，AI評測數據如下：
總分${soeResult.total_score}/100（${soeResult.grade}），聲韻${soeResult.dimensions.phone_score}，聲調${soeResult.dimensions.tone_score}，流暢度${soeResult.dimensions.fluency_score}，完整度${soeResult.dimensions.integrity_score}。

需要改進的字（最多列出8個最差的）：
${topBadStr || '全部正確，無需改進'}

重要規則：
- 音素詳情僅供你判斷問題類型，不要在報告中顯示原始編碼
- 用帶聲調拼音標注正確讀法（如 shuāng、luò）
- 報告必須簡短精煉，總字數控制在300字以內

用繁體中文寫診斷報告，結構如下：
1. 整體評價（2句話）
2. 問題分析與練習（合併為一段，每個問題字用一句話說明問題+練習方法，不要分開兩個部分）
3. 一句鼓勵的話

如果所有字都正確，就寫一段簡短表揚。
語氣親切，適合家長閱讀。純文字，不要用markdown格式，不要用星號或符號標記。`;

  const payload = JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 800,
    thinking: { type: 'disabled' }
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
