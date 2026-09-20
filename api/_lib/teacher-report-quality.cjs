'use strict';
// A small, conservative quality gate for already schema-validated model output.
// It reports actionable issues; it never rewrites claims or creates evidence.
const MAX_ISSUES=8;
const WRITE=/(?:默[寫写](?!辨[識识])|聽寫|听写|書寫|书写|抄[寫写]|練[寫写]|练写|[寫写]字|書空|书空|描紅|描红|筆順|笔顺|[寫写](?:出|好|上)|[寫写](?=[「『“"：:])|[寫写].{0,4}(?:字|詞|词))/u;
const READ=/(?:[讀读念]|[聽听](?![寫写])|辨[認认]|圈出|指出|(?:示範|示范).{0,20}(?:《|原句|首句|第[一二三四五六]句))/u;
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
function scopedClauses(text,grade,fallback){
  let applies=fallback;const mentioned=new Set(),result=[];
  // Providers also write targets followed by grade labels, e.g.
  // 「鵝」（一年級）或「舟」（二年級）. These are distinct scoped choices.
  for(const group of clauses(text)){
    let inheritedWriting=false;
    for(const clause of group.split(/(?<=[）)])(?:或|及|和|與|与|、)/u)){
      const writes=asserted(clause,WRITE);
      if(writes)inheritedWriting=true;else if(READ.test(clause))inheritedWriting=false;
      const explicit=gradeNumbers(clause);
      if(explicit.size){for(const value of explicit)mentioned.add(value);applies=explicit.has(grade);}
      else if(/其[餘余]年[級级]|其他年[級级]/u.test(clause)&&mentioned.size)applies=!mentioned.has(grade);
      else if(/各年[級级]|所有年[級级]/u.test(clause))applies=true;
      else applies=appliesToGrade(clause,grade,applies);
      if(applies)result.push({text:clause,writing:writes||inheritedWriting});
    }
  }
  return result;
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
const DOMAIN_PATTERNS=[['reading',/朗[讀读]|跟[讀读]|[讀读]音/gu],['writing',/默[寫写]|[聽听][寫写]|[書书][寫写]/gu],['sound',/辨音|[聽听]辨|辨[識识]/gu]];
function mentionedDomains(value){
  const mentions=[];
  for(const [domain,pattern]of DOMAIN_PATTERNS)for(const match of String(value||'').matchAll(pattern)){
    // 「默寫辨識」 names one writing measure, not a separate listening measure.
    if(domain==='sound'&&/默[寫写]$/u.test(String(value).slice(0,match.index)))continue;
    mentions.push({domain,index:match.index});
  }
  const recent=[];
  for(const {domain}of mentions.sort((a,b)=>a.index-b.index)){const prior=recent.indexOf(domain);if(prior!==-1)recent.splice(prior,1);recent.push(domain);}
  return recent;
}
function namedDomainPairs(value){
  const domain='(?:朗[讀读](?:字音(?:評分|评分)?)?|默[寫写](?:辨[識识](?:[準准]確度)?)?|[聽听][寫写]|[書书][寫写]|辨音(?:答題(?:[準准]確度)?)?|[聽听]辨)';
  const matches=[...String(value||'').matchAll(new RegExp(domain+'(?:與|与|和|及|、|／|/)'+domain,'gu'))];
  return matches.map(match=>mentionedDomains(match[0])).filter(domains=>domains.length===2);
}
function namedDomainPair(value){return namedDomainPairs(value).at(-1)||[];}
function emptyObservedGroup(value,context,pairs){
  const dualLow=/(?:兩項|两项|兩者|两者|二者)(?:個人平均|平均|分數|分数)?(?:皆|均|都|同時|同时)?(?:低於|低于|不足|未達|未达)\s*60\s*分|(?:皆|均|同時|同时)(?:低於|低于|不足|未達|未达)\s*60\s*分/gu;
  for(const match of String(value).matchAll(dualLow)){
    const sentenceStart=Math.max(value.lastIndexOf('。',match.index),value.lastIndexOf('\n',match.index))+1;
    const prefix=value.slice(sentenceStart,match.index),suffix=value.slice(match.index+match[0].length).split(/[。；;\n]/u)[0];
    if(negated(prefix,prefix.length)||/(?:若|如果|倘若|假如|一旦|如有|如出現|如出现)/u.test(prefix))continue;
    if(/^(?:的)?(?:學生|学生|同學|同学)?(?:為|为|有|是|共|共有)?\s*(?:0|零)\s*(?:名|位)?人/u.test(suffix))continue;
    if(!/(?:學生|学生|同學|同学|一組|一组|組別|组别)/u.test(suffix)||!/(?:先|再|安排|練|练|跟進|跟进|補|补|[聽听]|[寫写]|[讀读])/u.test(suffix))continue;
    // Bind “both” to a named pair such as 朗讀與默寫. A later listening
    // activity within that plan does not turn it into a different cohort.
    const explicit=namedDomainPair(value.slice(0,match.index)),inContext=namedDomainPair(context);
    const domains=explicit.length===2?explicit:inContext;
    const candidates=domains.length===2?pairs.filter(pair=>domains.every(domain=>pair.domains.includes(domain))):pairs;
    // Resolve only an unambiguous pair. A zero reading/writing intersection
    // must not suppress a genuine reading/listening group in the same report.
    if(candidates.length===1&&candidates[0].count===0)return candidates[0];
  }
  return null;
}
function inspectAnalysis(analysis,payload={}){
  const issues=[],keys=new Set();
  const add=(code,message,path)=>{if(!keys.has(code)&&issues.length<MAX_ISSUES){keys.add(code);issues.push({code,message,path});}};
  if(payload.reportStyle==='narrative-teaching-review'){
    const facts=Array.isArray(payload.evidence)?payload.evidence:[],byId=new Map(facts.map(fact=>[fact.id,fact]));
    const pairs=facts.filter(fact=>fact.label?.endsWith('：同一批學生觀察')&&Number.isSafeInteger(fact.value?.bothBelow60Students)).map(fact=>({label:fact.label.split('：')[0],domains:mentionedDomains(fact.label),count:fact.value.bothBelow60Students,id:fact.id}));
    const groupingPairs=new Set(),selectedGrouping=payload.teachingGroups?.length===1?payload.teachingGroups[0]:null;
    const selectedDomains=selectedGrouping?mentionedDomains(selectedGrouping.domains.join('與')).sort().join('/') : null;
    for(const {value,path}of textFields(analysis)){
      const itemMatch=/^(findings|teachingActions|reviewPlan)\[(\d+)\]/u.exec(path),item=itemMatch?analysis[itemMatch[1]][Number(itemMatch[2])]:null;
      const cited=(item?.evidenceIds||[]).map(id=>byId.get(id)).filter(Boolean),citedPairs=pairs.filter(pair=>cited.some(fact=>fact.id===pair.id));
      const emptyGroup=emptyObservedGroup(value,item?.title,citedPairs.length?citedPairs:pairs);
      if(emptyGroup)add('EMPTY_LEARNING_GROUP',`「${emptyGroup.label}」兩項皆低於60分的學生為0人。刪除針對這個空組的練習安排及湊成三組的表述；沿用teachingGroups中實際存在的組別，分別說清原句聽讀或寫字的做法。保留其餘正確分析，不另補假設組或免責文字。`,path);
      for(const sentence of value.split(/[。！？!?\n]/u)){
        if(/(?:不能|不可|不宜|不應|不应|無法|无法|未能).{0,12}(?:推論|推论|推斷|推断|判斷|判断|代表).{0,25}(?:每[個个]|人人|全班|所有[學学]生|普遍)|(?:平均分|均分|逐字平均|[評评]分|分[數数]).{0,12}(?:只是|僅[供为為]?|仅[供为為]?|只供|僅僅|仅仅).{0,12}(?:[參参]考|[線线]索)|(?:平均分|均分|逐字平均).{0,18}不(?:等[於于]|代表).{0,15}(?:每[個个]|人人|全班)/u.test(sentence))
          add('REPORT_DEFENSIVE_LANGUAGE',`刪除整句「${sentence}」。這是解說數據局限的防禦文字，不要改寫成另一句「不能推論」「只是參考」。保留前後的教學安排；若缺少做法，直接寫全班跟讀後逐一聽取，讓仍需鞏固的學生再讀。`,path);
        if(/同一批|交集|重[疊叠]|兩項|两项|低[於于]\s*60|分[組组層层]/u.test(sentence)){
          for(const domains of namedDomainPairs(sentence)){
            const key=[...domains].sort().join('/');groupingPairs.add(key);
            if(groupingPairs.size>1||selectedDomains&&key!==selectedDomains)
              add('REPORT_MULTIPLE_GROUPING_PAIRS','整篇分組敘述只展開teachingGroups提供的同一對學習分項。保留這一對的實際組別與教法；刪除其餘配對的交集、重疊及「僅某項低」人數。第三項只保留全班個人平均低於60分的实际跟進人數和具體教法，不追加分母解釋或免責段落。',path);
          }
        }
        // A whole-class low-score total may include pupils without the other
        // measurement. Do not turn a smaller paired-only count into its split.
        const total=sentence.match(/低[於于]\s*60\s*分的?\s*(\d+)\s*(?:名|位)?人中/u);
        const exclusive=sentence.match(/(?:有)?\s*(\d+)\s*(?:名|位)?人(?:僅|仅|只有|只).{0,12}低/u);
        if(total&&exclusive){
          const domains=mentionedDomains(sentence),whole=Number(total[1]),subset=Number(exclusive[1]);
          const wholeFact=facts.find(fact=>fact.source==='平台評分'&&fact.label?.endsWith('：個人平均低於60分的名冊學生')&&fact.value===whole&&mentionedDomains(fact.label).some(domain=>domains.includes(domain)));
          const pairedSubset=wholeFact&&facts.some(fact=>{
            if(!fact.label?.endsWith('：同一批學生觀察'))return false;
            const pairDomains=mentionedDomains(fact.label),domain=mentionedDomains(wholeFact.label)[0],index=pairDomains.indexOf(domain);if(index<0)return false;
            const side=index===0?'left':'right';
            return fact.value?.[side+'OnlyBelow60Students']===subset&&fact.value?.[side+'Below60Students']<whole;
          });
          if(pairedSubset)add('REPORT_MIXED_GROUP_DENOMINATORS',`刪除「${sentence}」中「有${subset}人僅某項低」這個拆分，保留全班${whole}人的實際跟進安排。這個拆分取自不同觀察範圍；不要補算其餘學生、改寫成第二對分組，或向老師加入分母解說。`,path);
        }
        const characterContext=/字音|逐字|這些字|这些字|該字|该字|[讀读]不準|[讀读]不准/u.test(sentence);
        const prevalence=/(?:問題|问题|困難|困难|弱項|弱项|[讀读]不[準准]|需.{0,5}(?:糾正|纠正)).{0,18}(?:普遍|廣泛|广泛)|(?:普遍|廣泛|广泛|多數|多数|大部分|大多[數数]|全班(?:都|均|皆)|人人).{0,25}(?:問題|问题|困難|困难|弱項|弱项|[讀读]不[準准]|未[讀读][準准]|不清楚|有[錯错])/u;
        if(characterContext&&asserted(sentence,prevalence))add('UNSUPPORTED_CHARACTER_PREVALENCE','逐字均分和受測人數沒有提供讀錯或低分的學生比例。刪除字音問題普遍、多數學生讀不準等結論；保留具體字和所在原句，改成先共同跟讀、再逐一聽取，據課堂表現安排個別再讀。不要把這條核對規則改寫成報告中的免責句。',path);
        if(mentionedDomains(sentence).length>=2&&asserted(sentence,/(?:關聯|关联|相[關关])(?:性|程度)?(?:[較较更]|稍|相[對对])(?:高|強|强|低|弱)|(?:高度|密切|顯著|显著)(?:相[關关]|關聯|关联)/u))add('UNSUPPORTED_DOMAIN_ASSOCIATION','兩項低分名單的交集只用來安排哪些學生一起跟進。刪除關聯較高、密切相關等推論，改為說清這批學生先聽後讀或分別練習的安排，不加入統計免責說明。',path);
      }
    }
    const collectNumbers=(value,set)=>{
      if(typeof value==='number'&&Number.isFinite(value))set.add(value);
      else if(value&&typeof value==='object')Object.values(value).forEach(part=>collectNumbers(part,set));
    };
    const observations=[{text:analysis?.overview,path:'overview',facts},...(Array.isArray(analysis?.findings)?analysis.findings:[]).map((item,index)=>({text:item?.interpretation,path:`findings[${index}].interpretation`,facts:(item?.evidenceIds||[]).map(id=>byId.get(id)).filter(Boolean)}))];
    for(const item of observations){
      if(payload.rosterSummary?.noRecords>0)for(const sentence of String(item.text||'').split(/[。！？!?\n]/u)){
        const subset=sentence.match(/已有(?:活動|活动)?(?:紀錄|記錄|记录)的(\d+)人中/u);
        if(!subset||Number(subset[1])!==payload.rosterSummary.withRecords)continue;
        const rest=sentence.slice(subset.index+subset[0].length);
        if(/從全班|从全班|全班名冊|全班名册/u.test(rest))continue;
        const totals=facts.filter(fact=>fact.scope==='所選範圍'&&fact.source==='平台評分'&&fact.label?.endsWith('：尚無評分的名冊學生')&&Number.isSafeInteger(fact.value)&&fact.value>0);
        const misplaced=totals.some(fact=>{
          const topic=fact.label.match(/^(朗讀|默寫|辨音|配對|排序|場景)/u)?.[1];if(!topic)return false;
          return new RegExp(topic+'.{0,20}?(?<!\\d)'+fact.value+'(?!\\d)\\s*(?:名|位)?人.{0,8}(?:未評|未评|尚無|尚无|無評|无评|未留)','u').test(rest);
        });
        if(misplaced)add('INCORRECT_MISSING_SCORE_SCOPE',`刪除整句「${sentence}」。這句把全班總未評分人數放入已有紀錄學生的子集；前文已按全班正確說明總未評分人數，因此刪除即可，不要重算或改寫此句。其餘正確分析保持原樣。`,item.path);
      }
      const allowed=new Set([60,80]);item.facts.forEach(fact=>collectNumbers(fact.value,allowed));
      for(const clause of clauses(item.text)){
        // Proposed lesson activities are not claimed measurements.
        if(/下一課|下次|建議|擬安排|可安排|可先|可以|宜先|讓學生|讓同學/u.test(clause))continue;
        for(const match of clause.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(分(?!鐘)|人|筆|次|%|％)/gu)){
          const number=Number(match[1]),precision=match[1].split('.')[1]?.length||0;
          const approximate=match[2]==='分'&&(/(?:大?約|大?约)\s*$/u.test(clause.slice(0,match.index))||/^\s*左右/u.test(clause.slice(match.index+match[0].length)));
          const rounded=approximate&&[...allowed].some(value=>Number(value.toFixed(precision))===number);
          if(!allowed.has(number)&&!rounded)add('UNSUPPORTED_REPORTED_NUMBER',`觀察段落的「${match[0]}」未出現在本項引用依據。核對原始evidence及evidenceIds；若原始資料確有此數值，補上正確依據，否則刪除。不要自行推算人數、百分比或改善幅度。`,item.path);
        }
      }
    }
    for(const {value,path}of textFields(analysis))if(/(?:^|[\n。；])\s*(?:\d+[.)）、]|[一二三四五六七八九十]+[、.)）])(?:\s|(?=\p{Script=Han}))/u.test(value))
      add('REPORT_OPERATION_LIST','改成連貫的完整中文段落，刪除1)/2)、一、二、等操作清單。分析先解釋觀察及教學重心，建議再自然寫出理由、練習安排與觀察目標。',path);
    for(const field of ['teachingActions','reviewPlan'])for(const [index,item]of (analysis?.[field]||[]).entries())if(Array.isArray(item?.steps)&&item.steps.length>2)
      add('REPORT_OPERATION_LIST','steps是相容舊格式的段落欄位，每項只放1至2個完整段落；不要把每個動作拆成一行。',`${field}[${index}]`);
    const measuredDomains=new Set(facts.filter(fact=>fact.label?.endsWith('：平均值')).map(fact=>fact.label));
    if((payload.rosterSummary?.withRecords||0)>=5&&measuredDomains.size>=2){
      const findings=(analysis?.findings||[]).map(item=>String(item?.interpretation||'')).join('');
      const other=[analysis?.overview,...(analysis?.teachingActions||[]).flatMap(item=>item.steps||[]),...(analysis?.reviewPlan||[]).flatMap(item=>item.steps||[])].join('');
      if(findings.length<500||findings.length<other.length)
        add('REPORT_ANALYSIS_TOO_THIN','主要發現必須是正文重心：用3至4個完整段落、合計至少500中文字，篇幅不少於概覽與建議合計。連結參與/完成、不同題型覆蓋和具體字音觀察，解釋何者應優先共同教、何者個別跟進；不能只羅列均分或重複聽示範。', 'findings');
    }
  }
  for(const {value,path}of textFields(analysis)){
    for(const sentence of value.split(/[。！？!?\n]/u))if(/(?:本詩|本诗|平台).{0,10}(?:已有|現有|现有).{0,15}(?:辨音|[聽听]辨|配對|配对).{0,24}(?:包含(?:這些|这些|指定|這四|这四)|(?:這些|这些)字的)/u.test(sentence))
      add('UNVERIFIED_GAME_CONTENT',`本次未提供完整遊戲題庫，不能斷言既有辨音題包含指定觀察字。把整句「${sentence}」替換為「接著，使用本詩現有遊戲的實際題目，讓學生聽後作答，再重讀所聽內容，教師聽取字音。」保留其餘正確的教師示範與原句跟讀建議。`,path);
    const assumedAbsence=clauses(value).some(clause=>{
      if(/(?:是否|有否|有沒有|有没有).{0,16}(?:缺席|參與|参与|參加|参加)/u.test(clause))return false;
      return asserted(clause,/缺席|(?:完全|從未|从未|沒有|没有|未有|未曾|未)(?:參與|参与|參加|参加)(?![紀記记]錄|记录)/u);
    });
    if(assumedAbsence)add('UNSUPPORTED_ATTENDANCE_INFERENCE','未留平台紀錄不能寫成「缺席」「完全未參與」。只把這些斷言改為先了解練習情況、補齊觀察，保留其餘正確分析。相關段落中的尚無評分人數是全班總數（包含完全無紀錄者），不可套在已有紀錄子集或相加；按原始evidence修正範圍。教學建議只使用現有遊戲實際题目，不聲稱平台題庫已有指定字或短句。',path);
    if(/伺服器|服务器|瀏覽器自報|浏览器自报|server[_ ]?verified|client[_ ]?reported|資料快照|数据快照|evidenceIds|teachingFocus|teachingGroups|teachingConstraints|allowedCharacters|bothBelow60Students|OnlyBelow60Students|F\d{3,}/iu.test(value))
      add('REPORT_TECHNICAL_LANGUAGE','把技術術語改成教師用語，例如朗讀字音評分、辨音答題或默寫練習。只寫實際數據與下一步做法，不以資料来源或核實方式作段落主題。',path);
    if(/(?:不能|無法|无法|不可|不足以|未能).{0,12}(?:推斷|推断|診斷|诊断|判斷|判断).{0,25}(?:[聲声]母|[韻韵]母|[聲声][調调]|病因)|(?:不代表|不能證明|不能证明|未經證明|未经证明).{0,12}(?:教[學学]成效|能力提高|[學学]習成效)/u.test(value))
      add('REPORT_DEFENSIVE_LANGUAGE','刪除此說明，不改成另一句免責文字。沒有細項資料時直接安排聽示範、跟讀同一句，再由老師聽取字音；不要補造錯誤原因。',path);
    if(payload.demo&&/模[擬拟]|[虛虚][構构]|非真[實实][學学]生|功能演示|研究[證证][據据]/u.test(value))
      add('DEMO_LABEL_IN_BODY','頁首會統一標示「模擬數據」。刪除正文及標題的模擬、虛構或研究證據說明，按正常班級教學報告寫數據和建議；不要描述學生姓名的真假。',path);
    if(asserted(value,/(?:中等|尚可|(?:未達|未达)?高水[準准平]|基[礎础]薄弱|已有(?:一定)?基[礎础]|能力(?:薄弱|良好|較弱|较弱)|不?及格)/u))
      add('UNSUPPORTED_ABILITY_LEVEL','未提供能力等級或及格界線。刪除「中等、尚可、高水準、基礎薄弱」等定級，只寫實際分數、測量筆數和可觀察的練習線索；不能用均分推斷能力高低。',path);
    if(/朗[讀读]|默[寫写]|辨音|[聽听]辨|字音/u.test(value)&&!/(?:同一|相同).{0,8}(?:原句|題目|题目)|上次|前[後后]兩次|前[後后]两次/u.test(value)&&asserted(value,/(?:平均分|均分|分[數数]|[準准]確度|准确度|成[績绩]|表[現现]).{0,5}(?:相近|接近|[較较更]高|[較较更]低|[優优]於|[優优]于|[遜逊]於|[遜逊]于)/u))
      add('UNSUPPORTED_SCORE_COMPARISON','不同學習分項不能以均分高低推論能力。改為連結各項有評分的人數、明確提供的同一批學生觀察、具體字音和題目結果，解釋教學先後次序；不要另造高低或能力標準。',path);
    if(payload.reportStyle==='narrative-teaching-review'&&asserted(value,/(?:各[項项]|所有[項项]).{0,6}(?:最低|最高)|(?:均|都).{0,6}(?:高[於于]|低[於于]).{0,12}(?:朗[讀读]|默[寫写]|[聽听]辨)|(?:朗[讀读]|默[寫写]|[聽听]辨|辨音).{0,18}(?:明[顯显]偏低|相[對对]穩定|表[現现]穩定)/u))
      add('UNSUPPORTED_SCORE_COMPARISON','刪除「各項最低」「均高於朗讀」「聽辨穩定」等沒有同量尺或縱向證據的判斷。用實際覆蓋人數、配對學生的跟進線索和原句字音，說明教學重心，而非以不同題型分數排名。',path);
    if(payload.reportStyle==='narrative-teaching-review'&&/(?:這不是|这不是|並非|并非).{0,24}(?:[聽听]力|辨[識识]能力|理解能力).{0,10}問題|(?:沒有|没有|並非|并非).{0,10}集中.{0,15}(?:[聲声]母|[韻韵]母|[聲声]韻)|(?:不是|並非|并非).{0,5}少數[學学]生.{0,25}全班/u.test(value))
      add('UNSUPPORTED_LEARNING_INFERENCE','不要因兩種評分或部分學生的結果就排除聽力/辨識問題、指認聲韻分布，或認定全班都有同一困難。改寫為下一課的具體觀察與分組選擇；可明確安排共同練習，但不能把安排說成全班能力結論。',path);
    if(/自報|自报|[學学]生端|[瀏浏]覽器|浏览器|來源|来源|可信度/u.test(value)&&asserted(value,/(?:可信度|可靠性).{0,5}(?:較低|较低|較高|较高|偏低|偏高|低於|低于|高於|高于)|自[報报].{0,8}(?:偏高|偏低|誇大|夸大)/u))
      add('UNSUPPORTED_SOURCE_COMPARISON','刪除來源可信度或自報偏高的判斷。按各分項實際數字安排練習；不要補寫來源核實方式或免責說明。',path);
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
      const writingTitle=asserted(title,WRITE)&&!/(?:朗[讀读]|跟[讀读]|[聽听]辨|原句)/u.test(title);
      // One provider step can contain separate instructions for different
      // grades. Keep each clause's targets within its stated grade, including
      // an ensuing "other grades" instruction, instead of unioning all quotes.
      const applicable=steps.flatMap(value=>value.split(/[。！？!?；;\n]/u).flatMap(sentence=>{
        const items=scopedClauses(sentence,grade,titleScope),writingContext=items.some(item=>item.writing);
        return items.map(item=>({...item,writingContext}));
      }));
      if(!writingTitle&&!applicable.some(value=>value.writing))continue;
      hadWriting=true;firstPath ||= path;
      for(const {text:step,writing,writingContext} of applicable){
        if(READ.test(step)&&!writing)continue;
        if(!writing&&!writingTitle&&!writingContext)continue;
        const relevant=clauses(step).filter(clause=>!negated(clause,clause.length)).join('，');
        for(const char of quotedCharacters(relevant))seen.add(char);
        if((writing||writingTitle)&&asserted(relevant,/(?:[2-9]\d*|[二兩两三四五六七八九十])\s*(?:個|个)?\s*(?:字|詞|词)|(?:一|1)\s*(?:個|个)?\s*(?:詞語|词语)|(?:各|每字|每個字|每个字).{0,4}(?:[寫写]|抄)|(?:[這这]些|上述|多[個个]|若干|[幾几數数][個个])(?:字|詞|词)/u))
          add(`LOW_GRADE_WRITING_LOAD_G${grade}`,`${grade}年級整份報告連同複查最多安排一個字，只可選「${[...allowed].join('／')}」。刪除多字字表、詞語默寫、每字各寫多次等安排；其餘改用聽選和短句跟讀。`,path);
      }
    }
    if(seen.size>1||[...seen].some(char=>!allowed.has(char)))add(`LOW_GRADE_WRITING_TARGET_G${grade}`,`${grade}年級的教學建議及複查合計只能書寫一個允許字：「${[...allowed].join('／')}」。目前出現其他字或多字；整份報告統一用同一個允許字，不能改成詞語或字表。`,firstPath);
    if(hadWriting&&!seen.size)add(`LOW_GRADE_WRITING_UNSPECIFIED_G${grade}`,`${grade}年級的書寫安排必須清楚指明同一個允許字「${[...allowed].join('／')}」；不要籠統寫「默寫字詞」或另出一組默寫題。亦可完全採用聽選、跟讀而不安排書寫。`,firstPath);
  }
  return issues;
}
module.exports={inspectAnalysis};
