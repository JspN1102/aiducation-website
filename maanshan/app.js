import {escapeHTML as esc, clamp, mapAssessment, mergeAssessments, migrateReadingState, handwritingMatch, createSyncQueue} from './core.mjs?v=20260909a';
import {mountStage, getScenePreview} from './scene-stage.mjs?v=20260909a';
import {configurePronunciation, getPronunciationPractice} from './pronunciation.mjs?v=20260909a';
import {getWordAudioURL} from './word-audio.mjs';
import {getSpeechAudioURL} from './speech-audio.mjs';
import {createHandwritingPad} from './handwriting-pad.mjs?v=20260908i';

const $ = (selector, root = document) => root.querySelector(selector);
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons();
const audio = $('#narration');
const video = $('#recital-video');
const app = $('#app');
const STORE = 'maanshan-learning-v2';
const PROFILE = 'ms_student_info';
const STUDENT_GRADE = 'ms_student_grade';
const REPORT_VERSION = 'grade-v3';
const PENDING = 'ms_pending_sync';
let memoryStore = {};
function readStorage(key, fallback) { if(Object.hasOwn(memoryStore,key))return memoryStore[key];try { const value=JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
function writeStorage(key, value) { try { localStorage.setItem(key,JSON.stringify(value)); delete memoryStore[key]; return true; } catch { memoryStore[key]=value; toast('此裝置的儲存空間不足，請保留本頁。'); return false; } }
let saved = readStorage(STORE, {});
if (!saved || Array.isArray(saved) || typeof saved !== 'object') saved={};
let profile=readStorage(PROFILE,null);
let poems=[], poem=null, view='record', routeVersion=0, showPinyin=true;
let transientAudio=null, transientUrl=null, speechVersion=0, toastTimer=null;
let scene=1, currentLine=0, recorder=null, stream=null, recordContext=null, recordTimer=null, recordStarted=0, recordBusy=false, recordingVersion=0;
let recordStep='read', recordWordIndex=0;
let writeIndex=0, handwritingPad=null, hinted=false, writeBusy=false, strokeWriter=null;
let strokeHintVersion=0, strokeHintTimer=null, reportGeneration=0;
let quizIndex=0, quizChoice=null, quizAnswers=[];
let chatBusy=false;
let sceneStage=null, activeSpeechButton=null, finishTransient=null;
let practiceIndex=0, reportTab='practice', reportLine=0, practiceMode='sound';
const speechCache=new Map(), speechPending=new Map();
const recordings=new Map(), requests=new Set();
const sync=createSyncQueue({
  read:()=>{const list=readStorage(PENDING,[]);return Array.isArray(list)?list:[];},
  write:value=>writeStorage(PENDING,value),
  send:item=>fetch('/api/maanshan-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item),signal:AbortSignal.timeout(12000)})
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
  if (migrateReadingState(s,p)) writeStorage(STORE,saved);
  return s;
};
const persist=()=>writeStorage(STORE,saved);
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
  s.quiz.forEach((answer,i)=>{const question=p.phonics[i];if(question){(groups[question.label]??=[]).push(answer===question.answer?100:0);}});
  const phonics=Object.fromEntries(Object.entries(groups).map(([label,scores])=>[label,Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)]));
  queueSection('reading',{...extra,...(result?{totalScore:result.total_score}:{}),linesCompleted:s.reading.filter(Boolean).length,words:result?.words||[],phonics,updatedAt:new Date().toISOString()},p);
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
async function speechBlob(text) {
  if(speechCache.has(text))return speechCache.get(text);
  if(speechPending.has(text))return speechPending.get(text);
  const pending=(async()=>{
    const response=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:101015,speed:-.25}),signal:AbortSignal.timeout(12000)});
    if(!response.ok||!response.headers.get('content-type')?.startsWith('audio/'))throw new Error('TTS');
    const blob=await response.blob();if(!blob.size)throw new Error('empty audio');
    if(speechCache.size>=80)speechCache.delete(speechCache.keys().next().value);
    speechCache.set(text,blob);return blob;
  })().finally(()=>speechPending.delete(text));
  speechPending.set(text,pending);return pending;
}
function playBlob(blob) {
  return playSource(URL.createObjectURL(blob),true);
}
function playSource(url,revoke=false) {
  return new Promise(resolve=>{
    const player=new Audio(url);
    transientUrl=revoke?url:null;transientAudio=player;
    const finish=ok=>{
      player.onended=null;player.onerror=null;if(revoke)URL.revokeObjectURL(url);
      if(transientAudio===player){transientAudio=null;transientUrl=null;finishTransient=null;}
      resolve(ok);
    };
    finishTransient=finish;player.onended=()=>finish(true);
    player.onerror=()=>{finish(false);};
    player.play().catch(()=>finish(false));
  });
}
async function speakWord(char,pinyin,button=null) {
  const url=getWordAudioURL(char,pinyin);
  if(!url){toast('這個字的示範音暫時未能播放。');return;}
  if(button&&activeSpeechButton===button){stopMedia();return;}
  stopMedia();const version=speechVersion,route=routeVersion;activeSpeechButton=button;
  speechState(button,'playing');
  const finished=await playSource(url);
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
  stopMedia();const version=speechVersion,route=routeVersion;activeSpeechButton=button;speechState(button,'playing');
  try{for(const item of items){const url=getWordAudioURL(item.char,item.pinyin);if(!url)throw new Error('missing');const finished=await playSource(url);if(version!==speechVersion||route!==routeVersion)return;if(!finished)throw new Error('playback');}}
  catch{if(version===speechVersion&&route===routeVersion)toast('字音暫時未能播放，請再試一次。');}
  finally{if(version===speechVersion&&route===routeVersion)stopTransient();}
}
function stopMedia() { audio.pause();video.pause();stopTransient();updateAudio(); }
function cancelRecording() {
  recordingVersion++;
  if (recorder && recorder.state !== 'inactive') {recorder.onstop=null;recorder.stop();}
  stream?.getTracks().forEach(track=>track.stop());stream=null;recorder=null;
  if(recordContext?.state!=='closed')recordContext?.close().catch(()=>{});recordContext=null;
  clearInterval(recordTimer);recordTimer=null;recordBusy=false;
}
async function api(path,body,timeout=35000) {
  const controller=new AbortController();requests.add(controller);
  const timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data.error) throw new Error(response.status===429?'現在較多人使用，請稍後重試。':'服務暫時未能完成，請稍後再試。');
    return data;
  } finally {clearTimeout(timer);requests.delete(controller);}
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
    '<div class="library-heading"><div><p class="eyebrow">馬鞍山靈糧小學 · 普通話</p><h1>把古詩，讀成<span class="title-ink">一幅畫</span><span class="poetry-seal" aria-hidden="true">詩</span></h1><p class="library-sub">選一首詩，開啟今天的小旅程。</p></div><div class="library-flourish" aria-hidden="true"><img class="paper-bird" src="media/paper-crane.svg" width="180" height="100" alt=""></div></div>'+
    '<div class="poem-grid library-books" id="poem-grid" aria-label="選擇古詩"></div><footer class="library-footer"><span>六首古詩 · 六段小旅程</span><a href="credits.html">素材來源 '+icon('arrow-up-right')+'</a></footer></main>';
  renderCards();icons();
}
function renderCards() {
  $('#poem-grid').innerHTML=poems.map(p=>'<article class="poem-card poem-color-'+p.id+'"><a class="poem-entry" href="'+link('record',p)+'" aria-label="朗讀'+esc(titleOf(p))+'"><div class="poem-art" style="background-image:url('+getScenePreview(p.slug,p.lines.at(-1).scene)+')"><img src="'+asset('cover-final.webp',p)+'" width="800" height="450" alt="'+esc(p.lines.at(-1).text)+'" '+(p.id>3?'loading="lazy"':'fetchpriority="high"')+'><span class="poem-grade">'+['','一','二','三','四','五','六'][p.grade]+'年級</span></div><div class="poem-card-body"><img class="poem-emblem" src="'+poemMotif(p)+'" width="56" height="56" alt="" aria-hidden="true"><div class="poem-card-title"><h2>'+esc(p.title)+(p.id===5?'<small>其三</small>':'')+'</h2></div><p class="poem-author">'+esc(p.dynasty)+' · '+esc(p.author)+'</p><span class="poem-open">'+icon('mic')+'<span>'+(state(p).reading.some(Boolean)?'繼續朗讀':'開始朗讀')+'</span>'+icon('arrow-right')+'</span></div></a></article>').join('');icons();
}
const NAV=[['read','book-open','賞讀古詩','賞詩'],['record','mic','朗讀測評','朗讀'],['write','pen-line','默寫練習','默寫'],['quiz','flag','語音小闖關','闖關'],['chat','messages-square','與詩人對話','詩人'],['report','award','學習報告','報告']];
function renderWorkspace() {
  const name=NAV.find(n=>n[0]===view)?.[2]||'';
  document.title=`${titleOf(poem)} · ${name} · AIDUCATION`;
  const activities=[['record','mic','朗讀練習'],['read','book-open','整首欣賞'],['write','pen-line','寫字'],['quiz','flag','闖關'],['chat','messages-square','問詩人'],['report','award','朗讀成績']];
  app.innerHTML='<div class="workspace lesson-shell poem-color-'+poem.id+' view-'+view+'"><div class="lesson-bar"><a class="back-library" href="#">'+icon('arrow-left')+'<span>選詩</span></a><div class="lesson-title"><img class="lesson-portrait" src="'+asset('avatar.webp')+'" width="48" height="48" alt="'+esc(poem.author)+'"><div class="lesson-heading"><h1>'+esc(titleOf(poem))+'</h1><p>'+esc(poem.dynasty)+' · '+esc(poem.author)+'</p></div></div><details class="lesson-menu"><summary title="更多活動" aria-label="更多活動">'+icon('ellipsis')+'<span>更多</span></summary><nav class="menu-panel" aria-label="更多活動">'+activities.map(([id,symbol,label])=>'<a href="'+link(id)+'" '+(view===id?'aria-current="page"':'')+'>'+icon(symbol)+'<span>'+label+'</span></a>').join('')+'<button data-action="profile">'+icon('user-round')+'學習檔案</button></nav></details></div><main class="study-main" id="main"><section id="view" class="view-section '+(showPinyin?'':'hide-pinyin')+'"></section></main></div>';
  renderView();icons();
}
function renderView() {
  if(view==='read')renderRead();
  if(view==='record')renderRecord();
  if(view==='report')renderReport();
  if(view==='write')renderWriting();
  if(view==='quiz')renderQuiz();
  if(view==='chat')renderChat();
  icons();
}
function renderRead() {
  $('#view').innerHTML=readingToolbar()+
    '<div class="reading-experience"><div class="reading-scene"><div class="poem-landscape"><div class="art-stage" id="reading-art"></div><div class="scene-dots" aria-label="畫卷">'+[1,2,3,4].map(n=>'<button data-action="scene" data-value="'+n+'" aria-label="第'+n+'幅畫卷" title="第'+n+'幅畫卷" aria-pressed="'+(scene===n)+'"></button>').join('')+'</div></div>'+
    '<div class="poem-text"><div class="reading-folio"><span>畫中有詩</span><span id="reading-page">'+scene+' / 4</span></div><div class="poem-lines" id="reading-verses"></div><div class="page-turner"><button class="icon-button" data-action="read-prev" aria-label="上一幅畫卷">'+icon('chevron-left')+'</button><button class="text-button" data-action="full-poem">'+icon('book-open')+'整首詩</button><button class="icon-button" data-action="read-next" aria-label="下一幅畫卷">'+icon('chevron-right')+'</button></div></div></div>'+
    '<div class="reader-controls"><div class="media-buttons"><button class="button audio-command" data-action="narration" id="listen-button">'+icon('volume-2')+'<span>聽朗讀</span></button><button class="button video-command" data-action="video">'+icon('clapperboard')+'看影片</button></div><a class="button primary read-start" href="'+link('record')+'">'+icon('mic')+'我來讀 '+icon('arrow-right')+'</a></div>'+
    '<div class="audio-options"><div class="audio-timeline"><span id="audio-time">0:00</span><input id="audio-seek" type="range" min="0" max="100" value="0" step=".1" aria-label="朗讀進度"><span id="audio-duration">0:00</span><select id="audio-speed" aria-label="朗讀速度"><option value=".75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select></div></div></div>';
  sceneStage=mountStage($('#reading-art'),{poemSlug:poem.slug,scene,alt:sceneText(scene)});
  audio.src=asset('narration.m4a');audio.playbackRate=1;
  $('#audio-seek').addEventListener('input',event=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(event.target.value)/100;});
  $('#audio-speed').addEventListener('change',event=>{audio.playbackRate=Number(event.target.value);});
  updateReadingPage();
}
function updateReadingPage(){
  if(!$('#reading-verses'))return;
  $('#reading-verses').innerHTML=poem.lines.filter(line=>line.scene===scene).map(line=>verseHTML(line)).join('');
  $('#reading-page').textContent=scene+' / 4';
  $('[data-action="read-prev"]').disabled=scene===1;$('[data-action="read-next"]').disabled=scene===4;
}
function readingToolbar() {
  return '<div class="reader-toolbar"><h2>整首欣賞</h2>'+pinyinButton()+'</div>';
}
function pinyinButton() {
  return '<button class="icon-button pinyin-toggle" data-action="pinyin" title="'+(showPinyin?'隱藏':'顯示')+'拼音" aria-label="'+(showPinyin?'隱藏':'顯示')+'拼音" aria-pressed="'+showPinyin+'">'+icon('languages')+'</button>';
}
function sceneText(n,p=poem){return p.lines.filter(l=>l.scene===Math.max(1,n)).map(l=>l.text).join('，');}
function updateAudio() {
  const button=$('#listen-button');if(!button)return;
  button.innerHTML=icon(audio.paused?'volume-2':'pause')+`<span>${audio.paused?'聽朗讀':'暫停朗讀'}</span>`;
  const format=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  $('#audio-time').textContent=format(audio.currentTime||0);$('#audio-duration').textContent=format(Number.isFinite(audio.duration)?audio.duration:0);
  $('#audio-seek').value=Number.isFinite(audio.duration)?audio.currentTime/audio.duration*100:0;icons();
}
async function playNarration() {
  if(!audio.paused){audio.pause();return;}
  stopMedia();if(audio.ended)audio.currentTime=0;
  try{await audio.play();}catch{toast('朗讀音訊暫時無法播放，請重試。');}updateAudio();
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
      const url=getSpeechAudioURL(phrase);let finished;
      if(url){speechState(button,'playing');finished=await playSource(url);}
      else{speechState(button,'loading');const blob=await speechBlob(phrase);if(version!==speechVersion||route!==routeVersion)return;speechState(button,'playing');finished=await playBlob(blob);}
      if(version!==speechVersion||route!==routeVersion)return;
      if(!finished)throw new Error('playback');
    }
  } catch {if(version===speechVersion&&route===routeVersion)toast('語音暫時無法播放，請再按一次重試。');}
  finally {if(version===speechVersion&&route===routeVersion)stopTransient();}
}
function reveal(n) {
  scene=n;sceneStage?.show(n,sceneText(n));
  if($('#scene-caption'))$('#scene-caption').textContent=sceneText(n);
  if($('#scene-count'))$('#scene-count').textContent=n+' / 4';
  document.querySelectorAll('[data-action="scene"]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.value)===n));
  updateReadingPage();
}
function renderRecord() {
  const s=state(poem),line=poem.lines[currentLine],result=s.reading[currentLine];
  const weak=recordWeakWords();
  if(!result)recordStep='read';
  if(recordStep==='result'&&weak.length)recordStep='words';
  if(recordStep==='words'&&!weak.length)recordStep='result';
  const latest=s.reading.slice(0,currentLine).reduce((a,r,i)=>r?i:a,-1),displayed=result?currentLine:latest;
  const sceneNumber=displayed>=0?poem.lines[displayed].scene:0;
  if(!$('#record-art')){
    $('#view').innerHTML='<div class="record-layout"><div class="record-landscape"><div class="record-art" id="record-art"></div><div class="record-progress" aria-hidden="true"></div></div><div class="record-practice"><div class="record-tool" id="record-tool"></div></div></div>';
    sceneStage=mountStage($('#record-art'),{poemSlug:poem.slug,scene:sceneNumber,alt:sceneNumber?sceneText(sceneNumber):'等待展開的古詩畫卷'});
  }else sceneStage?.show(sceneNumber,sceneNumber?sceneText(sceneNumber):'等待展開的古詩畫卷');
  $('.record-progress').innerHTML=poem.lines.map((_,i)=>'<i class="'+(s.reading[i]?'done ':'')+(i===currentLine?'current':'')+'"></i>').join('');
  const next='<button class="button primary" data-action="record-next">'+(currentLine===poem.lines.length-1?'看看成果':'下一句')+icon('arrow-right')+'</button>';
  let content;
  if(recordStep==='read'){
    content=verseHTML(line,'active')+'<div class="record-model"><button class="button" data-action="line-tts">'+icon('volume-2')+'聽示範</button></div><div id="record-controls"><div class="record-actions"><button class="mic-button" data-action="record-start" aria-label="開始朗讀">'+icon('mic')+'<span>開始朗讀</span></button></div><p class="record-status" id="record-status"></p></div>';
  }else if(recordStep==='result'){
    content='<div class="record-feedback"><img class="feedback-motif" src="'+poemMotif()+'" width="64" height="64" alt=""><div class="record-result" aria-label="這次朗讀'+result.total_score+'分">'+result.total_score+'<small>分</small></div><h2 tabindex="-1" class="record-feedback-title">'+esc(result.grade)+'</h2><div class="record-actions"><button class="button" data-action="record-retry">'+icon('rotate-ccw')+'再讀一次</button>'+next+'</div></div>';
  }else{
    recordWordIndex=clamp(recordWordIndex,0,weak.length-1);const word=weak[recordWordIndex];
    content='<div class="record-word-heading"><span>這句 '+result.total_score+' 分</span><span>第 '+(recordWordIndex+1)+' / '+weak.length+' 個字</span></div><div class="record-review"><button class="focus-word" data-action="word-tts" data-value="'+esc(word.c)+'" data-pinyin="'+esc(word.p)+'" aria-label="聽'+esc(word.c)+'的讀音"><ruby>'+esc(word.c)+'<rt>'+esc(word.p)+'</rt></ruby>'+icon('volume-2')+'</button></div><p class="record-word-hint">再練這個字，點字聽讀音。</p><div class="record-word-pager"><button class="icon-button" data-action="record-word-step" data-value="-1" aria-label="上一個字" '+(recordWordIndex===0?'disabled':'')+'>'+icon('chevron-left')+'</button><button class="icon-button" data-action="record-word-step" data-value="1" aria-label="下一個字" '+(recordWordIndex===weak.length-1?'disabled':'')+'>'+icon('chevron-right')+'</button></div><div class="record-actions">'+next+'</div>';
  }
  $('#record-tool').dataset.step=recordStep;
  $('#record-tool').innerHTML='<div class="record-counter"><span>第 '+(currentLine+1)+' / '+poem.lines.length+' 句</span>'+(recordStep==='read'?'<img class="practice-motif" src="'+poemMotif()+'" width="40" height="40" alt="">':'')+'</div>'+content;
  if(!$('#record-options'))$('.menu-panel').insertAdjacentHTML('afterbegin','<div id="record-options" class="menu-group"></div>');
  $('#record-options').innerHTML='<button data-action="record-choose">'+icon('list')+'選擇詩句</button><button data-action="video">'+icon('clapperboard')+'看影片</button><button data-action="pinyin" aria-pressed="'+showPinyin+'">'+icon('languages')+'<span>'+(showPinyin?'隱藏拼音':'顯示拼音')+'</span></button>'+(result?'<button data-action="record-retry">'+icon('mic')+'讀原句</button>':'')+(result&&recordStep==='read'?'<button data-action="record-feedback">'+icon('award')+'看看成果</button>':'')+(recordings.has(poem.id+'-'+currentLine)?'<button data-action="replay" data-value="'+currentLine+'">'+icon('headphones')+'我的錄音</button>':'');
  setRecordingBusy();
  icons();
}
function recordWeakWords(){return state(poem).reading[currentLine]?.words.filter(w=>Number.isFinite(w.score)&&w.score<80)||[];}
function setRecordingBusy(){
  const layout=$('.record-layout');if(layout)layout.dataset.recordBusy=String(recordBusy);
  document.querySelectorAll('#record-options button,[data-action="record-line"],[data-action="line-tts"]').forEach(button=>button.disabled=recordBusy);
}
function setRecordStep(step,focus=true){
  stopMedia();recordStep=step;renderRecord();
  if(focus){const target=$('#record-tool .focus-word, #record-tool .record-feedback-title, #record-tool [data-action="record-start"]');target?.focus({preventScroll:true});}
}
function chooseRecordLine(){
  stopMedia();const s=state(poem);
  $('#record-lines').innerHTML=poem.lines.map((line,i)=>'<button class="verse-list-item '+(i===currentLine?'current':'')+'" data-action="record-line" data-value="'+i+'" '+(i===currentLine?'aria-current="step"':'')+'><span class="line-number">'+(i+1)+'</span><span>'+esc(line.text)+'</span>'+(s.reading[i]?icon('check'):'')+'</button>').join('');
  icons();$('#record-lines-dialog').showModal();
}
async function startRecording() {
  if(recordBusy)return;stopMedia();cancelRecording();recordBusy=true;
  recordStep='read';renderRecord();
  const version=routeVersion,generation=recordingVersion,p=poem,index=currentLine;
  const isCurrent=()=>version===routeVersion&&generation===recordingVersion;
  const controls=$('#record-controls');controls.innerHTML='<p class="record-status"><span class="spinner"></span> 正在開啟麥克風</p>';
  try {
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('此瀏覽器未能使用錄音，請使用新版 Safari、Chrome 或 Edge。');
    const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    if(!isCurrent()){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;const context=new (window.AudioContext||window.webkitAudioContext)();recordContext=context;await context.resume();
    if(!isCurrent()){acquired.getTracks().forEach(t=>t.stop());if(context.state!=='closed')context.close().catch(()=>{});return;}
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    const localRecorder=new MediaRecorder(acquired,mime?{mimeType:mime}:{});recorder=localRecorder;const chunks=[];
    localRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    localRecorder.onstop=()=>{acquired.getTracks().forEach(t=>t.stop());if(isCurrent()){stream=null;clearInterval(recordTimer);assessRecording(new Blob(chunks,{type:localRecorder.mimeType}),p,index,version,generation,context);}};
    localRecorder.start();recordStarted=Date.now();
    controls.innerHTML=`<div class="record-wave live">${'<span></span>'.repeat(19)}</div><div class="record-actions"><button class="mic-button recording" data-action="record-stop" aria-label="完成錄音" title="完成錄音">${icon('square')}<span>讀好了</span></button></div><p class="record-status" id="record-status">錄音中 · 0:00</p>`;icons();
    recordTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-recordStarted)/1000);const status=$('#record-status');if(status)status.textContent=`錄音中 · 0:${String(seconds).padStart(2,'0')}`;if(seconds>=30)stopRecording();},250);
  } catch(error) {if(!isCurrent())return;cancelRecording();renderRecord();toast(error.name==='NotAllowedError'?'麥克風尚未允許，請在瀏覽器中開啟權限。':error.name==='NotFoundError'?'找不到麥克風，請檢查裝置。':error.message);}
}
function stopRecording(){if(recorder?.state==='recording'){recorder.stop();$('#record-controls').innerHTML='<p class="record-status"><span class="spinner"></span> 正在聆聽你的朗讀</p>';}}
async function wavBase64(blob,context) {
  const decoded=await context.decodeAudioData(await blob.arrayBuffer());
  const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
  const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
  const pcm=(await offline.startRendering()).getChannelData(0);const buffer=new ArrayBuffer(44+pcm.length*2),data=new DataView(buffer);
  const str=(offset,text)=>Array.from(text).forEach((c,i)=>data.setUint8(offset+i,c.charCodeAt(0)));
  str(0,'RIFF');data.setUint32(4,36+pcm.length*2,true);str(8,'WAVE');str(12,'fmt ');data.setUint32(16,16,true);data.setUint16(20,1,true);data.setUint16(22,1,true);data.setUint32(24,16000,true);data.setUint32(28,32000,true);data.setUint16(32,2,true);data.setUint16(34,16,true);str(36,'data');data.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++){const s=clamp(pcm[i],-1,1);data.setInt16(44+i*2,s<0?s*32768:s*32767,true);}
  const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
}
async function assessRecording(blob,p,index,version,generation,context) {
  const isCurrent=()=>version===routeVersion&&generation===recordingVersion;
  try {
    if(blob.size<100)throw new Error('這次錄音太短，再讀一次吧。');
    const encoded=await wavBase64(blob,context);
    if(!isCurrent())return;
    const raw=await api('/api/soe',{audio:encoded,refText:p.lines[index].simplified},26000);
    if(!isCurrent())return;
    const result=mapAssessment(raw,p.lines[index]);result.words=result.words.map(w=>({...w,lineIndex:index}));const s=state(p);recordings.set(`${p.id}-${index}`,blob);s.reading[index]=result;s.report='';s.updatedAt=Date.now();
    recordStep='result';recordWordIndex=0;
    queueReading(p,{lineIdx:index,lineScore:result.total_score});
  } catch(error) {if(isCurrent())toast(error.name==='AbortError'?'這次等得有點久，請再試一次。':error.message);}
  finally {if(isCurrent()){cancelRecording();setRecordStep(recordStep);}}
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
  if(!$('#practice-options'))$('.menu-panel').insertAdjacentHTML('afterbegin','<div id="practice-options" class="menu-group"></div>');
  $('#practice-options').innerHTML='<button data-action="sentence-tts" data-text="'+esc(item.lineText)+'">'+icon('volume-2')+'聽原句</button><button data-action="replay" data-value="'+index+'" '+(canReplay?'':'disabled')+'>'+icon('headphones')+'我的錄音</button>';
  $('#practice-options').hidden=reportTab!=='practice';icons();
}
function renderReport() {
  const s=state(poem),result=poemAssessment();
  if(!result){$('#view').innerHTML='<div class="report-empty"><img src="media/paper-crane.svg" width="180" height="100" alt=""><h2>第一句，從現在開始</h2><a class="button primary" href="'+link('record')+'">'+icon('mic')+'開始朗讀</a></div>';return;}
  const keys=[['phone_score','發音準確度'],['fluency_score','流暢度'],['integrity_score','完整度']],grade=studentGrade(),report=currentReport();
  $('#view').innerHTML='<div class="report-summary"><div class="score-ring" style="--score:'+result.total_score+'"><div><strong>'+result.total_score+'</strong><span>朗讀得分</span></div></div><div><p class="eyebrow">'+s.reading.filter(Boolean).length+' / '+poem.lines.length+' 句已完成</p><div class="dimension-grid">'+keys.map(([k,label])=>'<div class="dimension"><strong>'+(result.dimensions[k]??'—')+'</strong><span>'+label+'</span></div>').join('')+'</div></div></div>'+
    '<div class="report-tabs" role="tablist" aria-label="朗讀成果">'+[['practice','練字音'],['advice','老師建議'],['scores','逐句成績']].map(([id,label])=>'<button id="tab-'+id+'" role="tab" aria-controls="panel-'+id+'" data-action="report-tab" data-value="'+id+'">'+label+'</button>').join('')+'</div><div class="report-panels"><div id="panel-practice" role="tabpanel" aria-labelledby="tab-practice">'+pronunciationHTML(result)+'</div>'+
    '<section id="panel-advice" class="ai-advice" data-student-grade="'+grade+'" role="tabpanel" aria-labelledby="tab-advice"><div class="ai-report-header"><div><h2>老師的小建議</h2><label class="report-grade-label">我的年級 <select id="report-grade" aria-label="我的年級">'+['一','二','三','四','五','六'].map((label,i)=>'<option value="'+(i+1)+'" '+(grade===i+1?'selected':'')+'>'+label+'年級</option>').join('')+'</select></label></div><button class="button" data-action="report-generate" id="report-button">'+icon('sparkles')+(report?'重新生成':'生成建議')+'</button></div><div id="advice-details" '+(report?'':'hidden')+'><div id="report-prose" class="report-prose">'+esc(report)+'</div></div><p class="advice-placeholder" '+(report?'hidden':'')+'>'+(s.report?'年級建議已更新，按「生成建議」看看吧。':'老師會按你的年級，說說下一次可以怎樣練。')+'</p></section>'+
    '<section id="panel-scores" class="word-analysis" role="tabpanel" aria-labelledby="tab-scores"><div class="section-heading"><span>點字聽讀音</span><button class="button small" data-action="replay-all" '+(poem.lines.some((_,i)=>recordings.has(poem.id+'-'+i))?'':'disabled')+'>'+icon('headphones')+'全部回聽</button></div><div class="score-line-tabs" aria-label="選擇詩句">'+s.reading.map((r,i)=>r?'<button class="icon-button" data-action="score-line" data-value="'+i+'" aria-label="第'+(i+1)+'句">'+(i+1)+'</button>':'').join('')+'</div>'+
    s.reading.map((lineResult,i)=>{
      if(!lineResult)return '';
      return '<div class="report-line" data-line="'+i+'"><div class="report-line-heading"><h3>第'+(i+1)+'句</h3><span>'+esc(poem.lines[i].text)+'</span><button class="icon-button" data-action="replay" data-value="'+i+'" aria-label="回聽第'+(i+1)+'句錄音" title="回聽第'+(i+1)+'句錄音" '+(recordings.has(poem.id+'-'+i)?'':'disabled')+'>'+icon('headphones')+'</button></div><div class="word-grid">'+lineResult.words.map(w=>'<button class="word-result '+w.status+'" data-action="word-tts" data-value="'+esc(w.c)+'" data-pinyin="'+esc(w.p)+'" title="聽'+esc(w.c)+'的讀音"><ruby>'+esc(w.c)+'<rt>'+esc(w.p)+'</rt></ruby><strong>'+(w.score??'未測')+'</strong>'+icon('volume-2')+'</button>').join('')+'</div><a class="button small" href="'+link('record')+'" data-action="record-target" data-value="'+i+'">'+icon('mic')+'再讀這一句</a></div>';
    }).join('')+'</section></div><nav class="report-next-activities" aria-label="繼續學習">'+[['write','pen-line','默寫練習'],['quiz','flag','語音闖關'],['chat','messages-square','詩人聊天']].map(([id,symbol,label])=>'<a href="'+link(id)+'">'+icon(symbol)+'<span>'+label+'</span></a>').join('')+'</nav>';
  if(!s.reading[reportLine])reportLine=s.reading.findIndex(Boolean);
  updateReportTab();updateScoreLine();renderFocusedPractice();icons();
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
  $('#report-prose').innerHTML='<span class="spinner"></span> 正在整理你的朗讀建議';
  try{
    const data=await api('/api/maanshan-report',{poemId:p.id,studentGrade:grade,soeResult:{...result,linesCompleted:state(p).reading.filter(Boolean).length}});
    if(version!==routeVersion||generation!==reportGeneration)return;
    if(!data.report||data.studentGrade!==grade||data.reportVersion!==REPORT_VERSION)throw new Error('建議尚未生成，請稍後再試。');
    Object.assign(state(p),{report:data.report,reportStudentGrade:grade,reportVersion:REPORT_VERSION});
    queueSection('report',{content:data.report,totalScore:result.total_score,grade:result.grade,studentGrade:grade,reportVersion:REPORT_VERSION},p);$('#report-prose').textContent=data.report;
  }
  catch(error){if(version===routeVersion&&generation===reportGeneration)$('#report-prose').textContent=error.name==='AbortError'?'生成時間較長，請稍後再試。':error.message;}
  finally{if(version===routeVersion&&generation===reportGeneration)button.disabled=false;}
}
function stopStrokeHint(){
  strokeHintVersion++;clearTimeout(strokeHintTimer);strokeHintTimer=null;
  strokeWriter?.pauseAnimation?.();strokeWriter=null;
  const holder=$('#stroke-hint');if(holder){holder.hidden=true;holder.replaceChildren();}
}
function renderWriting() {
  stopStrokeHint();
  handwritingPad?.destroy();handwritingPad=null;
  const results=state(poem).writing;
  if(writeIndex>=poem.dictation.length){const correct=results.filter(r=>r.correct&&!r.hinted).length;$('#view').innerHTML=`<div class="completion">${icon('award')}<h2>今天的默寫完成了</h2><p>${correct} / ${poem.dictation.length} 個字獨立完成</p><div class="completion-actions"><button class="button" data-action="write-reset">${icon('rotate-ccw')}再練一次</button><a class="button primary" href="${link('quiz')}">${icon('ear')}語音練習</a></div><div class="practice-results">${results.map(r=>`<span class="result-chip ${r.correct&&!r.hinted?'':'wrong'}">${esc(r.char)}</span>`).join('')}</div></div>`;icons();return;}
  const item=poem.dictation[writeIndex];
  $('#view').innerHTML=`<div class="writing-layout"><div class="writing-context"><div class="art-stage"><img src="${asset(`scene-${Math.min(4,1+Math.floor(writeIndex/3))}.webp`)}" width="1600" height="900" alt="${esc(poem.title)}畫卷"></div><h2>聽見詩，也寫下詩。</h2><p>${esc(poem.description)}</p><div class="practice-results">${results.map(r=>`<span class="result-chip ${r.correct&&!r.hinted?'':'wrong'}">${esc(r.char)}</span>`).join('')}</div></div><div class="writing-tool"><div class="writing-toolbar"><div><span class="writing-pinyin">${esc(item.pinyin)}</span><p class="writing-counter">第 ${writeIndex+1} / ${poem.dictation.length} 字</p></div><button class="icon-button" data-action="write-speak" title="聽默寫字詞" aria-label="聽默寫字詞">${icon('volume-2')}</button></div><div class="writing-board"><div id="writing-hint" class="writing-hint"></div><div id="stroke-hint" class="stroke-hint" hidden></div><canvas id="writing-canvas" width="560" height="560" aria-label="手寫答題區"></canvas></div><div class="writing-controls"><div class="writing-tools"><button class="icon-button" data-action="write-undo" aria-label="撤銷上一筆" title="撤銷上一筆">${icon('undo-2')}</button><button class="icon-button" data-action="write-clear" aria-label="清空" title="清空">${icon('eraser')}</button><button class="icon-button" data-action="write-hint" aria-label="看看這個字" title="看看這個字">${icon('eye')}</button><button class="icon-button" data-action="stroke-hint" aria-label="看筆順" title="${item.char==='峯'?'暫無此字筆順':'看筆順'}" ${item.char==='峯'?'disabled':''}>${icon('pencil-ruler')}</button></div><button class="button primary" data-action="write-check" id="write-check">${icon('check')}寫好了</button></div><div class="writing-status"><p id="writing-feedback" class="writing-feedback" role="status">${hinted?'這個字已看過提示。':''}</p><button class="text-button" data-action="write-skip">稍後再練 ${icon('arrow-right')}</button></div></div></div>`;
  writeBusy=false;strokeWriter=null;
  handwritingPad=createHandwritingPad($('#writing-canvas'),{isLocked:()=>writeBusy,onChange:strokes=>{
    if(strokes.length&&($('#stroke-hint')&&!$('#stroke-hint').hidden)){
      stopStrokeHint();$('#writing-feedback').textContent='現在自己寫一寫。';
    }
  }});icons();
}
function writingSpeech(button){const item=poem.dictation[writeIndex];speak(item.char,`${item.word}，${item.word}的${item.char}。`,button);}
async function showStrokeHint() {
  stopStrokeHint();
  const target=poem.dictation[writeIndex].char,version=routeVersion,index=writeIndex,hintVersion=strokeHintVersion;hinted=true;const holder=$('#stroke-hint');holder.hidden=false;holder.textContent='正在準備筆順…';
  try{
    if(!window.HanziWriter)throw new Error('unavailable');
    const response=await fetch(`vendor/hanzi-data/${target.codePointAt(0).toString(16)}.json`);if(!response.ok)throw new Error('missing');const data=await response.json();if(version!==routeVersion||index!==writeIndex||hintVersion!==strokeHintVersion)return;
    holder.replaceChildren();
    strokeWriter=HanziWriter.create(holder,target,{width:560,height:560,padding:45,showCharacter:false,showOutline:true,strokeColor:'#176759',outlineColor:'#e1eae4',strokeAnimationSpeed:1,delayBetweenStrokes:180,charDataLoader:(_char,onLoad)=>onLoad(data)});
    const svg=holder.querySelector('svg');if(svg){svg.setAttribute('viewBox','0 0 560 560');svg.setAttribute('preserveAspectRatio','xMidYMid meet');}
    await strokeWriter.animateCharacter();if(version===routeVersion&&index===writeIndex&&hintVersion===strokeHintVersion){strokeHintTimer=setTimeout(()=>{if(hintVersion===strokeHintVersion)stopStrokeHint();},600);$('#writing-feedback').textContent='看過筆順了，現在試着自己寫一次。';}
  }catch{if(holder.isConnected&&hintVersion===strokeHintVersion){stopStrokeHint();$('#writing-hint').textContent=target;$('#writing-feedback').textContent='這個字的筆順暫時無法播放。';}}
}
async function checkWriting() {
  if(writeBusy)return;const strokes=handwritingPad?.finish()||[];
  if(!strokes.length){$('#writing-feedback').textContent='先在田字格寫下你的答案。';return;}
  writeBusy=true;const button=$('#write-check');button.disabled=true;const version=routeVersion,index=writeIndex,item=poem.dictation[index];$('#writing-feedback').textContent='正在辨認你的字…';
  const start=strokes[0][0].t;const ink=strokes.map(s=>[s.map(p=>Math.round(p.x)),s.map(p=>Math.round(p.y)),s.map(p=>p.t-start)]);
  try {
    const data=await api('/api/handwriting',{ink},12000);if(version!==routeVersion||index!==writeIndex)return;
    const candidates=data.candidates||[];const line=poem.lines.find(l=>l.text.includes(item.char));const pos=Array.from(line.text).indexOf(item.char);const simplified=Array.from(line.simplified)[pos];
    const match=handwritingMatch(candidates,item.char,simplified);
    if(match==='correct'){const usedHint=hinted;completeWriting(true);toast(usedHint?'完成了，下次試試不看提示。':'寫對了，繼續下一個字。');}
    else $('#writing-feedback').textContent=match==='simplified'?'這次寫的是簡體字，試試繁體寫法。':`再看看字形，${candidates.length?'這次還未認出目標字。':'這次未能辨認，試着寫大一點。'}`;
  }catch(error){if(version===routeVersion&&index===writeIndex)$('#writing-feedback').textContent=error.name==='AbortError'?'辨認時間較長，請重試。':error.message;}
  finally{if(version===routeVersion&&index===writeIndex){writeBusy=false;button.disabled=false;}}
}
function completeWriting(correct) {
  const s=state(poem),item=poem.dictation[writeIndex];s.writing[writeIndex]={char:item.char,correct,hinted};
  queueSection('writing',{results:s.writing,totalCorrect:s.writing.filter(r=>r.correct&&!r.hinted).length,totalChars:poem.dictation.length,updatedAt:new Date().toISOString()});
  writeIndex++;hinted=false;stopTransient();renderWriting();
}
function renderQuiz() {
  if(quizIndex>=poem.phonics.length){const count=quizAnswers.filter((a,i)=>a===poem.phonics[i].answer).length;$('#view').innerHTML=`<div class="completion">${icon('badge-check')}<h2>語音小挑戰完成</h2><p>${count} / ${poem.phonics.length} 題答對了，每一題都學會一點。</p><div class="completion-actions"><button class="button" data-action="quiz-reset">${icon('rotate-ccw')}再挑戰一次</button><a class="button primary" href="${link('chat')}">${icon('messages-square')}找${esc(poem.author)}聊聊</a></div></div>`;icons();return;}
  const q=poem.phonics[quizIndex];
  $('#view').innerHTML=`<div class="quiz-layout"><div class="quiz-art"><div class="art-stage"><img src="${asset(`scene-${Math.min(4,1+Math.floor(quizIndex/2))}.webp`)}" width="1600" height="900" alt="${esc(poem.title)}畫卷"></div><h2 class="panel-title">讓每個字，都更清楚。</h2><p class="muted">${esc(poem.description)}</p></div><div><div class="quiz-top"><span>${esc(q.label)}</span><span>${quizIndex+1} / ${poem.phonics.length}</span></div><div class="quiz-progress"><i style="width:${quizIndex/poem.phonics.length*100}%"></i></div><h2 class="quiz-prompt">${esc(q.prompt)}</h2><div class="quiz-options">${q.options.map((option,i)=>`<button class="quiz-option ${quizChoice!==null?(i===q.answer?'correct':i===quizChoice?'incorrect':''):''}" data-action="quiz-answer" data-value="${i}" ${quizChoice!==null?'disabled':''}><span>${String.fromCharCode(65+i)}</span>${esc(option)}</button>`).join('')}</div><div class="quiz-explanation" role="status">${quizChoice!==null?`${quizChoice===q.answer?'答對了。':'一起看看正確讀法。'}${esc(q.explanation)}`:''}</div><div class="quiz-next"><button class="button primary" data-action="quiz-next" ${quizChoice===null?'disabled':''}>${quizIndex===poem.phonics.length-1?'完成挑戰':'下一題'}${icon('arrow-right')}</button></div></div></div>`;icons();
}
function renderChat() {
  const messages=state(poem).chat;
  $('#view').innerHTML=`<div class="chat-layout"><aside class="poet-profile"><img src="${asset('avatar.webp')}" width="480" height="600" alt="${esc(poem.author)}"><h2>${esc(poem.author)}</h2><p>${esc(poem.authorBio)}</p></aside><div class="chat-tool"><div class="chat-messages" id="chat-messages" role="log" aria-live="polite"><div class="chat-message"><img src="${asset('avatar.webp')}" width="32" height="32" alt="${esc(poem.author)}"><div class="chat-bubble">你好，我是${esc(poem.author)}。今天一起讀《${esc(titleOf(poem))}》，你想聊聊詩裡的甚麼呢？</div></div>${messages.map((m,i)=>chatMessage(m,i)).join('')}</div><div class="chat-suggestions">${poem.suggestions.map((q,i)=>`<button data-action="chat-suggestion" data-value="${i}">${esc(q)}</button>`).join('')}</div><form class="chat-form" id="chat-form"><textarea id="chat-input" aria-label="想問詩人的問題" placeholder="我想問……" rows="2" maxlength="1000" required></textarea><button type="submit" class="icon-button" id="chat-send" aria-label="傳送問題" title="傳送問題">${icon('send')}</button></form><div id="chat-error" class="chat-error" role="status"></div></div></div>`;
  $('#chat-form').addEventListener('submit',event=>{event.preventDefault();sendChat($('#chat-input').value.trim());});
  $('#chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#chat-form').requestSubmit();}});icons();
  const holder=$('#chat-messages');holder.scrollTop=holder.scrollHeight;
}
function chatMessage(message,index) {return `<div class="chat-message ${message.role==='user'?'user':''}">${message.role==='assistant'?`<img src="${asset('avatar.webp')}" width="32" height="32" alt="${esc(poem.author)}">`:''}<div class="chat-bubble">${esc(message.content)}${message.role==='assistant'?`<button class="icon-button" data-action="chat-speak" data-value="${index}" aria-label="朗讀回答" title="朗讀回答">${icon('volume-2')}</button>`:''}</div></div>`;}
async function sendChat(text) {
  if(!text||chatBusy)return;stopMedia();chatBusy=true;const p=poem,version=routeVersion,s=state(p);s.chat.push({role:'user',content:text.slice(0,1000)});s.chat=s.chat.slice(-30);persist();renderChat();$('#chat-send').disabled=true;$('#chat-error').innerHTML='<span class="spinner"></span> 正在想一想…';
  try{const data=await api('/api/maanshan-chat',{poemId:p.id,messages:s.chat.slice(-10)},25000);if(version!==routeVersion)return;if(!data.reply)throw new Error('暫時未能回答，請再試一次。');s.chat.push({role:'assistant',content:data.reply});persist();renderChat();}
  catch(error){if(version===routeVersion){$('#chat-error').textContent=error.name==='AbortError'?'等得有點久，稍後再問一次吧。':error.message;}}
  finally{if(version===routeVersion){chatBusy=false;$('#chat-send').disabled=false;}}
}
function route() {
  stopStrokeHint();reportGeneration++;
  handwritingPad?.destroy();handwritingPad=null;
  sceneStage?.destroy();sceneStage=null;
  routeVersion++;stopMedia();cancelRecording();requests.forEach(c=>c.abort());requests.clear();chatBusy=false;writeBusy=false;
  clearTimeout(toastTimer);$('#toast').classList.remove('visible');
  if($('#video-dialog').open)$('#video-dialog').close();
  if($('#poem-dialog').open)$('#poem-dialog').close();
  if($('#record-lines-dialog').open)$('#record-lines-dialog').close();
  let parts;try{parts=decodeURIComponent(location.hash.slice(1)).split('/');}catch{parts=[];}
  const next=poems.find(p=>p.slug===parts[0]);
  if(!next){document.body.dataset.screen='library';renderLibrary();window.scrollTo({top:0});return;}
  const changed=poem?.id!==next.id;poem=next;view=NAV.some(n=>n[0]===parts[1])?parts[1]:'record';
  document.body.dataset.screen=view;
  if(changed){scene=1;practiceIndex=0;reportTab='practice';reportLine=0;currentLine=Math.max(0,state(poem).reading.findIndex(r=>!r));}
  recordStep='read';recordWordIndex=0;practiceMode='sound';
  if(view==='write'){writeIndex=state(poem).writing.length;hinted=false;}
  if(view==='quiz'){quizAnswers=[...state(poem).quiz];quizIndex=quizAnswers.length;quizChoice=null;}
  renderWorkspace();window.scrollTo({top:0});
}
document.addEventListener('click',event=>{
  const menu=$('.lesson-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;
  if(event.target.closest('.menu-panel a')){if(menu)menu.open=false;}
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action,value=button.dataset.value;
  if(button.closest('.menu-panel')&&menu)menu.open=false;
  if(action==='profile'){if(menu)menu.open=false;openProfile();return;}
  if(!poem)return;
  if(action==='pinyin'){showPinyin=!showPinyin;$('#view').classList.toggle('hide-pinyin',!showPinyin);button.setAttribute('aria-pressed',showPinyin);button.setAttribute('aria-label',showPinyin?'隱藏拼音':'顯示拼音');button.title=showPinyin?'隱藏拼音':'顯示拼音';if(button.closest('#record-options'))$('span',button).textContent=button.title;}
  if(action==='scene')reveal(Number(value));
  if(action==='read-prev')reveal(Math.max(1,scene-1));
  if(action==='read-next')reveal(Math.min(4,scene+1));
  if(action==='full-poem'){$('#full-poem-title').textContent=titleOf(poem);$('#full-poem-lines').innerHTML=poem.lines.map(line=>verseHTML(line)).join('');$('#full-poem-lines').classList.toggle('hide-pinyin',!showPinyin);$('#poem-dialog').showModal();}
  if(action==='narration')playNarration();
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
  if(action==='record-start')startRecording();
  if(action==='record-stop')stopRecording();
  if(action==='record-choose'&&!recordBusy)chooseRecordLine();
  if(action==='record-line'&&!recordBusy){currentLine=Number(value);recordWordIndex=0;$('#record-lines-dialog').close();setRecordStep('read');}
  if(action==='record-feedback'&&!recordBusy)setRecordStep('result');
  if(action==='record-retry'&&!recordBusy)setRecordStep('read');
  if(action==='record-word-step'&&!recordBusy){recordWordIndex=clamp(recordWordIndex+Number(value),0,recordWeakWords().length-1);setRecordStep('words');}
  if(action==='record-next'&&!recordBusy){stopMedia();if(currentLine<poem.lines.length-1){currentLine++;recordWordIndex=0;setRecordStep('read');}else location.hash=link('report');}
  if(action==='replay')replay(Number(value),button);
  if(action==='replay-all')replay(null,button);
  if(action==='report-generate')generateReport();
  if(action==='write-speak')writingSpeech(button);
  if(action==='write-clear'&&!writeBusy){stopStrokeHint();handwritingPad?.clear();}
  if(action==='write-undo'&&!writeBusy){stopStrokeHint();handwritingPad?.undo();}
  if(action==='write-hint'&&!writeBusy){stopStrokeHint();hinted=true;$('#writing-hint').textContent=poem.dictation[writeIndex].char;$('#writing-feedback').textContent='看過提示後完成，會記作練習。';}
  if(action==='stroke-hint'&&!writeBusy)showStrokeHint();
  if(action==='write-check')checkWriting();
  if(action==='write-skip'&&!writeBusy)completeWriting(false);
  if(action==='write-reset'){state(poem).writing=[];persist();writeIndex=0;hinted=false;renderWriting();}
  if(action==='quiz-answer'&&quizChoice===null){quizChoice=Number(value);renderQuiz();}
  if(action==='quiz-next'&&quizChoice!==null){quizAnswers[quizIndex]=quizChoice;state(poem).quiz=[...quizAnswers];persist();quizIndex++;quizChoice=null;if(quizIndex===poem.phonics.length)queueReading();renderQuiz();}
  if(action==='quiz-reset'){state(poem).quiz=[];persist();queueReading();quizAnswers=[];quizIndex=0;quizChoice=null;renderQuiz();}
  if(action==='chat-suggestion')sendChat(poem.suggestions[Number(value)]);
  if(action==='chat-speak'){const message=state(poem).chat[Number(value)];if(message)speak(message.content,'',button);}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){const menu=$('.lesson-menu');if(menu?.open){menu.open=false;menu.querySelector('summary').focus();}}
  if(event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=[...document.querySelectorAll('[role="tab"]')],index=tabs.indexOf(event.target);const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();}
});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.close==='video-dialog')video.pause();document.getElementById(button.dataset.close).close();}));
$('#video-dialog').addEventListener('close',()=>video.pause());
$('#video-dialog').addEventListener('cancel',()=>video.pause());
video.addEventListener('play',()=>{audio.pause();stopTransient();});video.addEventListener('error',()=>{$('#video-error').hidden=false;});
audio.addEventListener('play',()=>{video.pause();stopTransient();updateAudio();});
['pause','ended','loadedmetadata'].forEach(type=>audio.addEventListener(type,updateAudio));
audio.addEventListener('timeupdate',()=>{const time=$('#audio-time');if(!time)return;time.textContent=`${Math.floor(audio.currentTime/60)}:${String(Math.floor(audio.currentTime%60)).padStart(2,'0')}`;$('#audio-seek').value=Number.isFinite(audio.duration)?audio.currentTime/audio.duration*100:0;});
audio.addEventListener('ended',()=>{if(poem){state(poem).listened=true;persist();}});
video.addEventListener('ended',()=>{if(poem){state(poem).listened=true;persist();}});
audio.addEventListener('error',()=>{if(audio.getAttribute('src'))toast('朗讀音訊載入失敗，請重試。');});
function openProfile(){const form=$('#profile-form');form.elements.name.value=profile?.name||'';form.elements.grade.value=poem?studentGrade():profile?.grade||readStorage(STUDENT_GRADE,2);form.elements.cls.value=profile?.cls||'A';$('#profile-dialog').showModal();}
$('#profile-open').addEventListener('click',openProfile);
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
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){handwritingPad?.finish();stopMedia();cancelRecording();if(poem&&view==='record')renderRecord();}else sync.flush();});
window.addEventListener('pagehide',()=>{handwritingPad?.finish();stopMedia();cancelRecording();persist();});
async function init(){
  try{
    const responses=await Promise.all([fetch('poems.json?v=20260909a'),fetch('pronunciation.json?v=20260908b')]);
    if(responses.some(response=>!response.ok))throw new Error('catalog');
    const [data,pronunciation]=await Promise.all(responses.map(response=>response.json()));
    poems=data.poems;if(!Array.isArray(poems)||!poems.length)throw new Error('catalog');
    configurePronunciation(pronunciation);route();sync.flush();icons();
  }catch{
    app.innerHTML='<main id="main" class="loading-page"><p>古詩暫時未能載入。</p><button class="button" onclick="location.reload()">重新載入</button></main>';
  }
}
init();
