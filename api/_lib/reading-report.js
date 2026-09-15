const REPORT_VERSION = 'grade-v4-compact';

// The learner's grade controls the teaching task, not the poem's catalogue grade.
// Every report has one evidence-led paragraph and, from grade 2, one short task.
const GRADE_GUIDANCE = {
  1: {
    length: '最多85字', sentenceLimit: 3, maxWords: 1, maxContrasts: 0, maxTokens: 350,
    sections: { practice: [3, 85] },
    guidance: '一年級：一個短段落，只練一個字。用「聽這個字、慢慢跟讀兩次」和一個容易模仿的嘴巴或舌頭提示，不用聲母、韻母、音素等術語。'
  },
  2: {
    length: '最多120字', sentenceLimit: 4, maxWords: 1, maxContrasts: 0, maxTokens: 450,
    sections: { practice: [3, 85], selfCheck: [1, 35] },
    guidance: '二年級：只練一個字，先聽、跟讀，再放回原詩的一個短語讀一次。第二段只寫這個小動作，不做聲韻母分析。'
  },
  3: {
    length: '最多135字', sentenceLimit: 4, maxWords: 1, maxContrasts: 0, maxTokens: 550,
    sections: { practice: [3, 95], selfCheck: [1, 40] },
    guidance: '三年級：只選一個最需要練的字，說清正確讀法和一個模仿動作。第二段讓學生把它放回詩句錄一次，回聽這個字是否清楚。'
  },
  4: {
    length: '最多150字', sentenceLimit: 5, maxWords: 1, maxContrasts: 0, maxTokens: 600,
    sections: { practice: [3, 105], selfCheck: [2, 45] },
    guidance: '四年級：先練一個有證據的字，再在原詩短句中練習按意思停頓。第二段只給一次錄音回聽任務，檢查字音和句末停頓。'
  },
  5: {
    length: '最多190字', sentenceLimit: 6, maxWords: 2, maxContrasts: 0, maxTokens: 750,
    sections: { practice: [4, 140], selfCheck: [2, 50] },
    guidance: '五年級：最多選兩個有證據的字，不列錯字清單。第二段結合本詩一個畫面，讓學生試一處重音並回聽；明確這是下次可試的表達，不是本次已測到的問題。'
  },
  6: {
    length: '最多205字', sentenceLimit: 6, maxWords: 2, maxContrasts: 0, maxTokens: 800,
    sections: { practice: [4, 150], selfCheck: [2, 55] },
    guidance: '六年級：最多選兩個有證據的字，區分確定測到的部分和參考練法。第二段選原詩短句，試一處符合詩意的停頓或重音，錄下來比較字音與表達，再調整一處。'
  }
};

function getGradeGuidance(grade) {
  return GRADE_GUIDANCE[grade];
}

function reportFormatInstructions(grade) {
  const sections = getGradeGuidance(grade).sections;
  return `只輸出合法JSON物件，欄位為${Object.keys(sections).join('、')}，每欄是完整短句的字串陣列。practice是最值得改進的字和具體練法；selfCheck只給下次可試的一個短任務。` +
    Object.entries(sections).map(([key, [count, chars]]) => `${key}最多${count}句、合計${chars}個字符（包括標點、數字和拼音）。`).join('') +
    '全文最多兩段；一年級只有一段。不要寫完成句數、分數總結、表揚開場、結尾鼓勵、段落標題、【下一步鼓勵】等標籤、Markdown或編號。資料少就更短。';
}

const HEADING = '(?:整[體体](?:表[現现]|[評评][價价]|[評评][語语])|朗[讀读]表[現现]|[優优][點点](?:[與与]鼓[勵励])?|逐字(?:[診诊][斷断]|分析)(?:[與与][對对]比[練练][習习])?|[對对]比[練练][習习]|[練练][習习](?:建[議议]|方向|重[點点]|方法|目[標标])|下一步(?:鼓[勵励]|建[議议]|[練练][習习])?|[總总][結结](?:[與与]鼓[勵励])?|小(?:提醒|目[標标])|鼓[勵励](?:的[話话](?:[語语])?)?|practice|selfCheck|observation|expression)';
const BRACKET_HEADING = new RegExp('[【\\[]\\s*' + HEADING + '\\s*[】\\]]\\s*[：:]?\\s*', 'gi');
const LINE_HEADING = new RegExp('^[\\t ]*' + HEADING + '(?:[\\t ]*[：:][\\t ]*|[\\t ]*$)', 'gmi');

function normalizeReport(text) {
  if (typeof text !== 'string') return '';
  // Strip known formatting labels, never character quotes or phonetic evidence.
  // Compaction happens by selecting teaching tasks, not cutting a report's tail.
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```(?:text|plaintext)?\s*|```/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*{1,3}/g, '')
    .replace(BRACKET_HEADING, '\n\n')
    .replace(LINE_HEADING, '')
    .replace(/^\s*(?:[-•●]|\d+[.、）)])\s+/gm, '')
    .split(/\n\s*\n/).map(block => block.trim().replace(/\n+/g, ' ')).filter(Boolean).join('\n\n');
}

function fitReportSection(source, maxSentences, maxChars) {
  if (typeof source === 'string') source = [source];
  if (!Array.isArray(source) || !source.length || source.length > 30 || source.some(sentence => typeof sentence !== 'string')) return '';
  const sentences = source.flatMap(sentence => normalizeReport(sentence).replace(/\s+/g, ' ').trim().split(/(?<=[。！？!?])/)).map(sentence => sentence.trim()).filter(Boolean);
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

function buildReportFallback({ grade, poem, coverage, practiceWords, measuredWordCount, measured = {} }) {
  const first = practiceWords[0];
  const line = first?.lineText || poem.lines[0].text;
  const partial = coverage.completedLines > 0 && coverage.completedLines < coverage.totalLines ? `先看已讀的${coverage.completedLines}句。` : '';
  let practice;
  if (coverage.completedLines === 0) {
    practice = ['先錄下一句，再看字音建議；這次還沒有已完成詩句的逐字結果。'];
  } else if (first) {
    practice = practiceWords.slice(0, getGradeGuidance(grade).maxWords).map((word, index) => {
      const name = `「${word.character}」（${word.referencePinyin}）`;
      const tip = word.articulationTip || word.toneTip || '先聽單字示範，再慢慢跟讀兩次。';
      if (grade <= 2) return `${partial}先聽${name}，慢慢跟讀兩次。${tip}`;
      const focus = word.evidence.level === 'phone' ? `的${word.evidence.label}` : '';
      // Word scores support choosing a target, but do not diagnose its initial,
      // final or tone. Keep that distinction in the compact text itself.
      const basis = focus ? `${index ? '再' : '先'}練${name}${focus}。` : `${index ? '再' : '先'}練${name}，未能確定是哪部分，先跟示範。`;
      return `${index ? '' : partial}${basis}${tip}`;
    });
  } else if (measuredWordCount === 0) {
    practice = [`${partial}這次還沒有逐字結果，先跟示範慢讀一句，再錄一次看看。`];
  } else if (typeof measured.integrity_score === 'number' && measured.integrity_score < 80) {
    practice = [`${partial}這次先練完整讀出已評測的詩句：看着原文，跟示範慢讀一句，再自己讀一次。`];
  } else if (typeof measured.fluency_score === 'number' && measured.fluency_score < 80) {
    practice = [`${partial}這次先練把一句連起來讀：跟示範慢讀，再用舒服的速度自己讀一次。`];
  } else {
    practice = [`${partial}已評測的字暫未見需要優先練的字音；再聽一句示範，試着把整句讀清楚。`];
  }
  const selfCheck = grade === 2 ? [first ? `把練過的字放回「${line}」，再讀一次。` : `試讀「${line}」，句末停一停。`]
    : grade === 3 ? [`錄下「${line}」，回聽${first ? '練過的字' : '字音'}是否清楚。`]
    : grade === 4 ? [`試讀「${line}」，句末停一停；回聽字音和停頓。`]
    : grade === 5 ? [`試讀「${line}」，選一個字讀重些；回聽能否帶出詩中的畫面。`]
    : [`試讀「${line}」，按詩意選一處停頓或重音；回聽字音和表達，再調整一處。`];
  // With no completed/word evidence, avoid implying there is a known target to
  // put back into a phrase. One clear action is enough at every grade.
  return { practice, selfCheck: measuredWordCount === 0 || coverage.completedLines === 0 ? [] : selfCheck, sourceLines: poem.lines.map(item => item.text) };
}

function isPracticeTask(text, sourceLines) {
  // AI may personalise the next attempt, but may not add an observed diagnosis
  // in the second paragraph. Rejected tasks use the same-grade reference task.
  if (/(?:這次|本次|剛才|已經|你(?:的)?[^。！？]{0,12}(?:錯|不準|混淆|漏|不清|不足)|讀成|發音(?:有誤|錯誤)|\d+(?:\.\d+)?\s*分|聲母|韻母|音素|嘴[形型]|舌位|https?:\/\/|【|\[)/u.test(text)) return false;
  const quoted = [...text.matchAll(/[「“《]([^」”》]+)[」”》]/g)].map(match => match[1]);
  return !sourceLines || quoted.every(quote => sourceLines.some(line => line.includes(quote)));
}

function renderReportSections(rawText, grade, fallback = {}, useVerifiedEvidence = false) {
  const raw = typeof rawText === 'string' ? rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : '';
  let data;
  try { data = JSON.parse(raw); } catch (_) { data = null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  const paragraphs = [];
  const fallbackSections = [];
  for (const [key, [maxSentences, maxChars]] of Object.entries(getGradeGuidance(grade).sections)) {
    if (key === 'selfCheck' && useVerifiedEvidence && !fallback.selfCheck?.length) continue;
    const verified = useVerifiedEvidence && key === 'practice';
    // The complete selected evidence is kept. The known reference vocabulary is
    // bounded before rendering, and is never sliced to satisfy a visual limit.
    let paragraph = verified ? normalizeReport(fallback[key]?.join('')).replace(/\n\n/g, '') : fitReportSection(data[key], maxSentences, maxChars);
    if (key === 'selfCheck' && paragraph && !isPracticeTask(paragraph, fallback.sourceLines)) paragraph = '';
    if (!paragraph) {
      paragraph = fitReportSection(fallback[key], maxSentences, maxChars);
      fallbackSections.push(key);
    }
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
      const referenceOnly = studentGrade === 1 || !fallback.selfCheck?.length;
      return res.status(200).json({ ...body, report, studentGrade, reportVersion: REPORT_VERSION, reportSource: referenceOnly ? 'reference' : fallbackSections.length ? 'reference-assisted' : 'ai-assisted' });
    }
  };
}

module.exports = { REPORT_VERSION, getGradeGuidance, reportFormatInstructions, normalizeReport, renderReportSections, buildReportFallback, createReportResponse };
