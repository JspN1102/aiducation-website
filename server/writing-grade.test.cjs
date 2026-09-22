'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const grade=require('../api/_lib/writing-grade.cjs');
const repo=path.resolve(__dirname,'..');
const cases=[
 {label:'target first',candidates:['霑','雨'],accept:['霑','沾'],drawn:15,correct:true,recognized:'霑'},
 {label:'accepted variant first',candidates:['沾','霑'],accept:['霑','沾'],drawn:8,correct:true,recognized:'沾'},
 {label:'component above the fully drawn character',candidates:['雨','霑','霈'],accept:['霑','沾'],drawn:15,correct:true,recognized:'霑'},
 {label:'component above the character with merged strokes',candidates:['雨','霑'],accept:['霑','沾'],drawn:12,correct:true,recognized:'霑'},
 {label:'component alone',candidates:['雨','霑'],accept:['霑','沾'],drawn:9,correct:false,recognized:'雨'},
 {label:'target below the third guess',candidates:['雨','霈','露','霑'],accept:['霑','沾'],drawn:16,correct:false,recognized:'雨'},
 {label:'split into two characters',candidates:['雨沾','霑'],accept:['霑','沾'],drawn:15,correct:true,recognized:'霑'},
 {label:'similar full-size character first',candidates:['借','惜'],accept:['惜'],drawn:11,correct:false,recognized:'借'},
 {label:'simplified look-alike first',candidates:['谭','潭'],accept:['潭'],drawn:15,correct:false,recognized:'谭'},
 {label:'simple character never lenient',candidates:['日','白'],accept:['白'],drawn:5,correct:false,recognized:'日'},
 {label:'unknown first character stays strict',candidates:['a','霑'],accept:['霑'],drawn:16,correct:false,recognized:'a'},
 {label:'nothing recognised',candidates:[],accept:['霑'],drawn:16,correct:false,recognized:null}
];
test('stroke table covers the unified ideographs',()=>{
 const table=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/vendor/stroke-counts.json'),'utf8'));
 assert.equal(table.length,0x9FFF-0x4E00+1);
 assert.deepEqual(['雨','霑','沾','白','山','岸','崖','a','雨雨',''].map(grade.strokeCount),[8,16,8,5,3,8,11,0,0,0]);
 assert.equal(grade.strokeReader(table)('霑'),16);
 assert.throws(()=>grade.strokeReader(table.slice(1)));
});
test('a lower-ranked target counts only for a fully drawn character whose first guess is one of its parts',()=>{
 for(const c of cases){
  const verdict=grade.gradeCandidates(c.candidates,new Set(c.accept),{drawn:c.drawn,strokeOf:grade.strokeCount});
  assert.deepEqual({correct:verdict.correct,recognized:verdict.recognized},{correct:c.correct,recognized:c.recognized},c.label);
  assert.equal(verdict.pending,false,c.label);
 }
 assert.equal(grade.gradeCandidates(['雨','霑'],new Set(['霑']),{drawn:15}).pending,true,'needs the table');
 assert.equal(grade.gradeCandidates(['雨','霑'],new Set(['霑']),{drawn:3}).pending,false,'too few strokes to bother');
 assert.equal(grade.gradeCandidates(['雨','霑'],new Set(['霑']),{drawn:15,strokeOf:()=>0}).correct,false,'no table means strict');
});
test('the browser copy of the rule gives the same verdicts',async()=>{
 const esm=await import(pathToFileURL(path.join(repo,'maanshan/writing-grade.mjs')).href);
 assert.deepEqual(esm.LENIENCY,grade.LENIENCY);
 const table=JSON.parse(fs.readFileSync(path.join(repo,'maanshan/vendor/stroke-counts.json'),'utf8')),strokeOf=esm.strokeReader(table);
 for(const c of cases)assert.deepEqual(esm.gradeCandidates(c.candidates,new Set(c.accept),{drawn:c.drawn,strokeOf}),grade.gradeCandidates(c.candidates,new Set(c.accept),{drawn:c.drawn,strokeOf:grade.strokeCount}),c.label);
});
