'use strict';
const research = require('./research-store.cjs');
const auth = require('./school-auth.cjs');
const {poems} = require('../../maanshan/poems.json');
const CONSTRUCTS = Object.freeze({ 'reading.pronunciation':'朗讀字音評分', 'writing.dictation':'聽寫', 'sound.recognition':'聽音辨識', 'match.accuracy':'配對', 'sequence.accuracy':'排序', 'scene_builder.accuracy':'場景組合' });
const SOURCES = Object.freeze({serverVerified:'平台評分',clientReported:'練習回報'});
class TeacherDataError extends Error { constructor(code,status=503){super(code);this.code=code;this.status=status;} }
function normalizeFilters(input={}) {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['grade','poemId','cls','from','to','attempt','activity','student'].includes(key))) throw new TeacherDataError('INVALID_FILTER',400);
  const copy={...input};for(const key of ['grade','poemId'])if(Number.isInteger(copy[key]))copy[key]=String(copy[key]);
  return research.filtersFrom(copy);
}
function requireTeacherScope(filters){
  if(filters.grade===undefined||filters.poemId===undefined)throw new research.ResearchError('TEACHER_SCOPE_REQUIRED',400);
  if(!poems.some(poem=>poem.id===Number(filters.poemId)&&poem.grade===Number(filters.grade)))throw new research.ResearchError('POEM_GRADE_MISMATCH',400);
  return filters;
}
function fingerprint(filters,students,rows) {
  return research.hash(research.canonical({filters,roster:students.map(({researchId,displayName,grade,cls,classNo,rosterMatched})=>({researchId,displayName,grade,cls,classNo,rosterMatched})),events:rows.map(row=>[row.researchId,row.source,row.event.eventId,row.eventChecksum]).sort((a,b)=>research.canonical(a).localeCompare(research.canonical(b)))}));
}
function buildDataset(raw,people,filters,now=Date.now()) {
  const rows=raw.rows.filter(row=>research.matches(row,filters));
  const analytics=research.aggregateEvents(rows,filters,{generatedAt:new Date(now).toISOString(),source:raw.source||'postgres',lastImportedAt:raw.lastImportedAt||null,syncStatus:raw.syncStatus,integrity:raw.integrity,includeStudentDetails:true});
  const stats=new Map(analytics.students.map(row=>[row.researchId,row]));
  const roster=people.filter(person=>(filters.grade===undefined||person.grade===filters.grade)&&(!filters.cls||person.cls===filters.cls)&&(!filters.student||person.researchId===filters.student));
  const students=roster.map(person=>({researchId:person.researchId,displayName:person.displayName,grade:person.grade,cls:person.cls,classNo:person.classNo??null,rosterMatched:true,stats:stats.get(person.researchId)||null}));
  const known=new Set(students.map(person=>person.researchId));
  for(const row of analytics.students)if(!known.has(row.researchId))students.push({researchId:row.researchId,displayName:'未連結姓名',grade:row.grade,cls:row.cls,classNo:null,rosterMatched:false,stats:row});
  students.sort((a,b)=>a.grade-b.grade||a.cls.localeCompare(b.cls)||(a.classNo??999)-(b.classNo??999)||a.researchId.localeCompare(b.researchId));
  const withRecords=students.filter(person=>person.rosterMatched&&person.stats?.nEvents>0).length;
  return {schemaVersion:1,filters,snapshotId:fingerprint(filters,students,rows),generatedAt:analytics.generatedAt,analytics,students,
    rosterSummary:{totalStudents:roster.length,withRecords,noRecords:roster.length-withRecords,unmatchedWithRecords:students.length-roster.length}};
}
function buildFollowUp(dataset) {
  const absenceReliable=['direct','current','fresh','ready','ok','synced','live','published'].includes(dataset.analytics?.sync?.status);
  const students=dataset.students.flatMap(person=>{
    const selected=person.stats?.[dataset.filters.attempt]||person.stats;
    const reasons=Object.entries(CONSTRUCTS).flatMap(([construct,label])=>Object.entries(SOURCES).flatMap(([source,sourceLabel])=>{
      const metric=selected?.byConstruct?.[construct]?.[source],score=metric?.meanScore;
      return metric?.measuredN>0&&typeof score==='number'&&Number.isFinite(score)&&score<60?[{construct,label,score,source,sourceLabel,measuredN:metric.measuredN}]:[];
    }));
    return reasons.length?[{researchId:person.researchId,displayName:person.displayName,grade:person.grade,cls:person.cls,classNo:person.classNo,reasons}]:[];
  });
  return {students,unstartedIds:dataset.students.filter(person=>person.rosterMatched&&!person.stats?.nEvents).map(person=>person.researchId),absenceReliable,
    criteria:'下列學生有分項平均分低於 60 分，可先安排相應內容的聽讀或練習。'};
}
function createDatasetLoader({requireTeacher=req=>auth.requireActor(req,{roles:['teacher']}),listAccounts=req=>auth.listAccounts(req),readRows=async filters=>{
  if(!research.mode())throw new TeacherDataError('RESEARCH_DISABLED');
  if(research.mode()==='postgres')return {rows:await research.readPostgres(filters),source:'postgres'};
  const data=await research.readPublished(filters);return {...data,source:'published_snapshot',syncStatus:data.manifest.status,integrity:data.manifest.integrity};
},now=Date.now,ttlMs=15000,timeoutMs=15000,maxEntries=8}={}) {
  const cache=new Map();
  return async function loadTeacherDataset(req,input={}) {
    const actor=await requireTeacher(req);if(!actor||actor.role!=='teacher')throw new auth.AuthError(403,'ROLE_FORBIDDEN');
    const filters=normalizeFilters(input),cohort=await require('./student-learning-reset.cjs').current(),key=research.canonical([actor.id,filters,cohort?.epoch||null]),prior=cache.get(key);
    if(prior&&prior.expires>now())return structuredClone(await prior.promise);
    if(prior)cache.delete(key);
    if(cache.size>=maxEntries){const finished=[...cache].find(([,entry])=>entry.done);if(finished)cache.delete(finished[0]);else throw new TeacherDataError('EXPORT_BUSY',429);}
    const entry={expires:Infinity,done:false};
    let timer;
    let settled=false;
    const work=Promise.all([listAccounts(req),readRows(filters)]).then(([people,raw])=>{
      const dataset=buildDataset(raw,people,filters,now());
      if(cohort){dataset.learningEpoch=cohort.epoch;dataset.snapshotId=research.hash(research.canonical([dataset.snapshotId,cohort.epoch]));}
      return dataset;
    });
    void work.finally(()=>{settled=true;if(entry.timedOut&&cache.get(key)===entry)cache.delete(key);}).catch(()=>{});
    entry.promise=Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{entry.timedOut=true;reject(new TeacherDataError('EXPORT_TIMEOUT',504));},timeoutMs);})]).then(dataset=>{entry.done=true;entry.expires=now()+ttlMs;return dataset;},error=>{if(settled&&cache.get(key)===entry)cache.delete(key);throw error;}).finally(()=>clearTimeout(timer));
    cache.set(key,entry);return structuredClone(await entry.promise);
  };
}
module.exports={CONSTRUCTS,SOURCES,TeacherDataError,normalizeFilters,requireTeacherScope,buildDataset,buildFollowUp,createDatasetLoader,loadTeacherDataset:createDatasetLoader()};
