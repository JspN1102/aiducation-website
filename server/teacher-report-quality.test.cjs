'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspectAnalysis}=require('../api/_lib/teacher-report-quality.cjs');
const payload={filters:{grade:2},teachingConstraints:[{grade:2,writing:{maxCharactersAcrossWholeReport:1,allowedCharacters:['舟']}}]};
const action=(title,steps)=>({title,steps});
const codes=(a,p=payload)=>inspectAnalysis(a,p).map(item=>item.code);
test('flags actual provider ability/source claims without changing the model text',()=>{
  const analysis={findings:[{title:'朗讀字音評分平均70分，顯示整體朗讀表現中等',interpretation:'平均71.4分，顯示辨識能力尚可。此分數未達高水準。'}],limitations:['瀏覽器自報分數未經核實，其可信度較低。']};
  const before=JSON.stringify(analysis),issues=inspectAnalysis(analysis,payload);
  assert.deepEqual(issues.map(i=>i.code),['UNSUPPORTED_ABILITY_LEVEL','UNSUPPORTED_SOURCE_COMPARISON']);assert.equal(JSON.stringify(analysis),before);
  assert(issues.every(i=>i.message.length>20&&i.path));
});
test('does not flag explicit negation of unsupported claims or ordinary evidence limits',()=>{
  const analysis={overview:'不能因70分稱為中等。尚無依據說基礎薄弱。不可判斷自報偏高。',limitations:['不能據此判斷瀏覽器自報可信度較低。','未有證據表明自報偏高。自報偏高的說法沒有依據。','並非能力薄弱。「中等」的說法不成立。','字音分數不能推斷聲母、韻母或聲調錯誤。','未見紀錄不等於沒有練習，未測不當作零分。']};
  assert.deepEqual(inspectAnalysis(analysis,payload),[]);
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
test('bounded, deterministic issues ignore malformed optional fields and do not invent judgments',()=>{
  assert.deepEqual(inspectAnalysis(null,{}),[]);assert.deepEqual(inspectAnalysis({findings:'invalid',teachingActions:null}),[]);
  const a={findings:Array.from({length:100},()=>({title:'中等'}))};assert.equal(inspectAnalysis(a,{}).length,1);assert.deepEqual(inspectAnalysis(a,{}),inspectAnalysis(a,{}));
});
test('flags actual cross-construct comparison headings, preserves numeric thresholds and same-item follow-up',()=>{
  assert(codes({findings:[{title:'朗讀與默寫平均分接近'},{title:'辨音答題準確度較高'}]}).includes('UNSUPPORTED_SCORE_COMPARISON'));
  assert.deepEqual(inspectAnalysis({overview:'字音分數低於60分。不能說辨音答題準確度較高。',findings:[{interpretation:'同一原句的朗讀平均分比上次較高，只作描述。'}]},payload),[]);
});
test('flags listening choices that are all present in the specified first line, not an unambiguous or explicit multi-choice task',()=>{
  const p={...payload,curriculum:[{title:'題西林壁',lines:[{text:'橫看成嶺側成峯'}]},{title:'初春小雨',lines:[{text:'天街小雨潤如酥'}]}]};
  for(const step of ['教師朗讀《題西林壁》首句，學生從「橫」「嶺」中選出聽到的字。','教師朗讀《初春小雨》第一句，學生從「街」「潤」「酥」中選出聽到的字。','教師朗讀「橫看成嶺側成峯」，學生從「橫」「嶺」中選出聽到的字。'])assert(codes({teachingActions:[action('聽選',[step])]},p).includes('AMBIGUOUS_LISTENING_CHOICES'),step);
  for(const step of ['教師朗讀《題西林壁》首句，學生從「橫」「雨」中選出聽到的字。','教師朗讀《題西林壁》首句，學生從「橫」「嶺」中選出全部聽到的字。','教師朗讀《題西林壁》首句，學生跟讀「橫」「嶺」。'])assert(!codes({teachingActions:[action('聽選',[step])]},p).includes('AMBIGUOUS_LISTENING_CHOICES'),step);
});
