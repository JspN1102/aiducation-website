const REPORT_VERSION = 'grade-v1';

// The learner's grade controls the teaching task, not the poem's catalogue grade.
const GRADE_GUIDANCE = {
  1: {
    length: '60至100字', maxWords: 1, maxTokens: 650, paragraphLength: 64,
    guidance: '一年級：只安排一個小任務，最多練習一個字。用兩個短段落，每句約10至18字。先用一句話說這次的表現，再給「聽這個字、慢慢跟讀兩次」這樣能立即照做的動作。需要時用一個簡單的嘴巴或舌頭提示，不用聲母、韻母、音素、準確度等術語。不列對比詞清單，不講詩的深層意思，也不連續報分數。'
  },
  2: {
    length: '100至150字', maxWords: 1, maxTokens: 850, paragraphLength: 88,
    guidance: '二年級：選一個字，安排「聽一聽、跟讀、放回短語」三個小動作，用兩至三個短段落。給一個容易模仿的口形提示，可選一個已提供的對比詞並附帶調拼音，說清它是練習示範。用簡單的話提醒句末稍停，不使用音素等術語。不要求獨立分析聲韻母或詩人情感。'
  },
  3: {
    length: '150至220字', maxWords: 2, maxTokens: 1150, paragraphLength: 120,
    guidance: '三年級：最多選兩個字，每字給一個口形或舌位提示和至多一個已提供的對比詞及帶調拼音。用三個短段落，說清「練哪裡、怎樣練、放回哪個短語」。只有具體音素證據才可說哪個部分評分較低；專有詞出現時立即用簡單的話解釋。加入一個按詩句意思分小段的停頓練習，讓學生試讀一次、再聽一次自己的錄音。'
  },
  4: {
    length: '200至280字', maxWords: 2, maxTokens: 1450, paragraphLength: 140,
    guidance: '四年級：優先分析兩個字，每字選一至兩個已提供的對比詞及帶調拼音，解釋練習怎樣幫助讀準。用三個短段落，將逐字證據與有提供的流暢度、完整度聯繫起來。選原詩一個短句，示範按意思停頓和一次換氣安排；這是下次可嘗試的讀法，不能宣稱本次停頓出錯。最後給兩個有先後次序、可以自己檢查的練習步驟。'
  },
  5: {
    length: '240至340字', maxWords: 3, maxTokens: 1800, paragraphLength: 150,
    guidance: '五年級：優先分析兩至三個有證據的字，每字選一至兩個已提供的對比詞及帶調拼音，區分已測到的薄弱部分和仍不能判斷的部分。用三至四個短段落，除了讀準，結合本詩的一個具體畫面，提出重音、語速或語氣中一項表達練習並解釋理由。給一個可完成的小目標，讓學生比較練習前後同一句的清楚程度；不要保證分數會上升。'
  },
  6: {
    length: '300至420字', maxWords: 3, maxTokens: 2200, paragraphLength: 160,
    guidance: '六年級：優先分析兩至三個有證據的字，每字最多兩個已提供的對比詞及帶調拼音，說明證據能支持到哪一步，避免把參考練習當成錯讀診斷。用四個短段落，結合本詩的用字、畫面或情感轉折，對一個具體詩句提出停頓、重音與語氣的配合方法，並用詩意解釋選擇。安排「先讀準、再表達、錄音自查」的短練習，給兩個可自行觀察的檢查點，培養獨立修訂朗讀的能力；不要寫抽象說教。'
  }
};

function getGradeGuidance(grade) {
  return GRADE_GUIDANCE[grade];
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

// Keep report-specific formatting out of the helper shared by poet chat and quizzes.
function createReportResponse(res, studentGrade) {
  let status = 200;
  return {
    status(value) { status = value; return this; },
    json(body) {
      if (status !== 200 || typeof body?.report !== 'string') return res.status(status).json(body);
      const report = normalizeReport(body.report, studentGrade);
      if (!report) return res.status(502).json({ error: 'Invalid or empty report' });
      return res.status(200).json({ ...body, report, studentGrade, reportVersion: REPORT_VERSION });
    }
  };
}

module.exports = { REPORT_VERSION, getGradeGuidance, normalizeReport, createReportResponse };
