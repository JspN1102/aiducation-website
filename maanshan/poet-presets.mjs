// Shared question catalogue. Creative/conversational starters are prepared
// only for an explicit button click; ordinary typed follow-ups retain history.
export const POET_PRESET_VERSION = 'poet-presets-20260922-v1';
const questions = [
  [1, 'colors', '白鵝是甚麼顏色？'], [1, 'call', '鵝怎樣叫？'], [1, 'read', '陪我讀「鵝鵝鵝」吧。', true],
  [2, 'friend', '汪倫是誰？'], [2, 'boat', '你坐甚麼離開？'], [2, 'farewell', '朋友來送你，你開心嗎？'],
  [3, 'height', '廬山高不高？'], [3, 'view', '你在山裏看到甚麼？'], [3, 'sides', '山從兩邊看一樣嗎？'],
  [4, 'places', '京口、瓜洲和鍾山在詩中有甚麼關係？'],
  [4, 'other-poems', '聊聊別的詩吧', true], [4, 'new-poem', '一起寫一首新詩吧', true],
  [5, 'farming', '「晨興理荒穢」寫的是甚麼農事？'],
  [5, 'other-poems', '聊聊別的詩吧', true], [5, 'new-poem', '一起寫一首新詩吧', true],
  [6, 'rain', '「潤如酥」寫出春雨怎樣的感覺？'],
  [6, 'other-poems', '聊聊別的詩吧', true], [6, 'new-poem', '一起寫一首新詩吧', true]
];
export const POET_PRESETS = Object.freeze(questions.map(([poemId, key, question, explicitOnly=false]) =>
  Object.freeze({id:`p${poemId}.${key}`,poemId,question,explicitOnly,version:POET_PRESET_VERSION})));
const lower = {
  1: ['白鵝是甚麼顏色？', '鵝怎樣叫？', '陪我讀「鵝鵝鵝」吧。'],
  2: ['汪倫是誰？', '你坐甚麼離開？', '朋友來送你，你開心嗎？'],
  3: ['廬山高不高？', '你在山裏看到甚麼？', '山從兩邊看一樣嗎？']
};
export function getPoetSuggestions(poem, grade = poem?.grade) {
  if (Math.min(Number(grade), Number(poem?.grade)) <= 3)
    return [...(lower[poem?.id] || ['你看到甚麼？', '這首詩說甚麼？', '陪我讀一句吧。'])];
  return [POET_PRESETS.find(item => item.poemId === poem?.id)?.question || poem?.suggestions?.[0] || '這首詩說甚麼？', '聊聊別的詩吧', '一起寫一首新詩吧'];
}
export function matchPoetPreset(poemId, text) {
  if (!Number.isInteger(poemId) || typeof text !== 'string') return null;
  return POET_PRESETS.find(item => item.poemId === poemId && item.question === text.trim().normalize('NFC')) || null;
}
