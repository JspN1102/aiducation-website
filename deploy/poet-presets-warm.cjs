'use strict';
// Run locally on the application server with its private env. No account,
// student conversation or research event is read or written by this command.
const fs=require('node:fs/promises'),path=require('node:path');
const cache=require('../api/_lib/poet-preset-cache.cjs');
function argumentsFor(args){
  let apply=false,poemId;
  for(let index=0;index<args.length;index++){
    const value=args[index];
    if(value==='--apply')apply=true;
    else if(value==='--poem'&&/^[1-6]$/.test(args[index+1]||''))poemId=Number(args[++index]);
    else throw new Error('USAGE: node --env-file=/private/app.env deploy/poet-presets-warm.cjs [--apply] [--poem 1..6]');
  }
  return {apply,poemId};
}
async function run({apply=false,poemId,env=process.env,emit=value=>console.log(JSON.stringify(value)),generate=cache.generatePrepared}={}){
  const directory=env.POET_PRESET_CACHE_DIR;
  if(!directory||!path.isAbsolute(directory))throw new Error('POET_PRESET_CACHE_DIR must be an absolute private directory');
  const records=await cache.listPrepared({env,poemId});
  let hits=0,generated=0,missing=0,failed=0;
  // A directory lock prevents two administrative warmers paying for the same
  // set. It is never removed by a process which did not create it.
  let lock;
  if(apply){
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    lock=path.join(directory,'.warming');
    await fs.mkdir(lock,{mode:0o700});
  }
  try{
    for(const expected of records){
      const prior=await cache.readPrepared(expected,{directory});
      if(prior){hits++;emit({presetId:expected.presetId,status:'cached',model:expected.model});continue;}
      if(!apply){missing++;emit({presetId:expected.presetId,status:'missing',model:expected.model});continue;}
      try{
        const value=await generate(expected,{env});
        await cache.storePrepared(expected,value,{directory});generated++;
        emit({presetId:expected.presetId,status:'stored',model:expected.model});
      }catch(error){failed++;emit({presetId:expected.presetId,status:'failed',code:/^PRESET_[A-Z0-9_]+$/.test(error?.message||'')?error.message:'PRESET_GENERATION_FAILED'});}
    }
  }finally{if(lock)await fs.rmdir(lock);}
  const result={ok:failed===0&&missing===0,total:records.length,hits,generated,missing,failed};emit(result);return result;
}
if(require.main===module)run(argumentsFor(process.argv.slice(2))).then(result=>{if(!result.ok)process.exitCode=1;}).catch(error=>{
  console.error(error?.code==='EEXIST'?'Preset warmer already running; inspect the private .warming lock.':'Preset warm-up could not run; verify model and private cache configuration.');process.exitCode=1;
});
module.exports={argumentsFor,run};
