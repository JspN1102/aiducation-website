const { getPoem, poemContext, requestPoemText } = require('./_lib/poems.js');

function isScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 128 * 1024) {
    return res.status(413).json({ error: 'Request too large' });
  }
  const poem = getPoem(body.poemId);
  if (!poem) return res.status(400).json({ error: 'Invalid poemId' });
  const { soeResult } = body;
  if (!soeResult || typeof soeResult !== 'object' || Array.isArray(soeResult) || !isScore(soeResult.total_score)) {
    return res.status(400).json({ error: 'Invalid soeResult or total_score' });
  }
  const dimensions = soeResult.dimensions === undefined ? {} : soeResult.dimensions;
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) {
    return res.status(400).json({ error: 'Invalid dimensions' });
  }
  const measured = { total_score: soeResult.total_score };
  for (const key of ['phone_score', 'fluency_score', 'integrity_score']) {
    if (dimensions[key] === undefined || dimensions[key] === null) continue;
    if (!isScore(dimensions[key])) return res.status(400).json({ error: 'Invalid dimension score' });
    measured[key] = dimensions[key];
  }
  const words = soeResult.words === undefined ? [] : soeResult.words;
  if (!Array.isArray(words) || words.length > 128 || words.some(word =>
    !word || typeof word !== 'object' || typeof word.c !== 'string' || !word.c ||
    word.c.length > 16 || !isScore(word.score) ||
    (word.status !== undefined && (typeof word.status !== 'string' || word.status.length > 32)))) {
    return res.status(400).json({ error: 'Invalid word scores' });
  }

  const readings = new Map();
  for (const line of poem.lines) {
    for (const text of [line.text, line.simplified]) {
      Array.from(text).forEach((char, index) => {
        if (!readings.has(char)) readings.set(char, new Set());
        readings.get(char).add(line.pinyin[index]);
      });
    }
  }
  if (words.some(word => Array.from(word.c).some(char => !readings.has(char)))) {
    return res.status(400).json({ error: 'Word scores do not match selected poem' });
  }
  const practiceWords = words.filter(word => word.status !== 'ok' || word.score < 80).slice(0, 7).map(word => ({
    character: word.c,
    referencePinyin: Array.from(word.c).map(char => [...readings.get(char)].join('/')).join(' '),
    score: word.score
  }));

  const system = `你是香港小學普通話教師，為${poem.grade}年級學生（約${poem.grade + 5}-${poem.grade + 6}歲）寫《${poem.title}》的朗讀練習報告。
${poemContext(poem)}

只依據提供的評測數據，缺失欄位視為未提供，0分須保留。total_score是總分，phone_score是發音準確度，fluency_score是流暢度，integrity_score是完整度，單位均為0-100分。
本評測沒有提供獨立聲調分數。不得推算、編造或引用獨立聲調分數，不得僅憑字級低分就斷言聲母、韻母或聲調錯誤。
字級分數只作為練習線索。引用原詩中的字及已提供的帶聲調參考拼音，安排跟讀、慢讀、分句朗讀等可實行的練習，不能編造學生實際讀出的音。
使用繁體中文，直接以「你」稱呼學生；${poem.grade <= 2 ? '用短句和簡單有趣的例子，適合低年級閱讀。' : poem.grade <= 4 ? '用清楚親切的語言，解釋練習目的。' : '尊重高年級學生，可以結合停頓、節奏和詩意。'}
結構為整體表現、逐字練習、下一步鼓勵。表揚須符合分數；沒有字級資料時說明無法逐字判斷，不能宣稱全部正確。
只圍繞${poem.author}和本詩，不要把其他作者的生平或詩句套入。純文字，不使用Markdown。`;

  return requestPoemText(res, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ measured, wordCount: words.length, practiceWords }) }
  ], { field: 'report', temperature: 0.7, timeoutMs: 30000, maxTokens: 1600 });
};
