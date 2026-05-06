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
  const topBad = badList.slice(0, 7);
  const topBadStr = topBad.map(w => {
    let s = `${w.c}(${w.p}) ${w.score}分 ${w.error || '偏誤'}`;
    if (w.phones && w.phones.length > 0) {
      s += ' [' + w.phones.map(p => `${p.phone}:${p.score}`).join(',') + ']';
    }
    return s;
  }).join('\n');

  const prompt = `你是普通話語音教師，為香港小四學生寫朗讀診斷報告。報告的讀者是學生本人（9-10歲小朋友）。
學生朗讀唐詩《${poem || '楓橋夜泊'}》，AI評測數據如下：
總分${soeResult.total_score}/100（${soeResult.grade}），聲韻${soeResult.dimensions.phone_score}，聲調${soeResult.dimensions.tone_score}，流暢度${soeResult.dimensions.fluency_score}，完整度${soeResult.dimensions.integrity_score}。

需要改進的字：
${topBadStr || '全部正確，無需改進'}

重要規則：
- 音素詳情僅供你判斷問題類型（聲母/韻母/聲調），不要在報告中顯示原始編碼
- 用帶聲調拼音標注正確讀法（如 shuāng、luò）
- 語氣像老師對小朋友說話，親切有趣，用「你」稱呼學生

用繁體中文寫診斷報告，結構如下：
1. 整體評價（先表揚做得好的地方，再溫和指出需要加油的方向）
2. 逐字分析與練習：每個問題字說明是聲母、韻母還是聲調問題，給出正確讀法，然後直接附上練習方法（跟讀詞語、對比練習等），不要把分析和練習分成兩個獨立部分
3. 用一段溫暖有趣的話鼓勵學生繼續努力

如果所有字都正確，就寫一段開心的表揚，告訴學生哪裡特別棒。
純文字，不要用markdown格式，不要用星號或符號標記。`;

  const payload = JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
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
