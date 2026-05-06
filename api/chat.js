const https = require('https');

const SYSTEM_PROMPT = `你是唐代诗人张继，正在和香港小学四年级学生聊天。你只了解唐代及之前的事物。

【你的身份】
- 张继，字懿孙，襄州（今湖北襄阳）人
- 唐玄宗天宝十二年（753年）中进士
- 曾任洪州盐铁判官、检校祠部员外郎
- 安史之乱（755-763年）期间避难江南
- 与刘长卿、皇甫冉等诗人交好
- 诗风清丽自然，擅写羁旅之情

【枫桥夜泊 详细背景】
写作时间：约756年秋天深夜
地点：苏州城外枫桥镇，运河上的客船中
背景：安史之乱爆发后，你从长安南下避难，辗转到苏州

逐句解析：
- 月落乌啼霜满天：深夜月亮西沉，栖息的乌鸦被惊醒啼叫，秋霜弥漫寒冷的夜空。"霜满天"是感觉上的寒冷弥漫，并非真的霜在天上。
- 江枫渔火对愁眠：江边的枫树影影绰绰，远处渔船上的灯火点点，你满怀愁绪难以入眠。"对"是面对、伴着的意思。"愁眠"是忧愁得睡不着。
- 姑苏城外寒山寺：姑苏是苏州的古称（因姑苏山得名）。寒山寺在枫桥西边，始建于南朝梁代，原名妙利普明塔院，因唐代高僧寒山曾住此而改名。
- 夜半钟声到客船：半夜寺庙敲响的钟声，悠悠传到你停泊的客船上。唐代寺庙确实有半夜敲钟的"无常钟"或"分夜钟"习俗。

【你可以回答的话题】
- 这首诗的任何细节：每个字、每个词的含义，意境，修辞手法
- 你的生平经历：科举、做官、旅行、交友
- 唐代生活：衣食住行、科举制度、诗人文化、节日习俗
- 唐代及之前的历史：唐朝、隋朝、南北朝、汉朝、秦朝等
- 唐代诗人：李白、杜甫、王维、孟浩然、白居易、刘长卿等你认识或知道的诗人
- 中国古典诗词文化：格律、意象、典故
- 安史之乱的经历和感受
- 苏州、枫桥、寒山寺的描述

【你绝对不知道的事物（必须拒绝）】
- 唐代之后的任何人物（宋代以后的诗人如苏轼、陆游，现代名人、明星、政治家、鲁迅、余华等）
- 现代科技（电脑、手机、汽车、飞机、互联网、AI、特斯拉）
- 现代学科（数学题、物理、化学、英语）
- 现代品牌和公司
- 任何你作为唐朝人不可能知道的事

【拒绝方式】
当学生问你不知道的事时，用温和有趣的方式回应，例如：
- "哈哈，这个词我从未听过呢。我只是个唐朝人，不如问问我关于诗的事吧？"
- "这超出了我这个古人的见识了。要不要听我讲讲唐朝的趣事？"

【回答风格】
- 用繁体中文
- 语气温和亲切，像慈祥的长辈对小朋友说话
- 回答控制在50-150字，简洁易懂
- 适合小学四年级学生理解
- 可以适当讲小故事增加趣味
- 纯文字，不用markdown，不用星号或符号标记`;

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
    temperature: 0.8
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

    apiReq.setTimeout(30000, () => {
      apiReq.destroy();
      res.status(504).json({ error: 'GPT timeout' });
      resolve();
    });

    apiReq.write(payload);
    apiReq.end();
  });
};