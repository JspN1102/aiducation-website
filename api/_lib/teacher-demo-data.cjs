'use strict';
// In-memory demonstration only. No account store, research writer or provider is
// called here. All identities/events have their own explicit synthetic version.
const research=require('./research-store.cjs');
const {normalizeFilters,buildDataset}=require('./teacher-data.cjs');
const poems=require('../../maanshan/poems.json').poems;
const VERSION='teacher-demo-v4-scoped-characters',DAY_MS=86400000,MAX_SNAPSHOTS=6;
const CLASS_COUNTS=Object.freeze([5,5,5,5,5,6]);
const ROSTER=Object.freeze(CLASS_COUNTS.flatMap((count,index)=>Array.from({length:count},(_,classIndex)=>Array.from({length:25},(_,n)=>{
  const grade=index+1,cls=String.fromCharCode(65+classIndex),classNo=n+1,tag=`g${grade}_${cls}_${String(classNo).padStart(2,'0')}`;
  return Object.freeze({id:'s_demo_'+tag,researchId:'r_demo_'+tag,role:'student',displayName:`示範學生 ${grade}${cls}${String(classNo).padStart(2,'0')}`,grade,cls,classNo,demo:true});
})).flat()));
let current=null;
function demoRoster(people){
 if(people===undefined)return ROSTER.map(person=>({...person}));
 if(!Array.isArray(people))throw new TypeError('INVALID_DEMO_ROSTER');
 return people.filter(p=>p.role==='student').map((p,index)=>{
  if(!Number.isInteger(p.grade)||p.grade<1||p.grade>6||!String(p.cls||'').match(/^[A-F]$/)||typeof p.displayName!=='string'||!p.displayName.trim())throw new TypeError('INVALID_DEMO_ROSTER');
  const tag=research.hash(String(p.id||p.researchId||`${p.grade}/${p.cls}/${p.classNo}/${index}`)).slice(0,24);
  return {id:'s_demo_'+tag,researchId:'r_demo_'+tag,role:'student',displayName:p.displayName,grade:p.grade,cls:p.cls,classNo:Number.isInteger(p.classNo)&&p.classNo>0?p.classNo:index+1,demo:true};
 });
}
function seed(value){return Number.parseInt(research.hash(value).slice(0,8),16);}
function uuid(value){const h=research.hash(VERSION+'/'+value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function clamp(value){return Math.max(0,Math.min(100,value));}
function readingScore(person,visit,profile){
  if(person.classNo===1)return 0;
  if(person.classNo===2)return null;
  const change=profile%4===0?-visit*3:visit*3;
  return clamp(43+profile%48+change+(person.cls.charCodeAt(0)%5-2)*2);
}
function makeBase(today,people,rosterKey,poemId){
  const midnight=Date.parse(today),rows=[];
  for(const person of people){
    // Three clearly present but unstarted roster members per class.
    if(person.classNo>=23)continue;
    const poem=poems.find(item=>item.grade===person.grade&&(poemId===undefined||item.id===poemId));if(!poem)continue;
    const profile=seed(person.researchId);
    const offsets=[20+profile%10,10+profile%10,1+profile%9,profile%7];
    for(let visit=0;visit<4;visit++){
      const dayAt=midnight-offsets[visit]*DAY_MS;
      // Events at midnight keep this day's synthetic data deterministic even if
      // the demonstration is opened shortly after the UTC date changes.
      const at=new Date(dayAt).toISOString(),base=`${today}/${person.researchId}/${poem.id}/${visit}`,sessionId=uuid(base+'/session');let sequence=0,activeMs=0,eventOrdinal=0;
      const attemptId=uuid(base+'/attempt'),mode=visit===1&&person.classNo%11===0?'review':'standard';
      function emit(activity,type,changes={},source='client',advance=0){
        activeMs+=advance;
        const event={eventId:uuid(base+'/'+eventOrdinal++),sessionId,seq:sequence++,clientAt:at,activeMs,poemId:poem.id,activity,type,appVersion:VERSION,contentVersion:VERSION+`-poem${poem.id}`,context:{mode},...changes};
        research.validateEvent(event,source==='server_verified');
        rows.push({schemaVersion:1,researchId:person.researchId,grade:person.grade,cls:person.cls,source,serverReceivedAt:at,qualityFlags:[],event,eventChecksum:research.hash(research.canonical({researchId:person.researchId,source,event}))});
      }
      function outcome(operation,activity,itemId,score,extra={}){
        const correct=operation==='reading'||score===null?null:score===100;
        emit(activity,'provider_result',{attemptId,itemId,provider:'synthetic',model:'teacher-demo',providerVersion:VERSION,operation,result:{status:score===null?'unmeasured':correct===null?'completed':correct?'correct':'incorrect',score,correct},...extra},'server_verified');
      }
      emit('listen','playback_started',{itemId:`p${poem.id}.l0`,metrics:{playbackRate:.8}});
      emit('listen','playback_ended',{itemId:`p${poem.id}.l0`,metrics:{playbackMs:18000,playbackRate:.8}},'client',18000+profile%12000);
      const score=readingScore(person,visit,profile);
      emit('read','activity_start',{attemptId,itemId:`p${poem.id}.l0`});
      if(person.classNo!==3)poem.lines.forEach((poemLine,lineIndex)=>outcome('reading','read',`p${poem.id}.l${lineIndex}`,score,{...(score===null?{}:{wordScores:[...poemLine.text].filter(char=>/\p{Script=Han}/u.test(char)).map((char,index)=>({index,char,score:score===0?0:clamp(((index+lineIndex)%4===0?67:91)+profile%8+visit)})),metrics:{accuracyScore:score,fluencyScore:clamp(score-3),completionScore:score===0?0:100}})}));
      // A browser outcome deliberately differs and must remain a separate source.
      emit('read','feedback_shown',{attemptId,itemId:`p${poem.id}.l0`,result:{status:score===null?'unmeasured':'completed',score:score===null?null:clamp(score+(profile%7-3)),correct:null}},'client',23000+profile%17000);
      emit('read','activity_end',{attemptId,itemId:`p${poem.id}.l0`,result:{status:'completed'}},'client',4000);
      emit('challenge','activity_start',{attemptId,itemId:`g${person.grade}.sound0`});
      const soundScore=(profile+visit)%5===0?0:100;
      outcome('challenge','challenge',`g${person.grade}.game0`,null,{context:{mode,itemType:'microgame',position:1,total:5},result:{status:'completed',score:null,correct:null}});
      outcome('challenge','challenge',`g${person.grade}.sound0`,soundScore,{context:{mode,itemType:'sound',position:2,total:5}});
      emit('challenge','answer_submitted',{attemptId,itemId:`g${person.grade}.sound0`,context:{mode,itemType:'sound'},result:{status:soundScore?'correct':'incorrect',score:soundScore,correct:!!soundScore}},'client',12000+profile%8000);
      if(visit===0||visit===3){
        const type=person.grade<=2?'match':person.grade<=4?'sequence':'scene-builder',value=(profile+visit)%4?100:0;
        outcome('challenge','challenge',`g${person.grade}.${type}0`,value,{context:{mode,itemType:type,position:4,total:5}});
      }
      emit('challenge','activity_end',{attemptId,itemId:`g${person.grade}.sound0`,result:{status:'completed'}},'client',5000);
      if(visit%2===1){
        const writing=person.classNo===2?null:(profile+visit)%4===0?0:100;
        emit('writing','activity_start',{attemptId,itemId:`g${person.grade}.dictation0`,context:{mode,itemType:'dictation'}});
        outcome('handwriting','writing',`g${person.grade}.dictation0`,writing,{context:{mode,itemType:'dictation',position:3,total:5}});
        emit('writing','activity_end',{attemptId,itemId:`g${person.grade}.dictation0`,context:{mode,itemType:'dictation'},result:{status:'completed'}},'client',38000+profile%20000);
      }
      if(visit===2){
        emit('animation','playback_started',{itemId:`p${poem.id}.animation`});
        emit('animation','playback_ended',{itemId:`p${poem.id}.animation`,metrics:{watchedMs:90000,videoPositionMs:90000}},'client',90000);
      }
    }
  }
  return {today,rosterKey,generatedAt:new Date(midnight).toISOString(),rows,snapshots:new Map()};
}
function createDemoDataset(input={},options={}){
  const now=options.now===undefined?Date.now():Number(options.now);
  if(!Number.isFinite(now))throw new TypeError('INVALID_DEMO_DATE');
  const today=new Date(now).toISOString().slice(0,10);
  const filters=normalizeFilters({...input,from:input.from||new Date(Date.parse(today)-29*DAY_MS).toISOString().slice(0,10),to:input.to||today});
  const people=demoRoster(options.roster),rosterKey=research.hash(research.canonical(people));
  if(!current||current.today!==today||current.rosterKey!==rosterKey)current={today,rosterKey,bases:new Map(),snapshots:new Map()};
  const key=research.canonical(filters),cached=current.snapshots.get(key);
  if(cached){current.snapshots.delete(key);current.snapshots.set(key,cached);return structuredClone(cached);}
  const scopeKey=research.canonical([filters.grade,filters.poemId,filters.cls,filters.student].map(value=>value??null));
  let base=current.bases.get(scopeKey);
  if(!base){
    const selected=people.filter(person=>(filters.grade===undefined||person.grade===filters.grade)&&(!filters.cls||person.cls===filters.cls)&&(!filters.student||person.researchId===filters.student));
    base=makeBase(today,selected,rosterKey,filters.poemId);
    if(current.bases.size>=MAX_SNAPSHOTS)current.bases.delete(current.bases.keys().next().value);
    current.bases.set(scopeKey,base);
  }
  const dataset=buildDataset({rows:base.rows,source:'synthetic_demo',syncStatus:'current',lastImportedAt:base.generatedAt,integrity:{pendingObjects:0,integrityIssues:0,retryPending:0}},people,filters,Date.parse(base.generatedAt));
  dataset.demo=true;dataset.demoVersion=VERSION;
  // A domain-separated hash makes collisions with formal snapshots impossible
  // even if a caller accidentally builds an otherwise identical empty scope.
  dataset.snapshotId=research.hash(VERSION+'/isolated/'+today+'/'+dataset.snapshotId);
  dataset.analytics.demo=true;dataset.analytics.demoVersion=VERSION;
  dataset.analytics.sync.demo=true;
  dataset.demoNotice='模擬資料：本報告使用模擬學習紀錄。';
  if(current.snapshots.size>=MAX_SNAPSHOTS)current.snapshots.delete(current.snapshots.keys().next().value);
  current.snapshots.set(key,dataset);return structuredClone(dataset);
}
module.exports={VERSION,createDemoDataset,demoRoster};
