const { getPoem, poemContext, requestPoemText } = require('./_lib/poems.js');
const pronunciationData = require('../maanshan/pronunciation.json');

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
  if (soeResult.linesCompleted !== undefined && (!Number.isInteger(soeResult.linesCompleted) || soeResult.linesCompleted < 0 || soeResult.linesCompleted > poem.lines.length)) {
    return res.status(400).json({ error: 'Invalid completed line count' });
  }
  const coverage = { completedLines: soeResult.linesCompleted ?? null, totalLines: poem.lines.length };
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
    word.c.length > 16 || (word.score != null && !isScore(word.score)) ||
    (word.lineIndex != null && (!Number.isInteger(word.lineIndex) || word.lineIndex < 0 || word.lineIndex >= poem.lines.length)) ||
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
  let practice;
  try {
    const { getPronunciationPractice } = await import('../maanshan/pronunciation.mjs');
    practice = getPronunciationPractice({ words }, poem, pronunciationData);
  } catch (_) {
    return res.status(500).json({ error: 'Pronunciation practice unavailable' });
  }
  const practiceWords = practice.items.slice(0, 20).map(item => ({
    character: item.char,
    referencePinyin: item.pinyin,
    score: item.score,
    lineText: item.lineText,
    diagnosis: item.issue,
    explanation: item.explanation,
    articulationTip: item.tip,
    articulationDetail: item.articulationDetail,
    evidence: item.evidence,
    phones: item.phones,
    contrasts: item.contrasts.map(({text,pinyin,label}) => ({text,pinyin,label}))
  }));

  const system = `你是香港小學普通話教師，為${poem.grade}年級學生（約${poem.grade + 5}-${poem.grade + 6}歲）寫《${poem.title}》的朗讀練習報告。
${poemContext(poem)}

只依據提供的評測數據，缺失欄位視為未提供，0分須保留。total_score是總分，phone_score是發音準確度，fluency_score是流暢度，integrity_score是完整度，單位均為0-100分。
coverage.completedLines 才是已完成句數，coverage.totalLines 是全詩句數；未提供已完成句數時不可推測。integrity_score 只描述已評測詩句的朗讀完整度，即使100分也不能據此宣稱整首詩已完成。已完成句數少於全詩句數時，明確說明這是部分詩句的建議。
本評測沒有提供獨立的整體聲調分數。不得推算或編造聲調總分。有對應音素證據時，具體指出該聲母、韻母或聲調對應音素的評分偏低；只有字級分數時，說明字音需要改善並提供練習方向，不能把推測當成確定診斷。
逐字分析要包含原字、正確帶調拼音、現有分數、具體的口形或舌位提示，以及兩個已提供的對比詞和拼音。不能只泛泛地說「多練習」，也不能虛構學生實際讀成的字或音。
對比詞都是正確的示範讀音，並非學生的錯讀紀錄。鼓勵學生先聽原句示範與對比詞，再回聽自己的原句錄音。遇到多音字，用已提供的原詩語境解釋正確讀法；注意「一」及第三聲的正常連讀變調。
使用繁體中文的普通話書面語，避免粵語口語詞，直接以「你」稱呼學生；${poem.grade <= 2 ? '用短句和簡單有趣的例子，適合低年級閱讀。' : poem.grade <= 4 ? '用清楚親切的語言，解釋練習目的。' : '尊重高年級學生，可以結合停頓、節奏和詩意。'}
結構為整體表現、逐字診斷與對比練習、下一步鼓勵。只評論提供了資料的部分，表揚須符合分數；unknownWords 是未取得有效逐字分數或無法對應的項目，不能把它們當成零分、錯讀或全部正確。問題字較多時，優先說明分數最低的字，但不要宣稱其餘字沒有問題。
優先詳解分數最低的2至3個字，每字只選兩組對比詞；其他問題字可在頁面的易錯字練習中繼續練習。建議約350至500字，問題較少時更短，不要照抄全部提示或反覆鼓勵。
只圍繞${poem.author}和本詩，不要把其他作者的生平或詩句套入。純文字，不使用Markdown。`;

  return requestPoemText(res, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ coverage, measured, wordCount: words.length, measuredWordCount: practice.assessedCount, unknownWords: practice.unknownWords, practiceWords }) }
  ], { field: 'report', temperature: 0.7, timeoutMs: 30000, maxTokens: 2200 });
};
