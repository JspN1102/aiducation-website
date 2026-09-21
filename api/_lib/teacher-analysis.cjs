'use strict';
const crypto=require('node:crypto'),blob=require('@vercel/blob');
const research=require('./research-store.cjs');
const NS='maanshan-teacher-analysis-v1',PROMPT_VERSION='teacher-analysis-v19-precise-review';
const MAX_RECORD_BYTES=12*1024*1024,MAX_PROVIDER_BYTES=160*1024,MAX_RESPONSE_BYTES=128*1024;
const LEASE_MS=120000,PROVIDER_TIMEOUT_MS=42000;
const BACKGROUND_TIMEOUT_MS=180000,BACKGROUND_LEASE_MS=BACKGROUND_TIMEOUT_MS+30000;
const backgroundServices=new Set();let backgroundActive=0,backgroundScanning=false,backgroundTimer=null;
function wakeBackgroundWorker(){
 if(!backgroundTimer||backgroundScanning||backgroundActive>=2)return;
 backgroundScanning=true;
 void (async()=>{try{for(const service of backgroundServices){
  if(backgroundActive>=2)break;
  const task=await service.claimPending().catch(()=>null);if(!task)continue;
  backgroundActive++;
  void task().catch(()=>{}).finally(()=>{backgroundActive--;wakeBackgroundWorker();});
 }}finally{backgroundScanning=false;}})();
}
function startBackgroundWorker(){
 if(backgroundTimer)return()=>{};
 service(); // Register the formal namespace; demo registers its own service.
 backgroundTimer=setInterval(wakeBackgroundWorker,3000);backgroundTimer.unref?.();wakeBackgroundWorker();
 return()=>{clearInterval(backgroundTimer);backgroundTimer=null;};
}
const SCHEMA=`CREATE TABLE IF NOT EXISTS teacher_analysis_records (
 key text PRIMARY KEY, value jsonb NOT NULL, version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);`;
const CONSTRUCTS={'reading.pronunciation':'朗讀字音評分','writing.dictation':'默寫辨識準確度','sound.recognition':'辨音答題準確度','match.accuracy':'配對準確度','sequence.accuracy':'排序準確度','scene_builder.accuracy':'場景選擇準確度'};
const SOURCES={serverVerified:'平台評分',clientReported:'練習回報'};
const hash=research.hash,canonical=research.canonical;
class AnalysisError extends Error{constructor(code,status=503,retryable=true,retryAfterSeconds){super(code);Object.assign(this,{code,status,retryable,...retryAfterSeconds?{retryAfterSeconds}:{}});}}
const fail=(...args)=>{throw new AnalysisError(...args);};
const conflict=error=>error instanceof blob.BlobPreconditionFailedError||/already exists/i.test(String(error?.message||''));
function keyValid(key){return /^(?:report\/[a-f0-9]{64}|limit\/[a-f0-9]{64})$/.test(key);}
function reportKey(id){if(typeof id!=='string'||!/^ta_[a-f0-9]{64}$/.test(id))fail('INVALID_REPORT_ID',400,false);return 'report/'+id.slice(3);}
function bytes(value){const body=canonical(value);if(Buffer.byteLength(body)>MAX_RECORD_BYTES)fail('REPORT_TOO_LARGE',413,false);return body;}
function createBlobStore(client=blob,namespace=NS){if(![NS,NS+'-demo'].includes(namespace))throw new Error('Invalid teacher report namespace');return {
 async get(key){
  if(!keyValid(key))fail('INVALID_REPORT_KEY',400,false);
  const response=await client.get(`${namespace}/${key}.json`,{access:'private',useCache:false,abortSignal:AbortSignal.timeout(10000)});
  if(!response)return null;
  if(response.statusCode!==200||!response.stream||!response.blob?.etag||response.blob.size>MAX_RECORD_BYTES){await response.stream?.cancel();fail('REPORT_STORAGE_UNAVAILABLE');}
  const reader=response.stream.getReader(),chunks=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_RECORD_BYTES)fail('REPORT_TOO_LARGE',413,false);chunks.push(Buffer.from(part.value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  // Blob GET may weak-prefix the same stored entity tag when transport is
  // compressed. Conditional PUT requires the unprefixed stored entity tag.
  return {value:JSON.parse(Buffer.concat(chunks).toString('utf8')),version:response.blob.etag.replace(/^W\//,'')};
 },
 async cas(key,value,version){
  if(!keyValid(key))fail('INVALID_REPORT_KEY',400,false);
  try{await client.put(`${namespace}/${key}.json`,bytes(value),{access:'private',addRandomSuffix:false,allowOverwrite:version!==null&&version!==undefined,...version!==null&&version!==undefined?{ifMatch:version}:{},contentType:'application/json',abortSignal:AbortSignal.timeout(10000)});return true;}
  catch(error){if(conflict(error))return false;throw error;}
 }
};}
function createPostgresStore(db,prefix=''){if(!['','demo/'].includes(prefix))throw new Error('Invalid report prefix');return {
 async pending(at){return (await db.query("SELECT key,value,version::text FROM teacher_analysis_records WHERE key LIKE $1 AND value->>'status'='pending' AND value->>'background'='true' AND COALESCE((value->>'leaseUntil')::bigint,0)<=$2 AND COALESCE((value->>'retryAt')::bigint,0)<=$2 ORDER BY updated_at ASC LIMIT 1",[prefix+'report/%',at])).rows.map(row=>({...row,key:row.key.slice(prefix.length)}));},
 async get(key){if(!keyValid(key))fail('INVALID_REPORT_KEY',400,false);const row=(await db.query('SELECT value,version::text FROM teacher_analysis_records WHERE key=$1',[prefix+key])).rows[0];return row?{value:row.value,version:row.version}:null;},
 async cas(key,value,version){if(!keyValid(key))fail('INVALID_REPORT_KEY',400,false);const body=bytes(value);
  const result=version===null||version===undefined?await db.query('INSERT INTO teacher_analysis_records(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING RETURNING version',[prefix+key,body]):await db.query('UPDATE teacher_analysis_records SET value=$2::jsonb,version=version+1,updated_at=clock_timestamp() WHERE key=$1 AND version=$3 RETURNING version',[prefix+key,body,version]);
  return result.rowCount===1;
 }
};}
function configuredStore(env=process.env,namespace=NS){if(env.STUDENT_STORE==='blob')return createBlobStore(blob,namespace);return createPostgresStore(research.getPool(),namespace===NS?'':'demo/');}
function modelConfig(env=process.env){
 const model=env.TEACHER_AI_MODEL,key=env.TEACHER_AI_API_KEY||env.GPT_API_KEY,base=env.TEACHER_AI_API_BASE||env.GPT_API_BASE;
 if(typeof model!=='string'||!model.trim()||model.length>120||!key||!base)fail('AI_NOT_CONFIGURED',503,false);
 let url;try{url=new URL(base);}catch{fail('AI_NOT_CONFIGURED',503,false);}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('AI_NOT_CONFIGURED',503,false);
 let pathname=url.pathname.replace(/\/+$/,'');
 if(!pathname.endsWith('/chat/completions'))pathname+=(pathname.endsWith('/v1')?'':'/v1')+'/chat/completions';
 url.pathname=pathname;return {model:model.trim(),key,url:url.href};
}
function safeCount(value){return Number.isSafeInteger(value)&&value>=0?value:0;}
function safeScore(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;}
function aggregateEvidence(dataset){
 const analytics=dataset.analytics||{},facts=[];
 const add=(label,value,unit,scope='所選範圍',source='structured_records')=>{const id='F'+String(facts.length+1).padStart(3,'0');facts.push({id,label,value,unit,scope,source});};
 const roster=dataset.rosterSummary||{};
  add('名冊學生',safeCount(roster.totalStudents),'人');add('名冊中有記錄學生',safeCount(roster.withRecords),'人');add('名冊中未見記錄學生',safeCount(roster.noRecords),'人');
 if(safeCount(roster.totalStudents))add('名冊中已有記錄比例',Math.round(safeCount(roster.withRecords)/roster.totalStudents*1000)/10,'%');
 if(safeCount(roster.unmatchedWithRecords))add('尚未連結名冊的記錄身份',safeCount(roster.unmatchedWithRecords),'個');
 function summary(value,scope){
  if(!value)return;
  for(const [key,label,unit]of [['nEvents','已收集活動記錄','筆'],['nStudents','有記錄學生','人'],['nAttempts','練習嘗試','次'],['completedN','活動完成紀錄','筆'],['nInvalidEvents','需排除的資料異常記錄','筆'],['practiceOutcomeN','複習或自由練習結果','筆']])add(label,safeCount(value[key]),unit,scope);
  for(const [construct,label]of Object.entries(CONSTRUCTS))for(const [source,sourceLabel]of Object.entries(SOURCES)){
   const score=value.byConstruct?.[construct]?.[source];if(!score)continue;
   const n=safeCount(score.measuredN),missing=safeCount(score.unmeasuredN);
   add(label+'：有效測量',n,'筆',scope,sourceLabel);if(missing)add(label+'：未測量',missing,'筆',scope,sourceLabel);
   if(n&&safeScore(score.meanScore)!==null)add(label+'：平均值',score.meanScore,'分（0–100）',scope,sourceLabel);
  }
 }
 summary(analytics.summary,'所選範圍');
 const people=(dataset.students||[]).filter(person=>person.rosterMatched!==false);
 const measurable=(person,construct,source)=>{
  const score=(person.stats?.[dataset.filters.attempt]||person.stats)?.byConstruct?.[construct]?.[source];
  return score?.measuredN>0?safeScore(score.meanScore):null;
 };
 if(people.some(person=>person.stats?.nEvents>0)){
  add('有活動完成紀錄的名冊學生',people.filter(person=>person.stats?.completedN>0).length,'人');
  for(const [construct,label]of Object.entries(CONSTRUCTS))for(const [source,sourceLabel]of Object.entries(SOURCES)){
   const measured=people.map(person=>measurable(person,construct,source)).filter(value=>value!==null);
   if(!measured.length)continue;
   add(label+'：有評分的名冊學生',measured.length,'人','所選範圍',sourceLabel);
   add(label+'：個人平均低於60分的名冊學生',measured.filter(score=>score<60).length,'人','所選範圍',sourceLabel);
   add(label+'：尚無評分的名冊學生',people.filter(person=>measurable(person,construct,source)===null).length,'人','所選範圍',sourceLabel);
   add(label+'：有活動紀錄但尚無此項評分的名冊學生',people.filter(person=>person.stats?.nEvents>0&&measurable(person,construct,source)===null).length,'人','所選範圍',sourceLabel);
  }
  for(const [left,right]of [['reading.pronunciation','writing.dictation'],['reading.pronunciation','sound.recognition'],['writing.dictation','sound.recognition']]){
   const paired=people.map(person=>[measurable(person,left,'serverVerified'),measurable(person,right,'serverVerified')]).filter(scores=>scores.every(score=>score!==null));
   if(paired.length)add(CONSTRUCTS[left]+'與'+CONSTRUCTS[right]+'：同一批學生觀察',{
    bothMeasuredStudents:paired.length,
    bothBelow60Students:paired.filter(scores=>scores.every(score=>score<60)).length,
    leftBelow60Students:paired.filter(scores=>scores[0]<60).length,
    rightBelow60Students:paired.filter(scores=>scores[1]<60).length,
    leftOnlyBelow60Students:paired.filter(scores=>scores[0]<60&&scores[1]>=60).length,
    rightOnlyBelow60Students:paired.filter(scores=>scores[0]>=60&&scores[1]<60).length,
    neitherBelow60Students:paired.filter(scores=>scores.every(score=>score>=60)).length
   },'人','所選範圍','平台評分');
  }
 }
 if(!dataset.filters.grade)for(const item of analytics.byGrade||[])if(Number.isInteger(item.grade)&&item.grade>=1&&item.grade<=6)summary(item,item.grade+'年級');
 if(!dataset.filters.cls)for(const item of analytics.byClass||[])if(Number.isInteger(item.grade)&&item.grade>=1&&item.grade<=6&&/^[A-Z]$/.test(item.cls)){
  if(dataset.filters.grade)summary(item,item.grade+item.cls+'班');
  else{add('有記錄學生',safeCount(item.nStudents),'人',item.grade+item.cls+'班');add('已收集活動記錄',safeCount(item.nEvents),'筆',item.grade+item.cls+'班');}
 }
 const days=(analytics.trend||[]).filter(item=>/^\d{4}-\d\d-\d\d$/.test(item.date)).slice(-31);
 for(const item of days){add('有記錄學生',safeCount(item.nStudents),'人',item.date);add('收集記錄',safeCount(item.nEvents),'筆',item.date);}
 for(const word of (analytics.readingWords||[]).slice(0,20)){
  if(typeof word.char!=='string'||[...word.char].length!==1||!Number.isInteger(word.poemId)||word.poemId<1||word.poemId>6||safeScore(word.meanScore)===null)continue;
  add('「'+word.char+'」字音觀察',{meanScore:word.meanScore,observations:safeCount(word.count),below60:safeCount(word.below60Count)},'字音評分','第'+word.poemId+'首古詩','平台評分');
 }
 for(const poem of (analytics.readingCharacterAnalysis?.poems||[]).slice(0,6)){
  const measured=(poem.lines||[]).flatMap(line=>(line.words||[]).filter(word=>safeScore(word.meanScore)!==null&&safeCount(word.count)>0).map(word=>({...word,lineIndex:line.lineIndex}))).sort((left,right)=>left.meanScore-right.meanScore||right.count-left.count);
  if(!measured.length)continue;
  add('全詩逐字平均的觀察範圍',{measuredPositions:measured.length,meanBelow80Positions:measured.filter(word=>word.meanScore<80).length},'字位',poem.grade+'年級《'+poem.title+'》','平台評分');
  for(const word of measured.slice(0,8))add('「'+word.char+'」逐字平均',{meanScore:word.meanScore,measuredStudents:safeCount(word.count)},'字音評分',poem.grade+'年級《'+poem.title+'》第'+(word.lineIndex+1)+'句','平台評分');
 }
 if(facts.length>2000)fail('NARROW_DATE_OR_CLASS_FILTER',413,false);
 const syncStatus=['current','catching_up','attention','direct','published','unavailable'].includes(analytics.sync?.status)?analytics.sync.status:'unavailable';
 const curriculum=require('../../maanshan/poems.json').poems.filter(poem=>!dataset.filters.grade||poem.grade===dataset.filters.grade).map(poem=>({grade:poem.grade,title:poem.title,lines:poem.lines.map(line=>({text:line.text,pinyin:line.pinyin})),dictation:poem.dictation.slice(0,poem.grade<=2?1:poem.grade<=4?2:3).map(item=>({char:item.char,pinyin:item.pinyin,word:item.word}))}));
 const teachingConstraints=curriculum.map(poem=>({grade:poem.grade,poem:poem.title,writing:poem.grade<=2?{maxCharactersAcrossWholeReport:1,allowedCharacters:poem.dictation.slice(0,1).map(item=>item.char),instruction:'整份報告最多安排一個字，只選allowedCharacters；其餘全用聽選、短句跟讀。下次複查也沿用同一字，不能默寫詞語或字表。'}:{maxCharactersAcrossWholeReport:poem.grade<=4?2:3,allowedCharacters:poem.dictation.slice(0,poem.grade<=4?2:3).map(item=>item.char)}}));
 // These are lesson choices, not additional measurements. Keep every proposed
 // target in its source line so follow-up never assesses an unpractised word.
 const teachingFocus=curriculum.map(poem=>{
  const positions=analytics.readingCharacterAnalysis?.poems?.find(item=>item.grade===poem.grade)?.lines||[];
  const readingLines=positions.map(line=>({lineIndex:line.lineIndex,words:(line.words||[]).filter(word=>safeScore(word.meanScore)!==null&&word.meanScore<80&&safeCount(word.count)>0).sort((a,b)=>a.meanScore-b.meanScore)})).filter(line=>line.words.length&&poem.lines[line.lineIndex]).sort((a,b)=>b.words.length-a.words.length||a.lineIndex-b.lineIndex).slice(0,2).map(line=>({lineNumber:line.lineIndex+1,text:poem.lines[line.lineIndex].text,observeCharacters:line.words.slice(0,2).map(word=>word.char)}));
  return {grade:poem.grade,poem:poem.title,readingLines,writingCharacters:poem.dictation.map(item=>item.char),listeningActivity:'沿用本詩已有的辨音或配對練習，聽後再答；教師聽取學生重讀所聽內容。'};
 });
 // Give the writer actual, disjoint groups. An empty intersection must never
 // turn into a third class group merely to make the prose look comprehensive.
 const observedGroups=facts.filter(fact=>fact.label.endsWith('：同一批學生觀察')).map(fact=>{
  const [left,right]=fact.label.split('：')[0].split('與');
  return {evidenceId:fact.id,domains:[left,right],bothMeasuredStudents:fact.value.bothMeasuredStudents,
   groups:[['leftOnlyBelow60Students',[left]],['rightOnlyBelow60Students',[right]],['bothBelow60Students',[left,right]]]
    .filter(([key])=>fact.value[key]>0).map(([key,focus])=>({count:fact.value[key],focus}))};
 });
 // One paired cohort is enough to explain a classroom grouping. Supplying all
 // three pairs encouraged prose to mix paired counts with whole-class totals.
 // Prefer an observed overlap involving reading, then another real overlap.
 const groupPriority=group=>(group.domains.some(domain=>domain.startsWith('朗讀'))?2:0)+(group.groups.some(item=>item.focus.length===2)?4:0);
 const teachingGroups=observedGroups.sort((left,right)=>groupPriority(right)-groupPriority(left)).slice(0,1);
 const payload={schemaVersion:1,reportStyle:'narrative-teaching-review',demo:dataset.demo===true,filters:dataset.filters,curriculum,teachingConstraints,teachingFocus,teachingGroups,detailLevel:dataset.filters.cls?'selected_class':dataset.filters.grade?'grade_and_classes':'school_and_grades_with_class_participation',rosterSummary:{totalStudents:safeCount(roster.totalStudents),withRecords:safeCount(roster.withRecords),noRecords:safeCount(roster.noRecords)},sync:{status:syncStatus,integrityIssues:safeCount(analytics.sync?.integrity?.integrityIssues),retryPending:safeCount(analytics.sync?.integrity?.retryPending)},evidence:facts,
  interpretationRules:['未見記錄不等於沒有練習；離線未同步情況無法直接觀察。','零分是測量；null和缺少分數是未測量。','按構念及來源分開解讀，不可把朗讀分數與答題準確度混成平均分。','瀏覽器自報分數未經伺服器核實；伺服器核實亦不等於教育診斷。','字音分數不能推斷聲母、韻母、聲調的具體病因。','完成活動事件數和嘗試數均不是完成學生數。','各日人數不可相加作不重複總人數；分組數據與總計有重疊。','資料不能證明教學因果、學習障礙或學生態度。']};
 if(Buffer.byteLength(canonical(payload))>MAX_PROVIDER_BYTES)fail('NARROW_DATE_OR_CLASS_FILTER',413,false);
 return payload;
}
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('AI_INVALID_RESPONSE',502,true);return value.trim();}
function validateAnalysis(value,evidence,filters){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('AI_INVALID_RESPONSE',502,true);
 const ids=new Set(evidence.map(item=>item.id));
 const refs=value=>{if(!Array.isArray(value)||!value.length||value.length>32||value.some(id=>!ids.has(id)))fail('AI_INVALID_RESPONSE',502,true);return [...new Set(value)];};
 const list=(values,max,mapper,min=1)=>{if(!Array.isArray(values)||values.length<min||values.length>max)fail('AI_INVALID_RESPONSE',502,true);return values.map(mapper);};
 const action=value=>({title:text(value?.title,100),evidenceIds:refs(value?.evidenceIds),steps:list(typeof value?.steps==='string'?[value.steps]:value?.steps,5,item=>text(item,1000))});
 return {title:text(value.title,120),overview:text(value.overview,1800),findings:list(value.findings,8,item=>({title:text(item?.title,100),evidenceIds:refs(item?.evidenceIds),interpretation:text(item?.interpretation,2000)})),teachingActions:list(value.teachingActions,6,item=>({...action(item),priority:['high','medium','low'].includes(item.priority)?item.priority:'medium'})),reviewPlan:list(value.reviewPlan,4,action),limitations:list(value.limitations??[],1,item=>text(item,180),0)};
}
const SYSTEM_PROMPT=`你是香港小學普通話科的資深教師，向同科老師撰寫可直接使用的教研報告。以繁體中文連貫論述，用「整體評價→主要發現→教學建議」形成清楚的教學判斷。evidence是本班實際觀察，curriculum是正確課文，teachingFocus是可採用的課堂安排；教學安排並不表示學生已經做過。
【成稿結構】
overview約100字，說清下一課的重心及其主要依據。findings寫3個互不重複的完整段落，每段約220至280字，合計至少650字且佔正文一半以上。有數據時依次分析：
第一段：參與及不同活動的覆蓋。連起名冊、有紀錄、有完成紀錄及各分項有評分的學生人數，說明課堂應先補齊哪一環的觀察，並照顧已有評分學生的練習延續。「有評分的名冊學生」只寫「已有評分」「已留下朗讀/聽辨/默寫評分」，不能寫成「有X人完成」「已完成的X人」，標題也沿用「已有評分」。只有明確的完成事件人數才寫「有活動完成紀錄」，而非完成整課。這是內部用詞要求，正文直接提出教學決策。
第二段：具體字音在原句中的分布。以全詩逐字平均及有評分學生數支持判斷，挑teachingFocus中的少量字和所在原句，解釋為何先從這些句子練起，以及教師應如何分辨需要全班再練還是個別再聽。readingLines的lineNumber就是原詩實際句號；若選的是第一、第三句，就明寫「第一、第三句」或「上述兩句」，不能改稱「前兩句」，後者只指原詩第一、第二句。正文、教學建議及複查沿用同一批句號和原句。不重列整個字表，不猜學生錯誤原因，不把全班平均說成人人都錯。不可把平均低分改寫成「多數學生、普遍、大部分、很多學生、全班、人人讀不準／讀錯」；沒有逐人低分計數時，只寫平均分、已有評分人數和下一步的共同跟讀及逐一聽取。
第三段：學生分布及分層跟進。teachingGroups只提供一對已選定的學習分項，整篇報告的交集、僅一項低分及分組敘述都只沿用這同一對。先自然交代這兩項都有評分的學生人數，再說明實際存在的各組如何練習、以甚麼表現調整；交集為0時分別安排，不補空組或假設組。每一組均已有兩項評分，「只有默寫低」表示另一項有評分且不低，不是未測；「兩項皆低」也不是缺測者。若默寫低分共8人、僅默寫低5人、兩項皆低3人，8人就是這5人加3人，不能另稱其餘3人沒有朗讀評分；照三個現有組別寫教法即可。第三個分項只引用「個人平均低於60分的名冊學生」全體跟進人數並寫具體教法，例如交代默寫需跟進的實際人數後，直接安排練寫本課指定字及觀察字形。不再談第三項與其他項的重疊、不寫「全體X人中有Y人僅默寫低」，不把未納入同一對觀察的學生推成另一組。沒有兩項都有結果的觀察時，用各分項覆蓋和具體題目決定先後，避免重複第二段的字音清單。
每個發現的標題精簡，正文充分連結事實、教學含義和取捨；至少兩種相關證據共同支持一段，不能只有均分播報或把清單串起來。單班全文約1100至1500字，全校約1500至1900字，資料少則如實簡短。
teachingActions單年級1至2項、全校2至3項。每項steps放1段100至180字的完整中文建議，連貫交代理由、具體課文、師生活動和觀察目標。reviewPlan只放1項、1段80至120字，沿用前述同一句和同一觀察字，寫清如何根據下一次實際表現調整。不使用1)/2)、一二三操作清單，也不附教案或課時表。
【教師自然語氣】
正文只談教學，不解說系統規則或資料處理：例如自然寫「聽寫集中練好『舟』，讓其餘時間用於原句跟讀」，不要寫「唯一允許字」「二年級只准」「不得增加」；自然寫「下課先聽取尚未留下朗讀結果的學生」，不要說「不能判定未參與」。內部的閾值、來源名稱、校驗要求不充當論述主題。選有實際用處的數字，不重複列兩套字音資料。不作能力分級、病因推斷或防禦性免責。「平均分只是參考」「平均分僅供選擇句子之用，實際仍需個別聽取」「不能直接推論每個人都錯」「不能代表全班」「因此個別聽取是必要的」這類解釋數據局限的句子整句省略；直接寫「全班跟讀後，教師逐一聽取，讓仍需鞏固的學生再讀一次」，不先辯解為甚麼不能推論。標題正文不提demo、模擬、虛構、伺服器、瀏覽器、evidenceIds、模型或技術流程。demo為true時，文件頁首由系統加一次「模擬數據」，正文照常寫教研報告。
【可靠教學內容，內部遵守即可】
每個觀察數字準確引用evidence並在evidenceIds列出依據；不自行相減推算未提供人數。未測不是0。數字可有明確約數，但不能變換人數/筆數/字位單位。「逐字平均」的meanBelow80Positions是平均低於80的字位數，measuredStudents是該字有分數的學生數，不是讀錯或低分的學生數；舊字音觀察below60是評分次數。逐字均分用來選擇共同跟讀的原句，不能與受測人數相乘或結合成「字音問題普遍」「多數學生讀不準」的結論。自然寫「可先共同跟讀這些字所在原句，再逐一聽取，安排仍需鞏固的學生再讀」，不把這條內部規則或免責說明寫進報告。優先使用逐字平均，不再單獨分析舊字音觀察。兩個閾值都是跟進線索，不是及格線。
「尚無評分的名冊學生」是整份名冊中的總缺測人數，包含完全無活動紀錄的學生。表述為「全班朗讀尚有X人未留下評分」，不能放進「已有活動紀錄的學生中」的子集，也不能與無活動紀錄人數相加。無活動紀錄只表示尚未留下平台紀錄，直接建議先了解練習情況並補齊觀察；不將其說成缺席、未參與或沒有練習。
同一批學生觀察：bothMeasuredStudents為兩項都有結果的人數，bothBelow60Students為兩項個人均分皆低於60的人數，leftBelow60Students/rightBelow60Students是這批學生各項低於60的總人數，已包含兩項皆低者；leftOnlyBelow60Students/rightOnlyBelow60Students是只有一項低於60的人數，neitherBelow60Students是兩項均不低於60的人數，這三類與兩項皆低者互不重複。teachingGroups的每個groups只列非空組，focus就是該組需要跟進的分項；同一批學生未涵蓋的缺測者先補齊觀察。分組只按這些實際人數，不將不同兩項組合相加，也不為空組安排任務。簡潔寫需要跟進的名單重疊多少人，據此安排聽讀或寫字練習，不把多組交集數字全部抄入報告，不把交集大小說成能力相關程度。各分項優先用平台評分，不混合練習回報平均。只寫事實和可觀察的教學選擇，不指認未測的聲調/韻母錯誤、粵語干擾、字詞熟悉度、注意力或技術故障成因。
所有建議集中聽、讀、字音、聽辨和寫字，不教詩意、作文或擴展默寫。選teachingFocus的原句和觀察字，複查同樣內容；需要其他句才從curriculum選並核對字確實在句內。聽辨只建議使用本詩現有遊戲的實際題目，學生聽後作答、再重讀所聽內容；沒有提供完整題庫，不聲稱遊戲已有指定四個字、指定短句或某一讀音的題目，也不自編選項。教師可親自示範原句和指定字，但要寫清是教師帶讀。低小整份報告連同複查只寫同一個teachingConstraints允許字，其餘用聽選跟讀；中高年級按各自指定字與上限。多個年級的建議寫清適用年級。
只輸出完整JSON，不加markdown，schema：
{"title":"範圍普通話教研報告","overview":"連貫整體評價","findings":[{"title":"具體教學判斷","evidenceIds":["F001","F002"],"interpretation":"完整分析段落"}],"teachingActions":[{"priority":"high|medium|low","title":"教學方向","evidenceIds":["F001"],"steps":["完整建議段落"]}],"reviewPlan":[{"title":"下一課觀察","evidenceIds":["F001"],"steps":["完整複查段落"]}],"limitations":[]}。`;
function repairPunctuation(content){
 const source=content.trim();if(!source.startsWith('{')||!source.endsWith('}'))fail('AI_INVALID_RESPONSE',502,true);
 const stack=[],output=[];let quoted=false,escaped=false;
 for(const char of source){
  if(quoted){output.push(char);if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"'){quoted=true;output.push(char);continue;}
  if(char==='{'||char==='['){stack.push(char==='{'?'}':']');if(stack.length>24)fail('AI_INVALID_RESPONSE',502,true);output.push(char);continue;}
  if(char==='}'||char===']'){if(!stack.length)fail('AI_INVALID_RESPONSE',502,true);output.push(stack.pop());continue;}
  output.push(char);
 }
 // Never invent missing terminal fields/brackets or change quoted content.
 if(quoted||stack.length)fail('AI_INVALID_RESPONSE',502,true);
 return require('jsonrepair').jsonrepair(output.join(''));
}
function reportEvidence(payload){
 const facts=payload.evidence||[],hasCharacterAverages=facts.some(fact=>fact.label==='全詩逐字平均的觀察範圍');
 const groupingId=payload.teachingGroups?.[0]?.evidenceId;
 return facts.filter(fact=>{
  if(groupingId&&fact.label.endsWith('：同一批學生觀察')&&fact.id!==groupingId)return false;
  if(/^\d{4}-\d\d-\d\d$/u.test(fact.scope))return false;
  if(['活動完成紀錄','練習嘗試','已收集活動記錄','需排除的資料異常記錄','複習或自由練習結果'].includes(fact.label))return false;
  if(fact.label.includes('有活動紀錄但尚無此項評分'))return false;
  if(hasCharacterAverages&&/字音觀察$/u.test(fact.label))return false;
  if(fact.label.endsWith('：平均值')&&!fact.label.startsWith('朗讀'))return false;
  if(fact.source==='練習回報'&&facts.some(other=>other.source==='平台評分'&&other.label===fact.label&&other.scope===fact.scope))return false;
  return true;
 });
}
function completeEvidenceReferences(analysis,facts){
 // A real, exact observation sometimes lacks its internal reference in one
 // paragraph. Repair that metadata only when its construct, count and unit
 // identify one fact; never edit prose or accept an invented number.
 const topics=['朗讀','默寫','辨音','配對','排序','場景'];
 for(const finding of analysis.findings){
  const ids=new Set(finding.evidenceIds);
  for(const clause of finding.interpretation.split(/[。；]/u)){
   const used=topics.filter(topic=>clause.includes(topic));
   for(const match of clause.matchAll(/(\d+)\s*人/gu)){
    const value=Number(match[1]);
    const rosterLabels=[];
    if(/名冊|名册/u.test(clause))rosterLabels.push('名冊學生');
    if(/有(?:活動)?[紀記记]錄|有(?:活动)?记录/u.test(clause))rosterLabels.push('名冊中有記錄學生');
    if(/未見(?:任何|活動)?[紀記记]錄|未见(?:任何|活动)?记录/u.test(clause))rosterLabels.push('名冊中未見記錄學生');
    const rosterFacts=facts.filter(fact=>rosterLabels.includes(fact.label)&&fact.unit==='人'&&fact.value===value&&fact.scope==='所選範圍');
    if(rosterFacts.length===1&&ids.size<32)ids.add(rosterFacts[0].id);
    if(used.length!==1)continue;
    const kind=/低於60分/u.test(clause)?'個人平均低於60分的名冊學生':/有(?:效)?(?:分數|評分)|評分有|都有結果/u.test(clause)?'有評分的名冊學生':null;
    if(!kind)continue;
    const candidates=facts.filter(fact=>fact.unit==='人'&&fact.value===value&&fact.label.startsWith(used[0])&&fact.label.endsWith(kind)&&fact.scope==='所選範圍'&&fact.source==='平台評分');
    if(candidates.length===1&&ids.size<32)ids.add(candidates[0].id);
   }
  }
  finding.evidenceIds=[...ids];
 }
 return analysis;
}
async function requestAnalysis(payload,config,{fetchImpl=globalThis.fetch,signal,revision,timeoutMs=PROVIDER_TIMEOUT_MS}={}){
 const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const facts=reportEvidence(payload),{interpretationRules,sync,...providerPayload}=payload;
 providerPayload.evidence=facts;
 providerPayload.teachingConstraints=(payload.teachingConstraints||[]).map(({grade,poem,writing})=>({grade,poem,writing:{maxCharactersAcrossWholeReport:writing.maxCharactersAcrossWholeReport,allowedCharacters:writing.allowedCharacters}}));
 const messages=[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:canonical(providerPayload)}];
 if(revision)messages.push({role:'assistant',content:canonical(revision.analysis)},{role:'user',content:'請對上一份報告作最小必要修正，保留正確的分析、結構、篇幅與段落，不從零重寫。逐項糾正以下實際問題，相關句子也一併改正；不增加免責段落或解說內部規則。每項問題的path指出確切欄位；若指向title，必須修改該小標題，不能只改正文。標題也不可把不同題型均分排名，改成具體教學重心，例如「先跟讀原句，再鞏固聽辨」。覆核若要求刪除某整句，直接刪除，不再改寫或補算，保留相鄰的正確敘述。分組敘事只沿用teachingGroups這一對；第三項只寫全班實際跟進人數及教法，刪除第二對的交集與「全體X人中僅Y人」敘述。若指出REPORT_OVERLAP_AS_MISSING，直接刪除把兩項皆低者改稱缺另一項評分的整句，保留正確的三組與教法；不要用全體低分減去僅一項低分來算缺測者。若指出REPORT_DEFENSIVE_LANGUAGE，刪除「平均分僅供選擇句子之用」等限制用途的句子，保留直接教法。總缺測人數以全班為範圍，不能放入「已有紀錄的X人中」的子集。無紀錄不寫成缺席或未參與；現有遊戲只按實際題目練習，不宣稱題庫含指定字音。輸出修正後的完整JSON，evidenceIds沿用真實依據。覆核問題：'+canonical(revision.issues)});
 let response;
 try{response=await fetchImpl(config.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},body:JSON.stringify({model:config.model,messages,temperature:0.3,max_tokens:6500,thinking:{type:'disabled'},response_format:{type:'json_object'} }),signal:combined});}
 catch(error){if(signal?.aborted)fail('ANALYSIS_INTERRUPTED',499,true,5);if(timeout.aborted||['TimeoutError','AbortError'].includes(error?.name))fail('AI_TIMEOUT',504,true,30);fail('AI_UNAVAILABLE',502,true,30);}
 if(response.status===429){await response.body?.cancel().catch(()=>{});fail('AI_RATE_LIMITED',429,true,60);}
 if(!response.ok){await response.body?.cancel().catch(()=>{});fail('AI_UNAVAILABLE',502,true,30);}
 let provider;
 try{
  const reader=response.body?.getReader();if(!reader)fail('AI_INVALID_RESPONSE',502,true);
  const chunks=[];let size=0;try{while(true){combined.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_RESPONSE_BYTES)fail('AI_INVALID_RESPONSE',502,true);chunks.push(Buffer.from(part.value));}}catch(error){await reader.cancel().catch(()=>{});throw error;}
  provider=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch(error){if(signal?.aborted)fail('ANALYSIS_INTERRUPTED',499,true,5);if(timeout.aborted)fail('AI_TIMEOUT',504,true,30);if(error instanceof AnalysisError)throw error;fail('AI_INVALID_RESPONSE',502,true);}
 if(provider.choices?.[0]?.finish_reason==='length')fail('AI_INVALID_RESPONSE',502,true);
 if(provider.model!==undefined&&provider.model!==config.model)fail('AI_MODEL_MISMATCH',502,false);
 const content=provider.choices?.[0]?.message?.content;
 if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content)>MAX_RESPONSE_BYTES)fail('AI_INVALID_RESPONSE',502,true);
 let raw,syntaxRepaired=false;
 try{raw=JSON.parse(content);}catch{
  // Repair JSON punctuation only; the original values still pass the complete
  // schema/evidence validation below. Truncated provider output is rejected above.
  try{raw=JSON.parse(repairPunctuation(content));syntaxRepaired=true;}catch{fail('AI_INVALID_RESPONSE',502,true);}
 }
 return {analysis:completeEvidenceReferences(validateAnalysis(raw,payload.evidence,payload.filters),facts),syntaxRepaired,responseModel:provider.model||null,usage:{inputTokens:safeCount(provider.usage?.prompt_tokens),outputTokens:safeCount(provider.usage?.completion_tokens)}};
}
function publicReport(report){const {dataset,...visible}=report;return visible;}
function createService({loadDataset,buildFollowUp,store,env=process.env,fetchImpl=globalThis.fetch,now=Date.now,uuid=crypto.randomUUID,namespace=NS}={}){
 const storage=()=>store||configuredStore(env,namespace);
 const load=loadDataset||((req,filters)=>require('./teacher-data.cjs').loadTeacherDataset(req,filters));
 const follow=buildFollowUp||(dataset=>require('./teacher-data.cjs').buildFollowUp(dataset));
 async function read(key){try{return await storage().get(key);}catch(error){if(error instanceof AnalysisError)throw error;fail('REPORT_STORAGE_UNAVAILABLE');}}
 async function save(key,value,version){try{return await storage().cas(key,value,version);}catch(error){if(error instanceof AnalysisError)throw error;fail('REPORT_STORAGE_UNAVAILABLE');}}
 function status(record,reportId){
  if(record?.value?.status==='completed'){const report=record.value.report;if(report?.reportId!==reportId||report.schemaVersion!==1||hash(canonical(report))!==record.value.reportChecksum)fail('REPORT_STORAGE_UNAVAILABLE');return {ok:true,reportId,cached:true,report:publicReport(report)};}
  if(record?.value?.status==='pending'&&record.value.background){wakeBackgroundWorker();return {ok:true,status:'generating',reportId,retryAfterSeconds:3};}
  if(record?.value?.status==='pending'&&record.value.stage==='revision_ready')return {ok:true,status:'generating',reportId,nextAction:'continue',retryAfterSeconds:1};
  if(record?.value?.status==='pending'&&record.value.leaseUntil>now())return {ok:true,status:'generating',reportId,retryAfterSeconds:3};
  if(record?.value?.status==='failed'&&record.value.retryAt>now())throw new AnalysisError(record.value.code,record.value.httpStatus,record.value.retryable,Math.max(1,Math.ceil((record.value.retryAt-now())/1000)));
  fail('ANALYSIS_RETRY_REQUIRED',409,true);
 }
 async function check(reportId){const record=await read(reportKey(reportId));if(!record)fail('REPORT_NOT_FOUND',404,false);return status(record,reportId);}
 async function getReport(reportId){const record=await read(reportKey(reportId));if(!record)fail('REPORT_NOT_FOUND',404,false);const result=status(record,reportId);if(result.status==='generating')fail('REPORT_NOT_READY',409,true,3);return record.value.report;}
 async function quota(actorId){
  const key='limit/'+hash(String(actorId)),windowStart=Math.floor(now()/60000)*60000;
  for(let n=0;n<4;n++){const prior=await read(key),count=prior?.value?.windowStart===windowStart?safeCount(prior.value.count):0;if(count>=3)fail('AI_RATE_LIMITED',429,true,Math.max(1,Math.ceil((windowStart+60000-now())/1000)));
   if(await save(key,{windowStart,count:count+1},prior?.version))return;
  }fail('ANALYSIS_BUSY',429,true,5);
 }
 async function generate(req,filters,actor,{signal,background=false}={}){
  if(actor?.role!=='teacher'||typeof actor.id!=='string')fail('TEACHER_REQUIRED',403,false);
  const config=modelConfig(env),dataset=await load(req,filters),payload=aggregateEvidence(dataset);
  if(!safeCount(dataset.analytics?.coverage?.nEvents??dataset.analytics?.summary?.nEvents))fail('NO_LEARNING_DATA',422,false);
  if(typeof dataset.snapshotId!=='string'||!dataset.snapshotId.length)fail('REPORT_STORAGE_UNAVAILABLE');
  const dataFingerprint=hash(canonical({snapshotId:dataset.snapshotId,payload})),reportId='ta_'+hash(canonical({dataFingerprint,model:config.model,provider:config.url,promptVersion:PROMPT_VERSION})),key=reportKey(reportId);
  let record=await read(key);
  if(record?.value?.status==='completed'||record?.value?.status==='pending'&&(record.value.background||record.value.leaseUntil>now()||record.value.stage==='revision_ready')||record?.value?.status==='failed'&&record.value.retryAt>now())return status(record,reportId);
  const leaseId=uuid(),startedAt=new Date(now()).toISOString(),lease={schemaVersion:1,status:'pending',leaseId,leaseUntil:now()+LEASE_MS,startedAt};
  // Prepare and bound the complete document snapshot before any paid request.
  bytes({dataset,payload});const followUp=follow(dataset);
  if(background&&supportsBackground()){
   const task={dataset,payload,followUp,dataFingerprint,actorId:actor.id,promptVersion:PROMPT_VERSION,model:config.model,provider:config.url};
   if(!await save(key,{schemaVersion:1,status:'pending',stage:'queued',background:true,leaseUntil:0,task,taskChecksum:hash(canonical(task)),attempts:0},record?.version))return status(await read(key),reportId);
   wakeBackgroundWorker();return {ok:true,status:'generating',reportId,retryAfterSeconds:3};
  }
  if(!await save(key,lease,record?.version)){
   record=await read(key);if(!record)fail('REPORT_STORAGE_UNAVAILABLE');return status(record,reportId);
  }
  record=await read(key);if(record?.value?.leaseId!==leaseId)return status(record,reportId);
  return runInitial({dataset,payload,followUp,dataFingerprint,actorId:actor.id},config,reportId,leaseId,{signal});
 }
 async function runInitial(task,config,reportId,leaseId,{signal,background=false}={}){
  const {dataset,payload,followUp,dataFingerprint,actorId}=task,key=reportKey(reportId);
  try{
   await quota(actorId);
   const generated=await requestAnalysis(payload,config,{fetchImpl,signal,timeoutMs:background?BACKGROUND_TIMEOUT_MS:PROVIDER_TIMEOUT_MS});
   const f=dataset.filters;
   generated.analysis.title=`${f.grade?f.grade+'年級'+(f.cls?f.cls+'班':''):f.cls?'全校'+f.cls+'班':'全校'}普通話教研報告`;
   const report={schemaVersion:1,reportId,createdAt:new Date(now()).toISOString(),model:config.model,responseModel:generated.responseModel,syntaxRepaired:generated.syntaxRepaired,promptVersion:PROMPT_VERSION,filters:dataset.filters,dataFingerprint,snapshotId:dataset.snapshotId,
    source:{sync:dataset.analytics.sync,coverage:dataset.analytics.coverage,rosterSummary:dataset.rosterSummary},evidence:payload.evidence,analysis:generated.analysis,followUp,usage:generated.usage,dataset};
   const current=await read(key);if(current?.value?.leaseId!==leaseId)fail('ANALYSIS_RETRY_REQUIRED',409,true);
   const issues=require('./teacher-report-quality.cjs').inspectAnalysis(report.analysis,payload);
   if(issues.length){
    if(!await save(key,{schemaVersion:1,status:'pending',stage:'revision_ready',leaseUntil:0,draftReport:report,draftChecksum:hash(canonical(report)),issues,...background?{background:true,attempts:0,revisions:0}:{}},current.version))fail('REPORT_STORAGE_UNAVAILABLE');
    if(background)wakeBackgroundWorker();
    return {ok:true,status:'generating',reportId,...background?{}:{nextAction:'continue'},retryAfterSeconds:1};
   }
   report.qualityReview={passed:true,revisions:0};
   if(!await save(key,{schemaVersion:1,status:'completed',report,reportChecksum:hash(canonical(report))},current.version))fail('REPORT_STORAGE_UNAVAILABLE');
   return {ok:true,reportId,cached:false,report:publicReport(report)};
  }catch(error){
   return recordFailure(error,key,leaseId,{background,retryStage:'queued'});
  }
 }
 async function continueReport(reportId,actor,{signal,background=false}={}){
  if(actor?.role!=='teacher'||typeof actor.id!=='string')fail('TEACHER_REQUIRED',403,false);
  const key=reportKey(reportId),prior=await read(key);if(!prior)fail('REPORT_NOT_FOUND',404,false);
  if(prior.value.background)return status(prior,reportId);
  if(prior.value.status!=='pending'||prior.value.stage!=='revision_ready')return status(prior,reportId);
  const report=prior.value.draftReport,config=modelConfig(env);
  if(!report||report.reportId!==reportId||hash(canonical(report))!==prior.value.draftChecksum||report.model!==config.model||report.promptVersion!==PROMPT_VERSION)fail('REPORT_STORAGE_UNAVAILABLE');
  if(background&&supportsBackground()){
   if(!await save(key,{...prior.value,background:true,attempts:0,revisions:0},prior.version))return status(await read(key),reportId);
   wakeBackgroundWorker();return {ok:true,status:'generating',reportId,retryAfterSeconds:3};
  }
  const leaseId=uuid();
  if(!await save(key,{schemaVersion:1,status:'pending',stage:'revising',leaseId,leaseUntil:now()+LEASE_MS},prior.version))return status(await read(key),reportId);
  return runRevision(report,prior.value.issues,config,reportId,leaseId,{signal});
 }
 async function runRevision(report,issuesToFix,config,reportId,leaseId,{signal,background=false,revisions=0}={}){
  const key=reportKey(reportId);
  try{
   const payload=aggregateEvidence(report.dataset),generated=await requestAnalysis(payload,config,{fetchImpl,signal,timeoutMs:background?BACKGROUND_TIMEOUT_MS:PROVIDER_TIMEOUT_MS,revision:{analysis:report.analysis,issues:issuesToFix}});
   const issues=require('./teacher-report-quality.cjs').inspectAnalysis(generated.analysis,payload);
   generated.analysis.title=report.analysis.title;
   report.analysis=generated.analysis;report.createdAt=new Date(now()).toISOString();report.responseModel=generated.responseModel;report.syntaxRepaired=report.syntaxRepaired||generated.syntaxRepaired;
   report.usage={inputTokens:report.usage.inputTokens+generated.usage.inputTokens,outputTokens:report.usage.outputTokens+generated.usage.outputTokens};
   const current=await read(key);if(current?.value?.leaseId!==leaseId)fail('ANALYSIS_RETRY_REQUIRED',409,true);
   if(issues.length){
    if(background&&revisions<1){
     if(!await save(key,{schemaVersion:1,status:'pending',stage:'revision_ready',leaseUntil:0,background:true,attempts:0,revisions:revisions+1,draftReport:report,draftChecksum:hash(canonical(report)),issues},current.version))fail('REPORT_STORAGE_UNAVAILABLE');
     wakeBackgroundWorker();return {ok:true,status:'generating',reportId,retryAfterSeconds:3};
    }
    const error=new AnalysisError('AI_REPORT_QUALITY',502,true,30);error.qualityIssues=issues.map(({code,path})=>({code,path}));
    // Retain the final aggregate-only draft privately for diagnosis. It never
    // becomes a completed report, a public response, or a downloadable file.
    error.qualityDiagnostics={analysis:generated.analysis,evidence:payload.evidence,issues};throw error;
   }
   report.qualityReview={passed:true,revisions:revisions+1};
   if(!await save(key,{schemaVersion:1,status:'completed',report,reportChecksum:hash(canonical(report))},current.version))fail('REPORT_STORAGE_UNAVAILABLE');
   return {ok:true,reportId,cached:false,report:publicReport(report)};
  }catch(error){
   return recordFailure(error,key,leaseId,{background,retryStage:'revision_ready'});
  }
 }
 async function recordFailure(error,key,leaseId,{background,retryStage}={}){
  const safe=error instanceof AnalysisError?error:new AnalysisError('REPORT_STORAGE_UNAVAILABLE'),current=await read(key).catch(()=>null);
  if(current?.value?.leaseId===leaseId){
   const retry=background&&['AI_TIMEOUT','AI_UNAVAILABLE','AI_RATE_LIMITED','REPORT_STORAGE_UNAVAILABLE'].includes(safe.code)&&safeCount(current.value.attempts)<2;
   const value=retry?{...current.value,stage:retryStage,leaseId:null,leaseUntil:0,retryAt:now()+1000*(safe.retryAfterSeconds||10)}:{schemaVersion:1,status:'failed',promptVersion:PROMPT_VERSION,code:safe.code,httpStatus:safe.status,retryable:safe.retryable,retryAt:now()+1000*(safe.retryAfterSeconds||30),failedAt:new Date(now()).toISOString(),...(safe.qualityIssues?{qualityIssues:safe.qualityIssues}:{}),...(safe.qualityDiagnostics?{qualityDiagnostics:safe.qualityDiagnostics}:{})};
   await save(key,value,current.version).catch(()=>{});
   if(retry)return {ok:true,status:'generating',reportId:'ta_'+key.slice(7),retryAfterSeconds:3};
  }
  throw safe;
 }
 function supportsBackground(){
  if(store)return typeof store.pending==='function';
  // Guangzhou selects PostgreSQL through DB_DRIVER; STUDENT_STORE is optional.
  // An explicit Blob selection still wins, as it does in configuredStore().
  return env.STUDENT_STORE!=='blob'&&(env.STUDENT_STORE==='postgres'||env.DB_DRIVER==='postgres');
 }
 async function claimPending(){
  if(!supportsBackground())return null;
  const records=await storage().pending(now()),prior=records?.[0];if(!prior)return null;
  const {key}=prior,reportId='ta_'+key.slice(7),config=modelConfig(env),leaseId=uuid(),revision=['revision_ready','revising'].includes(prior.value.stage);
  if(!keyValid(key)||!key.startsWith('report/')||prior.value.status!=='pending'||!prior.value.background||prior.value.leaseUntil>now()||prior.value.retryAt>now())return null;
  const next={...prior.value,stage:revision?'revising':'generating',leaseId,leaseUntil:now()+BACKGROUND_LEASE_MS,retryAt:0,attempts:safeCount(prior.value.attempts)+1};
  if(!await save(key,next,prior.version))return null;
  return async()=>{
   try{
    if(revision){
     const report=next.draftReport;
     if(!report||report.reportId!==reportId||hash(canonical(report))!==next.draftChecksum||report.model!==config.model||report.promptVersion!==PROMPT_VERSION)fail('REPORT_STORAGE_UNAVAILABLE');
     return await runRevision(report,next.issues,config,reportId,leaseId,{background:true,revisions:safeCount(next.revisions)});
    }
    const task=next.task;
    if(!task||hash(canonical(task))!==next.taskChecksum||task.promptVersion!==PROMPT_VERSION||task.model!==config.model||task.provider!==config.url)fail('REPORT_STORAGE_UNAVAILABLE');
    return await runInitial(task,config,reportId,leaseId,{background:true});
   }catch(error){return recordFailure(error,key,leaseId,{background:true,retryStage:revision?'revision_ready':'queued'});}
  };
 }
 const api={generate,continueReport,check,getReport,claimPending,supportsBackground};
 if(supportsBackground())backgroundServices.add(api);
 return api;

}
let instance;const service=()=>instance||(instance=createService());
module.exports={NS,SCHEMA,PROMPT_VERSION,LEASE_MS,BACKGROUND_TIMEOUT_MS,BACKGROUND_LEASE_MS,AnalysisError,createBlobStore,createPostgresStore,modelConfig,aggregateEvidence,validateAnalysis,requestAnalysis,createService,publicReport,startBackgroundWorker,
 generate:(...args)=>service().generate(...args),continueReport:(...args)=>service().continueReport(...args),check:(...args)=>service().check(...args),getReport:(...args)=>service().getReport(...args)};
