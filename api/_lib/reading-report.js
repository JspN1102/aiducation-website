const REPORT_VERSION = 'grade-v3';

// The learner's grade controls the teaching task, not the poem's catalogue grade.
const GRADE_GUIDANCE = {
  1: {
    length: '60至100字', sentenceLimit: 3, maxWords: 1, maxContrasts: 0, maxTokens: 650, paragraphLength: 70,
    sections: { observation: [1, 18], practice: [2, 70] },
    guidance: '一年級：只安排一個小任務，最多練習一個字。用兩個短段落，每句約10至18字。先用一句話說這次的表現，再給「聽這個字、慢慢跟讀兩次」這樣能立即照做的動作。需要時用一個簡單的嘴巴或舌頭提示，不用聲母、韻母、音素、準確度等術語。不列對比詞清單，不講詩的深層意思，也不連續報分數。'
  },
  2: {
    length: '100至150字', sentenceLimit: 4, maxWords: 1, maxContrasts: 1, maxTokens: 850, paragraphLength: 90,
    sections: { observation: [1, 25], practice: [2, 80], selfCheck: [1, 45] },
    guidance: '二年級：選一個字，安排「聽一聽、跟讀、放回短語」三個小動作，用兩至三個短段落。給一個容易模仿的口形提示，可選一個已提供的對比詞並附帶調拼音，說清它是練習示範。用簡單的話提醒句末稍停，不使用音素等術語。不要求獨立分析聲韻母或詩人情感。'
  },
  3: {
    length: '150至220字', sentenceLimit: 6, maxWords: 2, maxContrasts: 1, maxTokens: 1150, paragraphLength: 130,
    sections: { observation: [1, 25], practice: [3, 115], expression: [1, 40], selfCheck: [1, 40] },
    guidance: '三年級：最多選兩個字，每字給一個口形或舌位提示和至多一個已提供的對比詞及帶調拼音。用四個短段落，說清「練哪裡、怎樣練、放回哪個短語」。只有具體音素證據才可說哪個部分評分較低；專有詞出現時立即用簡單的話解釋。加入一個按詩句意思分小段的停頓練習，讓學生試讀一次、再聽一次自己的錄音。'
  },
  4: {
    length: '200至280字', sentenceLimit: 7, maxWords: 2, maxContrasts: 1, maxTokens: 1450, paragraphLength: 155,
    sections: { observation: [1, 30], practice: [3, 135], expression: [1, 50], selfCheck: [2, 65] },
    guidance: '四年級：優先分析兩個字，每字選一個已提供的對比詞及帶調拼音，解釋練習怎樣幫助讀準。用四個短段落，將逐字證據與有提供的流暢度、完整度聯繫起來。選原詩一個短句，示範按意思停頓和一次換氣安排；這是下次可嘗試的讀法，不能宣稱本次停頓出錯。最後給兩個有先後次序、可以自己檢查的練習步驟。'
  },
  5: {
    length: '240至340字', sentenceLimit: 9, maxWords: 3, maxContrasts: 1, maxTokens: 1800, paragraphLength: 175,
    sections: { observation: [1, 35], practice: [4, 155], expression: [2, 70], selfCheck: [2, 80] },
    guidance: '五年級：優先分析兩至三個有證據的字，每字選一個已提供的對比詞及帶調拼音，區分已測到的薄弱部分和仍不能判斷的部分。用四個短段落，除了讀準，結合本詩的一個具體畫面，提出重音、語速或語氣中一項表達練習並解釋理由。給一個可完成的小目標，讓學生比較練習前後同一句的清楚程度；不要保證分數會上升。'
  },
  6: {
    length: '300至420字', sentenceLimit: 10, maxWords: 3, maxContrasts: 1, maxTokens: 2200, paragraphLength: 225,
    sections: { observation: [1, 40], practice: [5, 190], expression: [2, 85], selfCheck: [2, 105] },
    guidance: '六年級：優先分析兩至三個有證據的字，每字最多兩個已提供的對比詞及帶調拼音，說明證據能支持到哪一步，避免把參考練習當成錯讀診斷。用四個短段落，結合本詩的用字、畫面或情感轉折，對一個具體詩句提出停頓、重音與語氣的配合方法，並用詩意解釋選擇。安排「先讀準、再表達、錄音自查」的短練習，給兩個可自行觀察的檢查點，培養獨立修訂朗讀的能力；不要寫抽象說教。'
  }
};

function getGradeGuidance(grade) {
  return GRADE_GUIDANCE[grade];
}

function reportFormatInstructions(grade) {
  const sections = getGradeGuidance(grade).sections;
  const tasks = {
    observation: '只說本次已完成句數或一項已有分數，不加無證據的表揚。',
    practice: '首句先給最需要練習的原字、帶調拼音及一個正確動作；按年級詳略補充其餘有證據的字。只選一個主要口形或聲調提示，不把所有示範搬進來。',
    expression: '寫本年級要求的停頓、換氣或詩意表達任務，明確是下次可以嘗試的讀法。',
    selfCheck: grade === 2 ? '讓學生把練過的字放回短語讀一次，以一句親切邀請結束。' : '寫本年級可以自己完成的回聽檢查，具體說聽哪一句、檢查什麼；高年級包含兩個檢查點。'
  };
  return `輸出必須是合法JSON物件，不加程式碼圍欄或其他文字；只包含這些欄位：${Object.keys(sections).join('、')}。每個欄位是完整句子的字串陣列，一個元素是一句完整短句，句末加中文句號。各欄位彼此獨立，不能用「如上」「最後一點」等依賴其他欄位的開頭。每句先講核心內容，刪去冗詞。以下上限包含標點、數字和拼音，都是硬上限：\n` +
    Object.entries(sections).map(([key, [count, chars]]) => `${key}：最多${count}句，這個欄位合計最多${chars}個字符。${tasks[key]}`).join('\n') +
    '\n欄位名稱只供程式分段，不會顯示給學生；句子內不要重複欄位名稱、段落標題、【標籤】、編號或Markdown。不要另外寫報告總結或反覆鼓勵。';
}

const HEADING = '(?:整[體体](?:表[現现]|[評评][價价]|[評评][語语])|朗[讀读]表[現现]|[優优][點点](?:[與与]鼓[勵励])?|逐字(?:[診诊][斷断]|分析)(?:[與与][對对]比[練练][習习])?|[對对]比[練练][習习]|[練练][習习](?:建[議议]|方向|重[點点]|方法|目[標标])|下一步(?:鼓[勵励]|建[議议]|[練练][習习])?|[總总][結结](?:[與与]鼓[勵励])?|小(?:提醒|目[標标])|鼓[勵励](?:的[話话](?:[語语])?)?)';
const BRACKET_HEADING = new RegExp('[【\\[]\\s*' + HEADING + '\\s*[】\\]]\\s*[：:]?\\s*', 'g');
const LINE_HEADING = new RegExp('^[\\t ]*' + HEADING + '(?:[\\t ]*[：:][\\t ]*|[\\t ]*$)', 'gm');

function normalizeReport(text, grade) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    .replace(/```(?:text|plaintext)?\s*|```/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*{1,3}/g, '')
    .replace(BRACKET_HEADING, '\n\n')
    .replace(LINE_HEADING, '')
    .replace(/^\s*(?:[-•●]|\d+[.、）)])\s+/gm, '')
    .trim();
  if (!cleaned) return '';
  const limit = getGradeGuidance(grade).paragraphLength;
  const paragraphs = [];
  for (const block of cleaned.split(/\n\s*\n/)) {
    const sentences = block.trim().replace(/\n+/g, ' ').split(/(?<=[。！？!?；;])/).filter(Boolean);
    let paragraph = '';
    for (const sentence of sentences) {
      if (paragraph && paragraph.length + sentence.length > limit) {
        paragraphs.push(paragraph.trim());
        paragraph = '';
      }
      paragraph += sentence;
    }
    if (paragraph.trim()) paragraphs.push(paragraph.trim());
  }
  return paragraphs.join('\n\n');
}

function fitReportSection(source, grade, maxSentences, maxChars) {
  if (typeof source === 'string') source = [source];
  if (!Array.isArray(source) || !source.length || source.length > 30 || source.some(sentence => typeof sentence !== 'string')) return '';
  const sentences = source.flatMap(sentence => normalizeReport(sentence, grade).replace(/\s+/g, ' ').trim().split(/(?<=[。！？!?])/)).map(sentence => sentence.trim()).filter(Boolean);
  const retained = [];
  let charCount = 0;
  for (const sentence of sentences) {
    const complete = /[。！？!?]$/.test(sentence) ? sentence : sentence + '。';
    if (retained.length >= maxSentences || charCount + Array.from(complete).length > maxChars) break;
    retained.push(complete);
    charCount += Array.from(complete).length;
  }
  return retained.join('');
}

function buildReportFallback({ grade, poem, coverage, practiceWords, measuredWordCount }) {
  const first = practiceWords[0];
  const line = first?.lineText || poem.lines[0].text;
  const expressiveLine = poem.lines.find(item => item.text.length >= 5)?.text || line;
  const observation = [coverage.completedLines === null ? '這是這次朗讀的練習建議。' : coverage.completedLines === 0 ? '先錄下一句，再看字音建議。' : `這次完成了${coverage.completedLines}句練習。`];
  let practice;
  if (first && grade <= 2) {
    practice = [`先聽「${first.character}」（${first.referencePinyin}），再慢慢跟讀兩次。`, first.articulationTip || first.toneTip];
  } else if (first) {
    practice = practiceWords.map(word => {
      const evidence = word.evidence;
      const basis = evidence.level === 'phone' ? `${evidence.label}得${evidence.score}分` : `得${word.score}分，還不能確定哪部分需要調整`;
      return `「${word.character}」（${word.referencePinyin}）${basis}；先試試：${word.articulationTip || word.toneTip}`;
    });
  } else {
    practice = [measuredWordCount === 0 ? '這次還沒有逐字結果，先跟示範慢讀一句。' : '這次先聽一句示範，再自己讀一遍。'];
  }
  const expression = grade <= 3 ? [`讀「${line}」時，按意思分小段，句末停一停。`]
    : grade === 4 ? [`試讀「${line}」，先想清楚意思，在句末停頓換氣。`]
    : grade === 5 ? [`讀「${expressiveLine}」時，想像詩中的畫面，選一個字稍稍讀重。`, '想一想，這個重音會讓哪個畫面更清楚。']
    : [`試把「${expressiveLine}」讀出兩種語氣，比較哪種更貼近詩意。`, '選定一個重音和停頓位置，用詩中的字說明理由。'];
  const selfCheck = grade === 2 ? [`把練過的字放回「${line}」，再讀一次。`]
    : grade === 3 ? [`錄下「${line}」，回聽時找一個還能讀清楚的字。`]
    : grade === 4 ? [`先跟示範練字，再讀「${line}」。`, '回聽時先檢查字音，再聽句末有沒有停穩。']
    : grade === 5 ? [`錄下「${expressiveLine}」，先聽練過的字是否清楚。`, '再聽重音有沒有帶出你想表現的畫面。']
    : [`先跟示範練字，再錄下「${expressiveLine}」。`, '回聽時檢查字音是否清楚、停頓是否合乎句意；選一處調整後重錄比較。'];
  return { observation, practice: practice.filter(Boolean), expression, selfCheck };
}

function renderReportSections(rawText, grade, fallback = {}, useVerifiedEvidence = false) {
  const raw = typeof rawText === 'string' ? rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : '';
  let data;
  try { data = JSON.parse(raw); } catch (_) { data = null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  const paragraphs = [];
  const fallbackSections = [];
  for (const [key, [maxSentences, maxChars]] of Object.entries(getGradeGuidance(grade).sections)) {
    // Scores and articulation are assembled from verified reference data. Model
    // paraphrasing must not change a mouth movement or invent a diagnosed error.
    const verified = useVerifiedEvidence && (key === 'observation' || key === 'practice');
    let paragraph = fitReportSection(verified ? fallback[key] : data[key], grade, maxSentences, maxChars);
    if (!paragraph) {
      paragraph = fitReportSection(fallback[key], grade, maxSentences, maxChars);
      fallbackSections.push(key);
    }
    // Each task retains a complete sentence, using known reference data if the model
    // omitted it or produced one oversized sentence. The report's tail is never cut.
    if (!paragraph) return { report: '', fallbackSections };
    paragraphs.push(paragraph);
  }
  return { report: paragraphs.join('\n\n'), fallbackSections };
}

// Keep report-specific formatting out of the helper shared by poet chat and quizzes.
function createReportResponse(res, studentGrade, fallback) {
  let status = 200;
  return {
    status(value) { status = value; return this; },
    json(body) {
      if (status !== 200 || typeof body?.report !== 'string') return res.status(status).json(body);
      const { report, fallbackSections } = renderReportSections(body.report, studentGrade, fallback, true);
      if (!report) return res.status(502).json({ error: 'Invalid or empty report' });
      return res.status(200).json({ ...body, report, studentGrade, reportVersion: REPORT_VERSION, reportSource: studentGrade === 1 ? 'reference' : fallbackSections.length ? 'reference-assisted' : 'ai-assisted' });
    }
  };
}

module.exports = { REPORT_VERSION, getGradeGuidance, reportFormatInstructions, normalizeReport, renderReportSections, buildReportFallback, createReportResponse };
