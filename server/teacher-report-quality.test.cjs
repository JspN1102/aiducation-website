'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspectAnalysis}=require('../api/_lib/teacher-report-quality.cjs');
const payload={filters:{grade:2},teachingConstraints:[{grade:2,writing:{maxCharactersAcrossWholeReport:1,allowedCharacters:['舟']}}]};
const action=(title,steps)=>({title,steps});
const codes=(a,p=payload)=>inspectAnalysis(a,p).map(item=>item.code);
test('flags actual provider ability/source claims without changing the model text',()=>{
  const analysis={findings:[{title:'朗讀字音評分平均70分，顯示整體朗讀表現中等',interpretation:'平均71.4分，顯示辨識能力尚可。此分數未達高水準。'}],limitations:['瀏覽器自報分數未經核實，其可信度較低。']};
  const before=JSON.stringify(analysis),issues=inspectAnalysis(analysis,payload);
  assert.deepEqual(issues.map(i=>i.code),['UNSUPPORTED_ABILITY_LEVEL','REPORT_TECHNICAL_LANGUAGE','UNSUPPORTED_SOURCE_COMPARISON']);assert.equal(JSON.stringify(analysis),before);
  assert(issues.every(i=>i.message.length>20&&i.path));
});
test('negated claims are not false diagnoses, but technical disclaimers still need a teacher-voice rewrite',()=>{
  const analysis={overview:'不能因70分稱為中等。尚無依據說基礎薄弱。不可判斷自報偏高。',limitations:['不能據此判斷瀏覽器自報可信度較低。','未有證據表明自報偏高。自報偏高的說法沒有依據。','並非能力薄弱。「中等」的說法不成立。','字音分數不能推斷聲母、韻母或聲調錯誤。','未見紀錄不等於沒有練習，未測不當作零分。']};
  assert.deepEqual(codes(analysis),['REPORT_TECHNICAL_LANGUAGE','REPORT_DEFENSIVE_LANGUAGE']);
});
test('negative preface cannot hide a later affirmative unsupported claim',()=>{
  assert(codes({overview:'不能說能力差，但表現中等。'}).includes('UNSUPPORTED_ABILITY_LEVEL'));
  assert(codes({overview:'不能比較來源，但自報分數偏高。'}).includes('UNSUPPORTED_SOURCE_COMPARISON'));
});
test('flags targeted tone correction, permits listening observation and negation',()=>{
  assert(codes({teachingActions:[action('聽讀練習',['教師糾正「李」字的聲調。'])]}).includes('UNSUPPORTED_PHONEME_DIAGNOSIS'));
  assert(codes({findings:[{interpretation:'分數低，顯示第三聲不準。'}]}).includes('UNSUPPORTED_PHONEME_DIAGNOSIS'));
  assert.deepEqual(inspectAnalysis({teachingActions:[action('聽讀',['教師示範聲調，再觀察是否有聲調錯誤。','不要指定糾正「李」字的聲調。'])]},payload),[]);
});
test('catches actual nine-character provider writing list spanning separate steps',()=>{
  const analysis={teachingActions:[action('強化默寫辨識練習',['教師展示「舟」、「聞」、「岸」、「踏」、「潭」、「深」、「尺」、「送」、「情」，並示範正確書寫。','學生在練習本上書寫這些字詞。'])]};
  assert(codes(analysis).includes('LOW_GRADE_WRITING_TARGET_G2'));assert(codes(analysis).includes('LOW_GRADE_WRITING_LOAD_G2'));
});
test('one allowed character is reusable across teaching and recheck; reading poems is not writing',()=>{
  const analysis={teachingActions:[action('先聽後讀',['教師朗讀「李白乘舟將欲行」，學生跟讀同一句。']),action('書寫一個字',['教師示範「舟」字的筆順。','學生只寫「舟」一次。'])],reviewPlan:[action('下次複查',['再寫「舟」字一次，教師觀察。'])]};
  assert.deepEqual(inspectAnalysis(analysis,payload),[]);
});
test('checks allowlist and entire-report union, not only each individual activity',()=>{
  assert(codes({teachingActions:[action('寫字',['只寫「聞」一字。'])]}).includes('LOW_GRADE_WRITING_TARGET_G2'));
  assert(codes({teachingActions:[action('寫字',['寫「舟」一字。'])],reviewPlan:[action('複查',['寫「聞」一字。'])]}).includes('LOW_GRADE_WRITING_TARGET_G2'));
  assert(codes({teachingActions:[action('默寫',['請寫出舟、聞、岸。'])]}).includes('LOW_GRADE_WRITING_TARGET_G2'));
});
test('flags unquoted word counts and vague writing without inventing target characters',()=>{
  for(const text of ['每週一次默寫小測（5個詞語）。','安排書寫三個字。','每字各寫兩次。','請默寫字詞。'])assert(codes({teachingActions:[action('書寫練習',[text])]}).some(code=>code.startsWith('LOW_GRADE_WRITING_')),text);
  assert.deepEqual(inspectAnalysis({teachingActions:[action('聽讀練習',['不要求書寫這些字詞；只跟讀原句。'])]},payload),[]);
});
test('whole-school low-grade limits do not attach to explicit middle/high-grade writing',()=>{
  const school={filters:{},teachingConstraints:[{grade:1,writing:{allowedCharacters:['鵝']}},{grade:2,writing:{allowedCharacters:['舟']}},{grade:6,writing:{allowedCharacters:['潤','雨','酥']}}]};
  const analysis={teachingActions:[action('低年級',['一年級寫「鵝」一字。','二年級寫「舟」一字。']),action('中年級',['默寫「橫」、「側」兩字。']),action('高年級',['默寫「潤」、「雨」、「酥」三字。'])]};
  assert.deepEqual(inspectAnalysis(analysis,school),[]);
  assert(codes({teachingActions:[action('低年級書寫',['書寫「鵝」、「舟」兩個字。'])]},school).includes('LOW_GRADE_WRITING_TARGET_G1'));
});

test('actual whole-school provider revision assigns each writing target to its own grade within one step',()=>{
  const school={filters:{},teachingConstraints:[{grade:1,writing:{allowedCharacters:['鵝']}},{grade:2,writing:{allowedCharacters:['舟']}}]};
  const steps=['一年級聽寫「鵝」字，二年級聽寫「舟」字，其餘年級進行一次簡短聽寫，觀察默寫辨識準確度的變化。'];
  assert.deepEqual(inspectAnalysis({reviewPlan:[action('下次跟進',steps)]},school),[]);
  assert.deepEqual(inspectAnalysis({reviewPlan:[action('下次跟進',['一年級先看「鵝」字，再聽寫一次；二年級先看「舟」字，再聽寫一次。'])]},school),[]);
  assert.deepEqual(inspectAnalysis({teachingActions:[action('低年級',['低年級複查時，只安排書寫「鵝」字（一年級）或「舟」字（二年級），其餘用聽選或跟讀。'])]},school),[]);
  assert.deepEqual(inspectAnalysis({teachingActions:[action('低年級：以聽選和短句跟讀強化字音',['一年級：老師示範《詠鵝》第一句「鵝鵝鵝」，學生聽後跟讀；再播放平台示範音，學生對照後再讀一次。','二年級：老師示範《贈汪倫》第一句「李白乘舟將欲行」，學生聽後跟讀；再播放平台示範音，學生對照後再讀一次。','低年級複查時，只安排書寫「鵝」字（一年級）或「舟」字（二年級），其餘用聽選或跟讀。'])]},school),[]);
  assert(codes({teachingActions:[action('低年級',['老師示範《贈汪倫》中的「聞」字筆順。'])]},school).includes('LOW_GRADE_WRITING_TARGET_G2'));
  assert(codes({teachingActions:[action('低年級',['只安排書寫「舟」字（一年級）或「鵝」字（二年級）。'])]},school).includes('LOW_GRADE_WRITING_TARGET_G1'));
  const excessive={reviewPlan:[action('下次跟進',['一年級聽寫「鵝」字，二年級聽寫「舟」「聞」兩字，其餘年級聽寫三字。'])]};
  assert(!codes(excessive,school).some(code=>code.endsWith('_G1')));
  assert(codes(excessive,school).includes('LOW_GRADE_WRITING_TARGET_G2'));
  assert(codes({reviewPlan:[action('跟進',['一年級聽寫「舟」字，二年級聽寫「鵝」字。'])]},school).includes('LOW_GRADE_WRITING_TARGET_G1'));
  assert(codes({reviewPlan:[action('跟進',['一年級朗讀原句，其餘年級聽寫「潤」字。'])]},school).includes('LOW_GRADE_WRITING_TARGET_G2'));
});
test('bounded, deterministic issues ignore malformed optional fields and do not invent judgments',()=>{
  assert.deepEqual(inspectAnalysis(null,{}),[]);assert.deepEqual(inspectAnalysis({findings:'invalid',teachingActions:null}),[]);
  const a={findings:Array.from({length:100},()=>({title:'中等'}))};assert.equal(inspectAnalysis(a,{}).length,1);assert.deepEqual(inspectAnalysis(a,{}),inspectAnalysis(a,{}));
});
test('flags actual cross-construct comparison headings, preserves numeric thresholds and same-item follow-up',()=>{
  assert(codes({findings:[{title:'朗讀與默寫平均分接近'},{title:'辨音答題準確度較高'}]}).includes('UNSUPPORTED_SCORE_COMPARISON'));
  assert.deepEqual(inspectAnalysis({overview:'字音分數低於60分。不能說辨音答題準確度較高。',findings:[{interpretation:'同一原句的朗讀平均分比上次較高，只作描述。'}]},payload),[]);
});

test('same-measure character observations are not rejected as cross-construct score comparisons',()=>{
 const p={...payload,evidence:['隔','月','我'].map((char,index)=>({id:'F00'+index,label:`「${char}」逐字平均`,value:{meanScore:68.95,measuredStudents:20}}))};
 const interpretation='教師先帶全班朗讀第一、第三句。第二句的「隔」與第四句的「月、我」平均分相近，可接著共同跟讀。';
 assert(!codes({findings:[{interpretation}]},p).includes('UNSUPPORTED_SCORE_COMPARISON'));
 assert(codes({findings:[{interpretation}]},{...p,evidence:p.evidence.slice(0,2)}).includes('UNSUPPORTED_SCORE_COMPARISON'),'unobserved characters do not gain an exemption');
 assert(codes({findings:[{interpretation}]},{...p,evidence:p.evidence.map((fact,index)=>({...fact,value:{meanScore:index?90:20}}))}).includes('UNSUPPORTED_SCORE_COMPARISON'),'different same-measure results must not be called close');
 assert(codes({findings:[{interpretation:'同一原句的朗讀平均分比上次較高。辨音答題準確度較高。'}]},p).includes('UNSUPPORTED_SCORE_COMPARISON'),'a separate follow-up sentence must not exempt the whole paragraph');
});

test('an evidenced teaching subgroup is not a ranking of different assessment types',()=>{
 const p={...payload,evidence:[{label:'朗讀字音評分：個人平均低於60分的名冊學生',value:7,source:'平台評分',scope:'所選範圍'}]};
 const a={teachingActions:[action('原句跟讀',['對於朗讀分數較低的學生再示範一次，讓他們重讀原句。'])]};
 assert(!codes(a,p).includes('UNSUPPORTED_SCORE_COMPARISON'));
 assert(codes(a,{...p,evidence:[]}).includes('UNSUPPORTED_SCORE_COMPARISON'));
 const issue=inspectAnalysis({teachingActions:[action('跟讀',['朗讀平均分較低，默寫準確度較高。'])]},p).find(issue=>issue.code==='UNSUPPORTED_SCORE_COMPARISON');
 assert(issue);assert(issue.message.includes('朗讀平均分較低'),'revision identifies the actual clause');
});
test('flags listening choices that are all present in the specified first line, not an unambiguous or explicit multi-choice task',()=>{
  const p={...payload,curriculum:[{title:'題西林壁',lines:[{text:'橫看成嶺側成峯'}]},{title:'初春小雨',lines:[{text:'天街小雨潤如酥'}]}]};
  for(const step of ['教師朗讀《題西林壁》首句，學生從「橫」「嶺」中選出聽到的字。','教師朗讀《初春小雨》第一句，學生從「街」「潤」「酥」中選出聽到的字。','教師朗讀「橫看成嶺側成峯」，學生從「橫」「嶺」中選出聽到的字。'])assert(codes({teachingActions:[action('聽選',[step])]},p).includes('AMBIGUOUS_LISTENING_CHOICES'),step);
  for(const step of ['教師朗讀《題西林壁》首句，學生從「橫」「雨」中選出聽到的字。','教師朗讀《題西林壁》首句，學生從「橫」「嶺」中選出全部聽到的字。','教師朗讀《題西林壁》首句，學生跟讀「橫」「嶺」。'])assert(!codes({teachingActions:[action('聽選',[step])]},p).includes('AMBIGUOUS_LISTENING_CHOICES'),step);
});

test('ordinary teacher findings and practical next steps need no defensive caveats',()=>{
 const analysis={overview:'本班25人，22人已有練習紀錄。下次先聽《贈汪倫》的首句，再分句跟讀。',findings:[{title:'先練首句的字音',interpretation:'「舟」字有3次評分低於60分，課堂可先聽示範，再放回原句朗讀。'}],teachingActions:[action('聽讀首句',['老師示範「李白乘舟將欲行」，學生先聽一遍。','同桌輪流跟讀，老師聽取「舟」字，再邀請學生重讀原句。'])],reviewPlan:[action('下次再讀',['下一課用同一句再讀一次，記下需要繼續練習的字。'])],limitations:[]};
 assert.deepEqual(inspectAnalysis(analysis,{...payload,demo:true}),[]);
 assert.deepEqual(codes({limitations:['本次未有默寫紀錄，下一課先做一次聽寫觀察。']}),[]);
});

test('teacher reports reject implementation language and demo explanations but still reject unsupported diagnoses',()=>{
 for(const text of ['伺服器核實的測量平均70分。','瀏覽器自報結果。','server_verified的評測結果。','資料快照顯示20筆。'])assert(codes({overview:text}).includes('REPORT_TECHNICAL_LANGUAGE'),text);
 assert(codes({overview:'字音分數不能推斷聲母、韻母或聲調。'}).includes('REPORT_DEFENSIVE_LANGUAGE'));
 assert(codes({overview:'本報告全部是虛構學生的模擬資料。'},{...payload,demo:true}).includes('DEMO_LABEL_IN_BODY'));
 assert(codes({overview:'分數顯示聲調混淆。'}).includes('UNSUPPORTED_PHONEME_DIAGNOSIS'));
});

test('narrative review verifies observed numbers against cited facts while allowing a proposed lesson arrangement',()=>{
 const p={...payload,reportStyle:'narrative-teaching-review',evidence:[{id:'F001',label:'名冊學生',value:25},{id:'F002',label:'有紀錄',value:22},{id:'F003',label:'字音',value:{meanScore:65.5,measuredStudents:20}}]};
 const valid={overview:'本班25人，22人已有紀錄。',findings:[{evidenceIds:['F003'],interpretation:'65.5分的逐字平均涵蓋20人。下一課建議安排2次同一句跟讀。'}]};
 assert.deepEqual(inspectAnalysis(valid,p),[]);
 assert(codes({...valid,overview:'本班99人。'},p).includes('UNSUPPORTED_REPORTED_NUMBER'));
 assert(codes({...valid,findings:[{evidenceIds:['F001'],interpretation:'有22人留下紀錄。'}]},p).includes('UNSUPPORTED_REPORTED_NUMBER'));
 assert(codes({...valid,teachingActions:[action('課堂',['1) 老師播放原句。2) 學生跟讀。'])]},p).includes('REPORT_OPERATION_LIST'));
});

test('rich data needs sustained analysis, while a sparse report can stay concise',()=>{
 const p={...payload,reportStyle:'narrative-teaching-review',rosterSummary:{withRecords:22},evidence:[{id:'F001',label:'朗讀：平均值',value:65.5},{id:'F002',label:'聽辨：平均值',value:80}]};
 const short={overview:'本次先鞏固原句朗讀。',findings:[{evidenceIds:['F001'],interpretation:'朗讀平均65.5分，先聽示範。'}],teachingActions:[action('聽讀',['教師示範原句，學生跟讀。'])]};
 assert(codes(short,p).includes('REPORT_ANALYSIS_TOO_THIN'));
 assert(!codes(short,{...p,rosterSummary:{withRecords:1}}).includes('REPORT_ANALYSIS_TOO_THIN'));
 const paragraph='有紀錄和有分項評分應分開觀察。教師宜先確認本班的練習是否同時涵蓋聽辨和朗讀，再用原句中的字音線索決定共同跟讀的範圍；已留下聽辨結果的學生則可在同一句中示範，教師私下聽取仍需鞏固的字音，避免把一次評分直接當成固定分組。';
 const detailed={...short,findings:[{evidenceIds:['F001','F002'],interpretation:paragraph.repeat(6)}]};
 assert(!codes(detailed,p).includes('REPORT_ANALYSIS_TOO_THIN'));
});

test('narrative paragraphs can revisit several reading positions while keeping one allowed writing character',()=>{
 const paragraph='下次複查時，老師讓學生朗讀《贈汪倫》，並對照本次七個字位，觀察仍需跟讀的位置。複查沿用「舟」字作為唯一書寫字，不增加其他字。';
 assert.deepEqual(inspectAnalysis({reviewPlan:[action('下次觀察',[paragraph])]},payload),[]);
 assert(codes({reviewPlan:[action('下次觀察',['下次讓學生朗讀原句，再書寫七個字。'])]}).includes('LOW_GRADE_WRITING_LOAD_G2'));
 const p={...payload,reportStyle:'narrative-teaching-review'};
 for(const text of ['朗讀分數是各項中最低的。','聽辨和默寫分數均明顯高於朗讀。','這不是聽力或辨識能力的問題。','沒有集中在某一聲母或韻母。'])assert(codes({findings:[{interpretation:text}]},p).some(code=>code==='UNSUPPORTED_SCORE_COMPARISON'||code==='UNSUPPORTED_LEARNING_INFERENCE'),text);
});

test('ordinary rounded scores and dictation metric names do not become fabricated numbers or handwriting tasks',()=>{
 const p={...payload,reportStyle:'narrative-teaching-review',evidence:[{id:'F001',value:{meanScore:69.15,measuredStudents:20}}]};
 assert.deepEqual(codes({findings:[{evidenceIds:['F001'],interpretation:'本字平均69分左右，涵蓋20人。'}]},p),[]);
 assert(codes({findings:[{evidenceIds:['F001'],interpretation:'本字平均69分，涵蓋20人。'}]},p).includes('UNSUPPORTED_REPORTED_NUMBER'));
 assert(codes({findings:[{evidenceIds:['F001'],interpretation:'本字平均約75分。'}]},p).includes('UNSUPPORTED_REPORTED_NUMBER'));
 assert.deepEqual(codes({teachingActions:[action('聽辨練習',['默寫辨識已有結果的學生，可聽示範後選字，再朗讀「李白乘舟將欲行」。'])]}),[]);
 assert.deepEqual(codes({teachingActions:[action('練寫「舟」字',['教師示範「舟」字的筆順，學生書寫一次，並在「李白乘舟將欲行」句中圈出「舟」字。接著聽寫「舟」字。'])]}),[]);
 assert.deepEqual(codes({reviewPlan:[action('下一課觀察',['再次聽取學生朗讀「李白乘舟將欲行」和「桃花潭水深千尺」，特別留意「李、將、潭、尺」四字。同時檢查「舟」字聽寫結果。'])]}),[]);
 assert.deepEqual(codes({teachingActions:[action('以原句跟讀與聽寫「舟」字',['下一課先帶全班讀「李白乘舟將欲行」，特別聽「李」和「將」是否清楚。接著讀「桃花潭水深千尺」，留意「潭」和「尺」。讀完後進行聽寫，只寫「舟」字，教師念「乘舟」的「舟」，學生在紙上寫出。'])]}),[]);
});

test('missing records are not affirmative attendance claims, while an attendance check or explicit negation is allowed',()=>{
 for(const text of ['這表示那3位未留紀錄的學生在各項活動中都缺席。','課堂應先處理完全未參與的3人。','這些學生沒有參與活動。'])assert(codes({findings:[{interpretation:text}]}).includes('UNSUPPORTED_ATTENDANCE_INFERENCE'),text);
 for(const text of ['對未留紀錄的學生，先了解練習情況並補齊觀察。','未見紀錄不等於沒有參與。','先了解是否缺席，再安排跟讀。','本期未有參與紀錄的學生。'])assert(!codes({findings:[{interpretation:text}]}).includes('UNSUPPORTED_ATTENDANCE_INFERENCE'),text);
});

test('full-roster missing counts cannot be assigned to the recorded-student subset',()=>{
 const p={...payload,reportStyle:'narrative-teaching-review',rosterSummary:{totalStudents:25,withRecords:22,noRecords:3},evidence:[{id:'F001',scope:'所選範圍',source:'平台評分',label:'朗讀字音評分：尚無評分的名冊學生',value:5,unit:'人'},{id:'F002',scope:'所選範圍',source:'平台評分',label:'默寫辨識準確度：尚無評分的名冊學生',value:4,unit:'人'},{id:'F003',label:'名冊中有記錄學生',value:22,unit:'人'}]};
 const bad='同時，已有紀錄的22人中，部分學生在個別項目尚未完成，例如朗讀字音有5人未評，默寫辨識有4人未評，教師可請他們補做';
 const inspect=text=>inspectAnalysis({findings:[{evidenceIds:['F001','F002','F003'],interpretation:text}]},p);
 const issue=inspect(bad+'。').find(issue=>issue.code==='INCORRECT_MISSING_SCORE_SCOPE');assert(issue);assert(issue.message.includes('刪除整句「'+bad+'」'));
 assert(!inspect('從全班名冊看，朗讀字音有5人未評，默寫辨識有4人未評。').some(issue=>issue.code==='INCORRECT_MISSING_SCORE_SCOPE'));
 assert(!inspect('已有紀錄的22人中，朗讀字音有2人未評。').some(issue=>issue.code==='INCORRECT_MISSING_SCORE_SCOPE'));
});

test('existing games cannot be described as containing the observed target words without a question bank',()=>{
 const text='接著，利用本詩已有的辨音練習，播放包含這些字的短句，讓學生聽後選擇正確的讀音。';
 const issue=inspectAnalysis({teachingActions:[action('聽辨',[text])]},payload).find(issue=>issue.code==='UNVERIFIED_GAME_CONTENT');assert(issue);assert(issue.message.includes(text.slice(0,-1)));
 for(const valid of ['使用本詩現有遊戲的實際題目，讓學生聽後作答，再重讀所聽內容。','教師親自示範包含這些字的原句，學生跟讀。'])assert(!codes({teachingActions:[action('聽辨',[valid])]}).includes('UNVERIFIED_GAME_CONTENT'));
});

function pairedPayload(count=0){return {reportStyle:'narrative-teaching-review',filters:{grade:6},evidence:[
 {id:'F001',label:'朗讀字音評分與默寫辨識準確度：同一批學生觀察',value:{bothMeasuredStudents:20,bothBelow60Students:count,leftBelow60Students:9,rightBelow60Students:4}},
 {id:'F002',label:'「潤」逐字平均',value:{meanScore:68.9,measuredStudents:20}}
]};}

test('an empty paired group is not assigned a classroom activity',()=>{
 for(const text of [
  '朗讀與默寫可分成三組；兩項皆低於60分的學生，先做聽辨再寫字，降低負荷。',
  '朗讀與默寫同時低於60分的學生，先聽原句，再練寫字。',
  '兩者都低於60分的學生，安排先聽後寫。'
 ]){
  const item={...action('聽讀與寫字',[text]),evidenceIds:['F001']};
  const issues=inspectAnalysis({teachingActions:[item]},pairedPayload());
  assert(issues.some(issue=>issue.code==='EMPTY_LEARNING_GROUP'),text);
  assert(!inspectAnalysis({teachingActions:[item]},pairedPayload(1)).some(issue=>issue.code==='EMPTY_LEARNING_GROUP'),text);
 }
});

test('zero observations, omitted empty groups and explicit future conditions remain valid prose',()=>{
 for(const text of [
  '兩項皆低於60分的學生為0人，下一課分別聽取朗讀和檢查書寫。',
  '朗讀與默寫的跟進對象沒有重疊，可分別安排原句跟讀和聽寫。',
  '下次若兩項皆低於60分的學生需要更多時間，可先聽後寫。',
  '不要為兩項皆低於60分的學生另設一組練習。'
 ])assert(!codes({teachingActions:[{...action('跟進',[text]),evidenceIds:['F001']}]},pairedPayload()).includes('EMPTY_LEARNING_GROUP'),text);
});

test('a reading-writing zero does not suppress an observed reading-listening group',()=>{
 const p=pairedPayload();p.evidence.push({id:'F003',label:'朗讀字音評分與辨音答題準確度：同一批學生觀察',value:{bothMeasuredStudents:20,bothBelow60Students:3}});
 const valid={teachingActions:[{...action('聽辨與朗讀',['朗讀與辨音兩項皆低於60分的學生，先聽示範再跟讀原句。']),evidenceIds:['F001','F003']}]};
 assert(!codes(valid,p).includes('EMPTY_LEARNING_GROUP'));
 const bad={teachingActions:[{...action('跟進',['朗讀與辨音可共同練習。朗讀與默寫兩項皆低於60分的學生，安排先聽後寫。']),evidenceIds:['F001','F003']}]};
 assert(codes(bad,p).includes('EMPTY_LEARNING_GROUP'));
 const actualPlan='朗讀與默寫可分別練習：朗讀需要跟進的學生，專注聽辨遊戲；默寫需要跟進的學生，先練寫字；兩項皆低於60分的學生，先做聽辨再寫字。';
 const threePairs=pairedPayload(3);threePairs.evidence.push({id:'F003',label:'默寫辨識準確度與辨音答題準確度：同一批學生觀察',value:{bothMeasuredStudents:20,bothBelow60Students:0}});
 const plan={teachingActions:[{...action('分組練習',[actualPlan]),evidenceIds:['F001','F003']}]};
 assert(!codes(plan,threePairs).includes('EMPTY_LEARNING_GROUP'),'a listening exercise does not change the explicitly named reading-writing pair');
 threePairs.evidence[0].value.bothBelow60Students=0;
 assert(codes(plan,threePairs).includes('EMPTY_LEARNING_GROUP'));
});

test('character means and measured students do not establish widespread individual difficulty',()=>{
 for(const text of [
  '「潤」的平均分數為68.9分，各有20名學生受測，代表這些字音的問題具有普遍性。',
  '多數學生讀不準這些字，下一課要共同練習。',
  '全班都有字音困難。'
 ])assert(codes({findings:[{evidenceIds:['F002'],interpretation:text}]},pairedPayload()).includes('UNSUPPORTED_CHARACTER_PREVALENCE'),text);
 const natural='「潤」字平均68.9分，涵蓋20人，可先共同跟讀所在原句，再逐一聽取，讓仍需鞏固的學生多讀一次。';
 assert.deepEqual(codes({findings:[{evidenceIds:['F002'],interpretation:natural}],teachingActions:[action('共同跟讀',['教師帶全班跟讀原句，然後個別聽取「潤」字。'])]},pairedPayload()),[]);
});

test('paired low-score overlap supports teaching groups rather than an ability correlation',()=>{
 assert(codes({findings:[{interpretation:'朗讀與辨音同時低於60分的有3人，顯示朗讀和辨音的關聯稍高。'}]},pairedPayload()).includes('UNSUPPORTED_DOMAIN_ASSOCIATION'));
 assert(!codes({findings:[{interpretation:'朗讀與辨音的跟進名單有重疊，可讓這批學生先聽示範再跟讀。'}]},pairedPayload()).includes('UNSUPPORTED_DOMAIN_ASSOCIATION'));
});

test('the actual v13 paragraph loses its defensive explanation while direct teaching stays natural',()=>{
 const p={reportStyle:'narrative-teaching-review'};
 const actual='逐字平均分是全班整體表現的參考，不能直接推論每個人都錯，因此個別聽取是必要的。';
 const issue=inspectAnalysis({findings:[{interpretation:actual}]},p).find(item=>item.code==='REPORT_DEFENSIVE_LANGUAGE');
 assert(issue);assert(issue.message.includes('刪除整句「'+actual.slice(0,-1)+'」'));assert.match(issue.message,/不要改寫成另一句/);
 for(const text of ['平均分只是參考，不能代表全班。','逐字平均不等於人人讀錯。','不能由均分判斷所有學生的字音表現。','平均分僅供選擇句子之用，實際仍需以個別聽取結果安排後續。','朗讀評分只供選擇原句，實際仍需逐一聽取。','教師應以逐字平均和已有評分人數20人作為選擇句子的依據，不將平均低分推論為全班讀錯，而是透過共同跟讀與個別聽取，找出真正需要再練的學生。','不把均分推断为所有学生读错，教师仍需逐一听取。','教師應以個別聽取結果安排跟讀，避免以平均分推斷全班皆錯。'])
  assert(codes({overview:text},p).includes('REPORT_DEFENSIVE_LANGUAGE'),text);
 assert(codes({overview:'由於平均分僅反映整體趨勢，教師在個別聽取時應分辨哪些學生需要全班再練，哪些只需個別提醒。'},p).includes('REPORT_DEFENSIVE_LANGUAGE'));
 for(const text of ['全班跟讀後，教師逐一聽取，讓仍需鞏固的學生再讀一次。','教師依學生重讀的實際表現，調整小組練習。','教師不能忽略尚未留下朗讀紀錄的學生，下一課先聽取其朗讀。'])
  assert(!codes({overview:text},p).includes('REPORT_DEFENSIVE_LANGUAGE'),text);
});

test('paired low-score overlap cannot be misreported as missing another score',()=>{
 const p={reportStyle:'narrative-teaching-review',evidence:[
  {id:'F001',label:'朗讀字音評分與默寫辨識準確度：同一批學生觀察',source:'平台評分',value:{bothMeasuredStudents:20,bothBelow60Students:3,leftBelow60Students:7,rightBelow60Students:8,leftOnlyBelow60Students:4,rightOnlyBelow60Students:5}},
  {id:'F002',label:'默寫辨識準確度：個人平均低於60分的名冊學生',scope:'所選範圍',source:'平台評分',value:8},
  {id:'F003',label:'朗讀字音評分：個人平均低於60分的名冊學生',scope:'所選範圍',source:'平台評分',value:7}
 ]};
 const actual='朗讀字音評分與默寫辨識準確度兩項都有評分的學生共20人。其中僅朗讀低於60分者4人，僅默寫低於60分者5人，兩項皆低者3人。另外，默寫辨識個人平均低於60分的名冊學生共8人，除上述5人外，尚有3人未同時留下朗讀評分。';
 const inspect=(text,source=p)=>inspectAnalysis({findings:[{evidenceIds:source.evidence.map(f=>f.id),interpretation:text}]},source);
 const issue=inspect(actual).find(item=>item.code==='REPORT_OVERLAP_AS_MISSING');
 assert(issue);assert.match(issue.message,/全體該項低分8人/);assert.match(issue.message,/未留下另一項評分的是0人，不是3人/);assert.match(issue.message,/刪除整句/);
 for(const text of ['默寫平均低於60分的8人中，有3名學生沒有朗讀評分。','朗讀個人平均低於60分的有7人，其中3人未同時留下默寫評分。'])assert(inspect(text).some(item=>item.code==='REPORT_OVERLAP_AS_MISSING'),text);
 for(const text of ['默寫個人平均低於60分的共8人，其中僅默寫低5人，兩項皆低3人。','朗讀與默寫都有評分的20人，僅朗讀低4人，僅默寫低5人，兩項皆低3人。','全班有3人未留下朗讀評分。'])assert(!inspect(text).some(item=>item.code==='REPORT_OVERLAP_AS_MISSING'),text);
 const missing=structuredClone(p);missing.evidence[1].value=11;
 const validMissing='默寫個人平均低於60分的共11人，其中3人未同時留下朗讀評分。';
 assert(!inspect(validMissing,missing).some(item=>item.code==='REPORT_OVERLAP_AS_MISSING'),'actual missing scores use all paired low students, including the overlap');
 const reversed=structuredClone(p);reversed.evidence[0].label='默寫辨識準確度與朗讀字音評分：同一批學生觀察';
 Object.assign(reversed.evidence[0].value,{leftBelow60Students:8,rightBelow60Students:7,leftOnlyBelow60Students:5,rightOnlyBelow60Students:4});
 assert(inspect(actual,reversed).some(item=>item.code==='REPORT_OVERLAP_AS_MISSING'),'pair ordering cannot change which group is missing');
});

function focusedGroupingPayload(){return {reportStyle:'narrative-teaching-review',teachingGroups:[{evidenceId:'F002',domains:['朗讀字音評分','辨音答題準確度'],bothMeasuredStudents:20,groups:[{count:6,focus:['朗讀字音評分']},{count:4,focus:['辨音答題準確度']},{count:3,focus:['朗讀字音評分','辨音答題準確度']}]}],evidence:[
 {id:'F001',label:'朗讀字音評分與默寫辨識準確度：同一批學生觀察',source:'平台評分',value:{bothMeasuredStudents:20,bothBelow60Students:0,leftBelow60Students:9,rightBelow60Students:3,leftOnlyBelow60Students:9,rightOnlyBelow60Students:3}},
 {id:'F002',label:'朗讀字音評分與辨音答題準確度：同一批學生觀察',source:'平台評分',value:{bothMeasuredStudents:20,bothBelow60Students:3,leftBelow60Students:9,rightBelow60Students:7,leftOnlyBelow60Students:6,rightOnlyBelow60Students:4}},
 {id:'F003',label:'默寫辨識準確度：個人平均低於60分的名冊學生',scope:'所選範圍',source:'平台評分',value:4}
]};}

test('the actual v13 second pair and whole-class-versus-paired split cannot reach the report',()=>{
 const p=focusedGroupingPayload();
 const actual='從同一批學生觀察可見，朗讀字音與辨音答題的跟進對象有重疊：兩項皆低於60分的有3人，另有6人僅朗讀低、4人僅辨音低。默寫辨識與朗讀的同一批學生中，兩項皆低者為0，顯示默寫困難與朗讀困難並未重疊，因此默寫跟進可獨立安排。默寫辨識低於60分的4人中，有3人僅默寫低，可針對「街、潤、酥」三字進行書寫練習。';
 const result=codes({findings:[{evidenceIds:['F001','F002','F003'],interpretation:actual}]},p);
 assert(result.includes('REPORT_MULTIPLE_GROUPING_PAIRS'));assert(result.includes('REPORT_MIXED_GROUP_DENOMINATORS'));
 const corrected='在朗讀與辨音都有評分的20人中，兩項皆低於60分的有3人，僅朗讀低的6人，僅辨音低的4人。下一課讓兩項都需跟進的學生先聽原句再讀，另外兩組分別跟讀和聽後作答。默寫低於60分的4人練寫「街、潤、酥」，教師觀察字形。';
 assert.deepEqual(codes({findings:[{evidenceIds:['F002','F003'],interpretation:corrected}]},p),[]);
});

test('one grouping pair is followed across findings and advice without treating a third activity as a second pair',()=>{
 const p=focusedGroupingPayload();
 const finding={evidenceIds:['F002'],interpretation:'朗讀與聽辨的跟進名單有重疊，下一課先聽原句再讀。'};
 const valid={findings:[finding],teachingActions:[action('朗讀與聽辨分組',['兩項都有評分的學生，依實際組別先聽後讀。其後安排默寫練習，教師檢查字形。'])]};
 assert(!codes(valid,p).includes('REPORT_MULTIPLE_GROUPING_PAIRS'));
 const wrong={...valid,reviewPlan:[action('另外分組',['朗讀與默寫的交集為0，可獨立安排。'])]};
 assert(codes(wrong,p).includes('REPORT_MULTIPLE_GROUPING_PAIRS'));
 assert(!codes({findings:[{interpretation:'朗讀與默寫都先由教師示範，學生再練習。'}]},p).includes('REPORT_MULTIPLE_GROUPING_PAIRS'),'ordinary mentions of two activities do not describe a paired cohort');
 assert(!codes({findings:[{interpretation:'整體而言，課堂應先處理朗讀缺測，再進行全班共同跟讀，最後分組練習默寫與聽辨。'}]},p).includes('REPORT_MULTIPLE_GROUPING_PAIRS'),'the actual live lesson order does not claim a second observed intersection');
});

test('actual first-and-third-line teaching cannot be ambiguously renamed the first two poem lines',()=>{
 const focus={readingLines:[{lineNumber:1,text:'天街小雨潤如酥'},{lineNumber:3,text:'最是一年春好處'}]};
 const p={reportStyle:'narrative-teaching-review',teachingFocus:[focus]};
 const actual='課堂可先全班跟讀「天街小雨潤如酥」和「最是一年春好處」，教師示範後，學生齊讀。其餘低於80的「看、勝、皇」則在第二、四句跟讀時一併處理，但先集中練好前兩句，讓學生有足夠次數熟習。';
 const issue=inspectAnalysis({findings:[{interpretation:actual}]},p).find(item=>item.code==='REPORT_AMBIGUOUS_LINE_REFERENCE');
 assert(issue);assert.match(issue.message,/1、3/);assert.match(issue.message,/定點改為「上述兩句」/);
 for(const replacement of ['上述兩句','第一、第三句'])assert(!codes({findings:[{interpretation:actual.replace('前兩句',replacement)}]},p).includes('REPORT_AMBIGUOUS_LINE_REFERENCE'));
 const firstTwo={...p,teachingFocus:[{readingLines:[{lineNumber:1,text:'天街小雨潤如酥'},{lineNumber:2,text:'草色遙看近卻無'}]}]};
 assert(!codes({findings:[{interpretation:'跟讀「天街小雨潤如酥」和「草色遙看近卻無」，先集中練好前兩句。'}]},firstTwo).includes('REPORT_AMBIGUOUS_LINE_REFERENCE'));
});

test('actual measured-student counts stay distinct from activity completion and future assignments',()=>{
 const p={reportStyle:'narrative-teaching-review',evidence:[
  {id:'F001',source:'平台評分',label:'朗讀字音評分：有評分的名冊學生',value:20},
  {id:'F002',source:'平台評分',label:'默寫辨識準確度：有評分的名冊學生',value:21},
  {id:'F003',source:'平台評分',label:'辨音答題準確度：有評分的名冊學生',value:22},
  {id:'F004',source:'structured_records',label:'有活動完成紀錄的名冊學生',value:22}
 ]};
 for(const text of ['朗讀字音評分有20人完成。','默寫辨識有21人完成。','辨音答題有22人完成。','同時，已完成的20名學生可進行延續練習。'])
  assert(codes({findings:[{evidenceIds:['F001','F002','F003'],interpretation:text}]},p).includes('REPORT_MEASUREMENT_CALLED_COMPLETION'),text);
 for(const text of ['朗讀已有20人留下評分，接著安排原句跟讀。','默寫已有21人留下評分。','有活動完成紀錄的22人可延續練習。','22人完成，另安排原句朗讀。','下一課請這20人完成朗讀練習。','已留下朗讀評分的20名學生可互相聽讀。'])
  assert(!codes({findings:[{evidenceIds:['F001','F002','F003','F004'],interpretation:text}]},p).includes('REPORT_MEASUREMENT_CALLED_COMPLETION'),text);
});
