const auth=require('./school-auth.cjs');
const analysis=require('./teacher-analysis.cjs');
const research=require('./research-store.cjs');
const {TeacherDataError,normalizeFilters,requireTeacherScope}=require('./teacher-data.cjs');
function createHandler({authModule=auth,analysisModule=analysis}={}){return async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED',retryable:false});
 const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!res.writableEnded)abort();};
 req.once?.('aborted',abort);res.once?.('close',closed);
 try{
  const actor=await authModule.requireActor(req,{roles:['teacher'],csrf:req.method==='POST'});
  if(!actor||actor.role!=='teacher')return res.status(403).json({ok:false,code:'TEACHER_REQUIRED',retryable:false});
  let result;
  if(req.method==='GET'){
   if(!req.query||Object.keys(req.query).some(key=>!['reportId','tool'].includes(key))||req.query.tool!==undefined&&req.query.tool!=='analysis')throw new analysis.AnalysisError('INVALID_REPORT_REQUEST',400,false);
   result=await analysisModule.check(req.query.reportId);
  }else{
   const body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>4096)throw new analysis.AnalysisError('INVALID_REPORT_REQUEST',400,false);
   if(Object.keys(body).length===1&&typeof body.reportId==='string')result=await analysisModule.continueReport(body.reportId,actor,{signal:controller.signal});
   else{
    if(Object.keys(body).some(key=>key!=='filters')||!body.filters||typeof body.filters!=='object'||Array.isArray(body.filters))throw new analysis.AnalysisError('INVALID_REPORT_REQUEST',400,false);
    if(Object.keys(body.filters).some(key=>!['grade','poemId','cls','from','to','activity','attempt'].includes(key)))throw new analysis.AnalysisError('INVALID_REPORT_FILTERS',400,false);
    result=await analysisModule.generate(req,requireTeacherScope(normalizeFilters(body.filters)),actor,{signal:controller.signal});
   }
  }
  if(result.status==='generating'){res.setHeader('Retry-After',String(result.retryAfterSeconds));return res.status(202).json(result);}
  return res.status(200).json(result);
 }catch(error){
  if(error instanceof auth.AuthError)return authModule.sendError(res,error);
  if(error instanceof research.ResearchError)return research.sendError(res,error);
  if(error instanceof TeacherDataError)return res.status(error.status).json({ok:false,code:error.code,retryable:error.status>=500});
  const safe=error instanceof analysis.AnalysisError?error:new analysis.AnalysisError('REPORT_STORAGE_UNAVAILABLE');
  if(safe.retryAfterSeconds)res.setHeader('Retry-After',String(safe.retryAfterSeconds));
  return res.status(safe.status).json({ok:false,code:safe.code,retryable:safe.retryable,...safe.retryAfterSeconds?{retryAfterSeconds:safe.retryAfterSeconds}:{}});
 }finally{req.removeListener?.('aborted',abort);res.removeListener?.('close',closed);}
};}
module.exports=createHandler();module.exports.createHandler=createHandler;
