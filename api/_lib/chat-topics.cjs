'use strict';
// What each pupil asked the AI 詩人 about, in a few words: one small DeepSeek call per
// question after the chat has been answered and recorded (never on the pupil's path).
// Gibberish (emoji, digits, random letters) is 無效輸入 here without any call.
// Teachers see only these labels and counts; the words stay in 網站後台 (Jasper).
// A question with no row in chat_topics is 未分類 (the call failed or has not run).
const TOPICS={meaning:'問詩句意思',poet:'問詩人生平',pronounce:'讀音寫法',chat:'日常閒聊',offtopic:'與學習無關',invalid:'無效輸入'};
const CONCERNS={abuse:'罵人粗口',bully:'欺凌',selfharm:'自傷',other:'其他不當'};
const SCHEMA=`CREATE TABLE IF NOT EXISTS chat_topics (
  event_id uuid PRIMARY KEY, topic varchar(16) NOT NULL, concern varchar(16),
  topic_model varchar(80), classified_at timestamptz NOT NULL DEFAULT clock_timestamp()
)`;
const MODEL_RE=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL='local',TIMEOUT_MS=8000,MAX_INFLIGHT=6,CACHE_LIMIT=2000;
const ready=new WeakMap(),cache=new Map();let inflight=0;

function schema(pool){
  if(!ready.has(pool))ready.set(pool,pool.query(SCHEMA).catch(error=>{ready.delete(pool);throw error;}));
  return ready.get(pool);
}
// No letters at all (emoji, digits, symbols), one letter over and over, or Latin
// letters that are not word-like (no vowel, or five consonants in a row: Dxgbsgdx).
function gibberish(value){
  const s=String(value||'').normalize('NFC').trim();if(!s)return true;
  const letters=[...s.replace(/[^\p{L}]/gu,'')];if(!letters.length)return true;
  if(letters.length>=3&&new Set(letters.map(c=>c.toLowerCase())).size===1)return true;
  if(/\p{Script=Han}/u.test(s))return false;
  const words=s.toLowerCase().match(/\p{L}+/gu)||[];
  return !words.some(w=>!/^[a-z]+$/.test(w)||w.length>=2&&/[aeiouy]/.test(w)&&!/[^aeiouy]{5}/.test(w));
}
const PROMPT=`你為小學中文課分類學生對「AI 詩人」說的一句話。只輸出一行 JSON：{"topic":"…","concern":"…"}
topic 只可選一個：
meaning＝問詩句、字詞意思或詩的內容情感；poet＝問詩人生平、朝代、寫詩背景；pronounce＝問讀音、寫法、筆畫、字形；
chat＝和詩人日常閒聊、打招呼、說感受；offtopic＝與這首詩和學習無關（遊戲、動漫、其他話題）；invalid＝亂打、看不懂。
concern 只可選一個：none＝沒有問題；abuse＝罵人、粗口、髒話；bully＝欺凌、取笑或威脅別人；selfharm＝想傷害自己、不想活；other＝其他不適合小學生的內容（色情、暴力等）。
只按學生的話判斷，不要回答學生，不要解釋。`;
// Lenient: the first {...} in the reply, codes checked against the lists above.
function parse(text){
  const m=/\{[^{}]*\}/.exec(String(text||''));if(!m)return null;
  let v;try{v=JSON.parse(m[0]);}catch{return null;}
  const topic=String(v?.topic||'').trim().toLowerCase(),concern=String(v?.concern||'none').trim().toLowerCase();
  if(!Object.hasOwn(TOPICS,topic))return null;
  return {topic,concern:Object.hasOwn(CONCERNS,concern)?concern:null};
}
function modelName(){const m=String(process.env.CHAT_TOPIC_MODEL||process.env.POET_CHAT_MODEL||'deepseek-flash').trim();return MODEL_RE.test(m)?m:null;}
function endpoint(){
  try{const url=new URL(process.env.GPT_API_BASE||'');if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return null;
    const base=url.pathname.replace(/\/+$/,'');url.pathname=base.endsWith('/chat/completions')?base:base.endsWith('/v1')?base+'/chat/completions':base+'/v1/chat/completions';return url.toString();}
  catch{return null;}
}
// One DeepSeek call (same provider and key as the chat itself). null on any failure.
async function remote(question,poemTitle,{fetchImpl=globalThis.fetch,timeoutMs=TIMEOUT_MS}={}){
  const key=process.env.GPT_API_KEY,url=endpoint(),model=modelName();
  if(!key||!url||!model||typeof fetchImpl!=='function')return null;
  try{
    const response=await fetchImpl(url,{method:'POST',signal:AbortSignal.timeout(timeoutMs),
      headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Bearer '+key},
      body:JSON.stringify({model,temperature:0,max_tokens:40,stream:false,thinking:{type:'disabled'},
        messages:[{role:'system',content:PROMPT},{role:'user',content:`古詩：${poemTitle?'《'+poemTitle+'》':'（不詳）'}\n學生的話：${question}`}]})});
    if(!response.ok)return null;
    const data=await response.json(),r=parse(data?.choices?.[0]?.message?.content);
    return r&&{...r,model:typeof data?.model==='string'&&MODEL_RE.test(data.model)?data.model:model};
  }catch{return null;}
}
// Same words (the suggested questions, mostly) are asked once per process.
async function classify(question,poemTitle,options={}){
  const q=String(question||'').normalize('NFC').trim().slice(0,300);
  if(gibberish(q))return {topic:'invalid',concern:null,model:LOCAL};
  const key=(poemTitle||'')+'\n'+q;if(cache.has(key))return cache.get(key);
  const r=await remote(q,poemTitle,options);
  if(r){if(cache.size>=CACHE_LIMIT)cache.delete(cache.keys().next().value);cache.set(key,r);}
  return r;
}
async function save(pool,eventId,r){
  await schema(pool);
  await pool.query(`INSERT INTO chat_topics(event_id,topic,concern,topic_model) VALUES($1,$2,$3,$4)
    ON CONFLICT(event_id) DO UPDATE SET topic=EXCLUDED.topic,concern=EXCLUDED.concern,topic_model=EXCLUDED.topic_model,classified_at=clock_timestamp()`,
    [eventId,r.topic,r.concern||null,r.model?String(r.model).slice(0,80):null]);
}
// Fire and forget after the chat is recorded: never throws, never awaited by the chat.
function classifyLater({eventId,question,poemTitle},{pool=defaultPool,...options}={}){
  try{
    if(!UUID.test(String(eventId||''))||typeof question!=='string'||!question.trim())return Promise.resolve(false);
    const db=pool();if(!db||inflight>=MAX_INFLIGHT)return Promise.resolve(false);
    inflight++;
    return classify(question,poemTitle,options).then(r=>r?save(db,eventId,r).then(()=>true):false).catch(()=>false).finally(()=>{inflight--;});
  }catch{return Promise.resolve(false);}
}
function defaultPool(){try{const research=require('./research-store.cjs');return research.mode()==='postgres'?research.getPool():null;}catch{return null;}}

module.exports={TOPICS,CONCERNS,SCHEMA,schema,gibberish,parse,classify,remote,save,classifyLater,endpoint,modelName,LOCAL,
  _reset(){cache.clear();inflight=0;}};
