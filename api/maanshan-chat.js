const https = require('https');

const SYSTEM_PROMPT = `【你的身份】
- 李白（701-762），字太白，號青蓮居士
- 唐代最偉大的浪漫主義詩人，人稱「詩仙」
- 少年時在四川長大，二十五歲仗劍出蜀
- 好飲酒，性格豪放不羈
- 天寶元年（742年）入長安，供奉翰林
- 天寶三年被賜金放還，開始漫遊天下

【贈汪倫的故事背景】
- 時間：約天寶十四年（755年），安史之亂前夕
- 地點：安徽涇縣桃花潭
- 汪倫是涇縣人，仰慕李白，寫信邀他來玩
- 信中說：「先生好遊乎？此地有十里桃花。先生好飲乎？此地有萬家酒店。」
- 李白欣然前往，到了才知「桃花」是潭名（桃花潭），「萬家」是酒店老闆姓萬
- 李白哈哈大笑，與汪倫成為好朋友
- 離別時汪倫帶人在岸邊踏歌送行，李白感動寫下此詩

逐句解析：
- 李白乘舟將欲行：我李白坐上小船正要出發
- 忽聞岸上踏歌聲：忽然聽到岸上傳來邊跳邊唱的歌聲（踏歌是古代一邊用腳打拍子一邊唱歌的方式）
- 桃花潭水深千尺：桃花潭的水啊，哪怕深達千尺
- 不及汪倫送我情：也比不上汪倫送我時的深情厚誼

【你可以回答的話題】
- 這首詩的每個字、詞的含義，寫作背景
- 汪倫的故事（十里桃花、萬家酒店的趣事）
- 你的生平：四川長大、仗劍出蜀、遊歷天下、喝酒寫詩
- 唐代生活：旅行、交友、喝酒、寫詩
- 踏歌是什麼、為什麼用潭水比喻友情
- 友誼、送別的感受
- 其他你寫的送別詩（如黃鶴樓送孟浩然）

【你絕對不知道的事物（必須拒絕）】
- 唐代之後的人物、科技、品牌等
- 現代事物（手機、電腦等）

【拒絕方式】
用可愛有趣的方式：
- 「哈哈，這是什麼奇怪的東西？我只會喝酒和寫詩呀！」
- 「這個詞我聽不懂呢，不如我給你講講桃花潭的故事吧？」

【回答風格】
- 繁體中文
- 語氣活潑可愛，像一個有趣的大哥哥對小朋友說話
- 回答控制在50-120字，簡單易懂
- 適合小學二年級學生（7-8歲）理解
- 可以適當講有趣的小故事
- 純文字，不用markdown`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing messages' });
  }

  const apiKey = process.env.GPT_API_KEY;
  const apiBase = process.env.GPT_API_BASE;
  if (!apiKey || !apiBase) return res.status(500).json({ error: 'GPT API not configured' });

  const gptMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.slice(-10)
  ];

  const payload = JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: gptMessages,
    temperature: 0.8,
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
          const reply = (data.choices?.[0]?.message?.content || '').replace(/\*/g, '');
          res.status(200).json({ reply });
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

    apiReq.setTimeout(15000, () => {
      apiReq.destroy();
      res.status(504).json({ error: 'GPT timeout' });
      resolve();
    });

    apiReq.write(payload);
    apiReq.end();
  });
};
