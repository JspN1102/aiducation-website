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

function phoneEvidence(word, syllable) {
  const raw=Array.isArray(word.phones)?word.phones:Array.isArray(word.PhoneInfos)?word.PhoneInfos:[];
  const aliases={v:'ü',ve:'üe',van:'üan',vn:'ün',iou:'iu',uei:'ui',uen:'un',i2:'i'};
  return raw.slice(0,16).flatMap(entry=>{
    if (!entry || typeof entry!=='object') return [];
    const code=String(entry.phone ?? entry.Phone ?? '').toLowerCase().trim();
    if (!/^[a-zü:0-5_-]{1,24}$/.test(code)) return [];
    const score=scoreValue(entry.score ?? entry.PronAccuracy);
    let kind=null, label=null;
    const stripped=code.replace(/[1-5]$/,'').replace(/u:/g,'ü');
    const normal=aliases[code] || aliases[stripped] || stripped;
    if (syllable.initial && code===syllable.initial) {kind='initial';label=`聲母 ${syllable.initial}`;}
    else if (/^[1-5]$/.test(code) && Number(code)===syllable.tone) {kind='tone';label=`第${syllable.tone}聲對應音素`;}
    else if (normal===syllable.final || (syllable.final==='i-apical' && normal==='i')) {
      kind='final';label=syllable.final==='i-apical'?'整體認讀音節的韻部':`韻母 ${syllable.final}`;
    }
    return kind ? [{phone:code,label,kind,score,source:'assessment'}] : [];
  });
}

function referenceEntries(poem) {
  return poem.lines.flatMap((line,lineIndex)=>{
    const simplified=Array.from(line.simplified || line.text);
    return Array.from(line.text).map((char,charIndex)=>({char,simplified:simplified[charIndex],pinyin:line.pinyin[charIndex],lineIndex,charIndex,line}));
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
  return {...candidates[0],studentLineIndex:lines.size===1?candidates[0].lineIndex:null};
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
    const phones=phoneEvidence(word,syllable);
    const lowPhones=phones.filter(phone=>phone.score!==null && phone.score<60).sort((a,b)=>a.score-b.score);
    if (score===null) {
      output.unknownWords.push({char,pinyin,score:null,lineIndex:studentLineIndex,phones,reason:'本字未提供有效分數，未把缺失值當成零分或錯讀。'});
      continue;
    }
    output.assessedCount++;
    if (score>=80 && !lowPhones.length) continue;
    const weakest=lowPhones[0] || null;
    const initialGroup=data.groups?.[data.initials?.[syllable.initial]];
    const finalGroup=data.groups?.[data.finals?.[syllable.final]];
    const toneGroup=data.tones?.[syllable.tone];
    const focusGroup=weakest?.kind==='initial'?initialGroup:weakest?.kind==='final'?finalGroup:weakest?.kind==='tone'?toneGroup:initialGroup || finalGroup || toneGroup;
    const override=data.characters?.[`${poem.id}:${char}`];
    const evidence=weakest ? {level:'phone',kind:weakest.kind,label:weakest.label,score:weakest.score} : {level:'word',kind:'word',label:'本字發音準確度',score};
    const issue=weakest?.kind==='initial'?'聲母待改善':weakest?.kind==='final'?'韻母待改善':weakest?.kind==='tone'?'聲調對應音素待練習':score<60?'字音需要加強':'字音可以更準確';
    const explanation=weakest ? `「${char}」（${pinyin}）的${weakest.label}評分為${weakest.score}分，可優先練習這個部分；這不代表已辨識出你讀成了另一個字。` : `「${char}」（${pinyin}）的字級發音準確度為${score}分。這次資料不足以確定是哪個聲母、韻母或聲調出錯，先按原詩讀音做對比練習。`;
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
      issue,explanation,tip,articulationDetail,evidence,phones,
      model:{label:'示範讀音',text:line.text,pinyin:line.pinyin.join(' '),source:'model',lineIndex:reference.lineIndex},
      student:{label:'我的原句錄音',lineIndex:studentLineIndex,source:'student'},
      contrasts:contrastsFor([focusGroup,initialGroup,finalGroup,toneGroup],override)
    });
  }
  output.items.sort((a,b)=>a.score-b.score);
  output.needsPracticeCount=output.items.length;
  return output;
}
