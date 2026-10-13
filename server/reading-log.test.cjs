'use strict';
// 朗讀測評次數 in the teacher dashboard (jasper and molly): who may see it, the
// list without login or last-used time, every line's count, and the Excel of scores.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const auth=require('../api/_lib/school-auth.cjs');
const {getPoem}=require('../api/_lib/poems.js');
const {createReadingLog,filters,ATTEMPTS}=require('../api/_lib/reading-log-handler.cjs');

const A='r_aaaaaaaaaaaaaaaaaaaaaaaa',B='r_bbbbbbbbbbbbbbbbbbbbbbbb',RESET='2026-10-03T05:17:00.000Z';
const NOW=Date.parse('2026-10-11T04:00:00.000Z');
const ACCOUNTS=[{role:'student',researchId:B,displayName:'測試甲',login:'t2a01',grade:2,cls:'A',classNo:1}];
const AT=Date.parse('2026-10-10T02:00:00.000Z');

function pool(seen=[]){
 const client={async query(sql,params){if(/^(BEGIN|SET|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};seen.push({sql,params});
   if(sql.includes('row_number()'))return {rows:[{poem:2,line:0,n:1,at:AT,status:'completed',score:71.6},{poem:2,line:0,n:2,at:AT+60000,status:'error',score:null},
     {poem:2,line:0,n:3,at:AT+120000,status:'completed',score:90},{poem:2,line:1,n:1,at:AT+180000,status:'completed',score:88}]};
   if(sql.includes('GROUP BY research_id,poem_id'))return {rows:[{research_id:B,grade:2,cls:'A',poem:2,line:0,n:3,failed:1,last:5},{research_id:B,grade:2,cls:'A',poem:2,line:1,n:1,failed:0,last:6},
     {research_id:A,grade:3,cls:'B',poem:4,line:3,n:2,failed:0,last:4}]};
   return {rows:[]};},release(){}};
 return {connect:async()=>client};
}
async function withActor(who,run){
 const saved=auth.requireActor;auth.requireActor=async()=>who;
 try{return await run();}finally{auth.requireActor=saved;}
}
function caller(h){
 return async query=>{const res={statusCode:0,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},json(b){this.body=b;return this;},send(b){this.body=b;return this;}};
  res.status=n=>{res.statusCode=n;return res;};await h({method:'GET',query,headers:{}},res);return res;};
}
const handler=(seen=[])=>createReadingLog({researchPool:()=>pool(seen),directory:async()=>({accounts:ACCOUNTS}),cohort:async()=>RESET,now:()=>NOW});

test('only jasper and molly may see reading counts; other teachers and pupils get nothing',async()=>{
 assert.equal(auth.readingLog({role:'teacher',login:'jasper'}),true);assert.equal(auth.readingLog({role:'teacher',login:'molly'}),true);
 assert.equal(auth.readingLog({role:'teacher',login:'chan'}),false);assert.equal(auth.readingLog({role:'student',login:'jasper'}),false);
 assert.equal(auth.publicActor({role:'teacher',login:'molly'}).readingLog,true);assert.equal(auth.publicActor({role:'teacher',login:'chan'}).readingLog,false);
 const call=caller(handler());
 for(const who of [{role:'teacher',login:'chan'},{role:'student',login:'molly'}]){
  const r=await withActor(who,()=>call({}));assert.equal(r.statusCode,403);assert.doesNotMatch(JSON.stringify(r.body),/測試甲/);
 }
 for(const login of ['jasper','molly'])assert.equal((await withActor({role:'teacher',login},()=>call({}))).statusCode,200);
});

test('ranges are 今日, 7, 30 days or 全部 (400); grade and class are the only other filters',()=>{
 for(const days of ['1','7','30','400'])assert.equal(filters({days},NOW).days,Number(days));
 for(const days of ['2','14','401','x'])assert(filters({days},NOW).error,days);
 const f=filters({days:'7',grade:'2',cls:'A',poem:'6',q:'雨'},NOW);assert.equal(f.grade,2);assert.equal(f.cls,'A');assert.equal(f.poem,undefined);assert.equal(f.q,undefined);
});

test('the list names each pupil with class and seat, counts per poem, and has no login or last time',async()=>{
 const seen=[],r=await withActor({role:'teacher',login:'molly'},()=>caller(handler(seen))({days:'30',grade:'2'}));
 assert.equal(r.statusCode,200);assert.equal(r.body.readings,6);assert.equal(r.body.filters.grade,2);
 const b=r.body.students.find(s=>s.student===B);
 assert.deepEqual(b,{student:B,name:'測試甲',grade:2,cls:'A',classNo:1,total:4,failed:1,poems:[{id:2,title:getPoem(2).title,total:4}]});
 assert.doesNotMatch(JSON.stringify(r.body),/t2a01|lastAt|login/);
 assert(seen[0].params.includes(RESET),'readings start at the 2026-10-03 reset');
});

test('看每句 gives every line of every poem with its count; a pupil is required',async()=>{
 const call=caller(handler());
 let r=await withActor({role:'teacher',login:'jasper'},()=>call({view:'student'}));assert.equal(r.statusCode,400);
 r=await withActor({role:'teacher',login:'jasper'},()=>call({view:'other',student:B}));assert.equal(r.statusCode,400);
 r=await withActor({role:'teacher',login:'jasper'},()=>call({view:'student',student:B,days:'400'}));
 assert.equal(r.statusCode,200);assert.equal(r.body.student.name,'測試甲');
 assert.deepEqual(r.body.student.poems[0].lines,[{line:1,text:getPoem(2).lines[0].text,count:3,failed:1},{line:2,text:getPoem(2).lines[1].text,count:1,failed:0}]);
});

test('the Excel has 第一句 第 1 次, 第 2 次 … across and every attempt with its time below',async()=>{
 const seen=[],r=await withActor({role:'teacher',login:'jasper'},()=>caller(handler(seen))({view:'xlsx',student:B,days:'7'}));
 assert.equal(r.statusCode,200);assert(Buffer.isBuffer(r.body));assert.equal(r.body.subarray(0,2).toString(),'PK');
 assert.match(r.headers['content-disposition'],/filename\*=UTF-8''/);assert(decodeURIComponent(r.headers['content-disposition']).includes('測試甲'));
 const q=seen.find(x=>x.sql.includes('row_number()'));assert.deepEqual(q.params.slice(0,2),[B,RESET]);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(r.body);
 assert.deepEqual(wb.worksheets.map(w=>w.name),['每句分數','每次明細']);
 const wide=wb.getWorksheet('每句分數');
 assert.deepEqual(wide.getRow(2).values.slice(1),['古詩','句','句子','次數','第 1 次','第 2 次','第 3 次']);
 assert.deepEqual(wide.getRow(3).values.slice(1),[getPoem(2).title,'第 1 句',getPoem(2).lines[0].text,3,72,'沒有結果',90]);
 assert.deepEqual(wide.getRow(4).values.slice(1),[getPoem(2).title,'第 2 句',getPoem(2).lines[1].text,1,88]);
 const each=wb.getWorksheet('每次明細');assert.equal(each.rowCount,6);assert.equal(each.getRow(4).getCell(6).value,'沒有結果');
});

test('attempts are numbered over all of a pupil’s readings, then narrowed to the chosen days',()=>{
 const sql=ATTEMPTS('received_at >= $3 AND received_at < $4',true);
 const inner=sql.slice(0,sql.indexOf(') x'));
 assert.match(inner,/row_number\(\) OVER \(PARTITION BY poem_id/);assert.match(inner,/research_id = \$1 AND received_at >= \$2/);assert.doesNotMatch(inner,/\$3/);
 assert.match(sql.slice(sql.indexOf(') x')),/WHERE received_at >= \$3 AND received_at < \$4/);
});

test('a pupil with too many readings is asked to narrow the range rather than given a cut file',async()=>{
 const big={connect:async()=>({async query(sql){if(/^(BEGIN|SET|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
   return {rows:Array.from({length:20001},(_,i)=>({poem:2,line:0,n:i+1,at:AT,status:'completed',score:80}))};},release(){}})};
 const h=createReadingLog({researchPool:()=>big,directory:async()=>({accounts:ACCOUNTS}),cohort:async()=>RESET,now:()=>NOW});
 const r=await withActor({role:'teacher',login:'jasper'},()=>caller(h)({view:'xlsx',student:B,days:'400'}));
 assert.equal(r.statusCode,413);assert.equal(r.body.code,'TOO_MANY_READINGS');
 const none=createReadingLog({researchPool:()=>null,directory:async()=>({accounts:ACCOUNTS}),cohort:async()=>RESET,now:()=>NOW});
 assert.equal((await withActor({role:'teacher',login:'jasper'},()=>caller(none)({view:'xlsx',student:B}))).statusCode,503);
 assert.equal((await withActor({role:'teacher',login:'jasper'},()=>caller(none)({}))).body.available,false);
});
