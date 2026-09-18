const https = require('https');
const { poems } = require('../../maanshan/poems.json');
const teachingNotes = {
  6: '「酥」在本詩指用牛羊乳製成的酥油，取其細膩、潤澤來比喻初春細雨。解釋「潤如酥」的重點是雨絲細密柔和、滋潤大地，並非說街道像油一樣滑。「路滑」「踩起來滑」「不泥濘」都不是本詩的字詞意思，也不能用這些想像代替詞義解釋。'
};

function getPoem(poemId, defaultId = 2) {
  const id = poemId === undefined ? defaultId : poemId;
  return Number.isInteger(id) ? poems.find(poem => poem.id === id) || null : null;
}

function poemContext(poem) {
  const lines = poem.lines.map(line => `${line.text}${line.punctuation || ''} (${line.pinyin.join(' ')})`);
  return [
    `篇目：《${poem.title}》`,
    `作者：${poem.dynasty}代${poem.author}`,
    `作者資料：${poem.authorBio}`,
    `詩意：${poem.description}`,
    `主題：${poem.theme}`,
    ...(teachingNotes[poem.id] ? [`字詞教學參考：${teachingNotes[poem.id]}`] : []),
    ...lines
  ].join('\n');
}

function requestPoemText(res, messages, { field, temperature, timeoutMs, maxTokens }) {
  const apiKey = process.env.GPT_API_KEY;
  const apiBase = process.env.GPT_API_BASE;
  if (!apiKey || !apiBase) return res.status(500).json({ error: 'GPT API not configured' });

  let url;
  try {
    url = new URL(apiBase);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
  } catch (_) {
    return res.status(500).json({ error: 'Invalid GPT API configuration' });
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  const path = basePath.endsWith('/v1') ? basePath + '/chat/completions' : basePath + '/v1/chat/completions';
  const payload = JSON.stringify({
    model: 'deepseek-flash',
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    thinking: { type: 'disabled' }
  });

  return new Promise(resolve => {
    let settled = false;
    let apiReq;
    let timer;
    const finish = (status, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.status(status).json(body);
      resolve();
    };
    timer = setTimeout(() => {
      finish(504, { error: 'GPT timeout' });
      if (apiReq) apiReq.destroy();
    }, timeoutMs);

    try {
      apiReq = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
          'Content-Length': Buffer.byteLength(payload)
        }
      }, apiRes => {
        const chunks = [];
        let bytes = 0;
        apiRes.on('data', chunk => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > 512 * 1024) {
            finish(502, { error: 'GPT response too large' });
            apiReq.destroy();
            return;
          }
          chunks.push(chunk);
        });
        apiRes.on('end', () => {
          if (settled) return;
          if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
            finish(502, { error: 'GPT service unavailable' });
            return;
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const content = data.choices?.[0]?.message?.content;
            const text = typeof content === 'string' ? content.replace(/\*/g, '').trim() : '';
            if (!text || data.error) throw new Error();
            finish(200, { [field]: text });
          } catch (_) {
            finish(502, { error: 'Invalid or empty GPT response' });
          }
        });
        apiRes.on('aborted', () => finish(502, { error: 'GPT response interrupted' }));
        apiRes.on('error', () => finish(502, { error: 'GPT response failed' }));
      });
      apiReq.on('error', () => finish(502, { error: 'GPT request failed' }));
      apiReq.end(payload);
    } catch (_) {
      finish(502, { error: 'GPT request failed' });
      if (apiReq) apiReq.destroy();
    }
  });
}

module.exports = { getPoem, poemContext, requestPoemText };
