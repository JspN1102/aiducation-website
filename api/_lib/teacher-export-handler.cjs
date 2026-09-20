'use strict';
const auth=require('./school-auth.cjs');
const research=require('./research-store.cjs');
const data=require('./teacher-data.cjs');
const documents=require('./teacher-documents.cjs');
const MIME={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
function createHandler({requireTeacher=req=>auth.requireActor(req,{roles:['teacher'],csrf:true}),loadDataset=data.loadTeacherDataset,getReport=id=>require('./teacher-analysis.cjs').getReport(id),xlsx=documents.buildXlsx,docx=documents.buildDocx,timeoutMs=22000,maxConcurrent=2}={}){
  let active=0;
  return async function teacherExport(req,res){
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='POST')return res.status(405).json({ok:false,code:'POST_ONLY',error:'請使用匯出按鈕。'});
    let timer,work;
    try{
      const actor=await requireTeacher(req);if(!actor||actor.role!=='teacher')throw new auth.AuthError(403,'ROLE_FORBIDDEN');
      const body=req.body;
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','filters','reportId'].includes(key))||!['xlsx','docx'].includes(body.action)||body.action==='docx'&&!body.reportId||body.reportId!==undefined&&!/^ta_[a-f0-9]{64}$/.test(body.reportId)||body.reportId&&body.filters)throw new data.TeacherDataError('INVALID_EXPORT_REQUEST',400);
      if(active>=maxConcurrent)throw new data.TeacherDataError('EXPORT_BUSY',429);
      active++;
      work=(async()=>{
        let report,dataset;
        if(body.reportId){report=await getReport(body.reportId);if(!report)throw new data.TeacherDataError('REPORT_NOT_FOUND',404);if(report.reportId!==body.reportId)throw new data.TeacherDataError('REPORT_SNAPSHOT_INVALID',409);dataset=report.dataset;documents.assertDataset(dataset);}
        else dataset=await loadDataset(req,body.filters||{});
        const bytes=await(body.action==='xlsx'?xlsx(dataset):docx(report));
        if(bytes.length>documents.MAX_BYTES)throw new data.TeacherDataError('EXPORT_TOO_LARGE',413);
        return {bytes,dataset};
      })().finally(()=>{active--;});
      const result=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new data.TeacherDataError('EXPORT_TIMEOUT',504)),timeoutMs);})]);
      const f=result.dataset.filters,date=f.from.replaceAll('-','')+'-'+f.to.replaceAll('-',''),scope=f.grade?f.grade+(f.cls?f.cls+'班':'年級'):'全校'+(f.cls?'_'+f.cls+'班':'');
      const filename=`${result.dataset.demo?'模擬_':''}${body.action==='docx'?'普通話教研報告':'學生數據表格'}_${scope}_${date}.${body.action}`;
      res.setHeader('Content-Type',MIME[body.action]);res.setHeader('Content-Disposition',`attachment; filename="mandarin-learning-${date}.${body.action}"; filename*=UTF-8''${encodeURIComponent(filename)}`);res.setHeader('Content-Length',String(result.bytes.length));res.setHeader('X-Data-Snapshot',result.dataset.snapshotId);
      return res.status(200).send(Buffer.from(result.bytes));
    }catch(error){
      if(error instanceof auth.AuthError)return auth.sendError(res,error);
      const known=error instanceof data.TeacherDataError||error instanceof research.ResearchError||error instanceof require('./teacher-analysis.cjs').AnalysisError;
      const status=known?error.status:503,code=known?error.code:'EXPORT_UNAVAILABLE';
      const messages={INVALID_EXPORT_REQUEST:'匯出要求不完整，請重新操作。',INVALID_FILTER:'請核對日期及班級範圍。',REPORT_NOT_FOUND:'找不到這份報告，請重新產生。',REPORT_SNAPSHOT_INVALID:'報告資料未能核對，請重新產生。',EXPORT_BUSY:'已有匯出正在處理，請稍後再試。',EXPORT_TIMEOUT:'整理資料需時較長，請縮小日期或班級範圍後再試。',EXPORT_TOO_LARGE:'檔案過大，請縮小範圍後再匯出。',NARROW_DATE_OR_CLASS_FILTER:'資料較多，請縮短日期或選擇一個班別。'};
      if(status===429)res.setHeader('Retry-After','10');
      return res.status(status||503).json({ok:false,code,error:messages[code]||'暫時未能匯出，請稍後再試。'});
    }finally{clearTimeout(timer);}
  };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
