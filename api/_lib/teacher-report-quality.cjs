'use strict';
// A small, conservative quality gate for already schema-validated model output.
// It reports actionable issues; it never rewrites claims or creates evidence.
const MAX_ISSUES=8;
const WRITE=/(?:默[寫写]|聽寫|听写|書寫|书写|抄[寫写]|練[寫写]|练写|[寫写]字|書空|书空|描紅|描红|筆順|笔顺|[寫写](?:出|好|上)|[寫写](?=[「『“"：:])|[寫写].{0,4}(?:字|詞|词))/u;
const READ=/(?:朗[讀读]|跟[讀读]|聆[聽听]|[聽听][選选辨]|[讀读]音)/u;
const NEGATION=/(?:不能|不可|不應|不应|不要|不宜|不得|不必|毋須|毋须|無須|无需|無法|无法|未能|未必|並非|并非|不是|不代表|不等於|不等于|沒有依據|没有依据|尚無依據|尚无依据|沒有證據|没有证据|未有證據|未有证据|避免|禁止|不安排|不要求)/u;
function clauses(value){return String(value||'').split(/[。！？!?；;\n，,]/u).filter(Boolean);}
function negated(clause,index){
  // A later contrast begins a new assertion: "不能說偏低，但可信度較低".
  const prefix=clause.slice(0,index).split(/但是|然而|可是|但|卻|却|而是/u).at(-1);
  return NEGATION.test(prefix);
}
function asserted(value,pattern){
  for(const clause of clauses(value)){
    const flags=pattern.flags.includes('g')?pattern.flags:pattern.flags+'g';
    for(const match of clause.matchAll(new RegExp(pattern.source,flags))){
      const suffix=clause.slice(match.index+match[0].length);
      const rejectedAfter=/^[」』”"的\s]*(?:(?:說法|说法|推論|推论|判斷|判断|結論|结论)[\s的]*)?(?:並無|并无|沒有|没有|缺乏|尚無|尚无|未有)(?:充分)?(?:依據|依据|證據|证据)|^[」』”"的\s]*(?:說法|说法|推論|推论|判斷|判断|結論|结论)(?:不成立|並不成立|并不成立)/u.test(suffix);
      if(!negated(clause,match.index)&&!rejectedAfter)return true;
    }
  }
  return false;
}
function textFields(analysis){
  const result=[];const add=(value,path)=>{if(typeof value==='string')result.push({value,path});};
  add(analysis?.title,'title');add(analysis?.overview,'overview');
  for(const field of ['findings','teachingActions','reviewPlan'])for(const [index,item]of (Array.isArray(analysis?.[field])?analysis[field]:[]).slice(0,10).entries()){
    add(item?.title,`${field}[${index}].title`);add(item?.interpretation,`${field}[${index}].interpretation`);
    for(const [step,value]of (Array.isArray(item?.steps)?item.steps:[]).slice(0,8).entries())add(value,`${field}[${index}].steps[${step}]`);
  }
  for(const [index,value]of (Array.isArray(analysis?.limitations)?analysis.limitations:[]).slice(0,10).entries())add(value,`limitations[${index}]`);
  return result;
}
function gradeNumbers(value){
  const numbers=new Set(),map={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6};
  for(const match of String(value).matchAll(/([一二三四五六1-6])(?:[、及和至到—～~－-]([一二三四五六1-6]))?年[級级]/gu)){
    const first=map[match[1]]||Number(match[1]),last=map[match[2]]||Number(match[2]);
    if(last)for(let n=Math.min(first,last);n<=Math.max(first,last);n++)numbers.add(n);else numbers.add(first);
  }
  return numbers;
}
function appliesToGrade(text,grade,fallback=true){
  const explicit=gradeNumbers(text);if(explicit.size)return explicit.has(grade);
  if(/低[小年]|一二年/u.test(text))return grade<=2;
  if(/中高年|中[小年]|高[小年]/u.test(text))return false;
  return fallback;
}
function quotedCharacters(text){
  const chars=[];
  for(const match of String(text).matchAll(/[「『“"]([^」』”"]{1,40})[」』”"]/gu)){
    // Only concrete short characters/words, not quoted instructional phrases.
    const value=match[1].replace(/[、，,\s/／]/gu,'');
    if(!/^[\p{Script=Han}]{1,10}$/u.test(value)||/字詞|字词|原句|同一句|同一字|筆順|笔顺|默[寫写]|[寫写]字/u.test(value))continue;
    chars.push(...value);
  }
  for(const match of String(text).matchAll(/(?:默[寫写]|書寫|书写|[寫写]出|[寫写])[：:\s]*([\p{Script=Han}]{1,3}(?:[、/／][\p{Script=Han}]{1,3}){1,8})/gu))chars.push(...match[1].replace(/[、/／]/gu,''));
  return chars;
}
function ambiguousListeningChoices(item,curriculum){
  const steps=(Array.isArray(item?.steps)?item.steps:[]).filter(value=>typeof value==='string');
  const context=String(item?.title||'')+'。'+steps.join('。');
  for(const step of steps){
    if(/多[選选]|[選选]出(?:全部|所有|[兩两二三2-9])|可[選选]多[個个]/u.test(step))continue;
    const choice=step.match(/(?:從|从|在)([^。！？!?]{1,100}?)(?:[選选]出|[選选][擇择]|揀|拣)/u);
    if(!choice||!/(?:聽到|听到|[聽听][見见]|正確|正确)/u.test(step))continue;
    const candidates=[...choice[1].matchAll(/[「『“"]([\p{Script=Han}]{1,4})[」』”"]/gu)].map(match=>match[1]);
    const unique=[...new Set(candidates)];if(unique.length<2)continue;
    const literal=step.match(/(?:朗[讀读]|[讀读]出|播放|念)[^「]{0,20}「([^」]{3,40})」/u);
    const sourceLines=literal?[literal[1]]:[];
    if(/首句|第一句/u.test(step))for(const poem of curriculum)if(typeof poem?.title==='string'&&context.includes('《'+poem.title+'》')&&typeof poem.lines?.[0]?.text==='string')sourceLines.push(poem.lines[0].text);
    if(sourceLines.some(line=>unique.every(candidate=>line.includes(candidate))))return true;
  }
  return false;
}
function inspectAnalysis(analysis,payload={}){
  const issues=[],keys=new Set();
  const add=(code,message,path)=>{if(!keys.has(code)&&issues.length<MAX_ISSUES){keys.add(code);issues.push({code,message,path});}};
  for(const {value,path}of textFields(analysis)){
    if(asserted(value,/(?:中等|尚可|(?:未達|未达)?高水[準准平]|基[礎础]薄弱|已有(?:一定)?基[礎础]|能力(?:薄弱|良好|較弱|较弱)|不?及格)/u))
      add('UNSUPPORTED_ABILITY_LEVEL','未提供能力等級或及格界線。刪除「中等、尚可、高水準、基礎薄弱」等定級，只寫實際分數、測量筆數和可觀察的練習線索；不能用均分推斷能力高低。',path);
    if(/朗[讀读]|默[寫写]|辨音|[聽听]辨|字音/u.test(value)&&!/(?:同一|相同).{0,8}(?:原句|題目|题目)|上次|前[後后]兩次|前[後后]两次/u.test(value)&&asserted(value,/(?:平均分|均分|分[數数]|[準准]確度|准确度|成[績绩]|表[現现]).{0,5}(?:相近|接近|[較较更]高|[較较更]低|[優优]於|[優优]于|[遜逊]於|[遜逊]于)/u))
      add('UNSUPPORTED_SCORE_COMPARISON','不同學習分項不能比較高低或以均分接近推論能力。刪除標題及正文中的「朗讀與默寫平均分接近」「辨音準確度較高」等相對判斷；各項只列實際分數及測量筆數，也不要另造高低標準。',path);
    if(/自報|自报|[學学]生端|[瀏浏]覽器|浏览器|來源|来源|可信度/u.test(value)&&asserted(value,/(?:可信度|可靠性).{0,5}(?:較低|较低|較高|较高|偏低|偏高|低於|低于|高於|高于)|自[報报].{0,8}(?:偏高|偏低|誇大|夸大)/u))
      add('UNSUPPORTED_SOURCE_COMPARISON','沒有同一學生同一題的配對證據，不能說自報偏高或某來源可信度較低／較高。只說學生端回報未經伺服器核實，兩類來源分開呈現。',path);
    const diagnosis=clauses(value).some(clause=>{
      if(/(?:觀察|观察|[聽听]|[檢检]查|了解).{0,5}(?:是否|有否)/u.test(clause))return false;
      return asserted(clause,/(?:[糾纠]正|改正|矯正|矫正).{0,18}(?:[聲声]母|[韻韵]母|[聲声][調调]|[一二三四]聲|[一二三四]声)|(?:[聲声]母|[韻韵]母|[聲声][調调]|[一二三四][聲声]).{0,10}(?:[錯错][誤误]|有[誤误]|偏[誤误]|不[準准]|混淆)/u);
    });
    if(diagnosis)add('UNSUPPORTED_PHONEME_DIAGNOSIS','字音分數沒有標出具體聲母、韻母或聲調錯誤。不要指定糾正未觀察到的錯誤；改為聽原句示範、跟讀同一句，讓教師私下再聽取觀察。',path);
  }
  for(const field of ['teachingActions','reviewPlan'])for(const [index,item]of (Array.isArray(analysis?.[field])?analysis[field]:[]).slice(0,10).entries()){
    if(ambiguousListeningChoices(item,Array.isArray(payload.curriculum)?payload.curriculum:[]))add('AMBIGUOUS_LISTENING_CHOICES','聽選活動播放的原句包含全部候選字，學生無法選出唯一答案（例如首句同時有「橫、嶺」或「街、潤、酥」）。刪除此單選安排，改為聽同一原句示範後跟讀；或明確要求逐一指出全部聽到的字，不能把它們當互斥答案。',`${field}[${index}]`);
  }
  const constraints=(Array.isArray(payload.teachingConstraints)?payload.teachingConstraints:[]).filter(item=>[1,2].includes(item?.grade)&&Array.isArray(item.writing?.allowedCharacters));
  for(const constraint of constraints){
    const grade=constraint.grade,allowed=new Set(constraint.writing.allowedCharacters.flatMap(char=>[...String(char)])),seen=new Set();let hadWriting=false,firstPath='';
    for(const field of ['teachingActions','reviewPlan'])for(const [index,item]of (Array.isArray(analysis?.[field])?analysis[field]:[]).slice(0,10).entries()){
      const title=String(item?.title||''),path=`${field}[${index}]`;
      const titleScope=appliesToGrade(title,grade,true);if(!titleScope)continue;
      const steps=(Array.isArray(item?.steps)?item.steps:[]).filter(value=>typeof value==='string');
      const writingTitle=asserted(title,WRITE);
      const applicable=steps.filter(value=>appliesToGrade(value,grade,titleScope));
      if(!writingTitle&&!applicable.some(value=>asserted(value,WRITE)))continue;
      hadWriting=true;firstPath ||= path;
      for(const step of applicable){
        if(READ.test(step)&&!asserted(step,WRITE))continue;
        const relevant=clauses(step).filter(clause=>!negated(clause,clause.length)).join('，');
        for(const char of quotedCharacters(relevant))seen.add(char);
        if(asserted(relevant,/(?:[2-9]\d*|[二兩两三四五六七八九十])\s*(?:個|个)?\s*(?:字|詞|词)|(?:一|1)\s*(?:個|个)?\s*(?:詞語|词语)|(?:各|每字|每個字|每个字).{0,4}(?:[寫写]|抄)|(?:[這这]些|上述|多[個个]|若干|[幾几數数][個个])(?:字|詞|词)/u))
          add(`LOW_GRADE_WRITING_LOAD_G${grade}`,`${grade}年級整份報告連同複查最多安排一個字，只可選「${[...allowed].join('／')}」。刪除多字字表、詞語默寫、每字各寫多次等安排；其餘改用聽選和短句跟讀。`,path);
      }
    }
    if(seen.size>1||[...seen].some(char=>!allowed.has(char)))add(`LOW_GRADE_WRITING_TARGET_G${grade}`,`${grade}年級的教學建議及複查合計只能書寫一個允許字：「${[...allowed].join('／')}」。目前出現其他字或多字；整份報告統一用同一個允許字，不能改成詞語或字表。`,firstPath);
    if(hadWriting&&!seen.size)add(`LOW_GRADE_WRITING_UNSPECIFIED_G${grade}`,`${grade}年級的書寫安排必須清楚指明同一個允許字「${[...allowed].join('／')}」；不要籠統寫「默寫字詞」或另出一組默寫題。亦可完全採用聽選、跟讀而不安排書寫。`,firstPath);
  }
  return issues;
}
module.exports={inspectAnalysis};
