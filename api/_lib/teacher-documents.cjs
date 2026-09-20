'use strict';
const ExcelJS=require('exceljs');
const docx=require('docx');
const {CONSTRUCTS,SOURCES,buildFollowUp,TeacherDataError}=require('./teacher-data.cjs');
const MAX_BYTES=4*1024*1024;
const ACTIVITY={navigation:'選詩',listen:'聆聽',read:'朗讀',animation:'動畫',challenge:'練習',writing:'聽寫',explore:'探索',chat:'詩人對話'};
const SYNC={direct:'直接資料庫',published:'已發佈',ready:'已就緒',synced:'已同步',current:'最新',fresh:'最新',live:'即時',ok:'已就緒',catching_up:'正在補傳',attention:'部分資料待檢查',unavailable:'尚未同步'};
const clean=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const metric=(summary,construct,source)=>summary?.byConstruct?.[construct]?.[source]||{};
const selected=(person,dataset)=>person.stats?.[dataset.filters.attempt]||person.stats;
function assertDataset(dataset){if(dataset?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(dataset.snapshotId||'')||!Array.isArray(dataset.students)||dataset.students.length>10000||!dataset.analytics||!dataset.filters)throw new TeacherDataError('REPORT_SNAPSHOT_INVALID',409);}
function rangeLabel(dataset){const f=dataset.filters;return `${dataset.demo?'【模擬數據・非真實學生】 ':''}${f.grade?f.grade+' 年級':'全校'}${f.cls?' '+f.cls+' 班':''}${f.student?' · 個別學生':''} · ${f.from} 至 ${f.to}（UTC 收件日期） · ${f.activity?ACTIVITY[f.activity]||f.activity:'全部活動'} · ${f.attempt==='first'?'首次':'最近'}紀錄`;}
function limitationLines(dataset){const a=dataset.analytics,s=dataset.rosterSummary;return [
  '不同分項、伺服器評測與學生端回報分開呈現，不能混合成一個總分。0 分代表有測量；空白／未測代表沒有有效分數。',
  '首次／最近按相同題目、版本及練習模式內的嘗試選取。錯題複習與自由練習不納入獨立評測；首次與最近差異不等於教學成效。',
  '日期依伺服器收到紀錄的 UTC 日期；離線補傳可能在之後日期出現。名冊為產生快照時的在校名冊，期內未見紀錄不等於未學習。',
  `同步狀態：${SYNC[a.sync?.status]||a.sync?.status||'未知'}；最後發佈：${a.sync?.lastImportedAt||'直接讀取／未提供'}。尚未補傳的紀錄不在本表。`,
  `資料品質：${a.coverage?.nInvalidEvents||0} 筆異常紀錄；${a.summary?.qualityFlags?.join('、')||'沒有已標示異常'}。${s.unmatchedWithRecords||0} 位有紀錄學生未連結目前名冊。`,
  `字音重點顯示 ${a.readingWordSummary?.returnedGroups||0}／${a.readingWordSummary?.totalGroups||0} 組${a.readingWordSummary?.truncated?'，已截取前 50 組':''}；字分數用於安排練習，不能直接診斷聲母、韻母或聲調問題。`,
  '有效學習時間是可用連續事件之差的下限；範圍邊界、遺漏事件及離線紀錄可能令時間不完整。',
  ...(a.sync?.integrity?[`待處理資料：${a.sync.integrity.pendingObjects??'未提供'}；完整性問題：${a.sync.integrity.integrityIssues??'未提供'}；待重試：${a.sync.integrity.retryPending??'未提供'}。`]:[])
];}
function sheet(workbook,name,columns){const ws=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}],properties:{defaultRowHeight:24}});ws.columns=columns.map(([header,width=18])=>({header,width}));ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'},name:'Microsoft JhengHei',size:11};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF28665C'}};ws.getRow(1).height=30;ws.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};return ws;}
function add(ws,values){const row=ws.addRow(values.map(value=>typeof value==='string'?clean(value):value));row.eachCell(cell=>{cell.font={name:'Microsoft JhengHei',size:11};cell.alignment={vertical:'top',wrapText:true};if(typeof cell.value==='number')cell.numFmt=Number.isInteger(cell.value)?'0':'0.0';});if(row.number%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F6F3'}};}
function bounded(buffer){if(buffer.length>MAX_BYTES)throw new TeacherDataError('EXPORT_TOO_LARGE',413);return Buffer.from(buffer);}
async function buildXlsx(dataset){assertDataset(dataset);const wb=new ExcelJS.Workbook();wb.creator='AIDUCATION';wb.created=new Date(dataset.generatedAt);wb.title=(dataset.demo?'【模擬數據】':'')+'普通話學習紀錄';wb.subject=rangeLabel(dataset);
  const overview=sheet(wb,'概覽',[['項目',28],['內容',105]]),a=dataset.analytics,s=dataset.rosterSummary;
  for(const row of [['報表',dataset.demo?'【模擬數據】普通話學習紀錄 · 全部為虛構學生及紀錄，不可用作研究證據':'馬鞍山靈糧小學 · 普通話學習紀錄'],['範圍',rangeLabel(dataset)],['產生時間（香港）',hongKongTime(dataset.generatedAt)],['資料快照',dataset.snapshotId],['名冊學生數',s.totalStudents],['名冊內有紀錄',s.withRecords],['名冊內期內未見紀錄',s.noRecords],['未連結名冊但有紀錄',s.unmatchedWithRecords||0],['所選紀錄筆數',a.coverage.nEvents],['已標示異常紀錄',a.coverage.nInvalidEvents],['同步狀態',SYNC[a.sync?.status]||a.sync?.status||'未知'],['最後發佈（UTC）',a.sync?.lastImportedAt||'直接資料庫／未提供']])add(overview,row);
  const constructs=Object.entries(CONSTRUCTS),follow=buildFollowUp(dataset),followById=new Map(follow.students.map(person=>[person.researchId,person.reasons]));
  add(overview,['先看這裡','「學生明細」每人一行，直接查看各分項平均分及跟進提示；「分項表現」可追查測量筆數、首次／最近及學生端回報。']);
  add(overview,['學生明細的分數',`${dataset.filters.attempt==='first'?'首次':'最近'}紀錄的伺服器評測平均分（0–100）；空白為未測，不以學生端回報補上。各分項分開看，不相加、不算總分。`]);
  for(const [construct,label]of constructs)for(const [source,sourceLabel]of Object.entries(SOURCES)){const m=metric(a.summary,construct,source);if(m.measuredN>0&&number(m.meanScore)!==null)add(overview,[label+' · '+sourceLabel,`${m.meanScore} 分（${m.measuredN} 筆有效測量）`]);}
  const students=sheet(wb,'學生明細',[['年級',9],['班別',9],['座號',9],['姓名',20],['期內狀態',25],...constructs.map(([,label])=>[label+'（分）',18]),['跟進提示',62],['紀錄數',12],['嘗試數',12],['完成紀錄',12],['有效時間（分鐘）',20],['最近收到紀錄（UTC）',27],['名冊對應',14],['匿名研究代號',32]]);
  students.views=[{state:'frozen',xSplit:4,ySplit:1,topLeftCell:'E2'}];students.getRow(1).height=42;students.getRow(1).alignment={vertical:'middle',wrapText:true};
  for(let index=0;index<constructs.length;index++)students.getCell(1,index+6).note='只呈現所選首次／最近的伺服器評測平均分（0–100）。空白表示未測；學生端回報另外列在「分項表現」。';
  for(const person of dataset.students){
    const stats=person.stats,summary=selected(person,dataset),serverScores=constructs.map(([construct])=>{const score=metric(summary,construct,'serverVerified');return score.measuredN>0?number(score.meanScore):null;}),reasons=followById.get(person.researchId)||[];
    const clientMeasured=constructs.some(([construct])=>metric(summary,construct,'clientReported').measuredN>0);
    const note=!stats?.nEvents?(follow.absenceReliable?'所選範圍未見紀錄，先了解參與情況。':'暫未見已同步紀錄，待同步核對。'):reasons.length?reasons.map(reason=>`${reason.label} ${reason.score} 分（${reason.sourceLabel}，${reason.measuredN} 筆）`).join('；'):serverScores.some(value=>value!==null)?'已有伺服器評測；按各分項安排練習。':clientMeasured?'僅有學生端回報，尚無伺服器有效評測。':'已有活動紀錄，暫無有效分項測量。';
    add(students,[person.grade,person.cls,person.classNo,person.displayName,stats?.nEvents?'已有紀錄':'所選範圍未見紀錄',...serverScores,note,stats?.nEvents||0,stats?.nAttempts||0,stats?.completedN||0,number(stats?.activeMs)===null?null:Math.round(stats.activeMs/6000)/10,stats?.lastSeenAt||'',person.rosterMatched?'已連結':'未連結',person.researchId]);
    students.getRow(students.rowCount).height=Math.max(38,Math.ceil(note.length/34)*17);
  }
  const scores=sheet(wb,'分項表現',[['年級',9],['班別',9],['座號',9],['姓名',20],['分項',18],['資料來源',19],['所選平均分',17],['有效測量筆數',18],['未測筆數',14],['首次平均分',17],['首次有效筆數',18],['最近平均分',17],['最近有效筆數',18],['狀態',16],['匿名研究代號',32]]);
  scores.views=[{state:'frozen',xSplit:4,ySplit:1,topLeftCell:'E2'}];
  for(const person of dataset.students)for(const [construct,label]of constructs)for(const [source,sourceLabel]of Object.entries(SOURCES)){const m=metric(selected(person,dataset),construct,source),first=metric(person.stats?.first,construct,source),last=metric(person.stats?.latest,construct,source);if(![m,first,last].some(value=>value.measuredN>0||value.unmeasuredN>0))continue;add(scores,[person.grade,person.cls,person.classNo,person.displayName,label,sourceLabel,number(m.meanScore),m.measuredN||0,m.unmeasuredN||0,number(first.meanScore),first.measuredN||0,number(last.meanScore),last.measuredN||0,m.measuredN>0?'有測量':'未測',person.researchId]);}
  const trends=sheet(wb,'每日趨勢',[['日期（UTC）',18],['有紀錄學生',17],['紀錄數',13],['分項',18],['資料來源',19],['平均分',14],['有效測量筆數',18],['未測筆數',14],['異常紀錄數',16]]);
  for(let tick=Date.parse(dataset.filters.from),end=Date.parse(dataset.filters.to);tick<=end;tick+=86400000){const date=new Date(tick).toISOString().slice(0,10),day=a.trend.find(row=>row.date===date);for(const [construct,label]of Object.entries(CONSTRUCTS))for(const [source,sourceLabel]of Object.entries(SOURCES)){const m=metric(day,construct,source);add(trends,[date,day?.nStudents||0,day?.nEvents||0,label,sourceLabel,number(m.meanScore),m.measuredN||0,m.unmeasuredN||0,day?.nInvalidEvents||0]);}}
  const poemNames=new Map(require('../../maanshan/poems.json').poems.map(poem=>[poem.id,poem.title]));
  const words=sheet(wb,'字音重點',[['古詩',20],['古詩編號',13],['詩句代號',20],['字序（從1起）',18],['字',10],['平均分',13],['測量次數',14],['低於60分次數',19],['內容版本',38]]);
  for(const word of a.readingWords||[])add(words,[poemNames.get(word.poemId)||'未提供詩名',word.poemId,word.itemId,word.index+1,word.char,number(word.meanScore),word.count,word.below60Count,word.contentVersion]);
  if(!a.readingWords?.length)add(words,['尚無逐字評測紀錄']);
  const notes=sheet(wb,'說明',[['項目',22],['說明',125]]);limitationLines(dataset).forEach((line,index)=>add(notes,[`資料說明 ${index+1}`,line]));add(notes,['資料來源辨識','伺服器評測由服務端核對；學生端回報由瀏覽器提交，不能視為等同的已核實分數。']);add(notes,['學生明細與跟進提示','分數欄只列所選首次／最近的伺服器評測；跟進提示列出有效平均分低於 60 的分項及來源，僅為查看線索，不是能力分級。沒有測量的學生仍保留在名冊，空白不是零分。']);add(notes,['分項與每日趨勢','分項表現只列曾有測量或未測事件的來源，不重複列出不存在的分項。每日趨勢的當日人數與紀錄數在不同分項重複顯示，請勿跨分項相加；各日人數也不能相加作不重複學生數。']);add(notes,['檔案格式','所有內容為文字或數值儲存格，不含巨集、公式、外部連結或原始錄音／筆跡／聊天。']);
  return bounded(await wb.xlsx.writeBuffer());
}
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,HeadingLevel,AlignmentType,Footer,PageNumber}=docx;
const para=(text,extra={})=>new Paragraph({children:[new TextRun({text:clean(text),font:'Microsoft JhengHei',...(extra.heading?{}:{size:22})})],spacing:{after:130,line:300},widowControl:true,keepLines:clean(text).length<600,...extra});
const heading=text=>para(text,{heading:HeadingLevel.HEADING_1,keepNext:true});
function table(headers,rows,widths){return new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[headers,...rows].map((row,index)=>new TableRow({tableHeader:index===0,cantSplit:true,children:row.map((value,col)=>new TableCell({...(widths?{width:{size:widths[col],type:WidthType.PERCENTAGE}}:{}),shading:index===0?{fill:'E3EFE9'}:undefined,children:[para(value==null?'未測':value,{spacing:{after:65},...(index===0?{children:[new TextRun({text:clean(value),bold:true,font:'Microsoft JhengHei',size:21})]}:{})})]}))}))});}
function evidenceText(report,ids){const facts=(ids||[]).map(id=>report.evidence?.find(item=>item.id===id)).filter(Boolean);return facts.slice(0,4).map(item=>{
  const value=item.value&&typeof item.value==='object'?`平均 ${item.value.meanScore} 分，${item.value.observations} 次觀察，其中 ${item.value.below60} 次低於 60 分`:String(item.value??'未測');
  const source={structured_records:'學習紀錄',server_verified:'伺服器評測'}[item.source]||item.source;
  return `${item.scope?'〔'+item.scope+'〕':''}${item.label}：${value}${item.unit?' '+item.unit:''}${source?'（'+source+'）':''}`;
}).join('；')+(facts.length>4?`；另 ${facts.length-4} 項分組依據已保存於報告紀錄，詳細學習資料可查同範圍 Excel。`:'');}
function hongKongTime(value){const time=new Date(value);return Number.isFinite(time.getTime())?new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(time)+'（香港時間）':'未提供';}
async function buildDocx(report){const dataset=report?.dataset;assertDataset(dataset);if(!report.analysis||!report.reportId||report.snapshotId&&report.snapshotId!==dataset.snapshotId)throw new TeacherDataError('REPORT_SNAPSHOT_INVALID',409);
  const a=report.analysis,children=[...(dataset.demo?[para('模擬數據示範｜非真實學生、不可用作研究證據',{heading:HeadingLevel.HEADING_2})]:[]),para('馬鞍山靈糧小學',{spacing:{after:70}}),para(a.title||'普通話教學報告',{heading:HeadingLevel.TITLE,spacing:{after:200}}),para(rangeLabel(dataset)),para(`報告產生：${hongKongTime(report.createdAt)}`),heading('學習概況'),para(a.overview),table(['名冊學生','已有紀錄','期內未見紀錄'],[[`${dataset.rosterSummary.totalStudents} 人`,`${dataset.rosterSummary.withRecords} 人`,`${dataset.rosterSummary.noRecords} 人`]],[34,33,33])];
  children.push(heading('主要發現'));
  if(!a.findings?.length)children.push(para('目前沒有足夠資料形成分項發現。'));
  for(const item of a.findings||[]){children.push(para(item.title,{heading:HeadingLevel.HEADING_2,keepNext:true}),para(item.interpretation));const evidence=evidenceText(report,item.evidenceIds);if(evidence)children.push(para('依據：'+evidence));}
  children.push(heading('教學建議'));
  for(const [index,item]of (a.teachingActions||[]).entries()){children.push(para(`${index+1}. ${item.title}`,{heading:HeadingLevel.HEADING_2,keepNext:true}));for(const [step,text]of (item.steps||[]).entries())children.push(para(`${step+1}）${text}`));const evidence=evidenceText(report,item.evidenceIds);if(evidence)children.push(para('依據：'+evidence));}
  if(!a.teachingActions?.length)children.push(para('先安排短時聆聽及朗讀觀察，再依新增紀錄決定練習重點。'));
  if(a.reviewPlan?.length){children.push(heading('後續跟進'));for(const item of a.reviewPlan){children.push(para(item.title,{heading:HeadingLevel.HEADING_2,keepNext:true}));for(const step of item.steps||[])children.push(para('• '+step));}}
  children.push(heading('資料範圍與限制'));for(const line of a.limitations||[])children.push(para('• '+line));
  children.push(para('分數按學習項目與來源分開解讀；未測不當作零分。未見紀錄可能涉及尚未同步。報告反映本次已收到的資料，教學建議尚未實施，不代表已證明成效。'));
  const follow=buildFollowUp(dataset);children.push(heading('附錄：學生跟進參考'),para(follow.criteria));
  if(follow.students.length)children.push(table(['班別座號','姓名','具體觀察'],follow.students.map(person=>[`${person.grade}${person.cls} ${person.classNo??'—'}`,person.displayName,person.reasons.map(reason=>`${reason.label} ${reason.score} 分（${reason.sourceLabel}，${reason.measuredN} 筆）`).join('；')]),[17,18,65]));
  else children.push(para('所選範圍暫無符合上述分項觀察條件的學生；未測項目不列為低分。'));
  if(follow.unstartedIds.length){
    const ids=new Set(follow.unstartedIds),groups=new Map();
    for(const person of dataset.students.filter(person=>ids.has(person.researchId))){const key=person.grade+person.cls+' 班';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(`${person.classNo??'—'}號 ${person.displayName}`);}
    children.push(para(follow.absenceReliable?'期內未見紀錄：宜先了解參與或同步情況。':'同步仍待完成：以下學生暫未見已同步紀錄，不能判作未參與。',{heading:HeadingLevel.HEADING_2,keepNext:true}));
    for(const [label,names]of groups)children.push(para(`${label}（${names.length} 人）：${names.join('；')}。`));
  }
  const doc=new Document({creator:'AIDUCATION',title:a.title||'普通話學習分析報告',description:rangeLabel(dataset)+'；資料版本：'+dataset.snapshotId+'；報告代號：'+report.reportId,styles:{default:{document:{run:{font:'Microsoft JhengHei',size:22}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:38,bold:true,color:'24594F'},paragraph:{keepNext:true,spacing:{after:200}}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:28,bold:true,color:'28665C'},paragraph:{spacing:{before:240,after:140},keepNext:true}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:23,bold:true,color:'36564B'},paragraph:{spacing:{before:160,after:100},keepNext:true}}]},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1100,bottom:1100,left:1050,right:1050}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'普通話教學報告 · AI 協助撰寫，供教師參考 · ',size:18}),new TextRun({children:[PageNumber.CURRENT],size:18})]})]})},children}]});
  return bounded(await Packer.toBuffer(doc));
}
module.exports={MAX_BYTES,assertDataset,rangeLabel,limitationLines,buildXlsx,buildDocx};
