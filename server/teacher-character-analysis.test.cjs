'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const research=require('../api/_lib/research-store.cjs'),{poems}=require('../maanshan/poems.json');
const filters={from:'2026-09-20',to:'2026-09-20',attempt:'latest'};
function row({student='r_test_alpha',grade=1,cls='A',line=0,words=[],at=0,source='server_verified',mode='standard',version='v1',qualityFlags=[],total=90}={}){
 return {researchId:student,grade,cls,source,qualityFlags,serverReceivedAt:new Date(Date.parse('2026-09-20T08:00:00Z')+at).toISOString(),event:{eventId:randomUUID(),sessionId:randomUUID(),seq:0,activeMs:0,poemId:grade,activity:'read',type:source==='server_verified'?'provider_result':'feedback_shown',operation:'reading',attemptId:randomUUID(),itemId:`p${grade}.l${line}`,contentVersion:version,context:{mode},result:{score:total,status:total===null?'unmeasured':'completed'},wordScores:words}};
}
const words=(...scores)=>scores.map((score,index)=>({index,char:'鵝',score}));
const analysis=(rows,extra={})=>research.aggregateEvents(rows,{...filters,...extra}).readingCharacterAnalysis;
test('whole poem preserves repeated positions, zero, null, and averages only verified character samples',()=>{
 const data=analysis([row({words:words(0,79,80)}),row({student:'r_test_beta',words:words(100,81)})],{grade:1,cls:'A'});
 assert.equal(data.poems.length,1);assert.equal(data.poems[0].lines.length,4);const line=data.poems[0].lines[0];
 assert.deepEqual(line.words.map(word=>word.meanScore),[50,80,80]);assert.deepEqual(line.words.map(word=>word.count),[2,2,1]);assert.equal(line.punctuation,'，');assert.deepEqual(line.words.map(word=>word.pinyin),['é','é','é']);
 assert(data.poems[0].lines[1].words.every(word=>word.meanScore===null&&word.count===0));
});
test('scope, quality, review, client scores and missing word measurements never leak into character averages',()=>{
 const rows=[row({words:words(70)}),row({cls:'B',words:words(100)}),row({grade:2,words:[{index:0,char:'李',score:100}]}),row({words:words(100),qualityFlags:['invalid']}),row({words:words(100),mode:'review'}),row({words:words(100),source:'client'}),row({student:'r_test_empty',words:[],total:100})];
 const data=analysis(rows,{grade:1,cls:'A'});assert.equal(data.poems[0].lines[0].words[0].meanScore,70);assert.equal(data.poems[0].lines[0].words[0].count,1);
 const empty=analysis(rows,{grade:1,cls:'C'});assert(empty.poems[0].lines.every(line=>line.words.every(word=>word.meanScore===null)));
});
test('first/latest choose a recording per learner and line across versions; latest missing does not reuse an old score',()=>{
 const rows=[row({words:words(20),at:0,version:'old'}),row({words:words(90),at:1000,version:'new'})];
 assert.equal(analysis(rows,{grade:1}).poems[0].lines[0].words[0].meanScore,90);assert.equal(analysis(rows,{grade:1,attempt:'first'}).poems[0].lines[0].words[0].meanScore,20);
 rows.push(row({words:[],total:null,at:2000,version:'new'}));assert.equal(analysis(rows,{grade:1}).poems[0].lines[0].words[0].meanScore,null);
});
test('long poem excludes punctuation from SOE indices and retains punctuation in the reference',()=>{
 const data=analysis([row({grade:5,words:[{index:5,char:'草',score:78},{index:6,char:'盛',score:84},{index:7,char:'錯',score:99},{index:99,char:'豆',score:100}]})],{grade:5});
 const line=data.poems[0].lines[0];assert.equal(line.words.length,10);assert.equal(line.text,'種豆南山下，草盛豆苗稀');assert.equal(line.words[5].char,'草');assert.equal(line.words[5].meanScore,78);assert.equal(line.words[6].pinyin,'shèng');assert.equal(line.words[7].meanScore,null);
 const all=analysis([]);assert.equal(all.poems.length,6);assert.equal(all.poems.flatMap(poem=>poem.lines.flatMap(line=>line.words)).length,poems.flatMap(poem=>poem.lines.flatMap(line=>[...line.text].filter(char=>/\p{Script=Han}/u.test(char)))).length);
});
test('character averages retain the true value around 80 rather than rounding across the colour boundary',()=>{
 const data=analysis([row({words:words(79.99,80,100)}),row({student:'r_test_beta',words:words(80,80,0)})],{grade:1});
 assert.equal(data.poems[0].lines[0].words[0].meanScore,79.995);assert.equal(data.poems[0].lines[0].words[1].meanScore,80);assert.equal(data.poems[0].lines[0].words[2].meanScore,50);
});
