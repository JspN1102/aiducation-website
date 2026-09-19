import research from './_lib/research-store.cjs';
import auth from './_lib/school-auth.cjs';

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST_ONLY'});
  try{
    const actor=await auth.requireActor(req,{roles:['student'],csrf:true});
    if(!actor)return res.status(503).json({error:'RESEARCH_DISABLED'});
    return res.status(200).json(await research.ingest(req.body,actor));
  }catch(error){if(error instanceof auth.AuthError)return auth.sendError(res,error);return research.sendError(res,error);}
}
