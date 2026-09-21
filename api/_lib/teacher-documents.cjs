'use strict';
const ExcelJS=require('exceljs');
const docx=require('docx');
const {CONSTRUCTS,TeacherDataError}=require('./teacher-data.cjs');
const poems=require('../../maanshan/poems.json').poems;
const MAX_BYTES=4*1024*1024;
const ACTIVITY={navigation:'選詩',listen:'聆聽',read:'朗讀',animation:'動畫',challenge:'練習',writing:'聽寫',explore:'探索',chat:'詩人對話'};
const SYNC={direct:'已更新',published:'已更新',ready:'已就緒',synced:'已同步',current:'最新',fresh:'最新',live:'即時',ok:'已就緒',catching_up:'正在補傳',attention:'部分資料待更新',unavailable:'尚未同步'};
const clean=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const metric=(summary,construct,source)=>summary?.byConstruct?.[construct]?.[source]||{};
const selected=(person,dataset)=>person.stats?.[dataset.filters.attempt]||person.stats;
function assertDataset(dataset){if(dataset?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(dataset.snapshotId||'')||!Array.isArray(dataset.students)||dataset.students.length>10000||!dataset.analytics||!dataset.filters)throw new TeacherDataError('REPORT_SNAPSHOT_INVALID',409);}
function rangeLabel(dataset){const f=dataset.filters,poem=poems.find(p=>p.id===Number(f.poemId));return `${f.grade?f.grade+' 年級':'全校'}${poem?' · '+poem.title:''}${f.cls?' · '+f.cls+' 班':''}${f.student?' · 個別學生':''} · ${f.from} 至 ${f.to} · ${f.activity?ACTIVITY[f.activity]||f.activity:'全部活動'} · ${f.attempt==='first'?'首次':'最近'}練習`;}
function limitationLines(dataset){const a=dataset.analytics,s=dataset.rosterSummary;return [
  '朗讀、辨音與聽寫分開查看。0 分是已有評分；空白或「未測」表示尚無評分。',
  '首次及最近分數取自相同題目和練習模式；錯題複習及自由練習另行記錄。',
  '日期按平台收到紀錄的 UTC 日期整理，離線完成的練習會在連線後補上。',
  `更新狀態：${SYNC[a.sync?.status]||'待更新'}。`,
  ...(a.coverage?.nInvalidEvents?[`${a.coverage.nInvalidEvents} 筆紀錄待核對。`]:[]),
  ...(s.unmatchedWithRecords?[`${s.unmatchedWithRecords} 位學生的紀錄尚待對應名冊。`]:[]),
  `字音重點列出 ${a.readingWordSummary?.returnedGroups||0} 組${a.readingWordSummary?.truncated?'，可縮小班級範圍查看更多':''}，可用來挑選下一次跟讀的字。`,
  '有效學習時間按已收到的連續操作估算。'
];}
function sheet(workbook,name,columns){const ws=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}],properties:{defaultRowHeight:24}});ws.columns=columns.map(([header,width=18])=>({header,width}));ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'},name:'Microsoft JhengHei',size:11};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF28665C'}};ws.getRow(1).height=30;ws.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};ws.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};return ws;}
function add(ws,values){const row=ws.addRow(values.map(value=>typeof value==='string'?clean(value):value));row.eachCell(cell=>{cell.font={name:'Microsoft JhengHei',size:11};cell.alignment={vertical:'top',wrapText:true};if(typeof cell.value==='number')cell.numFmt=Number.isInteger(cell.value)?'0':'0.0';});if(row.number%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F6F3'}};}
function bounded(buffer){if(buffer.length>MAX_BYTES)throw new TeacherDataError('EXPORT_TOO_LARGE',413);return Buffer.from(buffer);}
async function buildXlsx(dataset){
  assertDataset(dataset);
  const wb=new ExcelJS.Workbook();
  wb.creator='AIDUCATION';wb.created=new Date(dataset.generatedAt);
  wb.title=(dataset.demo?'【模擬數據】':'')+'學生數據表格';wb.subject=rangeLabel(dataset);
  const constructs=['reading.pronunciation','sound.recognition','writing.dictation'];
  const students=sheet(wb,'學生明細',[
    ['年級',9],['班別',9],['座號',9],['姓名',20],['朗讀得分',15],['聽音辨字（分）',17],['聽寫（分）',15],['練一練完成情況',32]
  ]);
  students.views=[{state:'frozen',xSplit:4,ySplit:1,topLeftCell:'E2',showGridLines:false}];
  students.getRow(1).height=42;students.getRow(1).alignment={vertical:'middle',horizontal:'center',wrapText:true};
  students.pageSetup.printTitlesRow='1:1';students.pageSetup.printTitlesColumn='A:D';
  students.headerFooter={oddHeader:`&L${wb.title}&R${rangeLabel(dataset)}`,oddFooter:'&LAIDUCATION&R第 &P 頁 / 共 &N 頁'};
  students.getCell('A1').note=`${wb.title}\n${rangeLabel(dataset)}\n產生時間：${hongKongTime(dataset.generatedAt)}`;
  for(let index=0;index<constructs.length;index++)students.getCell(1,index+5).note=`${dataset.filters.attempt==='first'?'首次':'最近'}紀錄的平均分（0–100）。0 分是已有評分；空白表示未測。`;
  students.getCell('H1').note='最近一輪練一練的完成題數及答對題數。小遊戲完成計入完成題數，不計入答對題數。';
  for(const person of dataset.students){
    const summary=selected(person,dataset),scores=constructs.map(construct=>{const score=metric(summary,construct,'serverVerified');return score.measuredN>0?number(score.meanScore):null;});
    const practice=dataset.analytics.studentDetails?.[person.researchId]?.practiceSummary;
    const progress=practice?`完成 ${practice.completedN}${practice.total?' / '+practice.total:''} 題；答對 ${practice.correctN} 題`:'未有紀錄';
    add(students,[person.grade,person.cls,person.classNo,person.displayName,...scores,progress]);
    const row=students.getRow(students.rowCount);row.height=42;
    row.eachCell(cell=>{cell.alignment={vertical:'middle',horizontal:cell.col===4?'left':'center',wrapText:true};});
  }
  students.autoFilter={from:{row:1,column:1},to:{row:students.rowCount,column:students.columnCount}};
  return bounded(await wb.xlsx.writeBuffer());
}
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,HeadingLevel,AlignmentType,Footer,PageNumber}=docx;
const para=(text,extra={})=>new Paragraph({children:[new TextRun({text:clean(text),font:'Microsoft JhengHei',...(extra.heading?{}:{size:22})})],spacing:{after:130,line:300},widowControl:true,keepLines:clean(text).length<120,...extra});
const heading=text=>para(text,{heading:HeadingLevel.HEADING_1,keepNext:true});
function table(headers,rows,widths){return new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[headers,...rows].map((row,index)=>new TableRow({tableHeader:index===0,cantSplit:true,children:row.map((value,col)=>new TableCell({...(widths?{width:{size:widths[col],type:WidthType.PERCENTAGE}}:{}),shading:index===0?{fill:'E3EFE9'}:undefined,children:[para(value==null?'未測':value,{spacing:{after:65},...(index===0?{children:[new TextRun({text:clean(value),bold:true,font:'Microsoft JhengHei',size:21})]}:{})})]}))}))});}
function learningRows(dataset){
  return Object.entries(CONSTRUCTS).flatMap(([construct,label])=>{
    const source=['serverVerified','clientReported'].find(source=>{const m=metric(dataset.analytics.summary,construct,source);return m.measuredN>0&&number(m.meanScore)!==null;});
    if(!source)return [];
    const m=metric(dataset.analytics.summary,construct,source);return [[label,`${m.meanScore} 分`,`${m.measuredN} 次`]];
  });
}
function hongKongTime(value){const time=new Date(value);return Number.isFinite(time.getTime())?new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(time)+'（香港時間）':'未提供';}
async function buildDocx(report){const dataset=report?.dataset;assertDataset(dataset);if(!report.analysis||!report.reportId||report.snapshotId&&report.snapshotId!==dataset.snapshotId)throw new TeacherDataError('REPORT_SNAPSHOT_INVALID',409);
  const a=report.analysis,children=[...(dataset.demo?[para('模擬數據',{spacing:{after:70}})]:[]),para('AI普通話學習平台',{spacing:{after:70}}),para(a.title||'普通話教研報告',{heading:HeadingLevel.TITLE,spacing:{after:200}}),para(rangeLabel(dataset)),para(`報告日期：${hongKongTime(report.createdAt)}`),heading('整體評價'),para(a.overview)];
  children.push(heading('主要發現'));
  if(!a.findings?.length)children.push(para('目前沒有足夠資料形成分項發現。'));
  for(const item of a.findings||[])children.push(para(item.title,{heading:HeadingLevel.HEADING_2,keepNext:true}),para(item.interpretation));
  children.push(heading('教學建議'));
  for(const item of a.teachingActions||[]){children.push(para(item.title,{heading:HeadingLevel.HEADING_2,keepNext:true}));for(const text of item.steps||[])children.push(para(text));}
  if(!a.teachingActions?.length)children.push(para('先安排短時聆聽及朗讀觀察，再依新增紀錄決定練習重點。'));
  for(const item of a.reviewPlan||[]){children.push(para(item.title,{heading:HeadingLevel.HEADING_2,keepNext:true}));for(const text of item.steps||[])children.push(para(text));}
  if(a.limitations?.length)children.push(heading('補充'),para(a.limitations[0]));
  const doc=new Document({creator:'AIDUCATION',title:a.title||'普通話教研報告',description:rangeLabel(dataset)+'；資料版本：'+dataset.snapshotId+'；報告代號：'+report.reportId,styles:{default:{document:{run:{font:'Microsoft JhengHei',size:22}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:38,bold:true,color:'24594F'},paragraph:{keepNext:true,spacing:{after:200}}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:28,bold:true,color:'28665C'},paragraph:{spacing:{before:240,after:140},keepNext:true}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{size:23,bold:true,color:'36564B'},paragraph:{spacing:{before:160,after:100},keepNext:true}}]},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1100,bottom:1100,left:1050,right:1050}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:'普通話教研報告 · ',size:18}),new TextRun({children:[PageNumber.CURRENT],size:18})]})]})},children}]});
  return bounded(await Packer.toBuffer(doc));
}
module.exports={MAX_BYTES,assertDataset,rangeLabel,limitationLines,buildXlsx,buildDocx};
