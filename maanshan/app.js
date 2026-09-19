import {escapeHTML as esc, clamp, mapAssessment, mergeAssessments, migrateReadingState, createSyncQueue} from './core.mjs?v=20260919a';
import {mountStage, getScenePreview, preloadScene} from './scene-stage.mjs?v=20260919a';
import {configurePronunciation, getPronunciationPractice} from './pronunciation.mjs?v=20260909a';
import {getWordAudioURL} from './word-audio.mjs?v=20260919c';
import {getSpeechAudioURL} from './speech-audio.mjs?v=20260919c';
import {mountShishi} from './shishi.mjs?v=20260919a';
import {mountPoemSwipe} from './poem-swipe.mjs?v=20260915a';
import {mountLessonMap} from './lesson-map.mjs?v=20260919b';
import {CHALLENGE_SETS} from './challenge-data.mjs?v=20260919d';
import {challengeSummary} from './challenge-state.mjs?v=20260919d';
import {encodeRecording, submitAssessment, recordingErrorMessage} from './recording-audio.mjs?v=20260918a';
import {requestJSON} from './network.mjs?v=20260918a';

const $ = (selector, root = document) => root.querySelector(selector);
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons();
const video = $('#recital-video');
const app = $('#app');
const STORE = 'maanshan-learning-v2';
const PROFILE = 'ms_student_info';
const STUDENT_GRADE = 'ms_student_grade';
const REPORT_VERSION = 'grade-v4-compact';
const PENDING = 'ms_pending_sync';
let memoryStore = {};
function readStorage(key, fallback) { if(Object.hasOwn(memoryStore,key))return memoryStore[key];try { const value=JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
function writeStorage(key, value) { try { localStorage.setItem(key,JSON.stringify(value)); delete memoryStore[key]; return true; } catch { memoryStore[key]=value; toast('此裝置的儲存空間不足，請保留本頁。'); return false; } }
let saved = readStorage(STORE, {});
if (!saved || Array.isArray(saved) || typeof saved !== 'object') saved={};
let profile=readStorage(PROFILE,null);
let poems=[], poem=null, view='record', routeVersion=0, showPinyin=true;
let transientAudio=null, transientUrl=null, speechVersion=0, toastTimer=null;
let currentLine=0, recorder=null, stream=null, recordContext=null, recordTimer=null, recordStarted=0, recordBusy=false, recordingVersion=0;
let recordStep='read', recordWordIndex=0;
let reportGeneration=0;
let chatBusy=false;
let sceneStage=null, exploration=null, activeSpeechButton=null, finishTransient=null;
let shishi=null,challenge=null,lessonMap=null,poemSwipe=null;
let animationPlayer=null,disposeAnimation=null;
let activityLoad=0;
let practiceIndex=0, reportTab='advice', reportLine=0, practiceMode='sound';
const TTS_VOICE=403001;
const TTS_SPEED=-.75;
const TTS_PRONUNCIATION='edb-20260919d-yunxiaohe';
const speechCache=new Map(), speechPending=new Map(), speechFailureUntil=new Map(), staticAudioFailures=new Map();
const STATIC_AUDIO_RETRY_MS=60000;
let ttsUnavailableUntil=0,ttsSuccessVersion=0;
const recordings=new Map(), requests=new Set();
const pendingRecordings=new Map();
const sync=createSyncQueue({
  read:()=>{const list=readStorage(PENDING,[]);return Array.isArray(list)?list:[];},
  write:value=>writeStorage(PENDING,value),
  send:item=>fetch('/api/maanshan-save/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item),signal:AbortSignal.timeout(12000)})
});
const titleOf=p=>p.id===5 ? '歸園田居·其三' : p.title;
const asset=(name,p=poem)=>`media/${p.slug}/${name}`;
const poemMotif=(p=poem)=>'media/poetry-motifs/'+['goose','boat','mountain','moon','sprout','swallow'][p.id-1]+'.svg';
const link=(v='record',p=poem)=>`#${p.slug}/${v}`;
const state=p=>{
  const old=saved[p.id];
  if (!old || typeof old!=='object' || Array.isArray(old)) saved[p.id]={};
  const s=saved[p.id];
  if (!Array.isArray(s.reading)) s.reading=Array(p.lines.length).fill(null);
  if (!Array.isArray(s.writing)) s.writing=[];
  if (!Array.isArray(s.chat)) s.chat=[];
  if (!Array.isArray(s.quiz)) s.quiz=[];
  if (!s.quizGames || typeof s.quizGames !== 'object' || Array.isArray(s.quizGames)) s.quizGames={};
  if (migrateReadingState(s,p)) writeStorage(STORE,saved);
  return s;
};
const persist=()=>writeStorage(STORE,saved);
function practiceSnapshot(p=poem){
  const stored=state(p).challenge,set=CHALLENGE_SETS[p.slug],current=challengeSummary(stored,set);
  const original=current.mode==='review'?challengeSummary(stored?.sourceAttempt,set):null;
  return {current,assessment:original?.completed?original:current,pending:stored?.reviewPending?.length||0};
}
const validGrade=value=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=6;
function studentGrade(p=poem){
  const preferred=profile?.grade??readStorage(STUDENT_GRADE,null);
  return validGrade(preferred)?Number(preferred):p.grade;
}
function currentReport(p=poem){
  const s=state(p);
  return s.reportVersion===REPORT_VERSION&&s.reportStudentGrade===studentGrade(p)&&typeof s.report==='string'?s.report:'';
}
function changeStudentGrade(grade){
  if(!validGrade(grade))return;
  writeStorage(STUDENT_GRADE,Number(grade));
  if(profile){profile={...profile,grade:Number(grade)};writeStorage(PROFILE,profile);}
  reportGeneration++;
  if(poem&&view==='report')renderReport();
}
function queueSection(section,payload,p=poem) {
  persist();
  if (!profile?.id || !profile.name || !profile.grade || !profile.cls) return;
  sync.add({syncId:crypto.randomUUID(),studentId:profile.id,name:profile.name,grade:Number(profile.grade),cls:profile.cls,poemId:p.id,section,payload,queuedAt:Date.now()});
  sync.flush();
}
function queueReading(p=poem,extra={}) {
  const s=state(p),result=poemAssessment(p),groups={};
  const practice=practiceSnapshot(p),challengeResult=practice.assessment;
  challengeResult.answers?.forEach(answer=>{if(answer.type==='sound'&&answer.status!=='skipped'){(groups['聽辨：'+answer.focus]??=[]).push(answer.status==='correct'?100:0);}});
  const phonics=Object.fromEntries(Object.entries(groups).map(([label,scores])=>[label,Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)]));
  queueSection('reading',{...extra,...(result?{totalScore:result.total_score}:{}),linesCompleted:s.reading.filter(Boolean).length,words:result?.words||[],phonics,challenge:challengeResult,...(practice.current.mode==='review'?{challengeReview:practice.current}:{}),updatedAt:new Date().toISOString()},p);
}
function toast(text) { clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3800); }
function stopTransient() {
  speechVersion++;
  if(transientAudio){transientAudio.pause();transientAudio.onended=null;transientAudio.onerror=null;}
  finishTransient?.(false);finishTransient=null;transientAudio=null;
  if(transientUrl)URL.revokeObjectURL(transientUrl);transientUrl=null;
  if(activeSpeechButton){delete activeSpeechButton.dataset.audioState;activeSpeechButton.removeAttribute('aria-busy');activeSpeechButton.setAttribute('aria-pressed',String(activeSpeechButton.dataset.action==='practice-word'&&activeSpeechButton.classList.contains('selected')));}
  activeSpeechButton=null;
}
function speechState(button,status) {
  if(!button)return;
  button.dataset.audioState=status;button.setAttribute('aria-busy',String(status==='loading'));button.setAttribute('aria-pressed','true');
}
function xmlText(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function pinyinNumbered(value){
  const marks=['āēīōūǖ','áéíóúǘ','ǎěǐǒǔǚ','àèìòùǜ'];
  let tone=5;for(let i=0;i<marks.length;i++)if(Array.from(value).some(char=>marks[i].includes(char)))tone=i+1;
  return value.normalize('NFD').replace(/[\u0304\u0301\u030c\u0300]/g,'').normalize('NFC').replace(/ü/g,'v')+tone;
}
function phonemeMarkup(char,pinyin){return '<phoneme alphabet="py" ph="'+pinyinNumbered(pinyin)+'">'+xmlText(char)+'</phoneme>';}
function lineMarkup(line,text){
  const phrase=String(text),characters=Array.from(String(line?.text||'')).filter(char=>/\p{Script=Han}/u.test(char));
  let cursor=0;
  const out=['<speak>','<break time="160ms"/>'];
  for(const char of phrase){
    if(!/\p{Script=Han}/u.test(char)){out.push(xmlText(char));continue;}
    const index=characters.indexOf(char,cursor),p=line?.pinyin?.[index];
    out.push(p?phonemeMarkup(char,p):xmlText(char));
    cursor=index>=0?index+1:cursor+1;
  }
  out.push('</speak>');return out.join('');
}
function wordMarkup(char,pinyin){return '<speak><break time="160ms"/>'+phonemeMarkup(char,pinyin)+'</speak>';}
function challengeMarkup(target){
  if(!target.text)return wordMarkup(target.char,target.pinyin);
  const readings=new Map((target.parts||[]).map(item=>[item.char,item.pinyin]));
  if(target.char&&target.pinyin)readings.set(target.char,target.pinyin);
  return '<speak><break time="160ms"/>'+Array.from(target.text,char=>readings.has(char)?phonemeMarkup(char,readings.get(char)):xmlText(char)).join('')+'</speak>';
}
function speechKey(text,markup){return (markup?'ssml:':'plain:')+String(text);}
async function speechSource(text,{markup=null}={}) {
  const requestText=markup||String(text),key=speechKey(requestText,markup);
  if(speechCache.has(key))return speechCache.get(key);
  if(speechPending.has(key))return speechPending.get(key);
  const failedUntil=speechFailureUntil.get(key);
  if(failedUntil>Date.now())throw new Error('TTS phrase temporarily unavailable');
  if(failedUntil)speechFailureUntil.delete(key);
  if(Date.now()<ttsUnavailableUntil)throw new Error('TTS temporarily unavailable');
  const pending=(async()=>{
    const successVersion=ttsSuccessVersion;
    try{
      const response=await fetch('/api/tts/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:requestText,voice:TTS_VOICE,speed:TTS_SPEED,pronunciationVersion:TTS_PRONUNCIATION,delivery:'url',allowSSML:Boolean(markup)}),signal:AbortSignal.timeout(20000)});
      if(!response.ok){const error=new Error('TTS');error.status=response.status;throw error;}
      let source;
      const type=response.headers.get('content-type')||'';
      if(type.startsWith('application/json')){
        const result=await response.json();
        if(typeof result.url!=='string'||!result.url.startsWith('/api/tts/?'))throw new Error('TTS URL');
        source=result.url;
      }else if(type.startsWith('audio/')){
        source=await response.blob();
        if(!source.size)throw new Error('empty audio');
      }else throw new Error('TTS response');
      if(speechCache.size>=80)speechCache.delete(speechCache.keys().next().value);
      speechCache.set(key,source);
      speechFailureUntil.delete(key);
      ttsUnavailableUntil=0;
      ttsSuccessVersion++;
      return source;
    }catch(error){
      if(error?.name!=='AbortError'){
        if([400,413,422].includes(error.status)){
          if(speechFailureUntil.size>=80)speechFailureUntil.delete(speechFailureUntil.keys().next().value);
          speechFailureUntil.set(key,Date.now()+45000);
        }else if(ttsSuccessVersion===successVersion)ttsUnavailableUntil=Date.now()+45000;
      }
      throw error;
    }
  })().finally(()=>speechPending.delete(key));
  speechPending.set(key,pending);return pending;
}
function playBlob(blob) {
  return playSource(URL.createObjectURL(blob),true,.85);
}
function playSpeech(source) {
  return typeof source==='string'?playSource(source,false,.85):playBlob(source);
}
function playSource(url,revoke=false,playbackRate=1) {
  return new Promise(resolve=>{
    const player=new Audio(url);player.preload='auto';player.defaultPlaybackRate=playbackRate;
    let settled=false,watchdog,started=false;
    transientUrl=revoke?url:null;transientAudio=player;
    const finish=ok=>{
      if(settled)return;settled=true;clearTimeout(watchdog);
      player.onended=null;player.onerror=null;player.onplaying=null;player.onwaiting=null;
      player.pause();if(!ok){player.removeAttribute('src');player.load();}if(revoke)URL.revokeObjectURL(url);
      if(transientAudio===player){transientAudio=null;transientUrl=null;finishTransient=null;}
      resolve(ok);
    };
    const waitForAudio=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>finish(false),15000);};
    finishTransient=finish;player.onended=()=>finish(true);
    player.onerror=()=>{finish(false);};
    player.onplaying=()=>clearTimeout(watchdog);player.onwaiting=waitForAudio;waitForAudio();
    const start=()=>{if(started||settled)return;started=true;player.playbackRate=playbackRate;player.play().catch(()=>finish(false));};
    if(player.readyState>=3)start();else player.addEventListener('canplay',start,{once:true});
    player.load();
  });
}
function shouldTryStaticAudio(url){
  const failedAt=staticAudioFailures.get(url);
  if(!failedAt)return true;
  if(Date.now()-failedAt<STATIC_AUDIO_RETRY_MS)return false;
  staticAudioFailures.delete(url);return true;
}
function rememberStaticAudioFailure(url){
  if(staticAudioFailures.size>=80)staticAudioFailures.delete(staticAudioFailures.keys().next().value);
  staticAudioFailures.set(url,Date.now());
}
async function playDemonstration(url,text,markup,isCurrent,onPhase=()=>{}){
  const requestText=markup||String(text),key=speechKey(requestText,markup);
  try{
    if(url&&shouldTryStaticAudio(url)){
      onPhase('playing');
      const finished=await playSource(url);
      if(finished||!isCurrent())return finished;
      rememberStaticAudioFailure(url);
    }
    onPhase('loading');
    const source=await speechSource(text,{markup});
    if(!isCurrent())return false;
    onPhase('playing');
    const finished=await playSpeech(source);
    if(finished||!isCurrent())return finished;
    if(typeof source==='string')speechCache.delete(key);
  }catch{}
  if(!isCurrent())return false;
  return false;
}
async function speakWord(char,pinyin,button=null) {
  if(button&&activeSpeechButton===button){stopMedia();return;}
  stopMedia();const version=speechVersion,route=routeVersion;activeSpeechButton=button;
  speechState(button,'loading');
  let finished=false;
  try{finished=await playDemonstration(getWordAudioURL(char,pinyin),char,wordMarkup(char,pinyin),()=>version===speechVersion&&route===routeVersion,status=>speechState(button,status));}catch{}
  if(version!==speechVersion||route!==routeVersion)return;
  if(!finished)toast('字音暫時未能播放，請再試一次。');
  stopTransient();
}
function focusSound(sample){
  const char=sample.focusChar||sample.char;
  const index=Array.from(sample.text||char).indexOf(char);
  return {char,pinyin:sample.focusPinyin||(Array.isArray(sample.pinyin)?sample.pinyin[index]:sample.pinyin?.split(/\s+/)[index])||''};
}
async function speakWords(items,button){
  if(activeSpeechButton===button){stopMedia();return;}
  stopMedia();const version=speechVersion,route=routeVersion;activeSpeechButton=button;speechState(button,'loading');
  try{for(const item of items){const finished=await playDemonstration(getWordAudioURL(item.char,item.pinyin),item.char,wordMarkup(item.char,item.pinyin),()=>version===speechVersion&&route===routeVersion,status=>speechState(button,status));if(version!==speechVersion||route!==routeVersion)return;if(!finished)throw new Error('playback');}}
  catch{if(version===speechVersion&&route===routeVersion)toast('字音暫時未能播放，請再試一次。');}
  finally{if(version===speechVersion&&route===routeVersion)stopTransient();}
}
function stopMedia() { video.pause();animationPlayer?.pause();stopTransient(); }
function cancelRecording() {
  recordingVersion++;
  if (recorder) {recorder.onerror=null;recorder.onstop=null;if(recorder.state!=='inactive'){try{recorder.stop();}catch{}}}
  stream?.getTracks().forEach(track=>track.stop());stream=null;recorder=null;
  if(recordContext?.state!=='closed')recordContext?.close().catch(()=>{});recordContext=null;
  clearInterval(recordTimer);recordTimer=null;recordBusy=false;
}
async function api(path,body,timeout=35000,retry=false) {
  const controller=new AbortController();requests.add(controller);
  try {
    return await requestJSON(path,body,{timeout,signal:controller.signal,retry});
  } finally {requests.delete(controller);}
}
function verseHTML(line,extra='') {
  let index=0;
  const clauses=(line.text+(line.punctuation||'')).match(/[^，。！？；]+[，。！？；]?/g)||[];
  const contents=clauses.map(clause=>Array.from(clause).map(c=>/\p{Script=Han}/u.test(c)?`<ruby>${esc(c)}<rt>${esc(line.pinyin[index++])}</rt></ruby>`:`<span class="punct">${esc(c)}</span>`).join(''));
  return `<div class="verse ${extra}${contents.length>1?' verse-compound':''}" aria-label="${esc(line.text+(line.punctuation||''))}">${contents.length>1?contents.map(part=>'<span class="verse-clause">'+part+'</span>').join(''):contents.join('')}</div>`;
}
function renderLibrary() {
  poem=null;document.title='古詩朗讀 · 馬鞍山靈糧小學';
  app.innerHTML='<main class="library" id="main">'+
    '<div class="library-heading"><div><h1>把古詩，讀成<span class="title-ink">一幅畫</span></h1></div></div>'+
    '<div class="poem-grid library-books" id="poem-grid" aria-label="選擇古詩"></div><footer class="library-footer"><a href="credits.html">素材來源 '+icon('arrow-up-right')+'</a></footer></main>';
  renderCards();icons();
}
function renderCards() {
  $('#poem-grid').innerHTML=poems.map(p=>'<article class="poem-card poem-color-'+p.id+'"><a class="poem-entry" href="'+link('lesson',p)+'" aria-label="學習'+esc(titleOf(p))+'"><div class="poem-art" style="background-image:url('+getScenePreview(p.slug,p.lines.at(-1).scene)+')"><img src="'+asset('cover-final.webp',p)+'" width="800" height="450" alt="'+esc(p.lines.at(-1).text)+'" '+(p.id>3?'loading="lazy"':'fetchpriority="high"')+'><span class="poem-grade">'+['','一','二','三','四','五','六'][p.grade]+'年級</span></div><div class="poem-card-body"><img class="poem-emblem" src="'+poemMotif(p)+'" width="56" height="56" alt="" aria-hidden="true"><div class="poem-card-title"><h2>'+esc(p.title)+(p.id===5?'<small>其三</small>':'')+'</h2></div><p class="poem-author">'+esc(p.dynasty)+' · '+esc(p.author)+'</p><span class="poem-open">'+icon('book-open')+'<span>一起讀</span>'+icon('arrow-right')+'</span></div></a></article>').join('');icons();
}
const NAV=[['lesson','map','學習路線','路線'],['record','mic','聽一聽・讀一讀','讀一讀'],['animation','clapperboard','看一看動畫','看一看動畫'],['quiz','flag','練一練','練一練'],['explore','sparkles','找一找','找一找'],['chat','messages-square','與詩人對話','詩人'],['report','award','學習報告','報告']];
function renderWorkspace() {
  const name=NAV.find(n=>n[0]===view)?.[2]||'';
  document.title=view==='quiz'?'練一練 · 馬鞍山靈糧小學':`${titleOf(poem)} · ${name} · AIDUCATION`;
  const activityOrder=['record','animation','explore','quiz','chat','report'];
  const activities=NAV.filter(([id])=>activityOrder.includes(id)&&(id!=='explore'||poem.grade>=4)).sort((a,b)=>activityOrder.indexOf(a[0])-activityOrder.indexOf(b[0]));
  app.innerHTML='<div class="workspace lesson-shell poem-color-'+poem.id+' view-'+view+'"><div class="lesson-bar"><a class="back-library" href="'+(view==='lesson'?'#':link('lesson'))+'">'+icon('arrow-left')+'<span>'+(view==='lesson'?'選詩':'路線')+'</span></a><div class="lesson-title">'+(view==='quiz'?'':'<img class="lesson-portrait" src="'+asset('avatar.webp')+'" width="48" height="48" alt="'+esc(poem.author)+'">')+'<div class="lesson-heading"><h1>'+(view==='quiz'?'練一練':esc(titleOf(poem)))+'</h1><p>'+(view==='quiz'?['','一','二','三','四','五','六'][poem.grade]+'年級':(view==='record'?esc(poem.author):esc(poem.dynasty)+' · '+esc(poem.author)))+'</p></div></div><div class="lesson-tools"><details class="lesson-menu"><summary title="切換學習欄目" aria-label="切換學習欄目">'+icon('ellipsis')+'<span>更多</span></summary><nav class="menu-panel" aria-label="切換學習欄目">'+activities.map(([id,symbol,label])=>'<a href="'+link(id)+'" '+(view===id?'aria-current="page"':'')+'>'+icon(symbol)+'<span>'+label+'</span></a>').join('')+'</nav></details></div></div>'+lessonTabs()+'<main class="study-main" id="main"><section id="view" class="view-section '+(showPinyin?'':'hide-pinyin')+'"></section></main></div>';
  renderView();attachShishi();icons();
}
function lessonTabs(){
  return '';
}
function renderLesson(){
  const s=state(poem),{current:assessment}=practiceSnapshot();
  const readingCompleted=s.reading.filter(Boolean).length;
  const unfinished=assessment.answered>0&&!assessment.completed;
  const resume=unfinished?{view:'quiz',label:assessment.mode==='review'?'繼續錯題複習':'繼續小挑戰'}:readingCompleted>0&&readingCompleted<poem.lines.length?{view:'record',label:'繼續第 '+(s.reading.findIndex(r=>!r)+1)+' 句'}:null;
  lessonMap=mountLessonMap($('#view'),{poem,progress:{readingCompleted,readingTotal:poem.lines.length,explorationCompleted:s.exploration?.completed===true,challengeCompleted:assessment.completed,challengeAnswered:assessment.answered,challengeTotal:assessment.total,challengeMode:assessment.mode},resume,onNavigate:next=>{if(next==='record')currentLine=Math.max(0,state(poem).reading.findIndex(r=>!r));location.hash=link(next);}});
}
function attachShishi(){
  const options={view,poem,onFindPoet:()=>{location.hash=link('chat');},onOpen:()=>{if(recordBusy)return false;stopMedia();challenge?.pause();return true;}};
  if(shishi)shishi.update(options);else shishi=mountShishi($('#shishi-guide-host'),options);
  setRecordingBusy();
}
function renderView() {
  if(view==='lesson')renderLesson();
  if(view==='record')renderRecord();
  if(view==='animation')renderAnimation();
  if(view==='report')renderReport();
  if(view==='quiz')renderQuiz();
  if(view==='explore')renderExploration();
  if(view==='chat')renderChat();
  icons();
}
function sceneText(n,p=poem){return p.lines.filter(l=>l.scene===Math.max(1,n)).map(l=>l.text).join('，');}
function renderAnimation() {
  const media=poem.animation;
  if(!media?.src){
    $('#view').innerHTML=`<section class="animation-pending"><img src="${poemMotif()}" width="88" height="88" alt=""><h2>看一看動畫</h2><p>這首詩的動畫還在準備中。</p><a class="button primary" href="${link('record')}">${icon('mic')}先讀一讀</a></section>`;
    return;
  }
  $('#view').innerHTML=`<section class="animation-lesson" aria-labelledby="animation-heading"><header class="animation-heading"><h2 id="animation-heading">看一看動畫</h2><p>${esc(media.caption||`跟着${poem.author}看動畫`)}</p></header><div class="animation-stage"><video id="animation-video" controls playsinline preload="metadata" poster="${esc(media.poster)}" aria-label="${esc(titleOf(poem))}動畫"></video></div><p class="animation-status" id="animation-status" role="status" aria-live="polite" hidden></p><div class="animation-actions"><button type="button" class="button primary" id="animation-toggle" aria-controls="animation-video">${icon('play')}<span>播放動畫</span></button><a class="button" href="${link(poem.grade<=3?'quiz':'explore')}"><span>${poem.grade<=3?'練一練':'找一找'}</span>${icon('arrow-right')}</a></div></section>`;
  const player=$('#animation-video'),button=$('#animation-toggle'),label=$('span',button),status=$('#animation-status');
  const events=new AbortController(),listen=(target,event,callback)=>target.addEventListener(event,callback,{signal:events.signal});
  let started=false,failed=false,dead=false;
  animationPlayer=player;
  function message(text=''){status.textContent=text;status.hidden=!text;}
  function updateButton(){
    label.textContent=failed?'重新播放':player.ended?'再看一次':player.paused?(started?'繼續看':'播放動畫'):'暫停';
    const symbol=button.querySelector('svg,i');
    if(symbol){const replacement=document.createElement('i');replacement.dataset.lucide=!player.paused&&!failed?'pause':'play';replacement.setAttribute('aria-hidden','true');symbol.replaceWith(replacement);icons();}
  }
  async function toggle(){
    if(!player.paused&&!failed){player.pause();return;}
    if(failed){failed=false;player.load();}
    if(player.ended)player.currentTime=0;
    message('動畫載入中…');
    try{await player.play();}
    catch(error){if(!dead&&error.name!=='AbortError'){failed=!!player.error;message(failed?'影片暫時未能播放，按「重新播放」再試一次。':'按畫面上的播放按鈕，再試一次。');updateButton();}}
  }
  listen(button,'click',toggle);
  listen(player,'play',()=>{video.pause();stopTransient();started=true;failed=false;updateButton();});
  listen(player,'playing',()=>{message();updateButton();});
  listen(player,'pause',()=>{if(!failed)message();updateButton();});
  listen(player,'ended',()=>{message();updateButton();});
  listen(player,'waiting',()=>{if(!player.paused)message('動畫載入中…');});
  listen(player,'error',()=>{failed=true;message('影片暫時未能播放，按「重新播放」再試一次。');updateButton();});
  player.src=media.src;
  disposeAnimation=()=>{dead=true;events.abort();player.pause();player.removeAttribute('src');player.load();if(animationPlayer===player)animationPlayer=null;};
}
async function openVideo() {
  if(recordBusy)return;
  stopMedia();$('#video-error').hidden=true;
  $('#video-title').textContent=`${poem.author} · ${titleOf(poem)}`;
  video.src=asset('recital.mp4');video.poster=asset('poster.webp');video.currentTime=0;
  $('#video-dialog').showModal();
  try{await video.play();}catch{ /* Native controls remain available after autoplay restrictions. */ }
}
async function speak(text,context='',button=null) {
  if(button&&activeSpeechButton===button){stopMedia();return;}
  stopMedia();const version=speechVersion,route=routeVersion;
  const texts=Array.isArray(text)?text:[context||text];
  activeSpeechButton=button;
  try {
    for(const phrase of texts){
      const url=getSpeechAudioURL(phrase);
      speechState(button,'loading');
      const line=poem?.lines?.[currentLine];
      const markup=line?.text?.includes(phrase)?lineMarkup(line,phrase):null;
      const finished=await playDemonstration(url,phrase,markup,()=>version===speechVersion&&route===routeVersion,status=>speechState(button,status));
      if(version!==speechVersion||route!==routeVersion)return;
      if(!finished)throw new Error('playback');
    }
  } catch {if(version===speechVersion&&route===routeVersion)toast('語音暫時無法播放，請再按一次重試。');}
  finally {if(version===speechVersion&&route===routeVersion)stopTransient();}
}
function renderRecord() {
  const s=state(poem),line=poem.lines[currentLine],result=s.reading[currentLine];
  const weak=recordWeakWords();
  if((!result&&recordStep!=='extension')||(recordStep==='extension'&&poem.id!==2))recordStep='read';
  if(recordStep==='result'&&weak.length)recordStep='words';
  if(recordStep==='words'&&!weak.length)recordStep='result';
  const latest=s.reading.slice(0,currentLine).reduce((a,r,i)=>r?i:a,-1),displayed=result?currentLine:latest;
  const sceneNumber=displayed>=0?poem.lines[displayed].scene:0;
  void preloadScene(poem.slug,line.scene);
  if(!$('#record-art')){
    $('#view').innerHTML='<div class="record-layout"><div class="record-landscape"><div class="record-art" id="record-art"></div><div class="record-line-nav"><button class="icon-button" data-action="record-step" data-value="-1" aria-label="上一句">'+icon('chevron-left')+'</button><p class="record-unfold-note" id="record-unfold-note"></p><button class="icon-button" data-action="record-step" data-value="1" aria-label="下一句">'+icon('chevron-right')+'</button></div><div class="record-progress" aria-hidden="true"></div></div><div class="record-practice"><div class="record-tool" id="record-tool"></div></div><div class="record-bottom" id="record-bottom"></div></div>';
    sceneStage=mountStage($('#record-art'),{poemSlug:poem.slug,scene:sceneNumber,alt:sceneNumber?sceneText(sceneNumber):'等待展開的古詩畫卷'});
    poemSwipe=mountPoemSwipe($('#record-art'),{onStep:stepRecordLine,isLocked:()=>recordBusy});
  }else sceneStage?.show(sceneNumber,sceneNumber?sceneText(sceneNumber):'等待展開的古詩畫卷');
  if($('#record-unfold-note'))$('#record-unfold-note').textContent=sceneNumber?'左右滑動，選擇詩句':'讀完這一句，畫卷就會展開';
  $('.record-progress').innerHTML=poem.lines.map((_,i)=>'<i class="'+(s.reading[i]?'done ':'')+(i===currentLine?'current':'')+'"></i>').join('');
  const next='<button class="button primary" data-action="record-next">'+(currentLine===poem.lines.length-1?'看看成果':'下一句')+icon('arrow-right')+'</button>';
  let content;
  if(recordStep==='read'){
    content=verseHTML(line,'active')+'<div class="record-model"><button class="button" data-action="line-tts">'+icon('volume-2')+'聽示範</button><button class="button pinyin-command" data-action="pinyin" aria-pressed="'+showPinyin+'">'+icon('languages')+'<span>'+(showPinyin?'隱藏拼音':'顯示拼音')+'</span></button></div><div id="record-controls">'+recordControlsHTML()+'</div>';
  }else if(recordStep==='extension'){
    content='<div class="record-extension"><div class="record-review"><button class="focus-word" data-action="word-tts" data-value="快" data-pinyin="kuài" aria-label="聽快，kuài 的讀音" aria-pressed="false"><ruby>快<rt>kuài</rt></ruby>'+icon('volume-2')+'</button></div><p class="extension-final">韻母 <strong>uai</strong></p><p class="record-word-hint">點字聽音，跟着讀一讀。</p><div class="record-actions"><button class="button primary" data-action="record-extension-back">'+icon('arrow-left')+'返回讀詩</button></div></div>';
  }else if(recordStep==='result'){
    content='<div class="record-feedback"><img class="feedback-motif" src="'+poemMotif()+'" width="64" height="64" alt=""><div class="record-result" aria-label="這次朗讀'+result.total_score+'分">'+result.total_score+'<small>分</small></div><h2 tabindex="-1" class="record-feedback-title">'+esc(result.grade)+'</h2><div class="record-actions"><button class="button" data-action="record-retry">'+icon('rotate-ccw')+'再讀一次</button>'+next+'</div></div>';
  }else{
    recordWordIndex=clamp(recordWordIndex,0,weak.length-1);const word=weak[recordWordIndex];
    content='<div class="record-word-heading"><span>這句 '+result.total_score+' 分</span><span>第 '+(recordWordIndex+1)+' / '+weak.length+' 個字</span></div><div class="record-review"><button class="focus-word" data-action="word-tts" data-value="'+esc(word.c)+'" data-pinyin="'+esc(word.p)+'" aria-label="聽'+esc(word.c)+'的讀音"><ruby>'+esc(word.c)+'<rt>'+esc(word.p)+'</rt></ruby>'+icon('volume-2')+'</button></div><p class="record-word-hint">再練這個字，點字聽讀音。</p><div class="record-word-pager"><button class="icon-button" data-action="record-word-step" data-value="-1" aria-label="上一個字" '+(recordWordIndex===0?'disabled':'')+'>'+icon('chevron-left')+'</button><button class="icon-button" data-action="record-word-step" data-value="1" aria-label="下一個字" '+(recordWordIndex===weak.length-1?'disabled':'')+'>'+icon('chevron-right')+'</button></div><div class="record-actions">'+next+'</div>';
  }
  $('#record-tool').dataset.step=recordStep;
  const extensionEntry=poem.id===2&&recordStep!=='extension'?'<button class="text-button extension-entry" data-action="record-extension" '+(recordBusy?'disabled':'')+'>拓展字：快</button>':'';
  $('#record-tool').innerHTML='<div class="record-counter"><span>'+(recordStep==='extension'?'拓展字 · 不計分':'第 '+(currentLine+1)+' / '+poem.lines.length+' 句')+'</span>'+(result&&recordStep==='read'?'<button class="text-button" data-action="record-feedback" '+(recordBusy?'disabled':'')+'>'+icon('check')+'看看這句成果</button>':recordStep==='read'&&!extensionEntry?'<img class="practice-motif" src="'+poemMotif()+'" width="40" height="40" alt="">':'')+extensionEntry+'</div>'+content;
  $('#record-bottom').innerHTML=recordStep==='extension'||recordStep==='read'?'':recordings.has(poem.id+'-'+currentLine)?'<button class="text-button" data-action="replay" data-value="'+currentLine+'">'+icon('headphones')+'我的錄音</button>':'';
  document.querySelectorAll('[data-action="record-step"]').forEach(b=>b.disabled=recordBusy||(Number(b.dataset.value)<0?currentLine===0:currentLine===poem.lines.length-1));
  setRecordingBusy();
  icons();
}
function recordWeakWords(){return state(poem).reading[currentLine]?.words.filter(w=>Number.isFinite(w.score)&&w.score<80)||[];}
function setRecordingBusy(){
  const layout=$('.record-layout');if(layout)layout.dataset.recordBusy=String(recordBusy);
  document.querySelectorAll('.record-bottom button,[data-action="line-tts"],[data-action="pinyin"],[data-action="record-extension"]').forEach(button=>button.disabled=recordBusy);
  shishi?.update({disabled:recordBusy});
}
function setRecordStep(step,focus=true){
  stopMedia();recordStep=step;renderRecord();
  if(focus){const target=$('#record-tool .focus-word, #record-tool .record-feedback-title, #record-tool [data-action="record-start"]');target?.focus({preventScroll:true});}
}
function stepRecordLine(step){
  if(recordBusy)return;const next=clamp(currentLine+step,0,poem.lines.length-1);if(next===currentLine)return;
  currentLine=next;recordWordIndex=0;setRecordStep('read',false);shishi?.pause(false);
}
function recordControlsHTML(){
  const pending=pendingRecordings.get(`${poem.id}-${currentLine}`);
  if(pending&&!recordBusy){
    return '<div class="record-recovery"><p class="record-status" id="record-status" role="status">'+esc(pending.message||'錄音已保留，可以再送一次。')+'</p><div class="record-actions">'+(pending.canRetry?'<button class="button primary" data-action="record-send">'+icon('send')+'再送一次</button>':'')+'<button class="button" data-action="record-start">'+icon('mic')+'重新朗讀</button></div><button class="text-button" data-action="record-pending-play">'+icon('headphones')+'聽我的錄音</button></div>';
  }
  return '<div class="record-actions"><button class="mic-button" data-action="record-start" aria-label="開始朗讀">'+icon('mic')+'<span>開始朗讀</span></button></div><p class="record-status" id="record-status" role="status"></p>';
}
function assessmentStatus(message){const controls=$('#record-controls');if(controls)controls.innerHTML='<p class="record-status" role="status"><span class="spinner"></span> '+esc(message)+'</p>';}
async function startRecording() {
  if(recordBusy)return;stopMedia();cancelRecording();recordBusy=true;
  recordStep='read';renderRecord();
  const version=routeVersion,generation=recordingVersion,p=poem,index=currentLine;
  const isCurrent=()=>version===routeVersion&&generation===recordingVersion;
  const controls=$('#record-controls');controls.innerHTML='<p class="record-status"><span class="spinner"></span> 正在開啟麥克風</p>';
  try {
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Object.assign(new Error('此瀏覽器未能使用錄音，請使用新版 Safari、Chrome 或 Edge。'),{code:'AUDIO_UNSUPPORTED'});
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw Object.assign(new Error('此瀏覽器未能使用錄音，請使用新版 Safari、Chrome 或 Edge。'),{code:'AUDIO_UNSUPPORTED'});
    const context=new Audio();recordContext=context;
    // Start audio activation during the tap itself, before the permission prompt on Safari.
    context.resume().catch(()=>{});
    const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    if(!isCurrent()){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;
    if(!isCurrent()){acquired.getTracks().forEach(t=>t.stop());if(context.state!=='closed')context.close().catch(()=>{});return;}
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    const localRecorder=new MediaRecorder(acquired,mime?{mimeType:mime}:{});recorder=localRecorder;const chunks=[];
    localRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    localRecorder.onerror=event=>{if(!isCurrent())return;cancelRecording();renderRecord();toast(recordingErrorMessage(event.error));};
    localRecorder.onstop=()=>{acquired.getTracks().forEach(t=>t.stop());if(isCurrent()){stream=null;clearInterval(recordTimer);assessRecording(new Blob(chunks,{type:localRecorder.mimeType}),p,index,version,generation,context);}};
    localRecorder.start();pendingRecordings.delete(`${p.id}-${index}`);recordStarted=Date.now();
    controls.innerHTML=`<div class="record-wave live">${'<span></span>'.repeat(19)}</div><div class="record-actions"><button class="mic-button recording" data-action="record-stop" aria-label="完成錄音" title="完成錄音">${icon('square')}<span>讀好了</span></button></div><p class="record-status" id="record-status">錄音中 · 0:00</p>`;icons();
    recordTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-recordStarted)/1000);const status=$('#record-status');if(status)status.textContent=`錄音中 · 0:${String(seconds).padStart(2,'0')}`;if(seconds>=30)stopRecording();},250);
  } catch(error) {if(!isCurrent())return;cancelRecording();renderRecord();toast(recordingErrorMessage(error));}
}
function stopRecording(){if(recorder?.state==='recording'){recorder.stop();$('#record-controls').innerHTML='<p class="record-status"><span class="spinner"></span> 正在聆聽你的朗讀</p>';}}
async function assessRecording(blob,p,index,version,generation,context,existing=null) {
  const isCurrent=()=>version===routeVersion&&generation===recordingVersion;
  const key=`${p.id}-${index}`,pending=existing||{blob,encoded:null,canRetry:true,message:'錄音已保留，可以再送一次。'};
  const controller=new AbortController();requests.add(controller);
  try {
    if(blob.size>=100)pendingRecordings.set(key,pending);
    if(!pending.encoded)pending.encoded=await encodeRecording(blob,context);
    if(!isCurrent())return;
    if(context?.state!=='closed')context?.close().catch(()=>{});if(recordContext===context)recordContext=null;
    const raw=await submitAssessment({audio:pending.encoded,refText:p.lines[index].simplified},{signal:controller.signal,onRetry:()=>{if(isCurrent())assessmentStatus('正在重新連線，錄音已保留');},onWaiting:()=>{if(isCurrent())assessmentStatus('正在等候評測，錄音已保留');}});
    if(!isCurrent())return;
    const result=mapAssessment(raw,p.lines[index]);result.words=result.words.map(w=>({...w,lineIndex:index}));const s=state(p);recordings.set(`${p.id}-${index}`,blob);s.reading[index]=result;s.report='';s.updatedAt=Date.now();
    pendingRecordings.delete(key);
    recordStep='result';recordWordIndex=0;
    queueReading(p,{lineIdx:index,lineScore:result.total_score});
  } catch(error) {
    pending.canRetry=Boolean(error.canRetry||pending.encoded);pending.message=recordingErrorMessage(error);
    if(isCurrent()){recordStep='read';if(!pendingRecordings.has(key))toast(pending.message);}
  }
  finally {requests.delete(controller);if(isCurrent()){cancelRecording();setRecordStep(recordStep);}}
}
function retryRecording(){
  const pending=pendingRecordings.get(`${poem.id}-${currentLine}`);if(recordBusy||!pending?.canRetry)return;
  stopMedia();cancelRecording();recordBusy=true;recordStep='read';renderRecord();assessmentStatus('正在再送錄音');
  assessRecording(pending.blob,poem,currentLine,routeVersion,recordingVersion,null,pending);
}
async function replayPendingRecording(button){
  const pending=pendingRecordings.get(`${poem.id}-${currentLine}`);if(recordBusy||!pending)return;
  if(activeSpeechButton===button){stopMedia();return;}
  stopMedia();const version=speechVersion,route=routeVersion;activeSpeechButton=button;speechState(button,'playing');
  const finished=await playBlob(pending.blob);
  if(version!==speechVersion||route!==routeVersion)return;
  if(!finished)toast('錄音暫時無法播放，可以重新朗讀。');stopTransient();
}
async function replay(index,button=null) {
  if(button&&activeSpeechButton===button){stopMedia();return;}
  const blobs=(index===null?poem.lines.map((_,i)=>recordings.get(poem.id+'-'+i)):[recordings.get(poem.id+'-'+index)]).filter(Boolean);
  if(!blobs.length){toast('這段錄音只保留在本次開啟的頁面。');return;}
  stopMedia();const version=speechVersion,route=routeVersion;activeSpeechButton=button;speechState(button,'playing');
  try{for(const blob of blobs){const finished=await playBlob(blob);if(version!==speechVersion||route!==routeVersion)return;if(!finished)throw new Error('playback');}}
  catch{if(version===speechVersion&&route===routeVersion)toast('錄音暫時無法播放。');}
  finally{if(version===speechVersion&&route===routeVersion)stopTransient();}
}
function poemAssessment(p=poem) {
  return mergeAssessments(state(p).reading.map((result,lineIndex)=>result?{...result,words:result.words.map(w=>({...w,lineIndex}))}:null));
}
function soundButton(sample,target=false) {
  const {char,pinyin}=focusSound(sample);
  return '<button class="sound-word" data-action="word-tts" data-value="'+esc(char)+'" data-pinyin="'+esc(pinyin)+'" aria-label="聽'+esc(char)+'，'+esc(pinyin)+'的讀音" aria-pressed="false"><ruby>'+esc(char)+'<rt>'+esc(pinyin)+'</rt></ruby><small class="sound-context">'+esc(sample.text)+'</small>'+icon('volume-2')+'</button>';
}
function pronunciationHTML(result) {
  const practice=getPronunciationPractice(result,poem);
  if(!practice.items.length)return '<section class="practice-section"><div class="section-heading"><h2>'+icon('badge-check')+'字音小練習</h2></div><p class="practice-intro">'+((practice.unknownWords.length||!practice.assessedCount)?'有些字未取得分數，可以回到原句再讀一次。':'已評測的字都達到80分了，繼續保持！')+'</p></section>';
  practiceIndex=Math.min(practiceIndex,practice.items.length-1);
  return '<section class="practice-section" id="practice-section"><div id="focused-practice"></div></section>';
}
function renderFocusedPractice() {
  const item=getPronunciationPractice(poemAssessment(),poem).items[practiceIndex];if(!item||!$('#focused-practice'))return;
  const index=item.lineIndex,canReplay=Number.isInteger(index)&&recordings.has(poem.id+'-'+index);
  const count=getPronunciationPractice(poemAssessment(),poem).items.length;
  const content=practiceMode==='compare'?'<button class="text-button practice-back" data-action="practice-back">'+icon('chevron-left')+'返回字音</button><h3 class="comparison-title">相似字，聽聽看</h3><div class="contrast-pair">'+item.contrasts.slice(0,3).map(s=>soundButton(s)).join('')+'</div><div class="practice-actions"><button class="button" data-action="practice-sequence" data-value="'+practiceIndex+'" aria-pressed="false">'+icon('audio-lines')+'連續聽字音</button></div>':'<div class="practice-selector"><button class="practice-pick focus-word selected" data-action="practice-word" data-value="'+practiceIndex+'" aria-pressed="true" aria-label="聽'+esc(item.char)+'的讀音"><ruby>'+esc(item.char)+'<rt>'+esc(item.pinyin)+'</rt></ruby>'+icon('volume-2')+'</button></div><p class="practice-tip">'+esc(item.tip)+'</p><div class="practice-actions">'+(item.contrasts.length?'<button class="button" data-action="practice-compare">'+icon('ear')+'聽相似字</button>':'')+'</div>';
  $('#focused-practice').innerHTML='<div class="practice-card" data-mode="'+practiceMode+'"><div class="practice-card-heading"><h3>字音小練習</h3><div class="practice-pager"><button class="icon-button" data-action="practice-step" data-value="-1" aria-label="上一個字" '+(practiceIndex===0?'disabled':'')+'>'+icon('chevron-left')+'</button><span>'+(practiceIndex+1)+' / '+count+'</span><button class="icon-button" data-action="practice-step" data-value="1" aria-label="下一個字" '+(practiceIndex===count-1?'disabled':'')+'>'+icon('chevron-right')+'</button></div></div>'+content+'</div>';
  icons();
}
function quickAdvice(result){
  const practice=getPronunciationPractice(result,poem),item=practice.items[0],grade=studentGrade();
  if(item){
    const word='「'+item.char+'」（'+item.pinyin+'）',second=practice.items[1];
    return [
      '先練「'+item.char+'」吧。點「練字音」，聽一聽，再跟着讀兩次。一次練好一個字就很棒！',
      '這次先練'+word+'。'+item.tip+' 點「練字音」，聽一次，再跟讀兩次。',
      '先把'+word+'讀清楚。'+item.tip+' 在「練字音」聽示範、跟讀，再放回詩句讀一遍。',
      '這次先留意'+word+'。'+item.tip+' 先聽示範，再自然地跟讀；如果有「聽相似字」，可以比較它們的不同。最後回到詩句試一次。',
      '先練'+word+'。'+item.tip+' 聽示範後試着自己讀，留意聲調是否一致。'+(second?'這個字熟悉後，再練「'+second.char+'」。':'這個字熟悉後，再放回原句練習。')+' 每次專注一個小目標。',
      '優先調整'+word+'。'+item.tip+' 聽示範後自行朗讀，比較聲母、韻母和聲調；再回到原句，保持詞語連貫。'+(second?'接着可練「'+second.char+'」，逐一鞏固。':'字音穩定後，再練詩句的停頓。')
    ][grade-1];
  }
  if(practice.unknownWords.length||!practice.assessedCount)return grade<=2?'有些字還沒聽清楚。找個安靜的地方，對着麥克風再讀一次吧。':grade<=4?'有些字還沒有清楚的評測結果。請靠近麥克風一點，用自然的速度再讀一次。':'部分字音尚無可靠的評測結果，暫不判斷對錯。請在安靜的環境重讀，保持自然語速，字與字之間不用刻意停頓。';
  return [
    '已評測的字都讀得不錯！再聽一次示範，跟着讀一句吧。',
    '已評測的字音都達到八十分了！聽聽示範怎樣停一停，再讀一句。',
    '已評測的字音都達到八十分了。接着聽示範，練習在逗號稍停、句號停穩。',
    '已評測的字音都達到八十分了。下一步練句子的停頓：先聽示範，再自然地讀，讓詞語連在一起。',
    '已評測的字音都達到八十分了。可以把重點放在節奏：聽示範如何分組，讀時保持詞語連貫，在標點處適當停頓。',
    '已評測的字音都達到八十分了。接着練完整表達：參考示範的節奏，根據句意安排停頓和輕重，用自然的語速再讀一遍。'
  ][grade-1];
}
function renderReport() {
  const s=state(poem),result=poemAssessment();
  if(!result){$('#view').innerHTML='<div class="report-empty"><img class="empty-motif" src="'+poemMotif()+'" width="90" height="90" alt=""><h2>先讀一句，再看看建議</h2><a class="button primary" href="'+link('record')+'">'+icon('mic')+'開始朗讀</a></div>';return;}
  const keys=[['phone_score','發音準確度'],['fluency_score','流暢度'],['integrity_score','完整度']],grade=studentGrade(),report=currentReport();
  $('#view').innerHTML='<div class="report-summary"><div class="score-ring" style="--score:'+result.total_score+'"><div><strong>'+result.total_score+'</strong><span>朗讀得分</span></div></div><div><p class="eyebrow">'+s.reading.filter(Boolean).length+' / '+poem.lines.length+' 句已完成</p><div class="dimension-grid">'+keys.map(([k,label])=>'<div class="dimension"><strong>'+(result.dimensions[k]??'—')+'</strong><span>'+label+'</span></div>').join('')+'</div></div></div>'+
    '<div class="report-tabs" role="tablist" aria-label="朗讀成果">'+[['advice','小建議'],['practice','練字音'],['scores','逐句成績']].map(([id,label])=>'<button id="tab-'+id+'" role="tab" aria-controls="panel-'+id+'" data-action="report-tab" data-value="'+id+'">'+label+'</button>').join('')+'</div><div class="report-panels"><div id="panel-practice" role="tabpanel" aria-labelledby="tab-practice">'+pronunciationHTML(result)+'</div>'+
    '<section id="panel-advice" class="ai-advice" data-student-grade="'+grade+'" role="tabpanel" aria-labelledby="tab-advice"><div class="ai-report-header"><div><h2>老師的小建議</h2><label class="report-grade-label">我的年級 <select id="report-grade" aria-label="我的年級">'+['一','二','三','四','五','六'].map((label,i)=>'<option value="'+(i+1)+'" '+(grade===i+1?'selected':'')+'>'+label+'年級</option>').join('')+'</select></label></div><button class="button" data-action="report-generate" id="report-button">'+icon('sparkles')+(report?'重新生成':'生成建議')+'</button></div><div id="advice-details"><div id="report-prose" class="report-prose">'+esc(report||quickAdvice(result))+'</div></div><p class="advice-placeholder" hidden>'+(s.report?'年級建議已更新，按「生成建議」看看吧。':'老師會按你的年級，說說下一次可以怎樣練。')+'</p></section>'+
    '<section id="panel-scores" class="word-analysis" role="tabpanel" aria-labelledby="tab-scores"><div class="section-heading"><span>點字聽讀音</span><button class="button small" data-action="replay-all" '+(poem.lines.some((_,i)=>recordings.has(poem.id+'-'+i))?'':'disabled')+'>'+icon('headphones')+'全部回聽</button></div><div class="score-line-tabs" aria-label="選擇詩句">'+s.reading.map((r,i)=>r?'<button class="icon-button" data-action="score-line" data-value="'+i+'" aria-label="第'+(i+1)+'句">'+(i+1)+'</button>':'').join('')+'</div>'+
    s.reading.map((lineResult,i)=>{
      if(!lineResult)return '';
      return '<div class="report-line" data-line="'+i+'"><div class="report-line-heading"><h3>第'+(i+1)+'句</h3><span>'+esc(poem.lines[i].text)+'</span><button class="icon-button" data-action="replay" data-value="'+i+'" aria-label="回聽第'+(i+1)+'句錄音" title="回聽第'+(i+1)+'句錄音" '+(recordings.has(poem.id+'-'+i)?'':'disabled')+'>'+icon('headphones')+'</button></div><div class="word-grid">'+lineResult.words.map(w=>'<button class="word-result '+w.status+'" data-action="word-tts" data-value="'+esc(w.c)+'" data-pinyin="'+esc(w.p)+'" title="聽'+esc(w.c)+'的讀音"><ruby>'+esc(w.c)+'<rt>'+esc(w.p)+'</rt></ruby><strong>'+(w.score??'未測')+'</strong>'+icon('volume-2')+'</button>').join('')+'</div><a class="button small" href="'+link('record')+'" data-action="record-target" data-value="'+i+'">'+icon('mic')+'再讀這一句</a></div>';
    }).join('')+'</section></div><nav class="report-next-activities" aria-label="繼續學習">'+[['record','mic','AI讀古詩'],['quiz','flag','練習小遊戲'],['chat','messages-square','和詩人聊天']].map(([id,symbol,label])=>'<a href="'+link(id)+'">'+icon(symbol)+'<span>'+label+'</span></a>').join('')+'</nav>';
  if(!s.reading[reportLine])reportLine=s.reading.findIndex(Boolean);
  updateReportTab();updateScoreLine();renderFocusedPractice();icons();
  if(!report&&s.reading.every(Boolean))queueMicrotask(()=>{if(view==='report'&&$('#report-button')&&!$('#report-button').disabled)generateReport();});
}
function updateReportTab(){
  document.querySelectorAll('[data-action="report-tab"]').forEach(button=>{const active=button.dataset.value===reportTab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('#panel-'+button.dataset.value).hidden=!active;});
  $('.report-summary').hidden=reportTab!=='scores';
  if($('#practice-options'))$('#practice-options').hidden=reportTab!=='practice';
}
function updateScoreLine(){
  document.querySelectorAll('.report-line').forEach(line=>line.hidden=Number(line.dataset.line)!==reportLine);
  document.querySelectorAll('[data-action="score-line"]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.value)===reportLine)));
}
async function generateReport() {
  const button=$('#report-button');if(button.disabled)return;button.disabled=true;const version=routeVersion,p=poem,generation=++reportGeneration,grade=studentGrade(p);const result=poemAssessment(p);
  $('#advice-details').hidden=false;$('#advice-details').open=true;
  $('.advice-placeholder').hidden=true;
  $('#report-prose').textContent=currentReport(p)||quickAdvice(result);button.setAttribute('aria-busy','true');button.innerHTML=icon('sparkles')+'整理中…';icons();
  try{
    const data=await api('/api/maanshan-report',{poemId:p.id,studentGrade:grade,soeResult:{...result,linesCompleted:state(p).reading.filter(Boolean).length}});
    if(version!==routeVersion||generation!==reportGeneration)return;
    if(!data.report||data.studentGrade!==grade||data.reportVersion!==REPORT_VERSION)throw new Error('建議尚未生成，請稍後再試。');
    Object.assign(state(p),{report:data.report,reportStudentGrade:grade,reportVersion:REPORT_VERSION});
    queueSection('report',{content:data.report,totalScore:result.total_score,grade:result.grade,studentGrade:grade,reportVersion:REPORT_VERSION},p);$('#report-prose').textContent=data.report;
  }
  catch(error){if(version===routeVersion&&generation===reportGeneration){$('#report-prose').textContent=quickAdvice(result);toast('先照這個方法練一練，稍後可以再試老師建議。');}}
  finally{if(version===routeVersion&&generation===reportGeneration){button.disabled=false;button.removeAttribute('aria-busy');button.innerHTML=icon('sparkles')+'更新建議';icons();}}
}
async function playChallengeAudio(target) {
  stopMedia();
  const version=speechVersion,route=routeVersion;
  const text=target.text||target.char;
  const markup=challengeMarkup(target);
  const url=target.text?getSpeechAudioURL(text):getWordAudioURL(target.char,target.pinyin);
  let played=false;try{played=await playDemonstration(url,text,markup,()=>version===speechVersion&&route===routeVersion);}catch{}
  if(version!==speechVersion||route!==routeVersion)return false;
  stopTransient();return played;
}
async function loadActivity(name,load) {
  const holder=$('#view'),version=routeVersion,generation=++activityLoad;
  let timer;
  holder.innerHTML=`<div class="loading-page" role="status"><span class="spinner"></span><p>正在準備${name}…</p></div>`;
  try {
    const module=await Promise.race([load(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Load timeout')),15000);})]);
    return version===routeVersion&&generation===activityLoad&&holder.isConnected?module:null;
  } catch {
    if(version===routeVersion&&generation===activityLoad&&holder.isConnected)holder.innerHTML='<div class="loading-page"><p>剛才未能載入，請再試一次。</p><button class="button primary" data-action="activity-retry">再試一次</button></div>';
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function renderQuiz() {
  challenge?.destroy();challenge=null;stopMedia();
  const module=await loadActivity('小挑戰',()=>import('./challenge.mjs?v=20260919e'));
  if(!module)return;
  const p=poem;
  challenge=module.mountChallenge($('#view'),{poem:p,saved:state(p).challenge,
    onChange:attempt=>{state(p).challenge=attempt;persist();},
    onComplete:()=>queueReading(p),
    playAudio:playChallengeAudio,stopAudio:stopMedia,
    recognize:ink=>api('/api/handwriting',{ink},12000)});
}
async function renderExploration(){
  const module=await loadActivity('畫中小發現',()=>import('./exploration.mjs?v=20260919b'));
  if(!module)return;
  const holder=$('#view');
  if(!holder||!poem)return;
  holder.innerHTML='';
  exploration=module.mountExploration(holder,{
    poem,
    speakWord:(char,pinyin,button)=>speakWord(char,pinyin,button),
    onComplete:result=>{
      const s=state(poem);
      s.exploration={...(s.exploration||{}),completed:true,completedAt:result.completedAt,version:result.version};
      persist();
    }
  });
}
function chatSuggestions(p=poem) {
  if(Math.min(studentGrade(p),p.grade)<=3){
    return ({1:['白鵝是甚麼顏色？','鵝怎樣叫？','陪我讀「鵝鵝鵝」吧。'],2:['汪倫是誰？','你坐甚麼離開？','朋友來送你，你開心嗎？'],3:['廬山高不高？','你在山裏看到甚麼？','山從兩邊看一樣嗎？']})[p.grade]||['你看到甚麼？','這首詩說甚麼？','陪我讀一句吧。'];
  }
  return [p.suggestions[0], '聊聊別的詩吧', '一起寫一首新詩吧'];
}
function chatGreeting(p=poem){
  if(Math.min(studentGrade(p),p.grade)<=3)return `你好，我是${p.author}。`+(({1:'你見過白鵝嗎？',2:'你喜歡和朋友一起玩嗎？',3:'你喜歡看山嗎？'})[p.grade]||'我們一起讀一句詩，好嗎？');
  return `你好，我是${p.author}。想聊《${titleOf(p)}》、別的詩，還是今天的趣事？也可以一起寫一首新詩！`;
}
function renderChat() {
  const messages=state(poem).chat;
  $('#view').innerHTML=`<div class="chat-layout"><aside class="poet-profile"><img src="${asset('avatar.webp')}" width="480" height="600" alt="${esc(poem.author)}"><h2>${esc(poem.author)}</h2><p>${esc(poem.authorBio)}</p></aside><div class="chat-tool"><div class="chat-messages" id="chat-messages" role="log" aria-live="polite"><div class="chat-message"><img src="${asset('avatar.webp')}" width="32" height="32" alt="${esc(poem.author)}"><div class="chat-bubble">${esc(chatGreeting())}</div></div>${messages.map((m,i)=>chatMessage(m,i)).join('')}</div><div class="chat-suggestions">${chatSuggestions().map((q,i)=>`<button data-action="chat-suggestion" data-value="${i}">${esc(q)}</button>`).join('')}</div><form class="chat-form" id="chat-form"><textarea id="chat-input" aria-label="想和詩人聊的話" placeholder="我想聊……" rows="2" maxlength="1000" required></textarea><button type="submit" class="icon-button" id="chat-send" aria-label="傳送問題" title="傳送問題">${icon('send')}</button></form><div id="chat-error" class="chat-error" role="status"></div></div></div>`;
  $('#chat-form').addEventListener('submit',event=>{event.preventDefault();sendChat($('#chat-input').value.trim());});
  $('#chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#chat-form').requestSubmit();}});icons();
  const holder=$('#chat-messages');holder.scrollTop=holder.scrollHeight;
  if(messages.at(-1)?.role==='user'&&!chatBusy)showChatRetry('上一句還未收到回覆，可以再送一次。');
}
function chatMessage(message,index) {return `<div class="chat-message ${message.role==='user'?'user':''}">${message.role==='assistant'?`<img src="${asset('avatar.webp')}" width="32" height="32" alt="${esc(poem.author)}">`:''}<div class="chat-bubble">${esc(message.content)}${message.role==='assistant'?`<button class="icon-button" data-action="chat-speak" data-value="${index}" aria-label="朗讀回答" title="朗讀回答">${icon('volume-2')}</button>`:''}</div></div>`;}
function showChatRetry(message) {
  const holder=$('#chat-error');if(!holder)return;
  holder.innerHTML=`<span>${esc(message)}</span><button type="button" class="button chat-retry" data-action="chat-retry">再送一次</button>`;
}
async function sendChat(text,retry=false) {
  if(chatBusy)return;
  const p=poem,version=routeVersion,s=state(p);
  if(retry){if(s.chat.at(-1)?.role!=='user')return;}
  else {if(!text?.trim())return;s.chat.push({role:'user',content:text.trim().slice(0,1000)});s.chat=s.chat.slice(-30);persist();}
  stopMedia();chatBusy=true;renderChat();$('#chat-send').disabled=true;
  $('#chat-error').innerHTML='<span class="spinner"></span><span>正在想一想…</span>';
  const waiting=setTimeout(()=>{if(version===routeVersion&&chatBusy)$('#chat-error').innerHTML='<span class="spinner"></span><span>還在等回覆，你的問題已保留。</span>';},8000);
  try {
    const data=await api('/api/maanshan-chat/',{poemId:p.id,grade:Math.min(studentGrade(p),p.grade),messages:s.chat.slice(-10)},25000,true);
    if(version!==routeVersion)return;
    if(typeof data.reply!=='string'||!data.reply.trim())throw new Error('暫時未能回答，可以再送一次。');
    s.chat.push({role:'assistant',content:data.reply});persist();renderChat();
  } catch(error) {
    if(version===routeVersion)showChatRetry(error.message);
  } finally {
    clearTimeout(waiting);
    if(version===routeVersion){chatBusy=false;$('#chat-send').disabled=false;}
  }
}
function route() {
  shishi?.pause(false);poemSwipe?.destroy();poemSwipe=null;challenge?.destroy();challenge=null;lessonMap?.destroy();lessonMap=null;
  reportGeneration++;
  sceneStage?.destroy();sceneStage=null;
  exploration?.destroy();exploration=null;
  routeVersion++;stopMedia();cancelRecording();requests.forEach(c=>c.abort());requests.clear();chatBusy=false;
  disposeAnimation?.();disposeAnimation=null;
  clearTimeout(toastTimer);$('#toast').classList.remove('visible');
  if($('#video-dialog').open)$('#video-dialog').close();
  let parts;try{parts=decodeURIComponent(location.hash.slice(1)).split('/');}catch{parts=[];}
  const next=poems.find(p=>p.slug===parts[0]);
  if(!next){shishi?.destroy();shishi=null;document.body.dataset.screen='library';renderLibrary();window.scrollTo({top:0});return;}
  if(parts[1]==='write'){parts[1]='quiz';history.replaceState(null,'','#'+next.slug+'/quiz');}
  if(parts[1]==='read'){parts[1]='record';history.replaceState(null,'','#'+next.slug+'/record');}
  if(parts[1]==='explore'&&next.grade<=3){parts[1]='lesson';history.replaceState(null,'','#'+next.slug+'/lesson');}
  const changed=poem?.id!==next.id;poem=next;view=NAV.some(n=>n[0]===parts[1])?parts[1]:'lesson';
  document.body.dataset.screen=view;
  if(changed){practiceIndex=0;reportTab='advice';reportLine=0;currentLine=Math.max(0,state(poem).reading.findIndex(r=>!r));}
  recordStep='read';recordWordIndex=0;practiceMode='sound';
  if(view==='report')reportTab='advice';
  if(view==='quiz')$('#video-title').textContent='示範朗讀';
  renderWorkspace();window.scrollTo({top:0});
}
document.addEventListener('click',event=>{
  const menu=$('.lesson-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;
  if(event.target.closest('.menu-panel a')){if(menu)menu.open=false;}
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action,value=button.dataset.value;
  if(button.closest('.menu-panel')&&menu)menu.open=false;
  if(action==='profile'){if(menu)menu.open=false;openProfile();return;}
  if(!poem)return;
  if(action==='activity-retry')location.reload();
  if(action==='pinyin'){showPinyin=!showPinyin;$('#view').classList.toggle('hide-pinyin',!showPinyin);button.setAttribute('aria-pressed',showPinyin);button.setAttribute('aria-label',showPinyin?'隱藏拼音':'顯示拼音');button.title=showPinyin?'隱藏拼音':'顯示拼音';if(button.classList.contains('pinyin-command'))$('span',button).textContent=button.title;}
  if(action==='video')openVideo();
  if(action==='line-tts'&&!recordBusy)speak(poem.lines[currentLine].text.split('，'),'',button);
  if(action==='word-tts'&&!recordBusy)speakWord(value,button.dataset.pinyin||'',button);
  if(action==='practice-word'){const item=getPronunciationPractice(poemAssessment(),poem).items[practiceIndex];if(item)speakWord(item.char,item.pinyin,button);}
  if(action==='practice-step'){const items=getPronunciationPractice(poemAssessment(),poem).items;stopMedia();practiceIndex=clamp(practiceIndex+Number(value),0,items.length-1);practiceMode='sound';renderFocusedPractice();const selected=$('.practice-pick');selected.focus({preventScroll:true});speakWord(items[practiceIndex].char,items[practiceIndex].pinyin,selected);}
  if(action==='practice-compare'||action==='practice-back'){stopMedia();practiceMode=action==='practice-compare'?'compare':'sound';renderFocusedPractice();$('#focused-practice .sound-word, #focused-practice .practice-pick')?.focus({preventScroll:true});}
  if(action==='sentence-tts')speak(button.dataset.text,'',button);
  if(action==='practice-sequence'){const item=getPronunciationPractice(poemAssessment(),poem).items[Number(value)];if(item)speakWords([{char:item.char,pinyin:item.pinyin},...item.contrasts.slice(0,3).map(focusSound)],button);}
  if(action==='report-tab'){stopMedia();reportTab=value;updateReportTab();}
  if(action==='score-line'){stopMedia();reportLine=Number(value);updateScoreLine();}
  if(action==='record-target'&&Number.isInteger(Number(value))){currentLine=Number(value);recordStep='read';location.hash=link('record');}
  if(action==='record-step')stepRecordLine(Number(value));
  if(action==='record-start')startRecording();
  if(action==='record-send')retryRecording();
  if(action==='record-pending-play')replayPendingRecording(button);
  if(action==='record-stop')stopRecording();
  if(action==='record-feedback'&&!recordBusy)setRecordStep('result');
  if(action==='record-extension'&&view==='record'&&poem.id===2&&!recordBusy)setRecordStep('extension');
  if(action==='record-extension-back'&&view==='record'&&!recordBusy)setRecordStep('read');
  if(action==='record-retry'&&!recordBusy)setRecordStep('read');
  if(action==='record-word-step'&&!recordBusy){recordWordIndex=clamp(recordWordIndex+Number(value),0,recordWeakWords().length-1);setRecordStep('words');}
  if(action==='record-next'&&!recordBusy){stopMedia();if(currentLine<poem.lines.length-1){currentLine++;recordWordIndex=0;setRecordStep('read');}else location.hash=link('report');}
  if(action==='replay')replay(Number(value),button);
  if(action==='replay-all')replay(null,button);
  if(action==='report-generate')generateReport();
  if(action==='chat-suggestion')sendChat(chatSuggestions()[Number(value)]);
  if(action==='chat-retry')sendChat('',true);
  if(action==='chat-speak'){const message=state(poem).chat[Number(value)];if(message)speak(message.content,'',button);}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){const menu=$('.lesson-menu');if(menu?.open){menu.open=false;menu.querySelector('summary').focus();}}
  if(event.target.matches('.report-tabs [role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=[...document.querySelectorAll('.report-tabs [role="tab"]')],index=tabs.indexOf(event.target);const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();}
});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.close==='video-dialog')video.pause();document.getElementById(button.dataset.close).close();}));
$('#video-dialog').addEventListener('close',()=>video.pause());
$('#video-dialog').addEventListener('cancel',()=>video.pause());
video.addEventListener('play',()=>{animationPlayer?.pause();stopTransient();});video.addEventListener('error',()=>{$('#video-error').hidden=false;});
video.addEventListener('ended',()=>{if(poem){state(poem).listened=true;persist();}});
function renderProfileResult(slug){
  const p=poems.find(item=>item.slug===slug)||poem||poems[0];
  if(!p)return;
  const s=state(p),reading=s.reading.filter(Boolean).length,assessment=poemAssessment(p),{current,assessment:practice,pending}=practiceSnapshot(p);
  const reviewing=current.mode==='review';
  $('#profile-results').innerHTML=`<h3>${esc(titleOf(p))}</h3><div class="profile-progress"><div><span>AI讀古詩</span><strong>${reading} / ${p.lines.length}<small>句</small></strong><p>${assessment?'朗讀得分 '+assessment.total_score:'還未開始朗讀'}</p></div><div><span>練習小遊戲</span><strong>${practice.answered} / ${practice.total}<small>題</small></strong><p>${practice.completed?(reviewing?'原輪答對 ':'本輪答對 ')+practice.correct+' 題':practice.answered?'這一輪還未完成':'還未開始練習'}</p></div></div>${reviewing?`<p class="profile-review-note">錯題複習：${current.answered} / ${current.total} 題${pending?'，另有 '+pending+' 題待複習':''}。</p>`:''}<div class="profile-result-links"><a class="button primary" data-profile-route href="${link(reading?'report':'record',p)}">${reading?'看朗讀成果':'開始朗讀'}</a><a class="button" data-profile-route href="${link('quiz',p)}">${reviewing?current.completed?'看複習成果':'繼續錯題複習':practice.completed?'看練習成果':practice.answered?'繼續練習':'開始練習'}</a></div>`;
}
function openProfile(){
  if(recordBusy)return;
  stopMedia();challenge?.pause();
  const form=$('#profile-form');form.elements.name.value=profile?.name||'';form.elements.grade.value=poem?studentGrade():profile?.grade||readStorage(STUDENT_GRADE,2);form.elements.cls.value=profile?.cls||'A';
  const selected=poem||poems.find(p=>p.grade===Number(form.elements.grade.value))||poems[0];
  $('#profile-poem').innerHTML=poems.map(p=>`<option value="${p.slug}"${p===selected?' selected':''}>${['','一','二','三','四','五','六'][p.grade]}年級 · ${esc(titleOf(p))}</option>`).join('');
  renderProfileResult(selected?.slug);$('#profile-details').open=false;$('#profile-dialog').showModal();
}
$('#profile-open').addEventListener('click',openProfile);
$('#profile-poem').addEventListener('change',event=>renderProfileResult(event.target.value));
$('#profile-results').addEventListener('click',event=>{if(event.target.closest('[data-profile-route]'))$('#profile-dialog').close();});
$('#profile-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;const name=form.elements.name.value.trim();if(!name)return;profile={id:profile?.id||`S${crypto.randomUUID().replaceAll('-','').slice(0,30)}`,name,grade:Number(form.elements.grade.value),cls:form.elements.cls.value};writeStorage(PROFILE,profile);writeStorage(STUDENT_GRADE,profile.grade);reportGeneration++;$('#profile-name').textContent=profile.name;$('#profile-dialog').close();if(poem&&view==='report')renderReport();toast('學習檔案已儲存。');});
document.addEventListener('change',event=>{if(event.target.id==='report-grade')changeStudentGrade(Number(event.target.value));});
if(profile?.name)$('#profile-name').textContent=profile.name;
$('.skip-link').addEventListener('click',event=>{event.preventDefault();const main=$('#main');if(main){main.tabIndex=-1;main.focus();}});
window.addEventListener('hashchange',route);window.addEventListener('online',()=>sync.flush());
function updateViewport(){
  const height=window.visualViewport?.height||innerHeight;
  document.documentElement.style.setProperty('--visual-height',height+'px');
  document.body.classList.toggle('keyboard-open',innerHeight-height>150&&document.activeElement?.matches('input,textarea'));
}
window.visualViewport?.addEventListener('resize',updateViewport);
document.addEventListener('focusin',updateViewport);document.addEventListener('focusout',()=>requestAnimationFrame(updateViewport));updateViewport();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){stopMedia();cancelRecording();if(poem&&view==='record')renderRecord();}else sync.flush();});
window.addEventListener('pagehide',()=>{stopMedia();cancelRecording();persist();});
async function init(){
  try{
    const responses=await Promise.all([fetch('poems.json?v=20260919b',{signal:AbortSignal.timeout(15000)}),fetch('pronunciation.json?v=20260919a',{signal:AbortSignal.timeout(15000)})]);
    if(responses.some(response=>!response.ok))throw new Error('catalog');
    const [data,pronunciation]=await Promise.all(responses.map(response=>response.json()));
    poems=data.poems;if(!Array.isArray(poems)||!poems.length)throw new Error('catalog');
    configurePronunciation(pronunciation);route();sync.flush();icons();
  }catch{
    app.innerHTML='<main id="main" class="loading-page"><p>古詩暫時未能載入。</p><button class="button" onclick="location.reload()">重新載入</button></main>';
  }
}
init();
