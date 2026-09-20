'use strict';
const auth=require('./school-auth.cjs');
const data=require('./teacher-data.cjs');
const research=require('./research-store.cjs');
const demo=require('./teacher-demo-data.cjs');
const analysis=require('./teacher-analysis.cjs');
async function loadDemo(req,filters){return demo.createDemoDataset(filters,{roster:await auth.listAccounts(req)});}
const service=analysis.createService({namespace:analysis.NS+'-demo',loadDataset:loadDemo});
const assistant=require('./teacher-assistant-handler.cjs').createHandler({analysisModule:service});
const exporter=require('./teacher-export-handler.cjs').createHandler({loadDataset:loadDemo,getReport:service.getReport});
async function demoData(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie');
 try{
  const actor=await auth.requireActor(req,{roles:['teacher']});if(!actor||actor.role!=='teacher')throw new auth.AuthError(403,'ROLE_FORBIDDEN');
  if(req.method!=='GET')return res.status(405).json({ok:false,code:'GET_ONLY'});
  const {kind,...filters}=req.query||{};
  if(kind==='roster'&&!Object.keys(filters).length)return res.status(200).json({demo:true,students:demo.demoRoster(await auth.listAccounts(req)),teachers:[]});
  if(kind!=='analytics')return res.status(400).json({ok:false,code:'INVALID_DEMO_REQUEST'});
  const dataset=await loadDemo(req,filters);
  return res.status(200).json({...dataset.analytics,demo:true,demoNotice:dataset.demoNotice});
 }catch(error){
  if(error instanceof auth.AuthError)return auth.sendError(res,error);
  if(error instanceof research.ResearchError)return research.sendError(res,error);
  return res.status(error.status||503).json({ok:false,code:error instanceof data.TeacherDataError?error.code:'DEMO_UNAVAILABLE'});
 }
}
module.exports={assistant,exporter,demoData};
