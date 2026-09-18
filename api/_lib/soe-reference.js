// Tencent SOE TextMode 1 accepts a JSON wordList with optional pronunciation.
// https://cloud.tencent.com/document/product/884/78883
const { poems } = require('../../maanshan/poems.json');
const polyphonic = new Set(Array.from('曲乘將将行踏橫横看側侧識识只中泊間间祇數数重綠绿還还種种盛興兴荷長长露衣霑好處处都'));
const compactText = text => text.replace(/[\s，。！？；、,.!?;]/gu, '');
function numberedPinyin(value) {
  let tone=5;const marks=['āēīōūǖ','áéíóúǘ','ǎěǐǒǔǚ','àèìòùǜ'];
  marks.forEach((set,index)=>{if(Array.from(value).some(c=>set.includes(c)))tone=index+1;});
  return value.normalize('NFD').replace(/[\u0304\u0301\u030c\u0300]/g,'').normalize('NFC').replace(/ü/g,'v')+tone;
}
const references=new Map();
for(const poem of poems)for(const line of poem.lines){
 const traditional=Array.from(line.text).filter(c=>/\p{Script=Han}/u.test(c));
 for(const text of [line.text,line.simplified]){
  references.set(compactText(text),{characters:Array.from(text).filter(c=>/\p{Script=Han}/u.test(c)),readings:line.pinyin,traditional});
  let offset=0;for(const clause of text.split(/[，,]/)){const characters=Array.from(clause).filter(c=>/\p{Script=Han}/u.test(c));references.set(compactText(clause),{characters,readings:line.pinyin.slice(offset,offset+characters.length),traditional:traditional.slice(offset,offset+characters.length)});offset+=characters.length;}
 }
}
// Only known whole poem lines/clauses receive context-specific overrides.
// Unknown text and natural 一/不 connected-speech tone changes stay untouched.
function assessmentReference(refText) {
  if (typeof refText !== 'string') return { ref_text: refText, text_mode: 0 };
  const reference=references.get(compactText(refText));
  if (!reference || !reference.traditional.some(char=>polyphonic.has(char))) {
    return { ref_text: refText, text_mode: 0 };
  }
  const wordList = reference.characters.map((word,index)=>polyphonic.has(reference.traditional[index])
    ? {word,pron:[[numberedPinyin(reference.readings[index])]]}:{word});
  return { ref_text: JSON.stringify({ wordList }), text_mode: 1 };
}

module.exports = { assessmentReference };
