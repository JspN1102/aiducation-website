'use strict';
const crypto=require('node:crypto'),blob=require('@vercel/blob');
const research=require('./research-store.cjs');
const NS='maanshan-teacher-analysis-v1',PROMPT_VERSION='teacher-analysis-v9-grade-scopes';
const MAX_RECORD_BYTES=12*1024*1024,MAX_PROVIDER_BYTES=160*1024,MAX_RESPONSE_BYTES=128*1024;
const LEASE_MS=120000,PROVIDER_TIMEOUT_MS=42000;
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
 if(safeCount(roster.unmatchedWithRecords))add('尚未連結名冊的記錄身份',safeCount(roster.unmatchedWithRecords),'個');
 function summary(value,scope){
  if(!value)return;
  for(const [key,label,unit]of [['nEvents','已收集活動記錄','筆'],['nStudents','有記錄學生','人'],['nInvalidEvents','需排除的資料異常記錄','筆'],['practiceOutcomeN','複習或自由練習結果','筆']])add(label,safeCount(value[key]),unit,scope);
  for(const [construct,label]of Object.entries(CONSTRUCTS))for(const [source,sourceLabel]of Object.entries(SOURCES)){
   const score=value.byConstruct?.[construct]?.[source];if(!score)continue;
   const n=safeCount(score.measuredN),missing=safeCount(score.unmeasuredN);
   add(label+'：有效測量',n,'筆',scope,sourceLabel);if(missing)add(label+'：未測量',missing,'筆',scope,sourceLabel);
   if(n&&safeScore(score.meanScore)!==null)add(label+'：平均值',score.meanScore,'分（0–100）',scope,sourceLabel);
  }
 }
 summary(analytics.summary,'所選範圍');
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
 if(facts.length>2000)fail('NARROW_DATE_OR_CLASS_FILTER',413,false);
 const syncStatus=['current','catching_up','attention','direct','published','unavailable'].includes(analytics.sync?.status)?analytics.sync.status:'unavailable';
 const curriculum=require('../../maanshan/poems.json').poems.filter(poem=>!dataset.filters.grade||poem.grade===dataset.filters.grade).map(poem=>({grade:poem.grade,title:poem.title,lines:poem.lines.map(line=>({text:line.text,pinyin:line.pinyin})),dictation:poem.dictation.slice(0,poem.grade<=2?1:poem.grade<=4?2:3).map(item=>({char:item.char,pinyin:item.pinyin,word:item.word}))}));
 const teachingConstraints=curriculum.map(poem=>({grade:poem.grade,poem:poem.title,writing:poem.grade<=2?{maxCharactersAcrossWholeReport:1,allowedCharacters:poem.dictation.slice(0,1).map(item=>item.char),instruction:'整份報告最多安排一個字，只選allowedCharacters；其餘全用聽選、短句跟讀。下次複查也沿用同一字，不能默寫詞語或字表。'}:{maxCharactersAcrossWholeReport:poem.grade<=4?2:3,allowedCharacters:poem.dictation.slice(0,poem.grade<=4?2:3).map(item=>item.char)}}));
 const payload={schemaVersion:1,demo:dataset.demo===true,filters:dataset.filters,curriculum,teachingConstraints,detailLevel:dataset.filters.cls?'selected_class':dataset.filters.grade?'grade_and_classes':'school_and_grades_with_class_participation',rosterSummary:{totalStudents:safeCount(roster.totalStudents),withRecords:safeCount(roster.withRecords),noRecords:safeCount(roster.noRecords)},sync:{status:syncStatus,integrityIssues:safeCount(analytics.sync?.integrity?.integrityIssues),retryPending:safeCount(analytics.sync?.integrity?.retryPending)},evidence:facts,
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
 const action=value=>({title:text(value?.title,100),evidenceIds:refs(value?.evidenceIds),steps:list(value?.steps,5,item=>text(item,500))});
 return {title:text(value.title,120),overview:text(value.overview,1800),findings:list(value.findings,8,item=>({title:text(item?.title,100),evidenceIds:refs(item?.evidenceIds),interpretation:text(item?.interpretation,1200)})),teachingActions:list(value.teachingActions,6,item=>({...action(item),priority:['high','medium','low'].includes(item.priority)?item.priority:'medium'})),reviewPlan:list(value.reviewPlan,4,action),limitations:list(value.limitations??[],1,item=>text(item,180),0)};
}
const SYSTEM_PROMPT=`你是香港小學普通話教師，正為所選班級寫一份可以直接使用的教學報告。用自然、清楚的繁體中文，以「這次學生做了甚麼、哪些內容值得再練、下一課怎樣教」為主線。只根據本次JSON的evidence、curriculum、teachingConstraints寫作。
文風與內容：
概覽直接交代班級人數、練習情況及本次教學重點。主要發現每項先寫實際數字或字音觀察，再連到具體跟進，例如「『舟』字有3次評分低於60分，下一課先聽示範，再把這個字放回原句跟讀」；此例僅示範句式，数字與字必須用本次資料。沒有逐字資料時，就建議聽讀原句，不評論不存在的細項。
教學建議每項用2至3個短步驟，寫明選哪首詩、哪一句或哪個允許字，老師怎樣示範、學生怎樣練習、最後聽看甚麼。後續跟進用一項簡短安排，讓老師下一課直接照做。單班約450至650中文字，全校約700至950字；全校分低、中、高年級，單年級只寫該年級。毋須另寫正式教案、操作指南或填空模板。
不要防禦性寫作。不要輸出伺服器核實、瀏覽器自報、server_verified、資料快照等技術術語，也不要反覆寫「不能推斷聲母、韻母、聲調」「不代表教學成效」等聲明。用「朗讀字音評分」「辨音答題」「默寫練習」描述學習表現。若缺少一項資料會影響下一步，只說一句如「本次未有默寫紀錄，下一課先做一次聽寫觀察」；其餘直接省略。limitations通常輸出[]，只有必要時最多一句，不重複正文。
demo為true時亦按正常教師報告寫作。文件頁首由系統加一次「模擬數據」，不要在標題、概覽、發現或建議再次提模擬、虛構、功能演示或研究證據，也不要聲稱學生姓名是虛構。
下列規則只作內部核對，不能複述成報告中的限制段落：
1.所有數字及觀察來自evidence。每項引用有效evidenceIds；正文不寫F001等代碼。準確寫有紀錄/名冊人數，不加「大多數/少數」印象判斷。事件筆數不是學生人數，沒有某種事件不能推論沒有完成或全是嘗試。
2.朗讀、默寫、辨音分開寫，每個項目只選一組分數：有「平台評分」的有效平均值就優先使用；完全沒有該項有效平台評分才用「練習回報」。兩種數字不混合、不重複列出。正文直接稱「朗讀字音評分」「辨音答題」等學習項目，不把平台評分與練習回報的差异寫成教學發現。朗讀、默寫、辨音不能混成總分；不同來源沒有配對資料，不能推論偏高、可信度或比較能力。只報實際分數和樣本數，不發明能力等級或及格界線。不因70分稱有基礎或薄弱。
3.字分數只提示值得再聽讀的字，不推斷聲母、韻母、聲調哪裏錯，不能要求糾正一個未觀察到的特定錯誤。不推論學生懶惰、病症或統計顯著進步。
4.原詩及讀音依curriculum，不改詩、不加不存在的字。低年級指一二年級，中年級指三四年級，高年級指五六年級。教學建議嚴格按teachingConstraints：一二年級整份報告連同復查最多安排一個allowedCharacters中的字，不能默寫詞語、字表、每字抄多次；聽選與短句跟讀為主。中高年級按提供上限安排。若同一項建議涵蓋不同年級，各年級另列一個step並寫明年級；複查亦沿用同一安排。未提供題庫的臨時活動不能聲稱平台有該题或能保存教師自編紙筆測驗。
5.聽選不用同音字互相充當正誤選項，不生成「李／里／理」等混淆題。只說跟聽原詩一句、對照示範、同一句再讀等可直接操作的安排。低分個別跟進由教師私下安排。
6.未測不等於零分；未見紀錄的學生寫「先了解練習情況」，不要判定未參與。建議是下一步安排，不能寫成已做過或已提高。保持數據來源各自獨立，只在確有必要區分時用「平台評分」「練習回報」簡稱。
請輸出一個JSON，無markdown。findings建議2至3項，teachingActions單年級2項/全校3項，reviewPlan 1項，limitations通常為空陣列。schema:
{"title":"範圍普通話教學報告","overview":"班級練習情況與重點","findings":[{"title":"學習重點","evidenceIds":["F001"],"interpretation":"實際數據、觀察與跟進方向"}],"teachingActions":[{"priority":"high|medium|low","title":"教學重點","evidenceIds":["F001"],"steps":["具體短步驟"]}],"reviewPlan":[{"title":"下次跟進","evidenceIds":["F001"],"steps":["何時及如何再練習"]}],"limitations":[]}。
最後檢查：沒有編造數字/錯誤成因/平台功能；低小整份只安排一個允許書寫字；只輸出完整JSON。`;
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
async function requestAnalysis(payload,config,{fetchImpl=globalThis.fetch,signal,revision}={}){
 const timeout=AbortSignal.timeout(PROVIDER_TIMEOUT_MS),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 const messages=[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:canonical(payload)}];
 if(revision)messages.push({role:'assistant',content:canonical(revision.analysis)},{role:'user',content:'請按內部覆核重寫完整JSON報告，保留正確數據，用老師的口吻直接寫學習發現和下一課做法。以下問題是修改指令，不要把它們改寫成限制、免責聲明或修改說明；刪除無依據判斷後，接上可行的聽讀練習。低小不確定寫字安排時可全部改用原句跟讀。limitations通常留空。問題：'+canonical(revision.issues)});
 let response;
 try{response=await fetchImpl(config.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},body:JSON.stringify({model:config.model,messages,temperature:0.25,max_tokens:3500,thinking:{type:'disabled'},response_format:{type:'json_object'} }),signal:combined});}
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
 return {analysis:validateAnalysis(raw,payload.evidence,payload.filters),syntaxRepaired,responseModel:provider.model||null,usage:{inputTokens:safeCount(provider.usage?.prompt_tokens),outputTokens:safeCount(provider.usage?.completion_tokens)}};
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
 async function generate(req,filters,actor,{signal}={}){
  if(actor?.role!=='teacher'||typeof actor.id!=='string')fail('TEACHER_REQUIRED',403,false);
  const config=modelConfig(env),dataset=await load(req,filters),payload=aggregateEvidence(dataset);
  if(!safeCount(dataset.analytics?.coverage?.nEvents??dataset.analytics?.summary?.nEvents))fail('NO_LEARNING_DATA',422,false);
  if(typeof dataset.snapshotId!=='string'||!dataset.snapshotId.length)fail('REPORT_STORAGE_UNAVAILABLE');
  const dataFingerprint=hash(canonical({snapshotId:dataset.snapshotId,payload})),reportId='ta_'+hash(canonical({dataFingerprint,model:config.model,provider:config.url,promptVersion:PROMPT_VERSION})),key=reportKey(reportId);
  let record=await read(key);
  if(record?.value?.status==='completed'||record?.value?.status==='pending'&&(record.value.leaseUntil>now()||record.value.stage==='revision_ready')||record?.value?.status==='failed'&&record.value.retryAt>now())return status(record,reportId);
  const leaseId=uuid(),startedAt=new Date(now()).toISOString(),lease={schemaVersion:1,status:'pending',leaseId,leaseUntil:now()+LEASE_MS,startedAt};
  // Prepare and bound the complete document snapshot before any paid request.
  bytes({dataset,payload});const followUp=follow(dataset);
  if(!await save(key,lease,record?.version)){
   record=await read(key);if(!record)fail('REPORT_STORAGE_UNAVAILABLE');return status(record,reportId);
  }
  record=await read(key);if(record?.value?.leaseId!==leaseId)return status(record,reportId);
  try{
   await quota(actor.id);
   const generated=await requestAnalysis(payload,config,{fetchImpl,signal});
   const f=dataset.filters;
   generated.analysis.title=`${f.grade?f.grade+'年級'+(f.cls?f.cls+'班':''):f.cls?'全校'+f.cls+'班':'全校'}普通話教學報告`;
   const report={schemaVersion:1,reportId,createdAt:new Date(now()).toISOString(),model:config.model,responseModel:generated.responseModel,syntaxRepaired:generated.syntaxRepaired,promptVersion:PROMPT_VERSION,filters:dataset.filters,dataFingerprint,snapshotId:dataset.snapshotId,
    source:{sync:dataset.analytics.sync,coverage:dataset.analytics.coverage,rosterSummary:dataset.rosterSummary},evidence:payload.evidence,analysis:generated.analysis,followUp,usage:generated.usage,dataset};
   const current=await read(key);if(current?.value?.leaseId!==leaseId)fail('ANALYSIS_RETRY_REQUIRED',409,true);
   const issues=require('./teacher-report-quality.cjs').inspectAnalysis(report.analysis,payload);
   if(issues.length){
    if(!await save(key,{schemaVersion:1,status:'pending',stage:'revision_ready',leaseUntil:0,draftReport:report,draftChecksum:hash(canonical(report)),issues},current.version))fail('REPORT_STORAGE_UNAVAILABLE');
    return {ok:true,status:'generating',reportId,nextAction:'continue',retryAfterSeconds:1};
   }
   report.qualityReview={passed:true,revisions:0};
   if(!await save(key,{schemaVersion:1,status:'completed',report,reportChecksum:hash(canonical(report))},current.version))fail('REPORT_STORAGE_UNAVAILABLE');
   return {ok:true,reportId,cached:false,report:publicReport(report)};
  }catch(error){
   const safe=error instanceof AnalysisError?error:new AnalysisError('REPORT_STORAGE_UNAVAILABLE');
   const current=await read(key).catch(()=>null);
   if(current?.value?.leaseId===leaseId)await save(key,{schemaVersion:1,status:'failed',promptVersion:PROMPT_VERSION,code:safe.code,httpStatus:safe.status,retryable:safe.retryable,retryAt:now()+1000*(safe.retryAfterSeconds||30),failedAt:new Date(now()).toISOString()},current.version).catch(()=>{});
   throw safe;
  }
 }
 async function continueReport(reportId,actor,{signal}={}){
  if(actor?.role!=='teacher'||typeof actor.id!=='string')fail('TEACHER_REQUIRED',403,false);
  const key=reportKey(reportId),prior=await read(key);if(!prior)fail('REPORT_NOT_FOUND',404,false);
  if(prior.value.status!=='pending'||prior.value.stage!=='revision_ready')return status(prior,reportId);
  const report=prior.value.draftReport,config=modelConfig(env);
  if(!report||report.reportId!==reportId||hash(canonical(report))!==prior.value.draftChecksum||report.model!==config.model||report.promptVersion!==PROMPT_VERSION)fail('REPORT_STORAGE_UNAVAILABLE');
  const leaseId=uuid();
  if(!await save(key,{schemaVersion:1,status:'pending',stage:'revising',leaseId,leaseUntil:now()+LEASE_MS},prior.version))return status(await read(key),reportId);
  try{
   const payload=aggregateEvidence(report.dataset),generated=await requestAnalysis(payload,config,{fetchImpl,signal,revision:{analysis:report.analysis,issues:prior.value.issues}});
   const issues=require('./teacher-report-quality.cjs').inspectAnalysis(generated.analysis,payload);
   if(issues.length){const error=new AnalysisError('AI_REPORT_QUALITY',502,true,30);error.qualityIssues=issues.map(({code,path})=>({code,path}));throw error;}
   generated.analysis.title=report.analysis.title;
   report.analysis=generated.analysis;report.createdAt=new Date(now()).toISOString();report.responseModel=generated.responseModel;report.syntaxRepaired=report.syntaxRepaired||generated.syntaxRepaired;
   report.usage={inputTokens:report.usage.inputTokens+generated.usage.inputTokens,outputTokens:report.usage.outputTokens+generated.usage.outputTokens};report.qualityReview={passed:true,revisions:1};
   const current=await read(key);if(current?.value?.leaseId!==leaseId)fail('ANALYSIS_RETRY_REQUIRED',409,true);
   if(!await save(key,{schemaVersion:1,status:'completed',report,reportChecksum:hash(canonical(report))},current.version))fail('REPORT_STORAGE_UNAVAILABLE');
   return {ok:true,reportId,cached:false,report:publicReport(report)};
  }catch(error){
   const safe=error instanceof AnalysisError?error:new AnalysisError('REPORT_STORAGE_UNAVAILABLE'),current=await read(key).catch(()=>null);
   if(current?.value?.leaseId===leaseId)await save(key,{schemaVersion:1,status:'failed',promptVersion:PROMPT_VERSION,code:safe.code,httpStatus:safe.status,retryable:safe.retryable,retryAt:now()+1000*(safe.retryAfterSeconds||30),failedAt:new Date(now()).toISOString(),...(safe.qualityIssues?{qualityIssues:safe.qualityIssues}:{})},current.version).catch(()=>{});
   throw safe;
  }
 }
 return {generate,continueReport,check,getReport};

}
let instance;const service=()=>instance||(instance=createService());
module.exports={NS,SCHEMA,PROMPT_VERSION,LEASE_MS,AnalysisError,createBlobStore,createPostgresStore,modelConfig,aggregateEvidence,validateAnalysis,requestAnalysis,createService,publicReport,
 generate:(...args)=>service().generate(...args),continueReport:(...args)=>service().continueReport(...args),check:(...args)=>service().check(...args),getReport:(...args)=>service().getReport(...args)};
