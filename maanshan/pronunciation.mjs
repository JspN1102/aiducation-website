const verseCharacters = text => Array.from(text || '').filter(char => /\p{Script=Han}/u.test(char));
let practiceData = {groups:{},initials:{},finals:{},tones:{},characters:{}};
const scoreValue = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const toneMarks = ['āēīōūǖ','áéíóúǘ','ǎěǐǒǔǚ','àèìòùǜ'];

export function configurePronunciation(data) {
  if (!data || typeof data !== 'object' || !data.groups || !data.initials || !data.finals || !data.tones) {
    throw new Error('Invalid pronunciation practice data');
  }
  practiceData = data;
}

export function parsePinyin(pinyin) {
  const value = typeof pinyin === 'string' ? pinyin.toLowerCase().trim() : '';
  let tone = Number(value.match(/[1-5]$/)?.[0]) || 5;
  for (let index=0;index<toneMarks.length;index++) {
    if (Array.from(value).some(char=>toneMarks[index].includes(char))) tone=index+1;
  }
  const base=value.normalize('NFD').replace(/[\u0304\u0301\u030c\u0300]/g,'').normalize('NFC').replace(/[1-5]$/,'').replace(/u:/g,'ü');
  let initial=base.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/)?.[0] || '';
  let final=base.slice(initial.length);
  if (initial==='y') {
    final={i:'i',a:'ia',ao:'iao',e:'ie',ou:'iu',an:'ian',in:'in',ang:'iang',ing:'ing',ong:'iong',u:'ü',ue:'üe',uan:'üan',un:'ün'}[final] || final;
    initial='';
  } else if (initial==='w') {
    final={u:'u',a:'ua',o:'uo',ai:'uai',ei:'ui',an:'uan',en:'un',ang:'uang',eng:'ueng'}[final] || final;
    initial='';
  } else if (['j','q','x'].includes(initial) && final.startsWith('u')) {
    final='ü'+final.slice(1);
  }
  if (final==='i' && ['z','c','s','zh','ch','sh','r'].includes(initial)) final='i-apical';
  return {base,initial,final,tone};
}

// The written syllable the way pupils learn it: y and w count as initials and
// ü keeps its dots after j, q, x and y (yuǎn is y + üan, shuǐ is sh + ui).
export function writtenSyllable(pinyin) {
  const {base,tone}=parsePinyin(pinyin);
  const initial=base.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/)?.[0] || '';
  let final=base.slice(initial.length);
  if (['j','q','x','y'].includes(initial) && final.startsWith('u')) final='ü'+final.slice(1);
  return {initial,final,tone};
}

export const toneName=tone=>['','第一聲','第二聲','第三聲','第四聲','輕聲'][tone] || '';
const initialPhones=new Set(['b','p','m','f','d','t','n','l','g','k','h','j','q','x','zh','ch','sh','r','z','c','s','y','w']);
const partState=score=>score===null?'unknown':score>=80?'ok':score>=60?'near':'miss';

// Tones a fluent reader may produce here: 一 and 不 change with the next
// syllable, and a third tone before another third tone rises. Null accepts any.
function acceptedTones(char, tone, nextTone) {
  if (tone===5) return null;
  if (char==='一') return [1,2,4];
  if (char==='不') return [4,2];
  if (tone===3 && nextTone===3) return [2,3];
  return [tone];
}

/**
 * Initial, final and tone of one assessed character.
 *
 * The assessment scores the initial as its own phone and the final as one or
 * more phones (天 t, i1, an). The tone digit on the first final phone is the
 * tone it heard, which its word score ignores; the tone is judged from it,
 * allowing for tone sandhi. Returns null without phone data.
 */
export function syllableParts(word, line) {
  if (!word || typeof word!=='object' || typeof word.p!=='string' || !word.p) return null;
  const written=writtenSyllable(word.p);
  const clause=[];
  let charIndex=0;
  for (const char of Array.from(line?.text || '')) {
    if (/\p{Script=Han}/u.test(char)) clause.push({char,pinyin:line.pinyin?.[charIndex++] || '',pause:false});
    else if (clause.length && /\S/u.test(char)) clause.at(-1).pause=true;
  }
  const position=Number.isInteger(word.i) && clause[word.i]?.char===word.c ? word.i : clause.findIndex(entry=>entry.char===word.c);
  const next=position>=0 && !clause[position].pause ? clause[position+1] : null;
  const accepted=acceptedTones(word.c,written.tone,next ? parsePinyin(next.pinyin).tone : null);
  const empty={initial:{sound:written.initial,score:null,state:written.initial?'unknown':'none'},final:{sound:written.final,score:null,state:'unknown'},tone:{tone:written.tone,heard:null,state:'unknown'}};
  if (word.missing===true) return {...empty,missing:true};
  const phones=(Array.isArray(word.phones)?word.phones:[]).slice(0,8).map(entry=>({
    label:String(entry?.phone ?? '').toLowerCase().trim(),score:scoreValue(entry?.score)
  })).filter(entry=>entry.label && entry.score!==null);
  if (!phones.length) return null;
  const hasInitial=phones.length>1 && initialPhones.has(phones[0].label);
  const finals=hasInitial?phones.slice(1):phones;
  const finalScore=Math.round(Math.min(...finals.map(entry=>entry.score)));
  const heard=Number(finals.map(entry=>entry.label.match(/[1-5]$/)?.[0]).find(Boolean)) || null;
  // Without its own phone, y or w is read as part of the final (一 yī, 五 wǔ).
  const initialScore=!written.initial?null:hasInitial?Math.round(phones[0].score):['y','w'].includes(written.initial)?finalScore:null;
  const toneHeard=heard!==null && (!accepted || accepted.includes(heard));
  // The assessment expects its own changed tone for 一 and 不 and marks their
  // vowel down when the book tone is read instead (一水 yī scored 22), so a low
  // vowel score after an accepted tone says nothing about the final.
  const finalState=['一','不'].includes(word.c) && toneHeard && finalScore<80 ? 'unknown' : partState(finalScore);
  const initialState=!written.initial?'none':hasInitial?partState(initialScore):initialScore===null?'unknown':finalState;
  return {
    initial:{sound:written.initial,score:initialScore,state:initialState,...(hasInitial?{}:{shared:true})},
    final:{sound:written.final,score:finalScore,state:finalState},
    tone:{tone:written.tone,heard,state:heard===null?'unknown':toneHeard?'ok':'miss'},
    missing:false
  };
}

function phoneEvidence(parts) {
  if (!parts || parts.missing) return [];
  const evidence=[];
  const {initial,final,tone}=parts;
  if (initial.sound && initial.score!==null && !initial.shared) evidence.push({phone:initial.sound,label:`聲母 ${initial.sound}`,kind:'initial',score:initial.score,source:'assessment'});
  if (final.score!==null && final.state!=='unknown') evidence.push({phone:final.sound,label:`韻母 ${final.sound}`,kind:'final',score:final.score,source:'assessment'});
  if (tone.state==='miss') evidence.push({phone:`tone${tone.heard}`,label:`聲調（應讀${toneName(tone.tone)}，聽起來像${toneName(tone.heard)}）`,kind:'tone',score:null,expectedTone:tone.tone,heardTone:tone.heard,source:'assessment'});
  return evidence;
}

function referenceEntries(poem) {
  return poem.lines.flatMap((line,lineIndex)=>{
    const simplified=verseCharacters(line.simplified || line.text);
    return verseCharacters(line.text).map((char,charIndex)=>({char,simplified:simplified[charIndex],pinyin:line.pinyin[charIndex],lineIndex,charIndex,line}));
  });
}

function selectReference(word, entries) {
  const source=typeof word.c==='string'?word.c:typeof word.Word==='string'?word.Word:'';
  let candidates=entries.filter(entry=>entry.char===source || entry.simplified===source);
  if (Number.isInteger(word.lineIndex)) candidates=candidates.filter(entry=>entry.lineIndex===word.lineIndex);
  const supplied=typeof word.p==='string'?word.p:'';
  if (candidates.some(entry=>entry.pinyin===supplied)) candidates=candidates.filter(entry=>entry.pinyin===supplied);
  if (!candidates.length) return null;
  const lines=new Set(candidates.map(entry=>entry.lineIndex));
  const pinyins=new Set(candidates.map(entry=>entry.pinyin));
  if (pinyins.size>1) return null;
  // The same character can appear twice in a line; its own position decides
  // which neighbour affects its tone.
  const exact=lines.size===1 && candidates.find(entry=>entry.charIndex===word.i);
  return {...(exact || candidates[0]),studentLineIndex:lines.size===1?candidates[0].lineIndex:null};
}

function contrastsFor(groups, override) {
  const values=[...(override?.contrasts || []).map(example=>({...example,kind:'context'}))];
  for (const group of groups) {
    if (!group) continue;
    for (const example of group.examples || []) values.push({...example,kind:group.kind});
  }
  const seen=new Set();
  return values.filter(example=>{
    if (!example.text || !example.pinyin || seen.has(`${example.text}|${example.pinyin}`)) return false;
    seen.add(`${example.text}|${example.pinyin}`);return true;
  }).slice(0,6).map(example=>({...example,source:'model'}));
}

export function getPronunciationPractice(result, poem, data=practiceData) {
  const output={items:[],unknownWords:[],assessedCount:0,needsPracticeCount:0,sourceNote:data.sourceNote || '對比字是參考練習，並非辨識出的錯讀。'};
  if (!poem || !Array.isArray(poem.lines)) return output;
  const entries=referenceEntries(poem);
  const words=Array.isArray(result?.words)?result.words:Array.isArray(result?.Words)?result.Words:[];
  for (const [wordIndex,word] of words.entries()) {
    if (!word || typeof word!=='object') continue;
    const reference=selectReference(word,entries);
    const score=scoreValue(word.score ?? word.PronAccuracy);
    const source=typeof word.c==='string'?word.c:typeof word.Word==='string'?word.Word:'';
    if (!reference) {
      output.unknownWords.push({char:source,pinyin:'',score,lineIndex:null,reason:'未能對應到原詩的逐字位置，未推測讀音。'});
      continue;
    }
    const {char,pinyin,line,studentLineIndex}=reference;
    const syllable=parsePinyin(pinyin);
    const parts=syllableParts({...word,c:char,p:pinyin,i:reference.charIndex},line);
    const phones=phoneEvidence(parts);
    const lowPhones=phones.filter(phone=>phone.score!==null && phone.score<60).sort((a,b)=>a.score-b.score);
    const toneMiss=phones.find(phone=>phone.kind==='tone') || null;
    if (score===null) {
      output.unknownWords.push({char,pinyin,score:null,lineIndex:studentLineIndex,phones,reason:'本字未提供有效分數，未把缺失值當成零分或錯讀。'});
      continue;
    }
    output.assessedCount++;
    // The word score ignores the tone, so a clear wrong tone is listed even
    // when the score is high.
    if (score>=80 && !lowPhones.length && !toneMiss && !parts?.missing) continue;
    const weakest=toneMiss || lowPhones[0] || null;
    const initialGroup=data.groups?.[data.initials?.[syllable.initial]];
    const finalGroup=data.groups?.[data.finals?.[syllable.final]];
    const toneGroup=data.tones?.[syllable.tone];
    const focusGroup=weakest?.kind==='initial'?initialGroup:weakest?.kind==='final'?finalGroup:weakest?.kind==='tone'?toneGroup:initialGroup || finalGroup || toneGroup;
    const override=data.characters?.[`${poem.id}:${char}`];
    const evidence=weakest ? {level:'phone',kind:weakest.kind,label:weakest.label,score:weakest.score} : {level:'word',kind:'word',label:'本字發音準確度',score};
    const issue=parts?.missing?'這個字沒有讀出來':weakest?.kind==='initial'?'聲母待改善':weakest?.kind==='final'?'韻母待改善':weakest?.kind==='tone'?'聲調待改善':score<60?'字音需要加強':'字音可以更準確';
    const explanation=parts?.missing ? `這次評測沒有聽到「${char}」（${pinyin}），先聽示範，再把整句讀一次。` : weakest?.kind==='tone' ? `「${char}」（${pinyin}）應讀${toneName(weakest.expectedTone)}，這次聽起來像${toneName(weakest.heardTone)}，先聽示範再讀一次。` : weakest ? `「${char}」（${pinyin}）的${weakest.label}評分為${weakest.score}分，可優先練習這個部分；這不代表已辨識出你讀成了另一個字。` : `「${char}」（${pinyin}）的字級發音準確度為${score}分。這次資料不足以確定是哪個聲母、韻母或聲調出錯，先按原詩讀音做對比練習。`;
    const tips=[override?.tip,focusGroup?.tip];
    if (toneGroup && focusGroup?.kind!=='tone' && !override) tips.push(toneGroup.tip);
    const articulationDetail=[...new Set(tips.filter(Boolean))].join(' ') || `先聽「${char}」在原句中的${pinyin}讀音，慢讀一次，再用自然速度讀回原句。`;
    const childFocus=focusGroup?.kind==='initial'?data.childTips?.initials?.[syllable.initial]:focusGroup?.kind==='final'?data.childTips?.finals?.[syllable.final]:data.childTips?.tones?.[syllable.tone];
    const childTips=[childFocus,override?.tip];
    if (focusGroup?.kind!=='tone' && !override) childTips.push(data.childTips?.tones?.[syllable.tone]);
    const tip=poem.grade<=2 && childFocus ? childTips.filter(Boolean).join(' ') : articulationDetail;
    output.items.push({
      key:`${poem.id}:${studentLineIndex ?? 'unknown'}:${wordIndex}:${char}`,
      char,pinyin,score,lineIndex:studentLineIndex,lineText:line.text,linePinyin:line.pinyin.join(' '),
      issue,explanation,tip,articulationDetail,evidence,phones,parts,
      model:{label:'示範讀音',text:line.text,pinyin:line.pinyin.join(' '),source:'model',lineIndex:reference.lineIndex},
      student:{label:'我的原句錄音',lineIndex:studentLineIndex,source:'student'},
      contrasts:contrastsFor([focusGroup,initialGroup,finalGroup,toneGroup],override)
    });
  }
  output.items.sort((a,b)=>a.score-b.score);
  output.needsPracticeCount=output.items.length;
  return output;
}
