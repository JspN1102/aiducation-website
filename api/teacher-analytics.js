import research from './_lib/research-store.cjs';
import auth from './_lib/school-auth.cjs';
import data from './_lib/teacher-data.cjs';

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return res.status(405).json({error:'GET_ONLY'});
  try{
    const actor=await auth.requireActor(req,{roles:['teacher']});
    if(!actor)return res.status(503).json({error:'RESEARCH_DISABLED'});
    const filters=data.requireTeacherScope(research.filtersFrom(req.query||{}));
    const format=req.query?.format;
    if(format&&format!=='json'){
      if(!['csv','jsonl'].includes(format))throw new research.ResearchError('INVALID_EXPORT_FORMAT');
      for(const key of ['cursor','limit'])if(req.query[key]!==undefined&&(typeof req.query[key]!=='string'||!/^\d{1,6}$/.test(req.query[key])))throw new research.ResearchError('INVALID_EXPORT_PAGE');
      return res.status(200).json({schemaVersion:1,...await research.researchExport(filters,{format,cursor:Number(req.query.cursor||0),limit:Number(req.query.limit||5000),snapshot:req.query.snapshot})});
    }
    return res.status(200).json(await research.analytics(filters,{includeStudentDetails:true}));
  }catch(error){if(error instanceof auth.AuthError)return auth.sendError(res,error);return research.sendError(res,error);}
}
