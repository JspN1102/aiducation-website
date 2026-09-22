'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {getPoem}=require('./poems.js');
const {poetSystemPrompt,POET_PROMPT_VERSION}=require('./poet-prompt.cjs');
const MAX_BYTES=32*1024;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const catalogue=()=>import('../../maanshan/poet-presets.mjs');
const GROUNDED_PRESETS={
  'p1.call':'本題問真實白鵝的叫聲，用小學生容易理解的「嘎嘎」模仿。不要把詩中的「鵝鵝鵝」說成叫聲的擬聲詞，詩的第一句是呼喚或讚歎白鵝。直接說一至兩句。',
  'p1.read':'本題只需答「好，我們一起讀：鵝，鵝，鵝。」不解釋、不說這三字是白鵝發出的叫聲、不添加後續问题。',
  'p2.friend':'已確定的答覆只有：汪倫是李白的朋友，李白將要乘船離開時，他在岸上踏歌送別。「踏歌」是一邊唱歌一邊用腳打節拍。不能添加他的職業、常釀酒、酒樓、官職、家世或相識經過。用兩句容易聽懂的話。',
  'p2.boat':'本題只需答「我坐小船離開」，可接詩中「李白乘舟將欲行」。不要憑空補上船是否有人划、划得多慢、波紋或其他未提供情節。',
  'p3.sides':'準確說明：山本身沒有變，是人站的位置不同；從正面看像連綿山嶺，從側面看像高高山峰。兩三短句，不用「變成」「變臉」「變形」描寫山。',
  'p3.view':'準確說明：看到連綿的山嶺和高高的山峰；從不同位置看，同一座山的樣子不同，山本身沒有改變。不要使用「變成」「變臉」「變形」，不自行加雲霧等原詩未交代細節。最多三個短句。',
  'p4.other-poems':'直接選王安石《梅花》前兩句「牆角數枝梅，凌寒獨自開」並說作者是聊天角色自己。寒冷中梅花仍開放，可寫其堅強；不要聲稱寒冬所有其他花都凋謝，也不要先列分類反問。約八十字。',
  'p5.farming':'本題只用兩句答清農事：「晨興」是清早起來，「理荒穢」是清除豆田的雜草。接上「草盛豆苗稀」所寫的野草茂盛、豆苗稀疏即可。不要添加豆苗幼小、長得慢、蹲下、彎腰、一株一株用手拔等未交代動作；後文扛着鋤頭，不能把除草工具改成只靠手拔。不需談土壤或養分等擴展。',
  'p6.rain':'酥指酥油，「潤如酥」借其細膩潤澤寫早春小雨。只說春雨細細、帶來潤澤，不描寫街道濕滑或酥油黏不黏、膩不膩、摸起來滑等原詩沒有表達的觸覺；不要讓學生塗抹酥油。兩三句約八十字。',
  'p6.other-poems':'可選柳宗元《江雪》，引用四句原文後簡單解釋雪天寂靜和一位老翁獨自釣魚。老翁釣的是魚，不是雪；「人蹤」指人的蹤跡，不能斷言所有腳印被抹去。不需補作者生平或心境病因。引用加說明總計約一百字。'
};
function modelConfig(env=process.env){
  const model=String(env.POET_PRESET_MODEL||env.TEACHER_AI_MODEL||'deepseek-v4-pro').trim();
  const key=env.GPT_API_KEY,base=env.GPT_API_BASE;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/.test(model)||!key||!base)throw new Error('PRESET_AI_NOT_CONFIGURED');
  const url=new URL(base);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('PRESET_AI_NOT_CONFIGURED');
  let pathname=url.pathname.replace(/\/+$/,'');
  if(!pathname.endsWith('/chat/completions'))pathname+=(pathname.endsWith('/v1')?'':'/v1')+'/chat/completions';
  url.pathname=pathname;
  return {model,key,url:url.href};
}
function preparedMessages(poem,preset,grade){
  const independent='這是一個學生主動點選的獨立開場問題。直接回應這個問題，不假設任何先前對話、學生姓名或個人經歷。答案要具體、簡短、適合本年級。若請一起寫新詩，先明說「我們現在一起新寫幾句」，給出這次新作，不冒充傳世原作；若聊別的詩，直接選一首確定作者及原文的真實作品，簡短聊起，不只反問想聊甚麼。';
  return [{role:'system',content:poetSystemPrompt(poem,grade)+'\n\n'+independent+(GROUNDED_PRESETS[preset.id]?'\n'+GROUNDED_PRESETS[preset.id]:'')},{role:'user',content:preset.question}];
}
function descriptor(poem,preset,grade,config){
  const messages=preparedMessages(poem,preset,grade);
  const identity={schemaVersion:1,poemId:poem.id,grade,presetId:preset.id,presetVersion:preset.version,
    promptVersion:POET_PROMPT_VERSION,question:preset.question,model:config.model,provider:config.url,
    contentChecksum:digest(JSON.stringify(messages))};
  return {...identity,key:digest(JSON.stringify(identity)),messages};
}
function filename(directory,key){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||!/^[a-f0-9]{64}$/.test(key))throw new Error('PRESET_CACHE_NOT_CONFIGURED');
  return path.join(directory,key+'.json');
}
function validReply(reply){return typeof reply==='string'&&reply.trim().length>=2&&reply.length<=4000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(reply);}
function validRecord(record,expected){
  const {messages,...identity}=expected;
  return record&&Object.keys(identity).every(key=>record[key]===identity[key])&&validReply(record.reply)&&
    record.reply===record.reply.trim()&&record.replyChecksum===digest(record.reply)&&record.responseModel===expected.model&&
    typeof record.createdAt==='string'&&Number.isFinite(Date.parse(record.createdAt));
}
async function readPrepared(expected,{directory=process.env.POET_PRESET_CACHE_DIR}={}){
  if(!directory)return null;
  try{
    const target=filename(directory,expected.key),info=await fs.lstat(target);
    if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_BYTES)return null;
    const bytes=await fs.readFile(target);if(bytes.length>MAX_BYTES)return null;
    const record=JSON.parse(bytes.toString('utf8'));
    return validRecord(record,expected)?record:null;
  }catch{return null;}
}
async function storePrepared(expected,generated,{directory=process.env.POET_PRESET_CACHE_DIR,now=Date.now}={}){
  const {messages,...identity}=expected;
  const record={...identity,reply:generated.reply,replyChecksum:digest(generated.reply),responseModel:generated.responseModel,
    createdAt:new Date(now()).toISOString()};
  if(!validRecord(record,expected))throw new Error('PRESET_INVALID_RESPONSE');
  const target=filename(directory,expected.key),bytes=JSON.stringify(record);
  if(Buffer.byteLength(bytes)>MAX_BYTES)throw new Error('PRESET_RECORD_TOO_LARGE');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const info=await fs.lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('PRESET_CACHE_DIRECTORY_INVALID');
  const temporary=target+'.'+crypto.randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});await fs.rename(temporary,target);}
  finally{await fs.unlink(temporary).catch(()=>{});}
  return record;
}
// An arbitrary client flag cannot change the catalogue or the stored question.
// Typed follow-ups keep their history, even if their text matches a starter.
async function matchRequest(body,poem,grade){
  const {matchPoetPreset,POET_PRESET_VERSION}=await catalogue();
  const last=body?.messages?.at(-1);
  if(last?.role!=='user'||grade!==poem.grade)return null;
  const preset=matchPoetPreset(poem.id,last.content);if(!preset)return null;
  if(body.presetId!==undefined||body.presetVersion!==undefined){
    return body.presetId===preset.id&&body.presetVersion===POET_PRESET_VERSION?preset:null;
  }
  return body.messages.length===1&&!preset.explicitOnly?preset:null;
}
async function lookup(body,poem,grade,{env=process.env}={}){
  if(!env.POET_PRESET_CACHE_DIR)return null;
  try{
    const preset=await matchRequest(body,poem,grade);if(!preset)return null;
    const config=modelConfig(env),expected=descriptor(poem,preset,grade,config);
    return await readPrepared(expected,{directory:env.POET_PRESET_CACHE_DIR});
  }catch{return null;}
}
async function listPrepared({env=process.env,poemId}={}){
  const config=modelConfig(env),{POET_PRESETS}=await catalogue();
  return POET_PRESETS.filter(preset=>poemId===undefined||preset.poemId===poemId).map(preset=>{
    const poem=getPoem(preset.poemId,null);return descriptor(poem,preset,poem.grade,config);
  });
}
async function generatePrepared(expected,{env=process.env,fetchImpl=globalThis.fetch,timeoutMs=180000}={}){
  const config=modelConfig(env);if(config.model!==expected.model||config.url!==expected.provider)throw new Error('PRESET_CONFIGURATION_CHANGED');
  const response=await fetchImpl(config.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},
    body:JSON.stringify({model:config.model,messages:expected.messages,max_tokens:expected.grade<=3?1000:1800,temperature:0.5,stream:false,thinking:{type:'disabled'}}),signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error('PRESET_PROVIDER_HTTP_'+response.status);}
  const reader=response.body?.getReader();if(!reader)throw new Error('PRESET_EMPTY_RESPONSE');
  const chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>128*1024)throw new Error('PRESET_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(part.value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),choice=data.choices?.[0],reply=choice?.message?.content?.trim();
  if(data.model!==expected.model||choice?.finish_reason!=='stop'||!validReply(reply))throw new Error('PRESET_INVALID_RESPONSE');
  return {reply,responseModel:data.model};
}
module.exports={MAX_BYTES,modelConfig,descriptor,preparedMessages,validRecord,readPrepared,storePrepared,matchRequest,lookup,listPrepared,generatePrepared};
