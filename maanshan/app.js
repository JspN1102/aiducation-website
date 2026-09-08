import {escapeHTML as esc, clamp, mapAssessment, mergeAssessments, handwritingMatch, createSyncQueue} from './core.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons();
const audio = $('#narration');
const video = $('#recital-video');
const app = $('#app');
const STORE = 'maanshan-learning-v2';
const PROFILE = 'ms_student_info';
const PENDING = 'ms_pending_sync';
let memoryStore = {};
function readStorage(key, fallback) { if(Object.hasOwn(memoryStore,key))return memoryStore[key];try { const value=JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
function writeStorage(key, value) { try { localStorage.setItem(key,JSON.stringify(value)); delete memoryStore[key]; return true; } catch { memoryStore[key]=value; toast('此裝置的儲存空間不足，請保留本頁。'); return false; } }
let saved = readStorage(STORE, {});
if (!saved || Array.isArray(saved) || typeof saved !== 'object') saved={};
let profile=readStorage(PROFILE,null);
let poems=[], poem=null, view='read', routeVersion=0, libraryFilter=0, searchText='', showPinyin=true;
let transientAudio=null, transientUrl=null, speechVersion=0, toastTimer=null;
let scene=1, currentLine=0, recorder=null, stream=null, recordContext=null, recordTimer=null, recordStarted=0, recordBusy=false, recordingVersion=0;
let writeIndex=0, strokes=[], activeStroke=null, hinted=false, writeBusy=false, strokeWriter=null;
let quizIndex=0, quizChoice=null, quizAnswers=[];
let chatBusy=false;
const recordings=new Map(), requests=new Set();
const sync=createSyncQueue({
  read:()=>{const list=readStorage(PENDING,[]);return Array.isArray(list)?list:[];},
  write:value=>writeStorage(PENDING,value),
  send:item=>fetch('/api/maanshan-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item),signal:AbortSignal.timeout(12000)})
});
const titleOf=p=>p.id===5 ? '歸園田居·其三' : p.title;
const asset=(name,p=poem)=>`media/${p.slug}/${name}`;
const link=(v='read',p=poem)=>`#${p.slug}/${v}`;
const state=p=>{
  const old=saved[p.id];
  if (!old || typeof old!=='object' || Array.isArray(old)) saved[p.id]={};
  const s=saved[p.id];
  if (!Array.isArray(s.reading)) s.reading=Array(p.lines.length).fill(null);
  if (!Array.isArray(s.writing)) s.writing=[];
  if (!Array.isArray(s.chat)) s.chat=[];
  if (!Array.isArray(s.quiz)) s.quiz=[];
  return s;
};
const persist=()=>writeStorage(STORE,saved);
function queueSection(section,payload,p=poem) {
  persist();
  if (!profile?.id || !profile.name || !profile.grade || !profile.cls) return;
  sync.add({syncId:crypto.randomUUID(),studentId:profile.id,name:profile.name,grade:Number(profile.grade),cls:profile.cls,poemId:p.id,section,payload,queuedAt:Date.now()});
  sync.flush();
}
function toast(text) { clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3800); }
function stopTransient() { speechVersion++; if(transientAudio)transientAudio.pause();transientAudio=null;if(transientUrl)URL.revokeObjectURL(transientUrl);transientUrl=null; }
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
  return `<div class="verse ${extra}" aria-label="${esc(line.text+line.punctuation)}">${Array.from(line.text).map((c,i)=>`<ruby>${esc(c)}<rt>${esc(line.pinyin[i])}</rt></ruby>`).join('')}<span class="punct">${line.punctuation}</span></div>`;
}
function completed(p) {const s=state(p);return [!!s.listened,s.reading.filter(Boolean).length===p.lines.length,s.writing.length===p.dictation.length,s.quiz.length===p.phonics.length];}
function renderLibrary() {
  poem=null;document.title='古詩研習 · 馬鞍山靈糧小學';
  app.innerHTML=`<main class="library" id="main"><div class="library-heading"><div><p class="eyebrow">普通話 · 詩意日常</p><h1>我的古詩書架</h1><p class="library-sub">讀一首詩，走進一幅畫。</p></div><div class="library-count"><div><strong>06</strong><span>首經典古詩</span></div><div><strong>${String(poems.filter(p=>completed(p).every(Boolean)).length).padStart(2,'0')}</strong><span>首完成研習</span></div></div></div><div class="library-toolbar"><div class="filter-tabs" aria-label="年級篩選">${['全部古詩','一、二年級','三、四年級','五、六年級'].map((t,i)=>`<button data-action="filter" data-value="${i}" aria-pressed="${libraryFilter===i}">${t}</button>`).join('')}</div><label class="search">${icon('search')}<input id="poem-search" type="search" placeholder="尋找古詩或詩人" aria-label="尋找古詩或詩人" value="${esc(searchText)}"></label></div><div class="poem-grid" id="poem-grid"></div><footer class="library-footer"><span>馬鞍山靈糧小學 · AIDUCATION</span><a href="credits.html">素材來源 ${icon('arrow-up-right')}</a></footer></main>`;
  renderCards();icons();
  $('#poem-search').addEventListener('input',event=>{searchText=event.target.value;renderCards();});
}
function renderCards() {
  const query=searchText.trim().toLowerCase();
  const selected=poems.filter(p=>(!libraryFilter||Math.ceil(p.grade/2)===libraryFilter)&&`${p.title} ${p.subtitle||''} ${p.author} ${p.authorBio}`.toLowerCase().includes(query));
  $('#poem-grid').innerHTML=selected.map(p=>{
    const done=completed(p), progress=done.filter(Boolean).length;
    return `<article class="poem-card"><a href="${link('read',p)}" aria-label="練習${esc(titleOf(p))}"><div class="poem-art"><img src="${asset('scene-1.webp',p)}" width="1600" height="900" alt="${esc(p.lines[0].text)}" ${p.id>3?'loading="lazy"':'fetchpriority="high"'}><span class="poem-number">${['','一','二','三','四','五','六'][p.grade]}年級</span></div><div class="poem-card-body"><div class="poem-card-title"><h2 class="${titleOf(p).length>5?'long':''}">${esc(titleOf(p))}</h2>${icon('arrow-up-right')}</div><div class="poem-meta"><img src="${asset('avatar.webp',p)}" width="27" height="27" alt="${esc(p.author)}" loading="lazy"><span>${esc(p.dynasty)} · ${esc(p.author)}</span><span class="poem-theme">${esc(p.theme)}</span></div><div class="poem-card-bottom"><span>${progress===4?'已完成研習':progress?`已完成 ${progress} / 4 項`:'開始這一首'}</span><span class="mini-progress" aria-label="已完成${progress}項">${done.map(d=>`<span class="${d?'done':''}"></span>`).join('')}</span></div></div></a></article>`;
  }).join('')||'<p class="empty-search">沒有找到這首詩，試試詩人名字。</p>';icons();
}
const NAV=[['read','book-open','賞讀古詩'],['record','mic','朗讀測評'],['write','pen-line','默寫練習'],['quiz','ear','語音練習'],['chat','messages-square','與詩人對話'],['report','chart-no-axes-combined','學習報告']];
function renderWorkspace() {
  const name=NAV.find(n=>n[0]===view)?.[2]||'';
  document.title=`${titleOf(poem)} · ${name} · AIDUCATION`;
  app.innerHTML=`<div class="workspace"><aside class="sidebar"><a class="back-library" href="#">${icon('arrow-left')}我的古詩書架</a><div class="sidebar-poet"><img src="${asset('avatar.webp')}" width="68" height="68" alt="${esc(poem.author)}"><h2>${esc(titleOf(poem))}</h2><p>${esc(poem.dynasty)} · ${esc(poem.author)}</p></div><nav class="study-nav" aria-label="學習活動">${NAV.map(n=>`<a href="${link(n[0])}" class="${view===n[0]?'active':''}" ${view===n[0]?'aria-current="page"':''}>${icon(n[1])}<span>${n[2]}</span></a>`).join('')}</nav><div class="sidebar-bottom">${poem.grade}年級 · 古詩研習<br>每一遍，都有新發現。</div></aside><main class="study-main" id="main"><div class="breadcrumbs"><a href="#">古詩書架</a>${icon('chevron-right')}<a href="${link()}">${esc(titleOf(poem))}</a>${icon('chevron-right')}<span>${name}</span></div><div class="study-heading ${titleOf(poem).length>6?'long-title':''}"><div><h1>${view==='read'?esc(titleOf(poem)):view==='chat'?`與${esc(poem.author)}對話`:name}</h1><p>${esc(poem.dynasty)} · ${esc(poem.author)}${view==='read'?` · ${esc(poem.theme)}`:` · ${esc(titleOf(poem))}`}</p></div><div class="heading-actions">${view==='read'||view==='record'?`<button class="icon-button" data-action="pinyin" title="${showPinyin?'隱藏':'顯示'}拼音" aria-label="${showPinyin?'隱藏':'顯示'}拼音" aria-pressed="${showPinyin}">${icon('languages')}</button>`:''}${view==='read'?`<a class="button small" href="#">${icon('library')}換一首</a>`:''}</div></div><section id="view" class="view-section ${showPinyin?'':'hide-pinyin'}"></section></main></div>`;
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
  $('#view').innerHTML=`<div class="poem-stage"><div><div class="art-stage" id="reading-art"><img src="${asset(`scene-${scene}.webp`)}" alt="${esc(poem.lines.find(l=>l.scene===scene).text)}" width="1600" height="900"></div><div class="art-caption"><span id="scene-caption">${esc(poem.lines.filter(l=>l.scene===scene).map(l=>l.text).join('，'))}</span><div class="scene-dots" aria-label="畫卷">${[1,2,3,4].map(n=>`<button data-action="scene" data-value="${n}" aria-label="第${n}幅畫卷" title="第${n}幅畫卷" aria-pressed="${scene===n}"></button>`).join('')}</div></div><p class="poem-description">${esc(poem.description)}</p></div><div class="poem-text"><div class="poem-text-title"><div><h2>示範朗讀</h2><p>${esc(poem.author)} · ${poem.lines.length}句</p></div><button class="icon-button" data-action="video" title="看影片" aria-label="看影片">${icon('clapperboard')}</button></div><div class="poem-lines ${poem.lines.length>4?'long':''}">${poem.lines.map(l=>verseHTML(l)).join('')}</div><div class="media-tools"><div class="media-buttons"><button class="button primary" data-action="narration" id="listen-button">${icon('volume-2')}<span>聽朗讀</span></button><button class="button" data-action="video">${icon('play')}看影片</button></div><div class="audio-timeline"><span id="audio-time">0:00</span><input id="audio-seek" type="range" min="0" max="100" value="0" step=".1" aria-label="朗讀進度"><span id="audio-duration">0:00</span><select id="audio-speed" aria-label="朗讀速度"><option value=".75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select></div></div></div></div><div class="study-next"><p><strong>把詩讀給山水聽。</strong><br>${state(poem).reading.filter(Boolean).length?`已完成 ${state(poem).reading.filter(Boolean).length} / ${poem.lines.length} 句朗讀`:'今天，從第一句開始。'}</p><a class="button primary" href="${link('record')}">${icon('mic')}開始朗讀測評 ${icon('arrow-right')}</a></div>`;
  audio.src=asset('narration.m4a');audio.playbackRate=1;
  $('#audio-seek').addEventListener('input',event=>{if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(event.target.value)/100;});
  $('#audio-speed').addEventListener('change',event=>{audio.playbackRate=Number(event.target.value);});
}
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
  stopMedia();$('#video-error').hidden=true;
  $('#video-title').textContent=`${poem.author} · ${titleOf(poem)}`;
  video.src=asset('recital.mp4');video.poster=asset('poster.webp');video.currentTime=0;
  $('#video-dialog').showModal();
  try{await video.play();}catch{ /* Native controls remain available after autoplay restrictions. */ }
}
async function speak(text,context='') {
  stopMedia();const version=speechVersion;const route=routeVersion;
  try {
    const response=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:context||text,voice:101015,speed:-.15}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('TTS');const blob=await response.blob();
    if(version!==speechVersion||route!==routeVersion)return;
    transientUrl=URL.createObjectURL(blob);transientAudio=new Audio(transientUrl);await transientAudio.play();
  } catch {if(version===speechVersion&&route===routeVersion)toast('語音暫時無法播放，請稍後重試。');}
}
function reveal(n) {
  scene=n;const element=$('#reading-art');
  if(element){element.innerHTML=`<img src="${asset(`scene-${n}.webp`)}" width="1600" height="900" alt="${esc(poem.lines.find(l=>l.scene===n).text)}">`;$('#scene-caption').textContent=poem.lines.filter(l=>l.scene===n).map(l=>l.text).join('，');document.querySelectorAll('[data-action="scene"]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.value)===n));}
}
function renderRecord() {
  const s=state(poem),line=poem.lines[currentLine],result=s.reading[currentLine],latest=s.reading.reduce((a,r,i)=>r?i:a,-1);
  const displayed=result?currentLine:latest;
  const sceneNumber=displayed>=0?poem.lines[displayed].scene:1;
  $('#view').innerHTML=`<div class="record-layout"><div><div class="record-art ${latest<0?'locked':''}"><img src="${asset(`scene-${sceneNumber}.webp`)}" width="1600" height="900" alt="${latest>=0?esc(poem.lines[latest].text):'古詩畫卷'}">${latest<0?`<div class="art-lock">${icon('scroll-text')}第一幅畫卷，等你讀出來</div>`:''}</div><div class="verse-list">${poem.lines.map((l,i)=>`<button class="verse-list-item ${i===currentLine?'current':''}" data-action="record-line" data-value="${i}" ${recordBusy?'disabled':''}><span>${String(i+1).padStart(2,'0')}</span><span class="line-text">${esc(l.text)}</span>${s.reading[i]?`<span class="line-score">${s.reading[i].total_score}分</span>${icon('check')}`:icon('circle')}</button>`).join('')}</div></div><div><div class="record-tool"><div class="record-counter"><span>第 ${currentLine+1} / ${poem.lines.length} 句</span><button class="icon-button small" data-action="line-tts" title="聽這一句" aria-label="聽這一句" ${recordBusy?'disabled':''}>${icon('volume-2')}</button></div>${verseHTML(line,'active')}<div id="record-controls">${result?`<div class="record-result">${result.total_score}<small>分</small></div><p class="record-status">${esc(result.grade)}</p><div class="record-actions"><button class="icon-button" data-action="replay" data-value="${currentLine}" title="回聽錄音" aria-label="回聽錄音" ${recordings.has(`${poem.id}-${currentLine}`)?'':'disabled'}>${icon('headphones')}</button><button class="button" data-action="record-start">${icon('rotate-ccw')}再讀一次</button><button class="button primary" data-action="record-next">${currentLine===poem.lines.length-1?'查看報告':'下一句'}${icon('arrow-right')}</button></div>`:`<div class="record-wave" id="record-wave">${'<span></span>'.repeat(19)}</div><div class="record-actions"><button class="mic-button" data-action="record-start" aria-label="開始錄音" title="開始錄音">${icon('mic')}</button></div><p class="record-status" id="record-status">準備好，就開始朗讀吧。</p>`}</div></div><div class="record-bottom"><a class="text-button" href="${link('report')}">學習報告 ${icon('arrow-right')}</a></div><p class="saved-note">已完成的分數會保存在此裝置。</p></div></div>`;icons();
}
async function startRecording() {
  if(recordBusy)return;stopMedia();cancelRecording();recordBusy=true;
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
    controls.innerHTML=`<div class="record-wave live">${'<span></span>'.repeat(19)}</div><div class="record-actions"><button class="mic-button recording" data-action="record-stop" aria-label="完成錄音" title="完成錄音">${icon('square')}</button></div><p class="record-status" id="record-status">錄音中 · 0:00</p>`;icons();
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
    recordings.set(`${p.id}-${index}`,blob);const encoded=await wavBase64(blob,context);
    if(!isCurrent())return;
    const raw=await api('/api/soe',{audio:encoded,refText:p.lines[index].simplified},26000);
    if(!isCurrent())return;
    const result=mapAssessment(raw,p.lines[index]);const s=state(p);s.reading[index]=result;s.report='';s.updatedAt=Date.now();
    const merged=mergeAssessments(s.reading);
    queueSection('reading',{lineIdx:index,lineScore:result.total_score,totalScore:merged.total_score,linesCompleted:s.reading.filter(Boolean).length,words:merged.words,phonics:{},updatedAt:new Date().toISOString()},p);
    toast('這一句完成了，畫卷已展開。');
  } catch(error) {if(isCurrent())toast(error.name==='AbortError'?'這次等得有點久，請再試一次。':error.message);}
  finally {if(isCurrent()){cancelRecording();renderRecord();}}
}
function replay(index){const blob=recordings.get(`${poem.id}-${index}`);if(!blob){toast('這段錄音只保留在本次開啟的頁面。');return;}stopMedia();transientUrl=URL.createObjectURL(blob);transientAudio=new Audio(transientUrl);transientAudio.play().catch(()=>toast('錄音暫時無法播放。'));}
function renderReport() {
  const s=state(poem),result=mergeAssessments(s.reading);
  if(!result){$('#view').innerHTML=`<div class="report-empty">${icon('notebook-pen')}<h2>你的第一份朗讀報告</h2><a class="button primary" href="${link('record')}">${icon('mic')}開始朗讀</a></div>`;return;}
  const keys=[['phone_score','發音準確度'],['fluency_score','流暢度'],['integrity_score','完整度']];
  $('#view').innerHTML=`<div class="report-summary"><div class="score-ring" style="--score:${result.total_score}"><div><strong>${result.total_score}</strong><span>${esc(result.grade)}</span></div></div><div><p class="eyebrow">${s.reading.filter(Boolean).length} / ${poem.lines.length} 句已完成</p><div class="dimension-grid">${keys.map(([k,label])=>`<div class="dimension"><strong>${result.dimensions[k]??'—'}</strong><span>${label}</span><div class="dimension-bar"><i style="width:${result.dimensions[k]??0}%"></i></div></div>`).join('')}</div><p class="saved-note">${s.reading.filter(Boolean).length<poem.lines.length?'這是已完成詩句的成績。':'每一遍朗讀，都是新的進步。'}</p></div></div><div class="report-grid"><div><h2 class="panel-title">逐字小回顧</h2><div class="word-grid">${result.words.map(w=>`<button class="word-result ${w.status}" data-action="word-tts" data-value="${esc(w.c)}" title="聽「${esc(w.c)}」的讀音"><ruby>${esc(w.c)}<rt>${esc(w.p)}</rt></ruby><strong>${w.score??'—'}</strong></button>`).join('')||'<p class="muted">這次評測未提供逐字分數。</p>'}</div><div class="report-replay">${poem.lines.map((_,i)=>`<button class="button small" data-action="replay" data-value="${i}" ${recordings.has(`${poem.id}-${i}`)?'':'disabled'}>${icon('headphones')}第${i+1}句</button>`).join('')}</div></div><div><div class="ai-report-header"><h2>給你的小建議</h2><button class="button small" data-action="report-generate" id="report-button">${icon('sparkles')}${s.report?'重新生成':'生成建議'}</button></div><div id="report-prose" class="report-prose">${esc(s.report||'完成朗讀後，看看哪些字還可以讀得更好。')}</div></div></div><div class="study-next"><p>成績已保存在此裝置。</p><a class="button primary" href="${link('write')}">${icon('pen-line')}默寫練習 ${icon('arrow-right')}</a></div>`;icons();
}
async function generateReport() {
  const button=$('#report-button');if(button.disabled)return;button.disabled=true;const version=routeVersion,p=poem;const result=mergeAssessments(state(p).reading);
  $('#report-prose').innerHTML='<span class="spinner"></span> 正在整理你的朗讀建議';
  try{const data=await api('/api/maanshan-report',{poemId:p.id,soeResult:{...result,words:result.words.filter(w=>Number.isFinite(w.score))}});if(version!==routeVersion)return;if(!data.report)throw new Error('建議尚未生成，請稍後再試。');state(p).report=data.report;queueSection('report',{content:data.report,totalScore:result.total_score,grade:result.grade},p);$('#report-prose').textContent=data.report;}
  catch(error){if(version===routeVersion)$('#report-prose').textContent=error.name==='AbortError'?'生成時間較長，請稍後再試。':error.message;}
  finally{if(version===routeVersion)button.disabled=false;}
}
function renderWriting() {
  const results=state(poem).writing;
  if(writeIndex>=poem.dictation.length){const correct=results.filter(r=>r.correct&&!r.hinted).length;$('#view').innerHTML=`<div class="completion">${icon('award')}<h2>今天的默寫完成了</h2><p>${correct} / ${poem.dictation.length} 個字獨立完成</p><div class="completion-actions"><button class="button" data-action="write-reset">${icon('rotate-ccw')}再練一次</button><a class="button primary" href="${link('quiz')}">${icon('ear')}語音練習</a></div><div class="practice-results">${results.map(r=>`<span class="result-chip ${r.correct&&!r.hinted?'':'wrong'}">${esc(r.char)}</span>`).join('')}</div></div>`;icons();return;}
  const item=poem.dictation[writeIndex];
  $('#view').innerHTML=`<div class="writing-layout"><div class="writing-context"><div class="art-stage"><img src="${asset(`scene-${Math.min(4,1+Math.floor(writeIndex/3))}.webp`)}" width="1600" height="900" alt="${esc(poem.title)}畫卷"></div><h2>聽見詩，也寫下詩。</h2><p>${esc(poem.description)}</p><div class="practice-results">${results.map(r=>`<span class="result-chip ${r.correct&&!r.hinted?'':'wrong'}">${esc(r.char)}</span>`).join('')}</div></div><div class="writing-tool"><div class="writing-toolbar"><div><span class="writing-pinyin">${esc(item.pinyin)}</span><p class="writing-counter">第 ${writeIndex+1} / ${poem.dictation.length} 字</p></div><button class="icon-button" data-action="write-speak" title="聽默寫字詞" aria-label="聽默寫字詞">${icon('volume-2')}</button></div><div class="writing-board"><div id="writing-hint" class="writing-hint"></div><div id="stroke-hint" class="stroke-hint" hidden></div><canvas id="writing-canvas" width="560" height="560" aria-label="手寫答題區"></canvas></div><div class="writing-controls"><div class="writing-tools"><button class="icon-button" data-action="write-undo" aria-label="撤銷上一筆" title="撤銷上一筆">${icon('undo-2')}</button><button class="icon-button" data-action="write-clear" aria-label="清空" title="清空">${icon('eraser')}</button><button class="icon-button" data-action="write-hint" aria-label="看看這個字" title="看看這個字">${icon('eye')}</button><button class="icon-button" data-action="stroke-hint" aria-label="看筆順" title="${item.char==='峯'?'暫無此字筆順':'看筆順'}" ${item.char==='峯'?'disabled':''}>${icon('pencil-ruler')}</button></div><button class="button primary" data-action="write-check" id="write-check">${icon('check')}寫好了</button></div><p id="writing-feedback" class="writing-feedback" role="status">${hinted?'這個字已看過提示。':''}</p><button class="text-button" data-action="write-skip">稍後再練這個字 ${icon('arrow-right')}</button></div></div>`;
  strokes=[];activeStroke=null;writeBusy=false;strokeWriter=null;bindCanvas();icons();
}
function bindCanvas() {
  const canvas=$('#writing-canvas');if(!canvas)return;
  const point=event=>{const box=canvas.getBoundingClientRect();return {x:clamp((event.clientX-box.left)*560/box.width,0,560),y:clamp((event.clientY-box.top)*560/box.height,0,560),t:Date.now()};};
  canvas.addEventListener('pointerdown',event=>{if(writeBusy||event.button>0||activeStroke)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);activeStroke=[point(event)];drawCanvas();});
  canvas.addEventListener('pointermove',event=>{if(!activeStroke)return;event.preventDefault();activeStroke.push(point(event));drawCanvas();});
  const finish=event=>{if(!activeStroke)return;event.preventDefault();strokes.push(activeStroke);activeStroke=null;drawCanvas();};
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
}
function drawCanvas() {
  const canvas=$('#writing-canvas');if(!canvas)return;const c=canvas.getContext('2d');c.clearRect(0,0,560,560);c.strokeStyle='#233d32';c.fillStyle='#233d32';c.lineWidth=10;c.lineCap='round';c.lineJoin='round';
  [...strokes,...(activeStroke?[activeStroke]:[])].forEach(points=>{
    if(points.length===1){c.beginPath();c.arc(points[0].x,points[0].y,5,0,Math.PI*2);c.fill();return;}
    c.beginPath();c.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length-1;i++){const p=points[i],n=points[i+1];c.quadraticCurveTo(p.x,p.y,(p.x+n.x)/2,(p.y+n.y)/2);}c.lineTo(points.at(-1).x,points.at(-1).y);c.stroke();
  });
}
function writingSpeech(){const item=poem.dictation[writeIndex];speak(item.char,`${item.word}，${item.word}的${item.char}。`);}
async function showStrokeHint() {
  const target=poem.dictation[writeIndex].char,version=routeVersion,index=writeIndex;hinted=true;const holder=$('#stroke-hint');holder.hidden=false;holder.innerHTML='';
  try{
    if(!window.HanziWriter)throw new Error('unavailable');
    const response=await fetch(`vendor/hanzi-data/${target.codePointAt(0).toString(16)}.json`);if(!response.ok)throw new Error('missing');const data=await response.json();if(version!==routeVersion||index!==writeIndex)return;
    strokeWriter=HanziWriter.create(holder,target,{width:560,height:560,padding:45,showCharacter:false,showOutline:true,strokeColor:'#176759',outlineColor:'#e1eae4',strokeAnimationSpeed:1,delayBetweenStrokes:180,charDataLoader:(_char,onLoad)=>onLoad(data)});
    const svg=holder.querySelector('svg');if(svg){svg.setAttribute('viewBox','0 0 560 560');svg.setAttribute('preserveAspectRatio','xMidYMid meet');}
    await strokeWriter.animateCharacter();if(version===routeVersion&&index===writeIndex){setTimeout(()=>{if(holder.isConnected)holder.hidden=true;},1000);$('#writing-feedback').textContent='看過筆順了，現在試着自己寫一次。';}
  }catch{if(holder.isConnected){holder.hidden=true;$('#writing-hint').textContent=target;$('#writing-feedback').textContent='這個字的筆順暫時無法播放。';}}
}
async function checkWriting() {
  if(writeBusy)return;if(!strokes.length){$('#writing-feedback').textContent='先在田字格寫下你的答案。';return;}
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
  routeVersion++;stopMedia();cancelRecording();requests.forEach(c=>c.abort());requests.clear();chatBusy=false;writeBusy=false;
  clearTimeout(toastTimer);$('#toast').classList.remove('visible');
  if($('#video-dialog').open)$('#video-dialog').close();
  let parts;try{parts=decodeURIComponent(location.hash.slice(1)).split('/');}catch{parts=[];}
  const next=poems.find(p=>p.slug===parts[0]);
  if(!next){renderLibrary();window.scrollTo({top:0});return;}
  const changed=poem?.id!==next.id;poem=next;view=NAV.some(n=>n[0]===parts[1])?parts[1]:'read';
  if(changed){scene=1;currentLine=Math.max(0,state(poem).reading.findIndex(r=>!r));}
  if(view==='write'){writeIndex=state(poem).writing.length;hinted=false;}
  if(view==='quiz'){quizAnswers=[...state(poem).quiz];quizIndex=quizAnswers.length;quizChoice=null;}
  renderWorkspace();window.scrollTo({top:0});
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action,value=button.dataset.value;
  if(action==='filter'){libraryFilter=Number(value);renderLibrary();return;}
  if(!poem)return;
  if(action==='pinyin'){showPinyin=!showPinyin;$('#view').classList.toggle('hide-pinyin',!showPinyin);button.setAttribute('aria-pressed',showPinyin);button.setAttribute('aria-label',showPinyin?'隱藏拼音':'顯示拼音');button.title=showPinyin?'隱藏拼音':'顯示拼音';}
  if(action==='scene')reveal(Number(value));
  if(action==='narration')playNarration();
  if(action==='video')openVideo();
  if(action==='line-tts'&&!recordBusy)speak(poem.lines[currentLine].text);
  if(action==='word-tts')speak(value);
  if(action==='record-start')startRecording();
  if(action==='record-stop')stopRecording();
  if(action==='record-line'&&!recordBusy){currentLine=Number(value);stopMedia();renderRecord();}
  if(action==='record-next'){if(currentLine<poem.lines.length-1){currentLine++;renderRecord();}else location.hash=link('report');}
  if(action==='replay')replay(Number(value));
  if(action==='report-generate')generateReport();
  if(action==='write-speak')writingSpeech();
  if(action==='write-clear'&&!writeBusy){strokes=[];activeStroke=null;drawCanvas();}
  if(action==='write-undo'&&!writeBusy){strokes.pop();drawCanvas();}
  if(action==='write-hint'&&!writeBusy){hinted=true;$('#writing-hint').textContent=poem.dictation[writeIndex].char;$('#writing-feedback').textContent='看過提示後完成，會記作練習。';}
  if(action==='stroke-hint'&&!writeBusy)showStrokeHint();
  if(action==='write-check')checkWriting();
  if(action==='write-skip'&&!writeBusy)completeWriting(false);
  if(action==='write-reset'){state(poem).writing=[];persist();writeIndex=0;hinted=false;renderWriting();}
  if(action==='quiz-answer'&&quizChoice===null){quizChoice=Number(value);renderQuiz();}
  if(action==='quiz-next'&&quizChoice!==null){quizAnswers[quizIndex]=quizChoice;state(poem).quiz=[...quizAnswers];persist();quizIndex++;quizChoice=null;renderQuiz();}
  if(action==='quiz-reset'){state(poem).quiz=[];persist();quizAnswers=[];quizIndex=0;quizChoice=null;renderQuiz();}
  if(action==='chat-suggestion')sendChat(poem.suggestions[Number(value)]);
  if(action==='chat-speak'){const message=state(poem).chat[Number(value)];if(message)speak(message.content);}
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
$('#profile-open').addEventListener('click',()=>{const form=$('#profile-form');form.elements.name.value=profile?.name||'';form.elements.grade.value=profile?.grade||poem?.grade||2;form.elements.cls.value=profile?.cls||'A';$('#profile-dialog').showModal();});
$('#profile-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;const name=form.elements.name.value.trim();if(!name)return;profile={id:profile?.id||`S${crypto.randomUUID().replaceAll('-','').slice(0,30)}`,name,grade:Number(form.elements.grade.value),cls:form.elements.cls.value};writeStorage(PROFILE,profile);$('#profile-name').textContent=profile.name;$('#profile-dialog').close();toast('學習檔案已儲存。');});
if(profile?.name)$('#profile-name').textContent=profile.name;
$('.skip-link').addEventListener('click',event=>{event.preventDefault();const main=$('#main');if(main){main.tabIndex=-1;main.focus();}});
window.addEventListener('hashchange',route);window.addEventListener('online',()=>sync.flush());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){stopMedia();cancelRecording();if(poem&&view==='record')renderRecord();}else sync.flush();});
window.addEventListener('pagehide',()=>{stopMedia();cancelRecording();persist();});
async function init(){try{const response=await fetch('poems.json?v=20260908');if(!response.ok)throw new Error('catalog');const data=await response.json();poems=data.poems;if(!Array.isArray(poems)||!poems.length)throw new Error('catalog');route();sync.flush();icons();}catch{app.innerHTML='<main id="main" class="loading-page"><p>古詩暫時未能載入。</p><button class="button" onclick="location.reload()">重新載入</button></main>';}}
init();
