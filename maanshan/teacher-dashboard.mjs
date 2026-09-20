import {TERMS_VERSION,termsConfirmationMarkup,bindTermsConfirmation} from './platform-terms.mjs?v=20260921-school6';
const DEMO=location.pathname.endsWith('/teacher-demo.html');
const AUTH='/api/school-auth',ANALYTICS=DEMO?'/api/teacher-tools?tool=demo-data&kind=analytics':'/api/teacher-analytics';
const analyticsQuery=params=>ANALYTICS+(DEMO?'&':'?')+params;
const root=document.querySelector('#teacher-root'),dialog=document.querySelector('#student-dialog');
const state={auth:null,legacy:false,legacyCode:'',roster:null,rosterError:false,data:null,poems:[],view:'overview',search:'',page:0,generation:0,request:null,detailRequest:null,detailStudent:null,filters:{grade:'',poemId:'',cls:'',from:dayOffset(-29),to:dayOffset(0),attempt:'latest',activity:''},scopeCache:new Map()};
Object.assign(state,{studentFilter:'all',constructFilter:'',detailTab:'learning',detailData:null,exportJob:null});
Object.assign(state,{assistantJob:null,assistantReport:null,documentJob:null,toolsPreparing:false,rosterGeneration:0});
const ASSISTANT='/api/teacher-tools?tool='+(DEMO?'demo-analysis':'analysis'),DOCUMENTS='/api/teacher-tools?tool='+(DEMO?'demo-export':'export');
const CONSTRUCTS={'reading.pronunciation':'朗讀發音','writing.dictation':'聽寫辨字','sound.recognition':'字音辨認'};
const pendingRequests=new Set();let sessionEpoch=0,sessionCheck=null;
const legacyHost=['aiducation.asia','www.aiducation.asia'].includes(location.hostname)||/^aiducation-website(?:-[a-z0-9-]+)?\.vercel\.app$/.test(location.hostname);
const sessionChannel=globalThis.BroadcastChannel?new BroadcastChannel('maanshan-school-session'):null;
function broadcastSession(kind){sessionChannel?.postMessage({kind});}
const ICONS={overview:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',students:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',quality:'<path d="M6 3h12v18H6zM9 7h6M9 11h6m-6 4h3"/>',refresh:'<path d="M20 7a8 8 0 1 0 0 10M20 3v5h-5"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',empty:'<path d="M4 6h16v14H4zM8 3v6m8-6v6M8 13h8m-8 3h4"/>'};
function icon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||ICONS.empty}</svg>`;}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function number(value){return typeof value==='number'&&Number.isFinite(value)?value:null;}
function score(value){const n=number(value);return n!==null&&n>=0&&n<=100?n:null;}
function shown(value,digits=0){return number(value)===null?'—':value.toLocaleString('zh-HK',{maximumFractionDigits:digits});}
function characterScore(value){return value<80&&Math.round(value*10)/10>=80?shown(Math.floor(value*100)/100,2):shown(value,1);}
function scoreMarkup(value){const n=score(value);return `<span class="score${n===null?' missing':''}">${n===null?'未測':shown(n,1)}</span>`;}
function mean(values){const valid=values.filter(v=>number(v)!==null);return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;}
function dayOffset(offset){const date=new Date();date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
function timestamp(value,short=false){if(!value||!Number.isFinite(new Date(value).getTime()))return '尚未同步';return new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',month:'2-digit',day:'2-digit',...(short?{}:{hour:'2-digit',minute:'2-digit'}),hour12:false}).format(new Date(value));}
function empty(title,note=''){return `<div class="empty"><span class="empty-icon">${icon('empty')}</span><strong>${esc(title)}</strong>${esc(note)}</div>`;}
function toast(message){const el=document.querySelector('#teacher-notice');el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>{el.hidden=true;},4500);}
function selectionQuery(extra={}){const q=new URLSearchParams();for(const [key,value]of Object.entries({...state.filters,...extra}))if(value!==''&&value!==null&&value!==undefined)q.set(key,String(value));return q;}
async function requestJSON(url,{signal,headers={},timeoutMs=25000,...options}={}){
 const controller=new AbortController(),epoch=sessionEpoch,abort=()=>controller.abort();pendingRequests.add(controller);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timeout=setTimeout(abort,timeoutMs);
 try{const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...headers},signal:controller.signal});
  let data=null;try{data=await response.json();}catch{}
  if(epoch!==sessionEpoch||controller.signal.aborted)throw new DOMException('Session request cancelled','AbortError');
  if(!response.ok){const error=new Error(data?.error||'讀取未完成');error.status=response.status;error.code=data?.code;error.retryAfterSeconds=data?.retryAfterSeconds;throw error;}
  if(!data||typeof data!=='object')throw new Error('回應格式不完整');return data;
 }finally{pendingRequests.delete(controller);clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
function clearPrivate(){state.scopeCache.clear();clearTeacherTools();state.exportJob?.controller.abort();state.exportJob=null;state.detailData=null;state.studentsOpen=false;state.studentFilter='all';state.constructFilter='';sessionEpoch++;for(const controller of pendingRequests)controller.abort();pendingRequests.clear();sessionCheck=null;state.request?.abort();state.detailRequest?.abort();state.generation++;state.data=null;state.roster=null;state.rosterError=false;state.auth=null;state.legacyCode='';state.search='';state.page=0;state.detailStudent=null;if(dialog.open)dialog.close();document.querySelector('#student-dialog-content').replaceChildren();const identity=document.querySelector('#teacher-identity');identity.textContent='';identity.hidden=true;document.querySelector('#teacher-logout').hidden=true;document.querySelector('#teacher-change-password')?.remove();}
function lockSession(){clearPrivate();state.legacy=false;renderLogin('帳戶已登出或在另一個分頁切換，請重新登入。');}
function validateAuth(auth){if(typeof auth.enabled!=='boolean'||location.hostname==='mandarin.aiducation.asia'&&!auth.enabled||auth.authenticated&&(!auth.user?.id||!['student','teacher'].includes(auth.user.role)||typeof auth.csrfToken!=='string'||!auth.csrfToken))throw new Error('帳戶服務回覆不完整');return auth;}
async function checkSession(){
 if(state.legacy||!state.auth||sessionCheck)return sessionCheck;
 const epoch=sessionEpoch,previous=state.auth;
 sessionCheck=(async()=>{try{const next=validateAuth(await requestJSON(AUTH));if(epoch!==sessionEpoch)return;if(!next.enabled||!next.authenticated||next.user?.id!==previous.user.id||next.user?.role!==previous.user.role||next.csrfToken!==previous.csrfToken)lockSession();}catch{if(epoch===sessionEpoch)lockSession();}finally{if(epoch===sessionEpoch)sessionCheck=null;}})();
 return sessionCheck;
}
sessionChannel?.addEventListener('message',event=>{if(!state.legacy&&['signed-in','signed-out','session-changing','password-changed'].includes(event.data?.kind))lockSession();});
function updateIdentity(){const el=document.querySelector('#teacher-identity');el.textContent=state.legacy?'舊版班級紀錄':state.auth?.user?.displayName||'教師';el.hidden=false;document.querySelector('#teacher-logout').hidden=false;if(!state.legacy&&state.auth?.user?.role==='teacher'&&!document.querySelector('#teacher-change-password')){const button=document.createElement('button');button.id='teacher-change-password';button.type='button';button.className='button quiet';button.textContent='修改密碼';button.addEventListener('click',showPasswordChange);el.after(button);}}
function renderLogin(message='',success=false){
 root.innerHTML=`<main id="teacher-main" class="login-layout"><section class="login-card" aria-labelledby="login-title"><h1 id="login-title">教師登入</h1><form id="teacher-login-form" class="login-form">${state.legacy?'':`<label class="field" for="teacher-login">登入名稱<input id="teacher-login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="128" required></label>`}<label class="field" for="teacher-password">${state.legacy?'教師存取碼':'登入密碼'}<input id="teacher-password" name="password" type="password" autocomplete="${state.legacy?'off':'current-password'}" maxlength="512" required></label>${termsConfirmationMarkup('teacher-terms')}<p id="login-error" class="form-error" role="alert" ${message?'':'hidden'}>${esc(message)}</p><button class="button primary" type="submit">登入</button></form></section></main>`;
 bindTermsConfirmation(document.querySelector('#teacher-login-form'));
 if(success)document.querySelector('#login-error').classList.add('success');
}
async function boot(){
 clearPrivate();state.legacy=false;const epoch=sessionEpoch;
 try{const auth=validateAuth(await requestJSON(AUTH));if(epoch!==sessionEpoch)return;state.legacy=auth.enabled===false;
  if(state.legacy){renderLogin();return;}
  if(!auth.authenticated){renderLogin();return;}
  state.auth=auth;if(auth.user?.role!=='teacher'){renderStudentAccount();return;}
  await enterDashboard();
 }catch(error){if(epoch!==sessionEpoch)return;if(error.status===404&&legacyHost){state.legacy=true;renderLogin();}else renderBootError();}
}
function renderBootError(){root.innerHTML=`<main id="teacher-main" class="initial-state"><h1>暫時未能連接教師後台</h1><p>請重新載入。學習資料不會因這次連線中斷而被清除。</p><button class="button primary" data-action="boot">重新連接</button></main>`;}
function renderStudentAccount(){updateIdentity();root.innerHTML=`<main id="teacher-main" class="initial-state"><h1>這是學生帳戶</h1><p>教師後台需要學校教師帳戶。</p><button class="button primary" data-action="logout">登出並更換帳戶</button><a href="./">返回學生平台</a></main>`;}
async function login(form){
 if(!form.reportValidity())return;
 const button=form.querySelector('button'),password=form.elements.password.value,loginName=form.elements.login?.value.trim(),termsAccepted=form.elements.termsAccepted.checked;button.disabled=true;const errorEl=document.querySelector('#login-error');errorEl.hidden=true;
 clearPrivate();const epoch=sessionEpoch;
 try{
  if(state.legacy){state.legacyCode=password;state.filters.grade='1';state.filters.cls='A';await enterDashboard();return;}
  broadcastSession('session-changing');
  const auth=validateAuth(await requestJSON(AUTH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',login:loginName,password,termsAccepted,termsVersion:TERMS_VERSION})}));
  if(epoch!==sessionEpoch)return;state.auth=auth;if(!auth.authenticated)throw new Error('未能確認登入');broadcastSession('signed-in');if(auth.user?.role!=='teacher'){renderStudentAccount();return;}await enterDashboard();
 }catch(error){if(epoch!==sessionEpoch)return;clearPrivate();renderLogin(['TERMS_REQUIRED','TERMS_VERSION_CHANGED'].includes(error.code)?'請閱讀並同意最新的平台服務協議，再登入。':error.status===401?'登入名稱或密碼不正確，請再試一次。':error.status===429?'登入嘗試較多，請稍候再試。':'暫時未能登入，請稍後再試。');}
 finally{form.elements.password.value='';button.disabled=false;}
}
async function logout(){
 const csrf=state.auth?.csrfToken,isLegacy=state.legacy,epoch=sessionEpoch;
 if(isLegacy){clearPrivate();renderLogin();return;}
 try{await requestJSON(AUTH,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf||''},body:JSON.stringify({action:'logout'})});if(epoch!==sessionEpoch)return;broadcastSession('signed-out');clearPrivate();renderLogin();}
 catch(error){if(epoch!==sessionEpoch)return;if(error.status===401){broadcastSession('signed-out');clearPrivate();renderLogin();}else toast('登出尚未完成，請檢查連線後再試。');}
}
async function enterDashboard(){
 updateIdentity();renderShell();
 if(state.legacy){try{state.poems=(await requestJSON('./poems.json')).poems||[];}catch{state.poems=[];}renderFilters();await loadData();return;}
 const generation=++state.rosterGeneration,epoch=sessionEpoch;
 const current=()=>generation===state.rosterGeneration&&epoch===sessionEpoch;
 try{const [roster,catalog]=await Promise.all([requestJSON(DEMO?'/api/teacher-tools?tool=demo-data&kind=roster':AUTH+'?action=roster'),state.poems.length?Promise.resolve(null):requestJSON('./poems.json').catch(()=>null)]);if(!current())return;if(!Array.isArray(roster.students))throw new Error('名冊回覆不完整');state.roster=roster.students;state.rosterError=false;if(Array.isArray(catalog?.poems))state.poems=catalog.poems;}
 catch(error){if(!current())return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}state.rosterError=true;state.roster=null;}
 if(!current())return;renderFilters();await loadData();
}
function renderShell(){
 root.innerHTML=`<main class="teacher-main workspace" id="teacher-main"><section class="cohort-panel" aria-labelledby="view-title"><div class="teacher-controls"><div id="filter-holder"></div></div><div class="cohort-content"><div class="scope-line"><h1 id="view-title">${esc(scopeLabel())}</h1><div class="scope-actions"><span id="sync-state" class="sync-state" role="status"></span><button type="button" class="button quiet" data-action="refresh" aria-label="更新學生資料">${icon('refresh')}更新</button></div></div><div id="dashboard-content"></div></div></section><div id="teacher-tools" class="downloads-panel"></div></main>`;renderFilters();renderTeacherTools();
}
function renderFilters(){
 const f=state.filters,classes=[...new Set((state.roster||[]).filter(s=>!f.grade||String(s.grade)===f.grade).map(s=>String(s.cls||'')))].filter(Boolean).sort();
 const poems=state.poems.filter(poem=>String(poem.grade)===f.grade);
 if(state.legacy&&!classes.length)classes.push('A','B','C','D','E','F');
 const holder=document.querySelector('#filter-holder');if(!holder)return;
 const focused=holder.contains(document.activeElement)?document.activeElement:null;
 holder.innerHTML=`<form class="filters" id="teacher-filters"><label class="field" for="filter-grade">年級<select id="filter-grade" name="grade"><option value="">選擇年級</option>${[1,2,3,4,5,6].map(g=>`<option value="${g}" ${f.grade===String(g)?'selected':''}>${g} 年級</option>`).join('')}</select></label><label class="field" for="filter-poem">古詩<select id="filter-poem" name="poemId" ${!f.grade||!poems.length?'disabled':''}><option value="">${f.grade?'選擇古詩':'先選年級'}</option>${poems.map(p=>`<option value="${p.id}" ${f.poemId===String(p.id)?'selected':''}>${esc(p.title)}</option>`).join('')}</select></label><label class="field" for="filter-class">班級<select id="filter-class" name="cls" ${scopeReady()?'':'disabled'}><option value="">${scopeReady()?'全部班級':'先選古詩'}</option>${classes.map(c=>`<option value="${esc(c)}" ${f.cls===c?'selected':''}>${esc(c)} 班</option>`).join('')}</select></label><div class="date-presets"><span class="field-label">日期</span><div role="group" aria-label="日期範圍">${[[-6,'近 7 天'],[-29,'近 30 天']].map(([offset,label])=>`<button class="date-preset" type="button" data-date-offset="${offset}" aria-pressed="${f.from===dayOffset(offset)&&f.to===dayOffset(0)}" ${state.legacy?'disabled':''}>${label}</button>`).join('')}</div></div>${['from','to','attempt','activity'].map(key=>`<input type="hidden" name="${key}" value="${esc(f[key])}">`).join('')}</form>`;
 if(focused?.id)document.getElementById(focused.id)?.focus({preventScroll:true});
 else if(focused?.dataset.dateOffset!==undefined)holder.querySelector('[data-date-offset="'+focused.dataset.dateOffset+'"]')?.focus({preventScroll:true});
}
function draftFilters(){const form=document.querySelector('#teacher-filters'),next={...state.filters};if(form)for(const key of ['grade','poemId','cls','from','to','attempt','activity'])if(form.elements[key]&&!form.elements[key].disabled)next[key]=form.elements[key].value;return next;}
function markFilterDraft(){const draft=draftFilters();if(filterKey(draft)!==filterKey(state.filters))void applyFilters(draft);}
async function applyFilters(next){if(!state.legacy&&!rangeValid(next)){const detail=document.querySelector('.filter-details');if(detail)detail.open=true;toast('請選擇有效日期，開始至結束日期最多 31 天。');return false;}if(filterKey(next)!==filterKey(state.filters))clearTeacherTools();state.filters=next;state.search='';state.studentFilter='all';state.constructFilter='';state.studentsOpen=false;renderFilters();renderTeacherTools();await loadData();return !!state.data;}
function selectedPoem(filters=state.filters){return state.poems.find(poem=>String(poem.grade)===String(filters.grade)&&String(poem.id)===String(filters.poemId));}
function scopeReady(filters=state.filters){return !!selectedPoem(filters);}
function scopeLabel(){const poem=selectedPoem();return state.filters.grade?`${state.filters.grade} 年級${poem?' · '+poem.title:''}${state.filters.cls?' · '+state.filters.cls+' 班':''}`:'選擇年級與古詩';}
function rangeValid(f=state.filters){const a=new Date(f.from+'T00:00:00Z'),b=new Date(f.to+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(f.from)&&/^\d{4}-\d{2}-\d{2}$/.test(f.to)&&Number.isFinite(a.getTime())&&Number.isFinite(b.getTime())&&a.toISOString().slice(0,10)===f.from&&b.toISOString().slice(0,10)===f.to&&b>=a&&(b-a)/86400000<31;}
async function loadData({force=false}={}){
 const generation=++state.generation;state.detailRequest?.abort();state.detailStudent=null;state.detailData=null;if(dialog.open)dialog.close();state.request?.abort();const controller=new AbortController();state.request=controller;state.data=null;state.page=0;
 const host=document.querySelector('#dashboard-content');if(!host)return;document.querySelector('#view-title').textContent=scopeLabel();document.querySelector('#sync-state').textContent='';
 renderTeacherTools();
 if(!scopeReady()){host.innerHTML=empty(state.filters.grade?'請選擇一首古詩':'請先選擇年級');state.request=null;renderTeacherTools();return;}
 if(!state.legacy&&!rangeValid()){host.innerHTML='<p class="status-strip error" role="alert">請選擇有效日期，開始至結束日期最多 31 天。</p>';return;}
 host.innerHTML='<div class="data-loading" role="status"><span class="loader" aria-hidden="true"></span><p>正在整理學習紀錄</p></div>';
 try{
  const key=filterKey(state.filters),cached=state.scopeCache.get(key);
  if(!force&&cached&&cached.expires>Date.now()){state.data=cached.data;renderDashboard();return;}
  const data=state.legacy?await loadLegacy(controller.signal):await requestJSON(analyticsQuery(selectionQuery()),{signal:controller.signal});
  if(generation!==state.generation)return;if(!Array.isArray(data.students)||!state.legacy&&(String(data.filters?.grade)!==state.filters.grade||String(data.filters?.poemId)!==state.filters.poemId))throw new Error('學生紀錄格式不完整');state.data=data;state.scopeCache.set(key,{data,expires:Date.now()+30000});if(state.scopeCache.size>8)state.scopeCache.delete(state.scopeCache.keys().next().value);if(state.studentFilter==='unstarted'&&!absenceReliable())state.studentFilter='all';renderDashboard();
 }catch(error){if(generation!==state.generation)return;if(error.status===401||error.status===403){clearPrivate();renderLogin(state.legacy?'存取碼不正確或已更新，請重新輸入。':'登入已失效，請重新登入。');return;}host.innerHTML=`<div class="status-strip error" role="alert">${error.code==='NARROW_DATE_OR_CLASS_FILTER'?'紀錄較多，請縮短日期範圍，或選擇一個年級、班別。':error.code==='ANALYTICS_PENDING_SYNC'?'學習紀錄正在準備首次同步，請稍後更新。':error.code==='RESEARCH_DISABLED'?'學習紀錄尚未啟用，請聯絡平台管理員。':error.name==='AbortError'?'讀取時間較長，請稍後重試。':'暫時未能取得紀錄，請重新載入。'}</div><button class="button" data-action="refresh">重新載入</button>`;document.querySelector('#sync-state').textContent='本次更新未完成';}
 finally{if(generation===state.generation){state.request=null;renderTeacherTools();}}
}
function selectedSummary(row){return row?.[state.filters.attempt]||row||{};}
function filteredRoster(){return (state.roster||[]).filter(s=>(!state.filters.grade||String(s.grade)===state.filters.grade)&&(!state.filters.cls||s.cls===state.filters.cls));}
function joinedStudents(){
 const analytics=state.data?.students||[],map=new Map(analytics.map(s=>[s.researchId,s]));
 const list=state.legacy?analytics.map(s=>({...s,person:{displayName:s.legacyName,grade:s.grade,cls:s.cls,classNo:null}})):filteredRoster().map(person=>({...map.get(person.researchId),researchId:person.researchId,grade:person.grade,cls:person.cls,person}));
 const known=new Set(list.map(s=>s.researchId));for(const row of analytics)if(!known.has(row.researchId))list.push({...row,person:{displayName:'未連結姓名',grade:row.grade,cls:row.cls,classNo:null}});
 return list.sort((a,b)=>(a.grade||0)-(b.grade||0)||String(a.cls).localeCompare(String(b.cls))||(Number(a.person.classNo)||999)-(Number(b.person.classNo)||999)||String(a.researchId).localeCompare(String(b.researchId)));
}
function isActive(row){return number(row.nEvents)!==null&&row.nEvents>0;}
function readingMetric(summary){return state.legacy?summary?.serverVerified||{}:summary?.byConstruct?.['reading.pronunciation']?.serverVerified||{};}
function readingScore(row){return score(readingMetric(selectedSummary(row)).meanScore);}
function recordsReady(){return state.data&&state.data.sync?.status!=='unavailable';}
function absenceReliable(){return !state.legacy&&!state.rosterError&&Array.isArray(state.roster)&&recordsReady()&&['direct','current','fresh','ready','ok','synced','live','published'].includes(state.data.sync?.status);}
function supportSignals(row){
 const selected=selectedSummary(row);if(state.legacy){const value=readingScore(row);return value!==null&&value<60?[{key:'reading.pronunciation',label:'朗讀發音',source:'舊版摘要',score:value}]:[];}
 return Object.entries(CONSTRUCTS).flatMap(([key,label])=>['serverVerified','clientReported'].flatMap(source=>{const metric=selected.byConstruct?.[key]?.[source],value=score(metric?.meanScore);return metric?.measuredN>0&&value!==null&&value<60?[{key,label,source:source==='serverVerified'?'伺服器評測':'學生端回報',score:value}]:[];}));
}
function studentMatches(row,filter=state.studentFilter,construct=state.constructFilter){if(construct&&!supportSignals(row).some(signal=>signal.key===construct))return false;return filter==='active'?isActive(row):filter==='unstarted'?absenceReliable()&&!!row.person.id&&!isActive(row):filter==='support'?supportSignals(row).length>0:filter==='completed'?row.completedN>0:filter==='unmeasured'?recordsReady()&&isActive(row)&&readingScore(row)===null:true;}
function selectedStudents(){const term=state.search.trim().toLowerCase();return joinedStudents().filter(row=>studentMatches(row)&&(!term||[row.person.displayName,row.researchId,row.person.classNo,row.grade+row.cls,row.person.login].some(value=>String(value??'').toLowerCase().includes(term))));}

function renderDashboard(){
 if(!state.data)return;
 document.querySelector('#view-title').textContent=scopeLabel();
 document.querySelector('#sync-state').textContent='更新 '+timestamp(state.data.generatedAt);
 const sync=state.data.sync||{};let note='';
 if(state.rosterError)note='<p class="status-strip warning">名冊暫未載入。<button class="button small" data-action="retry-roster">重試</button></p>';
 if(sync.status==='unavailable')note+='<p class="status-strip warning">學習紀錄正在同步，請稍後更新。</p>';
 else if(['attention','catching_up'].includes(sync.status))note+='<p class="status-strip warning">部分紀錄仍在同步，目前顯示已取得的資料。</p>';
 document.querySelector('#dashboard-content').innerHTML=note+overview();renderTeacherTools();
}
function overview(){
 const students=joinedStudents(),active=students.filter(isActive),ready=recordsReady();
 const total=state.roster&&!state.rosterError?filteredRoster().length:null,reading=score(readingMetric(state.data.summary).meanScore);
 const cards=`<article class="kpi"><p class="kpi-label">參與學生</p><p class="kpi-value">${ready?active.length:'—'}<small>${total===null?'人':' / '+total+' 人'}</small></p></article><article class="kpi"><p class="kpi-label">朗讀平均</p><p class="kpi-value">${reading===null?'未測':shown(reading,1)}<small>${reading===null?'':'分'}</small></p></article>`;
 const measured=students.map(readingScore),groups=[['80–100 分',measured.filter(v=>v!==null&&v>=80).length,'green'],['60–79 分',measured.filter(v=>v!==null&&v>=60&&v<80).length,'blue'],['低於 60 分',measured.filter(v=>v!==null&&v<60).length,'gold'],['未測',measured.filter(v=>v===null).length,'muted']];
 const max=Math.max(1,...groups.map(([,count])=>count));
 const chart=`<section class="class-chart performance-panel" aria-labelledby="reading-chart-title"><h2 id="reading-chart-title">朗讀分布</h2><div class="score-distribution">${groups.map(([label,count,tone])=>`<div class="distribution-row"><span>${label}</span><div class="distribution-track"><span class="distribution-fill ${tone}" style="width:${ready?count/max*100:0}%"></span></div><strong>${ready?count:'—'}<small>人</small></strong></div>`).join('')}</div><p class="chart-note">未測不計入平均分</p></section>`;
 return `<div class="overview-summary"><div class="kpi-grid">${cards}</div>${chart}</div>${classWordAnalysis()}${studentList()}`;
}

function wordIssues(data){
 const analysis=data?.readingCharacterAnalysis;if(analysis?.source!=='server_verified'||!Array.isArray(analysis.poems))return [];
 return analysis.poems.flatMap(poem=>(poem.lines||[]).flatMap(line=>(line.words||[]).filter(word=>Number.isInteger(word.count)&&word.count>0&&score(word.meanScore)!==null&&word.meanScore<80).map(word=>({...word,poemId:poem.poemId,itemId:`p${poem.poemId}.l${line.lineIndex}`})))).sort((a,b)=>a.meanScore-b.meanScore||a.poemId-b.poemId||a.itemId.localeCompare(b.itemId)||a.index-b.index);
}
function wordContext(word){
 const poem=state.poems.find(p=>Number(p.id)===Number(word.poemId)),match=/^p([1-6])\.l(\d+)$/.exec(String(word.itemId)),lineIndex=match&&Number(match[1])===Number(word.poemId)?Number(match[2]):null,line=lineIndex===null?null:poem?.lines?.[lineIndex]?.text;
 const title=poem?.title||'古詩',position=lineIndex===null?'':'第 '+(lineIndex+1)+' 句';
 const chars=line?[...line]:[],han=chars.filter(char=>/\p{Script=Han}/u.test(char));const aligned=han[word.index]===word.char;let index=-1;
 return{label:title+(position?' · '+position:''),text:aligned?chars.map(char=>{if(/\p{Script=Han}/u.test(char))index++;return index===word.index&&/\p{Script=Han}/u.test(char)?`<mark>${esc(char)}</mark>`:esc(char);}).join(''):'',position};
}
function classWordAnalysis(){
 const analysis=state.data?.readingCharacterAnalysis;
 const catalog=state.poems.filter(poem=>String(poem.grade)===state.filters.grade&&String(poem.id)===state.filters.poemId);
 const trusted=analysis?.source==='server_verified'&&Array.isArray(analysis.poems);
 const content=catalog.map(poem=>{
  const measured=trusted?analysis.poems.find(item=>Number(item.poemId)===poem.id&&Number(item.grade)===poem.grade):null;
  const lines=poem.lines.map((line,lineIndex)=>{
   const source=measured?.lines?.find(item=>item.lineIndex===lineIndex),words=source?.text===line.text&&Array.isArray(source.words)?source.words:[];let index=-1;
   const phrases=[];let phrase=[],phraseLength=0;
   for(const char of [...(line.text+(line.punctuation||''))]){
    if(!/\p{Script=Han}/u.test(char)){phrase.push(`<span class="character-punctuation" aria-hidden="true">${esc(char)}</span>`);phrases.push({html:phrase.join(''),length:phraseLength});phrase=[];phraseLength=0;continue;}
    index++;const word=words.find(item=>item.index===index&&item.char===char),value=Number.isInteger(word?.count)&&word.count>0?score(word.meanScore):null;
    const tone=value===null?'unmeasured':value<80?'needs-practice':'clear',pinyin=line.pinyin?.[index]||'',label=`${char}，${pinyin}，${value===null?'未測':characterScore(value)+' 分，'+word.count+' 位學生'}，第 ${lineIndex+1} 句第 ${index+1} 字`;
    const display=value===null?'未測':characterScore(value);
    phraseLength++;phrase.push(`<span class="character-card ${tone}" data-char-index="${index}" data-score="${value===null?'':value}" title="${esc(label)}" aria-label="${esc(label)}"><strong class="character-glyph">${esc(char)}</strong><span class="character-score${display.length>4?' precise':''}">${display}</span><span class="character-pinyin">${esc(pinyin)}</span></span>`);
   }
   if(phrase.length)phrases.push({html:phrase.join(''),length:phraseLength});
   const pieces=phrases.map(part=>`<span class="character-phrase" style="--phrase-chars:${part.length}">${part.html}</span>`).join('');
   return `<div class="character-line" data-line-index="${lineIndex}" aria-label="${esc(line.text+(line.punctuation||''))}">${pieces}</div>`;
  }).join('');
  const heading=`<span>${esc(poem.title)}</span><small>${poem.grade} 年級</small>`;
  return state.filters.grade?`<article class="poem-character-sheet" data-poem-id="${poem.id}"><h3 class="poem-character-title">${heading}</h3><div class="character-lines">${lines}</div></article>`:`<details class="poem-character-sheet" data-poem-id="${poem.id}"><summary class="poem-character-title">${heading}<span class="details-chevron" aria-hidden="true">⌄</span></summary><div class="character-lines">${lines}</div></details>`;
 }).join('');
 return `<section class="class-character-analysis" aria-labelledby="class-words-title"><div class="character-section-heading"><h2 id="class-words-title">逐字分析</h2><div class="character-legend"><span class="legend-low">低於 80 分</span><span class="legend-clear">80 分或以上</span></div></div>${content||empty('古詩內容暫未載入')}<p class="chart-note">每字平均分 · 每位學生取${state.filters.attempt==='first'?'首次':'最近'}一次朗讀 · 未測不計分</p></section>`;
}
function studentWordBody(data,expanded=false){
 const words=wordIssues(data),visible=expanded?words:words.slice(0,6);
 if(!words.length)return empty(data?.readingCharacterAnalysis?.source==='server_verified'&&data.readingCharacterAnalysis.poems?.some(poem=>poem.lines.some(line=>line.words.some(word=>word.count>0)))?'最近的字音評測沒有低於 80 分的字':'尚未有逐字朗讀紀錄');
 return `<div class="student-word-grid">${visible.map(word=>{const context=wordContext(word);return `<article class="student-word-card"><div class="student-word-top"><strong class="word-glyph">${esc(word.char)}</strong><span class="word-score" title="字音平均分">${characterScore(word.meanScore)}<small>分</small></span></div><p class="word-context-label">${esc(context.label)}</p>${context.text?`<p class="word-original-line">${context.text}</p>`:''}</article>`;}).join('')}</div><p class="chart-note">最近字音平均分 · 只列低於 80 分的字</p>${words.length>visible.length?'<button type="button" class="button" data-action="more-student-words">查看其餘字音</button>':''}`;
}
function studentPracticeBody(data){
 const summary=data?.practiceSummary;
 if(!summary||!Array.isArray(summary.items))return '<section class="student-practice"><h3>練一練</h3><p class="helper">尚未有練習紀錄</p></section>';
 const types={sound:'聽音辨字',dictation:'聽寫',microgame:'詩裏玩一玩',match:'練習',sequence:'練習','scene-builder':'練習'};
 const status={correct:'答對',incorrect:'再試一次',completed:'已完成',skipped:'已跳過',unmeasured:'未評分',unanswered:'尚未作答'};
 const items=summary.items.slice(0,10),positions=new Set(items.map(item=>item.position));
 if(Number.isInteger(summary.total)&&summary.total>0&&summary.total<=10)for(let position=1;position<=summary.total;position++)if(!positions.has(position))items.push({position,type:null,status:'unanswered'});
 items.sort((a,b)=>(a.position??99)-(b.position??99));
 return `<section class="student-practice"><div class="student-practice-heading"><h3>練一練</h3><span>${esc(summary.title)}</span></div><p class="student-practice-progress">已完成 <strong>${shown(summary.completedN)}${summary.total?' / '+summary.total:''}</strong> 題<span>答對 <strong>${shown(summary.correctN)}</strong> 題</span></p><ol class="student-practice-list">${items.map((item,index)=>`<li><span class="practice-position">${item.position||index+1}</span><span>${esc(types[item.type]||'待作答')}</span><strong class="practice-result ${item.status==='correct'||item.status==='completed'?'clear':item.status==='incorrect'?'needs-practice':''}">${esc(status[item.status]||'未評分')}</strong></li>`).join('')}</ol><p class="chart-note">最近一輪 · 小遊戲完成不計答對題數</p></section>`;
}
function studentLearningBody(data,expanded=false){return `<section class="student-pronunciation"><h3>字音</h3>${studentWordBody(data,expanded)}</section>${studentPracticeBody(data)}`;}
function studentWordDialog(student,body){
 return `<header class="dialog-header"><div><h2 id="student-dialog-title">${esc(student.person.displayName)}</h2><p class="helper">${esc(student.grade+student.cls)} 班</p></div><button type="button" class="button icon-only" data-action="close-dialog" aria-label="關閉學生紀錄">×</button></header><div class="dialog-body student-words-body">${body}</div>`;
}
async function openStudentWords(researchId){
 const student=joinedStudents().find(row=>row.researchId===researchId);if(!student)return;
 state.detailRequest?.abort();const controller=new AbortController(),scope=filterKey(state.filters);state.detailRequest=controller;state.detailStudent=student;state.detailData=null;
 const content=document.querySelector('#student-dialog-content');content.innerHTML=studentWordDialog(student,'<div class="empty" role="status"><span class="loader" aria-hidden="true"></span><p>正在讀取字音紀錄</p></div>');if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
 const current=()=>!controller.signal.aborted&&state.detailStudent===student&&filterKey(state.filters)===scope&&dialog.open;
 const prepared=state.data?.studentDetails?.[researchId];
 if(prepared||absenceReliable()&&!isActive(student)){state.detailData=prepared||{};content.innerHTML=studentWordDialog(student,studentLearningBody(state.detailData));return;}
 if(state.legacy){content.innerHTML=studentWordDialog(student,empty('尚未有逐字朗讀紀錄'));return;}
 try{
  const data=await requestJSON(analyticsQuery(selectionQuery({student:researchId,grade:student.grade,cls:student.cls})),{signal:controller.signal});if(!current())return;
  if(data.filters?.student!==researchId||String(data.filters?.grade)!==String(student.grade)||String(data.filters?.poemId)!==state.filters.poemId||data.filters?.cls!==student.cls||!Array.isArray(data.students)||data.students.some(row=>row.researchId!==researchId))throw new Error('Student scope mismatch');
  state.detailData=data;content.innerHTML=studentWordDialog(student,studentLearningBody(data));
 }catch(error){if(!current())return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}content.innerHTML=studentWordDialog(student,empty('暫時未能讀取字音紀錄')+'<button type="button" class="button" data-action="retry-student-words">再試一次</button>');}
}

function studentList(){
 const filtered=selectedStudents(),size=8,pages=Math.max(1,Math.ceil(filtered.length/size));state.page=Math.min(state.page,pages-1);const page=filtered.slice(state.page*size,(state.page+1)*size);
 const rows=page.map(row=>{const attempts=isActive(row)?number(row.nAttempts):absenceReliable()?0:null;return `<tr><td><button type="button" class="student-name student-word-link" data-student-words="${esc(row.researchId)}" aria-label="查看${esc(row.person.displayName)}的學習紀錄">${esc(row.person.displayName)}</button><p class="student-meta">${esc(row.grade+row.cls)}${row.person.classNo?' · '+esc(row.person.classNo)+' 號':''}</p></td><td class="reading-cell">${scoreMarkup(readingScore(row))}</td><td class="attempt-cell">${shown(attempts)}</td></tr>`;}).join('');
 return `<details class="student-overview" id="student-list" ${state.studentsOpen?'open':''}><summary><span>學生概況 <small>${joinedStudents().length} 人</small></span><span class="details-chevron" aria-hidden="true">⌄</span></summary><div class="student-overview-content"><div class="list-toolbar"><label class="search-field"><span class="sr-only">搜尋學生</span><input type="search" id="student-search" value="${esc(state.search)}" placeholder="搜尋學生" autocomplete="off"></label><span class="list-result">${filtered.length} 人</span></div>${rows?`<div class="table-area"><table class="student-table"><thead><tr><th scope="col">學生</th><th scope="col">朗讀</th><th scope="col" class="attempt-cell">練習次數</th></tr></thead><tbody>${rows}</tbody></table></div>${pages>1?`<div class="pagination"><button class="button small" data-page="${state.page-1}" ${state.page===0?'disabled':''}>上一頁</button><span>${state.page+1} / ${pages}</span><button class="button small" data-page="${state.page+1}" ${state.page+1>=pages?'disabled':''}>下一頁</button></div>`:''}`:empty('暫時沒有符合的學生')}</div></details>`;
}
function updateStudentList(){const previous=document.querySelector('#student-list');if(previous){state.studentsOpen=previous.open;previous.outerHTML=studentList();}}


function showPasswordChange(){
 state.detailRequest?.abort();state.detailStudent=null;
 document.querySelector('#student-dialog-content').innerHTML=`<header class="dialog-header"><div><p class="eyebrow">教師帳戶</p><h2 id="student-dialog-title">修改密碼</h2></div><button class="button icon-only" data-action="close-dialog" aria-label="關閉修改密碼">×</button></header><div class="dialog-body"><p class="helper">修改成功後，所有已登入裝置都需要重新登入。</p><form id="teacher-password-form" class="password-form"><label class="field">目前密碼<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></label><label class="field">新密碼<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label class="field">再輸入新密碼<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><p class="helper">最少 8 個字元，請使用與其他網站不同的密碼。</p><p class="form-error" id="password-change-error" role="alert" hidden></p><div class="form-actions"><button type="button" class="button" data-action="close-dialog">取消</button><button type="submit" class="button primary">儲存新密碼</button></div></form></div>`;
 if(!dialog.open)dialog.showModal();
}
async function changePassword(form){
 const epoch=sessionEpoch,errorEl=form.querySelector('#password-change-error'),button=form.querySelector('[type=submit]'),currentPassword=form.elements.currentPassword.value,newPassword=form.elements.newPassword.value;errorEl.hidden=true;
 if(newPassword!==form.elements.confirmPassword.value){errorEl.textContent='兩次輸入的新密碼不相同。';errorEl.hidden=false;return;}
 if(newPassword.length<8||new TextEncoder().encode(newPassword).length>128){errorEl.textContent='新密碼最少 8 個字元；中文密碼請勿超過 42 個字。';errorEl.hidden=false;return;}
 button.disabled=true;button.textContent='正在儲存…';
 try{const result=await requestJSON(AUTH,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.auth?.csrfToken||''},body:JSON.stringify({action:'change_password',currentPassword,newPassword})});if(epoch!==sessionEpoch)return;if(!result.passwordChanged)throw new Error('密碼修改未獲確認');broadcastSession('password-changed');clearPrivate();renderLogin('密碼已修改，請使用新密碼重新登入。',true);toast('密碼已修改。');}
 catch(error){if(epoch!==sessionEpoch)return;if(error.status===401&&error.code!=='INVALID_CREDENTIALS'||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}if(!form.isConnected)return;errorEl.textContent=['INVALID_CREDENTIALS','CURRENT_PASSWORD_INVALID'].includes(error.code)?'目前密碼不正確。':error.status===429?'修改次數較多，請 15 分鐘後再試。':error.status===409?'帳戶資料已變更，請重新登入後再試。':error.status===400?'新密碼不符合要求，請檢查長度。':'修改尚未確認，請檢查連線後重新登入。';errorEl.hidden=false;}
 finally{form.reset();button.disabled=false;button.textContent='儲存新密碼';}
}

function filterKey(filters){return JSON.stringify(Object.fromEntries(['grade','poemId','cls','from','to','attempt','activity'].map(key=>[key,String(filters?.[key]??(key==='attempt'?'latest':''))])));}
function filterDescription(filters){return `${filters.grade} 年級 · ${selectedPoem(filters)?.title||'古詩'}${filters.cls?' · '+filters.cls+' 班':''} · ${filters.from} 至 ${filters.to}`;}
function toolPayloadFilters(filters){return Object.fromEntries(Object.entries(filters).filter(([,value])=>value!==''&&value!==null&&value!==undefined));}
function clearTeacherTools(){state.assistantJob?.controller.abort();state.documentJob?.controller.abort();state.assistantJob=null;state.assistantReport=null;state.documentJob=null;state.toolsPreparing=false;}
function toolsScopeChanged(){clearTeacherTools();renderTeacherTools();}
function validReportForScope(){const report=state.assistantReport;return !!report&&filterKey(report.filters)===filterKey(state.filters)&&filterKey(draftFilters())===filterKey(state.filters);}
function renderTeacherTools(){
 const host=document.querySelector('#teacher-tools');if(!host)return;if(state.legacy||state.auth?.user?.role!=='teacher'){host.replaceChildren();return;}
 if(!scopeReady()){host.replaceChildren();return;}
 const draft=draftFilters(),busy=!state.data||!!state.request||state.toolsPreparing||state.assistantJob?.status==='running'||state.documentJob?.status==='running';
 host.innerHTML=`<section class="teacher-tools-bar" aria-label="下載檔案"><div class="teacher-tools-actions"><button class="button" data-teacher-tool="xlsx" ${busy?'disabled':''}>${icon('download')}下載學生數據表格</button><button class="button primary" data-teacher-tool="docx" ${busy?'disabled':''}>${icon('download')}${state.assistantJob?.status==='running'?'正在撰寫…':'AI生成教研報告'}</button></div><p class="tools-hint">表格查看學生紀錄；教研報告由 AIDUCATION公司自研發AI Agent 撰寫學習分析與教學建議，完成後自動下載。</p></section><div id="document-tool-status"></div><div id="teacher-analysis"></div>`;
 renderDocumentStatus();renderAssistant();
}
function renderDocumentStatus(){
 const host=document.querySelector('#document-tool-status'),job=state.documentJob;if(!host)return;if(!job){host.replaceChildren();return;}
 const running=job.status==='running';host.innerHTML=`<div class="tool-status ${job.status}" role="status"><div><strong>${running?'正在準備 '+job.label:job.status==='complete'?job.label+' 已下載':job.status==='cancelled'?'已取消下載':job.label+' 暫未完成'}</strong><p>${esc(job.scope)}</p>${job.message?`<p>${esc(job.message)}</p>`:''}</div>${running?'<button class="button small" data-teacher-tool="cancel-document">取消</button>':job.status==='error'?`<button class="button small" data-teacher-tool="${job.action}">再試一次</button>`:''}</div>`;
}
function renderAssistant(){
 const host=document.querySelector('#teacher-analysis');if(!host)return;const job=state.assistantJob;
 if(job?.status==='running'){host.innerHTML=`<section class="analysis-loading" role="status"><span class="loader" aria-hidden="true"></span><div><h2>正在撰寫 Word 報告</h2><p>${esc(job.scope)}</p><p>${job.polling?'報告仍在處理，完成後會自動下載。':'正在整理學習紀錄與教學建議，請稍候。'}</p></div><button class="button" data-teacher-tool="cancel-analysis">停止等候</button></section>`;return;}
 if(job&&['error','empty','cancelled'].includes(job.status)){host.innerHTML=`<section class="analysis-message" role="status"><h2>${job.status==='empty'?'這個範圍還沒有可分析的學習紀錄':job.status==='cancelled'?'已停止等候':'Word 報告暫未完成'}</h2><p>${esc(job.message)}</p><p class="helper">${esc(job.scope)}</p><button class="button primary" data-teacher-tool="docx">${job.status==='empty'?'重新檢查資料':'再試一次'}</button></section>`;return;}
 host.replaceChildren();
}
function toolErrorMessage(error,kind='analysis'){
 const messages={AI_REPORT_QUALITY:'報告內容仍需修訂，尚未產生下載檔案。請稍後再試。',ANALYSIS_RETRY_REQUIRED:'上一個分析請求未完成，請按再試一次繼續處理。',NO_LEARNING_DATA:'可以調整班級或日期，或等學生完成練習並同步後再分析。',AI_RATE_LIMITED:'剛才的分析請求較多，請稍候再試。',AI_TIMEOUT:'分析需要較長時間，請再試一次；已完成的結果會直接取回。',AI_NOT_CONFIGURED:'教學分析服務尚未設定，請聯絡平台管理員。',REPORT_STORAGE_UNAVAILABLE:'報告儲存暫時未能連線，請稍後重試。',AI_INVALID_RESPONSE:'分析回覆未通過檢查，請重新分析。',AI_UNAVAILABLE:'分析服務暫時未能連線，請稍後再試。',REPORT_NOT_FOUND:'這份報告未能取回，請按再試一次重新產生。',REPORT_SNAPSHOT_INVALID:'這份報告資料未能核對，請按再試一次重新產生。',EXPORT_TOO_LARGE:'資料較多，請選一個班別或縮短日期範圍再匯出。',NARROW_DATE_OR_CLASS_FILTER:'資料較多，請選一個班別或縮短日期範圍。',EXPORT_TIMEOUT:'檔案準備需要較長時間，請縮短日期範圍或稍後重試。',INVALID_FILTER:'請核對年級、班別與日期；每次最多 31 天。',ANALYTICS_PENDING_SYNC:'學習資料尚在準備首次同步，請稍後再試。',RESEARCH_DISABLED:'學習紀錄服務尚未啟用，請聯絡平台管理員。'};
 return messages[error.code]||(error.name==='AbortError'?'連線等候時間較長，請稍後再試。':kind==='analysis'?'暫時未能取得完整分析，請再試一次。':'檔案未完整取得，沒有下載部分檔案。請再試一次。');
}
async function prepareToolScope(){
 if(state.legacy||state.auth?.user?.role!=='teacher'||state.toolsPreparing)return null;const next=draftFilters();
 if(!scopeReady(next)){toast('請先選擇年級及古詩。');return null;}
 if(!rangeValid(next)){const details=document.querySelector('.filter-details');if(details)details.open=true;toast('請選擇有效日期，開始至結束日期最多 31 天。');return null;}
 const epoch=sessionEpoch,key=filterKey(next);state.toolsPreparing=true;
 try{if(key!==filterKey(state.filters)||!state.data){await applyFilters(next);}if(epoch!==sessionEpoch||key!==filterKey(state.filters)||key!==filterKey(draftFilters())||!state.data)return null;return {...state.filters};}
 finally{if(epoch===sessionEpoch){state.toolsPreparing=false;renderTeacherTools();}}
}
function sleepForAnalysis(milliseconds,signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(new DOMException('Cancelled','AbortError'));return;}const timer=setTimeout(done,milliseconds);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('Cancelled','AbortError'));}signal.addEventListener('abort',abort,{once:true});});}
function cancelAnalysis(){const job=state.assistantJob;if(!job||job.status!=='running')return;job.controller.abort();job.status='cancelled';job.message='已停止這個畫面的等候。伺服器可能仍在完成分析，稍後再試會取回已保存的結果。';state.assistantReport=null;renderTeacherTools();}
async function generateAnalysis(){
 if(state.assistantJob?.status==='running'||state.documentJob?.status==='running')return;const filters=await prepareToolScope();if(!filters)return;
 const epoch=sessionEpoch,key=filterKey(filters),job={status:'running',controller:new AbortController(),scope:filterDescription(filters),polling:false,cached:false};state.assistantJob=job;state.assistantReport=null;state.documentJob=null;renderTeacherTools();
 const current=()=>epoch===sessionEpoch&&state.assistantJob===job&&job.status==='running'&&filterKey(state.filters)===key&&filterKey(draftFilters())===key&&!job.controller.signal.aborted;
 try{
  let payload=await requestJSON(ASSISTANT,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.auth.csrfToken},body:JSON.stringify({filters:toolPayloadFilters(filters)}),signal:job.controller.signal,timeoutMs:65000});
  const deadline=Date.now()+120000;
  while(payload?.status==='generating'){
   if(!current())return;if(!/^ta_[a-f0-9]{64}$/.test(payload.reportId))throw new Error('Invalid report');if(Date.now()>deadline)throw Object.assign(new Error('Analysis timeout'),{code:'AI_TIMEOUT'});
   job.polling=true;renderAssistant();await sleepForAnalysis(Math.max(1000,Math.min(10000,(Number(payload.retryAfterSeconds)||3)*1000)),job.controller.signal);
   payload=payload.nextAction==='continue'?await requestJSON(ASSISTANT,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.auth.csrfToken},body:JSON.stringify({reportId:payload.reportId}),signal:job.controller.signal,timeoutMs:65000}):await requestJSON(ASSISTANT+'&'+new URLSearchParams({reportId:payload.reportId}),{headers:{'X-CSRF-Token':state.auth.csrfToken},signal:job.controller.signal,timeoutMs:25000});
  }
  if(!current())return;const report=payload?.report;
  if(payload.ok!==true||!report||!/^ta_[a-f0-9]{64}$/.test(payload.reportId)||report.reportId!==payload.reportId||filterKey(report.filters)!==key||!report.analysis||typeof report.analysis.overview!=='string')throw new Error('Invalid report');
  state.assistantReport=report;job.status='complete';job.cached=payload.cached===true;renderTeacherTools();await exportDocument('docx');
 }catch(error){if(!current())return;if(error.status===401||error.status===403){lockSession();return;}job.status=error.code==='NO_LEARNING_DATA'?'empty':'error';job.message=toolErrorMessage(error);renderTeacherTools();}
}
function cancelDocument(){const job=state.documentJob;if(!job||job.status!=='running')return;job.controller.abort();job.status='cancelled';job.message='沒有下載部分檔案，可以稍後再試。';renderTeacherTools();}
async function exportDocument(action){
 if(state.documentJob?.status==='running'||!['xlsx','docx'].includes(action))return;
 let filters;if(action==='xlsx'){filters=await prepareToolScope();if(!filters)return;}else{if(!validReportForScope())return;filters={...state.filters};}
 const reportId=state.assistantReport?.reportId,epoch=sessionEpoch,key=filterKey(filters),job={action,label:action==='xlsx'?'Excel':'Word 報告',scope:filterDescription(filters),status:'running',controller:new AbortController(),message:''};state.documentJob=job;renderTeacherTools();pendingRequests.add(job.controller);
 const timer=setTimeout(()=>job.controller.abort(),35000),current=()=>epoch===sessionEpoch&&state.documentJob===job&&job.status==='running'&&key===filterKey(state.filters)&&key===filterKey(draftFilters());
 try{
  const response=await fetch(DOCUMENTS,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':state.auth.csrfToken},body:JSON.stringify(action==='xlsx'?{action,filters:toolPayloadFilters(filters)}:{action,reportId}),signal:job.controller.signal});
  if(!response.ok){const data=await response.json().catch(()=>null);throw Object.assign(new Error('Document failed'),{status:response.status,code:data?.code});}
  const mime=action==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if(!response.headers.get('content-type')?.toLowerCase().startsWith(mime))throw new Error('Invalid document format');const length=Number(response.headers.get('content-length'));if(length>4*1024*1024)throw Object.assign(new Error('Too large'),{code:'EXPORT_TOO_LARGE'});
  const blob=await response.blob();if(!current()||job.controller.signal.aborted)return;if(blob.size<4||blob.size>4*1024*1024)throw new Error('Invalid document size');
  const signature=new Uint8Array(await blob.slice(0,4).arrayBuffer());if(signature[0]!==80||signature[1]!==75||signature[2]!==3||signature[3]!==4)throw new Error('Invalid document signature');if(!current()||job.controller.signal.aborted)return;
  let filename=`普通話${action==='xlsx'?'學習紀錄':'教學分析'}_${filters.from}_${filters.to}.${action}`;const disposition=response.headers.get('content-disposition')||'',utf8=/filename\*=UTF-8''([^;]+)/i.exec(disposition),plain=/filename="([^"]+)"/i.exec(disposition);try{const supplied=utf8?decodeURIComponent(utf8[1]):plain?.[1];if(supplied?.endsWith('.'+action)&&!/[\\/\x00-\x1f]/.test(supplied)&&supplied.length<200)filename=supplied;}catch{}
  download(blob,filename);job.status='complete';job.message=action==='xlsx'?'已下載所選範圍的學習紀錄與名冊。':'已下載完整、可編輯的教學報告。';renderTeacherTools();
 }catch(error){if(!current())return;if(error.status===401||error.status===403){lockSession();return;}job.status='error';job.message=toolErrorMessage(error,'document');if(action==='docx'&&['REPORT_NOT_FOUND','REPORT_SNAPSHOT_INVALID'].includes(error.code))state.assistantReport=null;renderTeacherTools();}
 finally{clearTimeout(timer);pendingRequests.delete(job.controller);}
}


function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function loadLegacy(signal){
 const grade=Number(state.filters.grade),cls=state.filters.cls,poem=state.poems.find(p=>Number(p.grade)===grade)||state.poems.find(p=>p.id===grade),poemId=poem?.id||grade;
 const data=await requestJSON('/api/maanshan-data?'+new URLSearchParams({grade,cls,poemId}),{signal,headers:{Authorization:'Bearer '+state.legacyCode}});if(data.error)throw new Error('舊版資料暫未可用');
 const students=(data.students||[]).map(s=>{const r=score(s.score),w=score(s.writeScore),summary={nEvents:1,nStudents:1,nAttempts:null,completedN:null,serverVerified:{meanScore:r,measuredN:r===null?0:1,unmeasuredN:r===null?1:0},clientReported:{meanScore:w,measuredN:w===null?0:1,unmeasuredN:w===null?1:0}};return{researchId:String(s.id),legacyName:String(s.name||'未命名學生'),grade,cls,...summary,first:{},latest:summary,lastSeenAt:s.lastUpdated};});
 return{schemaVersion:1,generatedAt:new Date().toISOString(),legacyPhonics:data.phonAvg,students,summary:{serverVerified:{meanScore:mean(students.map(s=>s.serverVerified.meanScore)),measuredN:students.filter(s=>s.serverVerified.meanScore!==null).length},clientReported:{meanScore:mean(students.map(s=>s.clientReported.meanScore)),measuredN:students.filter(s=>s.clientReported.meanScore!==null).length}},byGrade:[],byClass:[],trend:[],coverage:{nStudents:students.length,nEvents:null,nInvalidEvents:null}};
}
root.addEventListener('submit',event=>{
 if(event.target.id==='teacher-login-form'){event.preventDefault();void login(event.target);}
 if(event.target.id==='teacher-filters'){event.preventDefault();applyFilters(draftFilters());}
});
root.addEventListener('change',event=>{
 if(event.target.id==='student-construct'){state.constructFilter=event.target.value;state.page=0;updateStudentList();document.querySelector('#student-construct')?.focus({preventScroll:true});return;}
 if(event.target.id==='filter-grade'){
  void applyFilters({...state.filters,grade:event.target.value,poemId:'',cls:''});return;
 }
 if(event.target.id==='filter-poem'){void applyFilters({...state.filters,poemId:event.target.value,cls:''});return;}
 if(event.target.closest('#teacher-filters'))markFilterDraft();
});
root.addEventListener('input',event=>{
 if(event.target.closest('#teacher-filters'))return;
 if(event.isComposing||event.target.id!=='student-search')return;state.search=event.target.value;state.page=0;const cursor=event.target.selectionStart;updateStudentList();const input=document.querySelector('#student-search');input?.focus();try{input?.setSelectionRange(cursor,cursor);}catch{}
});
root.addEventListener('compositionend',event=>{if(event.target.id==='student-search')event.target.dispatchEvent(new Event('input',{bubbles:true}));});
function click(event){const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.studentWords){void openStudentWords(button.dataset.studentWords);return;}
 if(button.dataset.action==='retry-student-words'&&state.detailStudent){void openStudentWords(state.detailStudent.researchId);return;}
 if(button.dataset.action==='more-student-words'&&state.detailStudent&&state.detailData){document.querySelector('#student-dialog-content').innerHTML=studentWordDialog(state.detailStudent,studentLearningBody(state.detailData,true));return;}
 if(button.dataset.teacherTool){const tool=button.dataset.teacherTool;if(tool==='docx')void generateAnalysis();else if(tool==='cancel-analysis')cancelAnalysis();else if(tool==='cancel-document')cancelDocument();else void exportDocument(tool);return;}
 if(button.dataset.action==='refresh'||button.dataset.action==='retry-roster'){if(state.rosterError||!state.poems.length||button.dataset.action==='retry-roster')void enterDashboard();else void loadData({force:true});}
 if(button.dataset.action==='boot')void boot();if(button.dataset.action==='logout')void logout();
 if(button.dataset.action==='reset-filters')applyFilters({grade:'',poemId:'',cls:'',from:dayOffset(-29),to:dayOffset(0),attempt:'latest',activity:''});
 if(button.dataset.dateOffset!==undefined){const form=document.querySelector('#teacher-filters');form.elements.from.value=dayOffset(Number(button.dataset.dateOffset));form.elements.to.value=dayOffset(0);markFilterDraft();}
 if(button.dataset.action==='close-dialog'){state.detailRequest?.abort();state.detailStudent=null;state.detailData=null;dialog.close();document.querySelector('#student-dialog-content').replaceChildren();}
 if(button.dataset.page!==undefined){state.page=Math.max(0,Number(button.dataset.page)||0);updateStudentList();document.querySelector('#student-list')?.scrollIntoView({block:'start',behavior:'instant'});}
 if(button.dataset.groupGrade)applyFilters({...state.filters,grade:button.dataset.groupGrade,cls:button.dataset.groupClass||''});
}
root.addEventListener('click',click);dialog.addEventListener('click',click);
root.addEventListener('toggle',event=>{if(event.target.id==='student-list')state.studentsOpen=event.target.open;},true);
dialog.addEventListener('close',()=>{if(dialog.open)return;state.detailRequest?.abort();state.detailStudent=null;state.detailData=null;document.querySelector('#student-dialog-content').replaceChildren();});
dialog.addEventListener('submit',event=>{if(event.target.id==='teacher-password-form'){event.preventDefault();void changePassword(event.target);}});document.querySelector('#teacher-logout').addEventListener('click',logout);
// Remove the old teacher-token persistence once; school credentials are never stored in browser storage.
try{sessionStorage.removeItem('maanshan-teacher-access');}catch{}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void checkSession();});
window.addEventListener('pagehide',()=>{clearPrivate();root.replaceChildren();});window.addEventListener('pageshow',event=>{if(event.persisted)void boot();else void checkSession();});
boot();
