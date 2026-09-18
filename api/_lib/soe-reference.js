// Tencent SOE TextMode 1 accepts a JSON wordList with optional pronunciation.
// https://cloud.tencent.com/document/product/884/78883
// Keep this correction limited to the known verse; other texts retain the
// provider's existing natural-language handling, including connected speech.
function assessmentReference(refText) {
  if (typeof refText !== 'string') return { ref_text: refText, text_mode: 0 };
  const compact = refText.replace(/[\s，。！？；、,.!?;]/gu, '');
  if (!/^道[狭狹]草木[长長](?:夕露[沾霑]我衣)?$/u.test(compact)) {
    return { ref_text: refText, text_mode: 0 };
  }
  const wordList = Array.from(compact, (word, index) => index === 4
    ? { word, pron: [['chang2']] }
    : { word });
  return { ref_text: JSON.stringify({ wordList }), text_mode: 1 };
}

module.exports = { assessmentReference };
