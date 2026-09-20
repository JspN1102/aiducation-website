const DEMO=location.pathname.endsWith('/teacher-demo.html');
const AUTH='/api/school-auth',ANALYTICS=DEMO?'/api/teacher-tools?tool=demo-data&kind=analytics':'/api/teacher-analytics';
const analyticsQuery=params=>ANALYTICS+(DEMO?'&':'?')+params;
const root=document.querySelector('#teacher-root'),dialog=document.querySelector('#student-dialog');
const state={auth:null,legacy:false,legacyCode:'',roster:null,rosterError:false,data:null,poems:[],view:'overview',search:'',page:0,generation:0,request:null,detailRequest:null,detailStudent:null,filters:{grade:'',cls:'',from:dayOffset(-29),to:dayOffset(0),attempt:'latest',activity:''}};
Object.assign(state,{studentFilter:'all',constructFilter:'',detailTab:'learning',detailData:null,exportJob:null});
Object.assign(state,{assistantJob:null,assistantReport:null,documentJob:null,toolsPreparing:false});
const ASSISTANT='/api/teacher-tools?tool='+(DEMO?'demo-analysis':'analysis'),DOCUMENTS='/api/teacher-tools?tool='+(DEMO?'demo-export':'export');
const CONSTRUCTS={'reading.pronunciation':'朗讀發音','writing.dictation':'聽寫辨字','sound.recognition':'字音辨認','match.accuracy':'配對練習','sequence.accuracy':'排序練習','scene_builder.accuracy':'情境選擇'};
const ACTIVITY_LABELS={'':'全部活動',listen:'聽一聽',read:'讀一讀',animation:'看一看動畫',explore:'詩境探索',challenge:'練一練',writing:'寫字練習',chat:'與詩人聊天',navigation:'瀏覽與選詩'};
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
function scoreMarkup(value){const n=score(value);return `<span class="score${n===null?' missing':''}">${n===null?'未測':shown(n,1)}</span>`;}
function mean(values){const valid=values.filter(v=>number(v)!==null);return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;}
function dayOffset(offset){const date=new Date();date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
function timestamp(value,short=false){if(!value||!Number.isFinite(new Date(value).getTime()))return '尚未同步';return new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',month:'2-digit',day:'2-digit',...(short?{}:{hour:'2-digit',minute:'2-digit'}),hour12:false}).format(new Date(value));}
function empty(title,note=''){return `<div class="empty"><span class="empty-icon">${icon('empty')}</span><strong>${esc(title)}</strong>${esc(note)}</div>`;}
function panel(title,subtitle,body,wide=false,action=''){return `<section class="panel${wide?' wide':''}"><div class="panel-heading"><h2>${esc(title)}</h2>${action}</div><p class="panel-subtitle">${esc(subtitle)}</p>${body}</section>`;}
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
function clearPrivate(){clearTeacherTools();state.exportJob?.controller.abort();state.exportJob=null;state.detailData=null;state.studentFilter='all';state.constructFilter='';sessionEpoch++;for(const controller of pendingRequests)controller.abort();pendingRequests.clear();sessionCheck=null;state.request?.abort();state.detailRequest?.abort();state.generation++;state.data=null;state.roster=null;state.rosterError=false;state.auth=null;state.legacyCode='';state.search='';state.page=0;state.detailStudent=null;if(dialog.open)dialog.close();document.querySelector('#student-dialog-content').replaceChildren();const identity=document.querySelector('#teacher-identity');identity.textContent='';identity.hidden=true;document.querySelector('#teacher-logout').hidden=true;document.querySelector('#teacher-change-password')?.remove();}
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
 root.innerHTML=`<main id="teacher-main" class="login-layout"><section class="login-story"><p class="eyebrow">每一次練習，都看得見</p><h1>看見進步，<br>也看見需要陪伴的地方。</h1><p>一起掌握六個年級的學習情況，從班級走到每一位學生的練習歷程。</p><svg class="login-illustration" viewBox="0 0 350 130" aria-hidden="true"><path d="M18 111h308" stroke="#c8d8c7"/><rect x="31" y="78" width="37" height="33" rx="8" fill="#dbe6d7"/><rect x="88" y="58" width="37" height="53" rx="8" fill="#c7d9c0"/><rect x="145" y="39" width="37" height="72" rx="8" fill="#a9c3a2"/><rect x="202" y="21" width="37" height="90" rx="8" fill="#73966f"/><path d="M275 104V57m0 24c-27 0-32-20-32-20 26-4 32 20 32 20m0-15c25 0 31-23 31-23-25-4-31 23-31 23" fill="#d4e2cc" stroke="#648860" stroke-width="2"/></svg></section><section class="login-card" aria-labelledby="login-title"><h2 id="login-title">${state.legacy?'查看舊版班級紀錄':'教師登入'}</h2><p class="helper">${state.legacy?'此網站尚未啟用學校帳戶，可使用原教師存取碼。':'一個學校教師帳戶，查看全校六個年級。'}</p><form id="teacher-login-form" class="login-form">${state.legacy?'':`<label class="field" for="teacher-login">登入名稱<input id="teacher-login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="128" required></label>`}<label class="field" for="teacher-password">${state.legacy?'教師存取碼':'密碼'}<input id="teacher-password" name="password" type="password" autocomplete="${state.legacy?'off':'current-password'}" maxlength="512" required></label><p id="login-error" class="form-error" role="alert" ${message?'':'hidden'}>${esc(message)}</p><button class="button primary" type="submit">${state.legacy?'查看班級紀錄':'登入教學觀察室'}</button></form><p class="login-foot">${state.legacy?'舊版只提供已同步的單班摘要，沒有全校名冊與完整過程資料。':'請使用學校提供的教師帳戶；共用裝置使用完畢後請登出。'}</p></section></main>`;
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
 const button=form.querySelector('button'),password=form.elements.password.value,loginName=form.elements.login?.value.trim();button.disabled=true;const errorEl=document.querySelector('#login-error');errorEl.hidden=true;
 clearPrivate();const epoch=sessionEpoch;
 try{
  if(state.legacy){state.legacyCode=password;state.filters.grade='1';state.filters.cls='A';await enterDashboard();return;}
  broadcastSession('session-changing');
  const auth=validateAuth(await requestJSON(AUTH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',login:loginName,password})}));
  if(epoch!==sessionEpoch)return;state.auth=auth;if(!auth.authenticated)throw new Error('未能確認登入');broadcastSession('signed-in');if(auth.user?.role!=='teacher'){renderStudentAccount();return;}await enterDashboard();
 }catch(error){if(epoch!==sessionEpoch)return;clearPrivate();renderLogin(error.status===401?'登入名稱或密碼不正確，請再試一次。':error.status===429?'登入嘗試較多，請稍候再試。':'暫時未能登入，請稍後再試。');}
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
 if(state.legacy){try{state.poems=(await requestJSON('./poems.json')).poems||[];}catch{state.poems=[];}await loadData();return;}
 const generation=state.generation;
 try{const [roster,catalog]=await Promise.all([requestJSON(DEMO?'/api/teacher-tools?tool=demo-data&kind=roster':AUTH+'?action=roster'),state.poems.length?Promise.resolve(null):requestJSON('./poems.json').catch(()=>null)]);if(generation!==state.generation)return;if(!Array.isArray(roster.students))throw new Error('名冊回覆不完整');state.roster=roster.students;state.rosterError=false;if(Array.isArray(catalog?.poems))state.poems=catalog.poems;}
 catch(error){if(generation!==state.generation)return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}state.rosterError=true;state.roster=null;}
 if(generation!==state.generation)return;renderFilters();await loadData();
}
function renderShell(){
 root.innerHTML=`${DEMO?'<aside class="demo-banner" role="status"><strong>模擬數據示範</strong><span>775 位虛構學生 · 31 班 · 30 天學習紀錄。匯出檔案均標註模擬，不影響正式數據。</span><a href="./teacher.html">返回正式後台 →</a></aside>':''}<div class="workspace"><aside class="teacher-sidebar" aria-label="教師功能"><p class="sidebar-label">教學視角</p><nav class="view-nav">${[['overview','學習總覽'],['students','學生紀錄'],['quality','資料與匯出']].map(([id,label])=>`<button data-view="${id}" ${state.view===id?'aria-current="page"':''}>${icon(id)}${label}</button>`).join('')}</nav><div class="sidebar-foot">觀察每位學生的進步。<br>不以分數為學生排名。</div></aside><main class="teacher-main" id="teacher-main"><div class="page-heading"><div><p class="eyebrow">TEACHING OBSERVATORY</p><h1 id="view-title">全校學習總覽</h1><p id="view-description">了解參與情況，安排下一次教學。</p><div class="sync-state" id="sync-state"><span class="sync-dot"></span>正在取得紀錄</div></div><div class="heading-actions">${DEMO?'':'<a class="button quiet" href="./teacher-demo.html">體驗模擬後台</a>'}<button type="button" class="button" data-action="refresh">${icon('refresh')}更新</button></div></div><div id="filter-holder"></div><div id="teacher-tools"></div><div id="dashboard-content"></div></main></div>`;renderFilters();renderTeacherTools();
}
function renderFilters(){
 const f=state.filters,classes=[...new Set((state.roster||[]).filter(s=>!f.grade||String(s.grade)===f.grade).map(s=>String(s.cls||'')))].filter(Boolean).sort();
 if(state.legacy&&!classes.length)classes.push('A','B','C','D','E','F');
 const holder=document.querySelector('#filter-holder');if(!holder)return;
 holder.innerHTML=`<form class="filters" id="teacher-filters"><div class="filter-primary"><label class="field" for="filter-grade">年級<select id="filter-grade" name="grade">${state.legacy?'':'<option value="">全校六個年級</option>'}${[1,2,3,4,5,6].map(g=>`<option value="${g}" ${f.grade===String(g)?'selected':''}>${g} 年級</option>`).join('')}</select></label><label class="field" for="filter-class">班別<select id="filter-class" name="cls">${state.legacy?'':'<option value="">全部班別</option>'}${classes.map(c=>`<option value="${esc(c)}" ${f.cls===c?'selected':''}>${esc(c)} 班</option>`).join('')}</select></label><div class="date-presets"><span class="field-label">觀察日期</span><div role="group" aria-label="快捷觀察日期">${[[0,'今天'],[-6,'近 7 天'],[-29,'近 30 天']].map(([offset,label])=>`<button class="date-preset" type="button" data-date-offset="${offset}" aria-pressed="${f.from===dayOffset(offset)&&f.to===dayOffset(0)}" ${state.legacy?'disabled':''}>${label}</button>`).join('')}</div></div><button class="button primary" type="submit">套用範圍</button></div><details class="filter-details" ${f.activity||f.attempt==='first'?'open':''}><summary>日期與更多條件 <span id="advanced-filter-summary">${esc(f.from+' — '+f.to)}</span></summary><div class="filter-advanced"><label class="field" for="filter-from">開始日期<input type="date" id="filter-from" name="from" value="${esc(f.from)}" ${state.legacy?'disabled':''} required></label><label class="field" for="filter-to">結束日期<input type="date" id="filter-to" name="to" value="${esc(f.to)}" ${state.legacy?'disabled':''} required></label><label class="field" for="filter-activity">活動<select id="filter-activity" name="activity" ${state.legacy?'disabled':''}>${Object.entries(ACTIVITY_LABELS).map(([value,label])=>`<option value="${value}" ${f.activity===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field" for="filter-attempt">觀察哪次表現<select id="filter-attempt" name="attempt" ${state.legacy?'disabled':''}><option value="latest" ${f.attempt==='latest'?'selected':''}>最近一次</option><option value="first" ${f.attempt==='first'?'selected':''}>首次嘗試</option></select></label></div><p class="helper">日期按 UTC 劃分；每次最多 31 天。畫面的時間以香港時間顯示。</p></details><div class="filter-note"><p class="applied-scope"><strong>目前顯示：${esc(scopeLabel())}</strong><span>${state.legacy?'舊版單班摘要':esc(f.from+' 至 '+f.to)+' · '+esc(ACTIVITY_LABELS[f.activity])+' · '+(f.attempt==='first'?'首次':'最近')+'嘗試'}</span></p><button class="button quiet small" type="button" data-action="reset-filters" ${state.legacy?'hidden':''}>重設</button></div><p class="filter-dirty" id="filter-dirty" role="status" hidden>條件尚未套用，下方仍是原來的紀錄。<button type="submit">套用新條件</button></p></form>`;
}
function draftFilters(){const form=document.querySelector('#teacher-filters'),next={...state.filters};if(form)for(const key of ['grade','cls','from','to','attempt','activity'])if(form.elements[key]&&!form.elements[key].disabled)next[key]=form.elements[key].value;return next;}
function markFilterDraft(){const draft=draftFilters(),dirty=Object.keys(state.filters).some(key=>draft[key]!==state.filters[key]);if(dirty&&(state.assistantJob?.status==='running'||state.documentJob?.status==='running'))clearTeacherTools();document.querySelector('#filter-dirty').hidden=!dirty;for(const el of document.querySelectorAll('[data-date-offset]'))el.setAttribute('aria-pressed',String(draft.from===dayOffset(Number(el.dataset.dateOffset))&&draft.to===dayOffset(0)));document.querySelector('#advanced-filter-summary').textContent=draft.from+' — '+draft.to;renderTeacherTools();}
async function applyFilters(next){if(!state.legacy&&!rangeValid(next)){const detail=document.querySelector('.filter-details');if(detail)detail.open=true;toast('請選擇有效日期，開始至結束日期最多 31 天。');return false;}if(filterKey(next)!==filterKey(state.filters))clearTeacherTools();state.filters=next;state.search='';state.studentFilter='all';state.constructFilter='';renderFilters();renderTeacherTools();await loadData();return !!state.data;}
function scopeLabel(){return `${state.filters.grade?state.filters.grade+' 年級':'全校'}${state.filters.cls?' · '+state.filters.cls+' 班':''}`;}
function rangeValid(f=state.filters){const a=new Date(f.from+'T00:00:00Z'),b=new Date(f.to+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(f.from)&&/^\d{4}-\d{2}-\d{2}$/.test(f.to)&&Number.isFinite(a.getTime())&&Number.isFinite(b.getTime())&&a.toISOString().slice(0,10)===f.from&&b.toISOString().slice(0,10)===f.to&&b>=a&&(b-a)/86400000<31;}
async function loadData(){
 const generation=++state.generation;state.detailRequest?.abort();state.detailStudent=null;state.detailData=null;if(dialog.open)dialog.close();state.request?.abort();const controller=new AbortController();state.request=controller;state.data=null;state.page=0;
 const host=document.querySelector('#dashboard-content');if(!host)return;
 if(!state.legacy&&!rangeValid()){host.innerHTML='<p class="status-strip error" role="alert">請選擇有效日期，開始至結束日期最多 31 天。</p>';return;}
 host.innerHTML='<div class="data-loading" role="status"><span class="loader" aria-hidden="true"></span><p>正在整理學習紀錄</p></div>';
 try{
  const data=state.legacy?await loadLegacy(controller.signal):await requestJSON(analyticsQuery(selectionQuery()),{signal:controller.signal});
  if(generation!==state.generation)return;if(!Array.isArray(data.students))throw new Error('學生紀錄格式不完整');state.data=data;if(state.studentFilter==='unstarted'&&!absenceReliable())state.studentFilter='all';renderDashboard();
 }catch(error){if(generation!==state.generation)return;if(error.status===401||error.status===403){clearPrivate();renderLogin(state.legacy?'存取碼不正確或已更新，請重新輸入。':'登入已失效，請重新登入。');return;}host.innerHTML=`<div class="status-strip error" role="alert">${error.code==='NARROW_DATE_OR_CLASS_FILTER'?'紀錄較多，請縮短日期範圍，或選擇一個年級、班別。':error.code==='ANALYTICS_PENDING_SYNC'?'學習紀錄正在準備首次同步，請稍後更新。':error.code==='RESEARCH_DISABLED'?'學習紀錄尚未啟用，請聯絡平台管理員。':error.name==='AbortError'?'讀取時間較長，請稍後重試。':'暫時未能取得紀錄，請重新載入。'}</div><button class="button" data-action="refresh">重新載入</button>`;document.querySelector('#sync-state').textContent='本次更新未完成';}
 finally{if(generation===state.generation)state.request=null;}
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
function practiceCount(row){return number(selectedSummary(row).clientReported?.measuredN);}
function recordsReady(){return state.data&&state.data.sync?.status!=='unavailable';}
function absenceReliable(){return !state.legacy&&!state.rosterError&&Array.isArray(state.roster)&&recordsReady()&&['direct','current','fresh','ready','ok','synced','live','published'].includes(state.data.sync?.status);}
function supportSignals(row){
 const selected=selectedSummary(row);if(state.legacy){const value=readingScore(row);return value!==null&&value<60?[{key:'reading.pronunciation',label:'朗讀發音',source:'舊版摘要',score:value}]:[];}
 return Object.entries(CONSTRUCTS).flatMap(([key,label])=>['serverVerified','clientReported'].flatMap(source=>{const metric=selected.byConstruct?.[key]?.[source],value=score(metric?.meanScore);return metric?.measuredN>0&&value!==null&&value<60?[{key,label,source:source==='serverVerified'?'伺服器評測':'學生端回報',score:value}]:[];}));
}
function studentMatches(row,filter=state.studentFilter,construct=state.constructFilter){if(construct&&!supportSignals(row).some(signal=>signal.key===construct))return false;return filter==='active'?isActive(row):filter==='unstarted'?absenceReliable()&&!!row.person.id&&!isActive(row):filter==='support'?supportSignals(row).length>0:filter==='completed'?row.completedN>0:filter==='unmeasured'?recordsReady()&&isActive(row)&&readingScore(row)===null:true;}
function selectedStudents(){const term=state.search.trim().toLowerCase();return joinedStudents().filter(row=>studentMatches(row)&&(!term||[row.person.displayName,row.researchId,row.person.classNo,row.grade+row.cls,row.person.login].some(value=>String(value??'').toLowerCase().includes(term))));}
function showStudentGroup(filter='all',construct=''){state.view='students';state.studentFilter=filter;state.constructFilter=construct;state.search='';state.page=0;renderDashboard();const list=document.querySelector('#student-list');list?.scrollIntoView({block:'start',behavior:'instant'});list?.querySelector('h2')?.focus({preventScroll:true});}
function activeStatus(row){return !recordsReady()?['等待同步','']:!isActive(row)?[absenceReliable()?'期內未有紀錄':'暫未見已同步紀錄','']:number(row.completedN)>0?['有完成紀錄','green']:['已有練習紀錄','blue'];}

function kpi(label,value,note,unit=''){return `<article class="kpi"><div class="kpi-accent"></div><p class="kpi-label">${esc(label)}</p><p class="kpi-value">${esc(value)}${unit?`<small>${esc(unit)}</small>`:''}</p><p class="kpi-note">${esc(note)}</p></article>`;}
function renderDashboard(){
 if(!state.data)return;
 const descriptions={overview:['全校學習總覽','了解參與情況，安排下一次教學。'],students:['學生練習紀錄','按年級、班別與學號排列，查看個人學習歷程。'],quality:['資料品質與匯出','先了解資料涵蓋範圍，再解讀學習成果。']};
 document.querySelector('#view-title').textContent=state.view==='overview'?scopeLabel()+'學習總覽':descriptions[state.view][0];document.querySelector('#view-description').textContent=descriptions[state.view][1];
 document.querySelectorAll('[data-view]').forEach(el=>{if(el.dataset.view===state.view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 const sync=state.data.sync||{};document.querySelector('#sync-state').innerHTML=`<span class="sync-dot"></span>${state.legacy?'摘要更新':'資料整理'}：${esc(timestamp(state.data.generatedAt))}${sync.lastImportedAt?' · 最近同步 '+esc(timestamp(sync.lastImportedAt)):''}`;
 const content=document.querySelector('#dashboard-content');let note='';
 if(state.legacy)note='<p class="status-strip warning">舊版資料：只顯示這個班別已同步的最新摘要。沒有全校名冊、完整嘗試歷程及研究事件。</p>';
 else if(state.rosterError)note='<p class="status-strip warning">名冊暫時未能載入，只列出有紀錄的研究代碼。參與率與未開始人數暫不計算。<button class="button small" data-action="retry-roster">重試名冊</button></p>';
 if(sync.status==='unavailable')note+='<p class="status-strip warning">研究紀錄尚未完成首次同步。此時的空白不代表學生沒有練習，請稍後更新。</p>';
 else if(sync.status==='attention')note+='<p class="status-strip warning">部分紀錄待修復，目前顯示可用的已同步資料。未有紀錄的人數暫不判斷，可在資料與匯出查看處理狀態。</p>';
 else if(sync.status==='catching_up')note+='<p class="status-strip warning">正在補齊同步，資料未齊。現有數字只代表已同步部分，請稍後更新再作教學判斷。</p>';
 else if(sync.status==='published')note+='<p class="status-strip">目前顯示已同步的研究資料，最新練習會在下次同步後出現。</p>';
 else if(sync.status&& !['direct','current','fresh','ready','ok','synced','live'].includes(sync.status))note+='<p class="status-strip warning">部分紀錄可能尚在同步，請以最近同步時間及資料品質說明為準。</p>';
 content.innerHTML=note+(state.view==='overview'?overview():state.view==='students'?studentList():quality());updateExportProgress();renderTeacherTools();
}
function overview(){
 const students=joinedStudents(),active=students.filter(isActive),completed=students.filter(row=>row.completedN>0),support=students.filter(row=>supportSignals(row).length),missing=students.filter(row=>row.person.id&&!isActive(row));
 const rosterN=!state.legacy&&!state.rosterError&&state.roster?filteredRoster().length:null,ready=recordsReady(),reliable=absenceReliable();
 const actionCard=(label,value,note,filter,tone='',disabled=false)=>`<button class="kpi action-kpi ${tone}" data-student-filter="${filter}" ${disabled?'disabled':''}><span class="kpi-label">${label}</span><span class="kpi-value">${esc(value)}<small>人</small></span><span class="kpi-note">${esc(note)}</span><span class="kpi-link">查看學生 <span aria-hidden="true">↗</span></span></button>`;
 const cards=actionCard('有練習紀錄',ready?String(active.length):'—',!ready?'等候首次同步':rosterN===null?'名冊人數未提供':`名冊 ${rosterN} 人`,'active')+actionCard('期內未有紀錄',reliable?String(missing.length):'—',reliable?'先確認學生是否已開始':state.rosterError?'等候名冊載入':'資料未齊，暫不判斷','unstarted','neutral',!reliable)+actionCard('可再給予支持',ready?String(support.length):'—','至少一項已測分項低於 60 分','support','warm',!ready)+actionCard('有完成紀錄',!state.legacy&&ready?String(completed.length):'—',state.legacy?'舊版未提供完成事件':'至少完成一項活動','completed','neutral',state.legacy||!ready);
 const cohort=filteredRoster(),groups=new Map();
 for(const person of cohort){const key=state.filters.grade?person.grade+person.cls:String(person.grade);if(!groups.has(key))groups.set(key,{grade:person.grade,cls:state.filters.grade?person.cls:'',label:state.filters.grade?person.grade+person.cls:person.grade+' 年級',total:0,active:0});const group=groups.get(key);group.total++;if(students.some(row=>row.researchId===person.researchId&&isActive(row)))group.active++;}
 if(!groups.size)for(const row of state.filters.grade?state.data.byClass||[]:state.data.byGrade||[])groups.set(String(row.grade)+(row.cls||''),{grade:row.grade,cls:row.cls||'',label:row.grade+(row.cls||' 年級'),active:row.nStudents||0,total:null});
 const groupRows=[...groups.values()].sort((a,b)=>a.grade-b.grade||a.cls.localeCompare(b.cls));
 const bars=groupRows.length?`<div class="progress-list">${groupRows.map(group=>`<button class="cohort-row" data-group-grade="${group.grade}" data-group-class="${esc(group.cls)}"><span>${esc(group.label)}</span><span class="bar-track" role="img" aria-label="${esc(group.label)}，${ready?group.active+' 人有紀錄':'等待同步'}${group.total===null?'':`，名冊 ${group.total} 人`}"><span class="bar-fill" style="width:${ready&&group.total?Math.min(100,group.active/group.total*100):0}%"></span></span><span class="bar-value">${ready?group.active:'—'}${group.total===null?' 人':' / '+group.total}</span><span aria-hidden="true">›</span></button>`).join('')}</div><div class="legend"><span><i></i>有紀錄學生</span><span><i class="pale"></i>名冊內其餘學生</span></div>`:empty('暫時沒有可分組的紀錄','載入名冊後可查看每一班。');
 const attention=support.slice(0,4),attentionHTML=attention.length?`<ul class="attention-list">${attention.map(row=>{const signals=supportSignals(row);return `<li class="attention-item"><div class="person"><span class="avatar">${esc(row.grade+row.cls)}</span><div><p class="student-name">${esc(row.person.displayName)}</p><p class="student-meta">${esc(row.grade+row.cls)} 班${row.person.classNo?' · '+row.person.classNo+' 號':''}</p><p class="attention-reason">${esc(signals.slice(0,2).map(signal=>signal.label+' '+shown(signal.score,1)+' 分（'+signal.source+'）').join(' · '))}</p></div></div><button class="button small" data-student="${esc(row.researchId)}">查看</button></li>`;}).join('')}</ul><button class="button quiet support-all" data-student-filter="support">查看全部 ${support.length} 位學生 →</button>`:empty(ready?'目前沒有低於 60 分的分項紀錄':'等候學習紀錄同步','未測與沒有紀錄都不當作低分。');
 const skills=state.legacy&&state.data.legacyPhonics?renderLegacySkills(state.data.legacyPhonics):readingWordPractice(state.data);
 return `<div class="kpi-grid teaching-actions">${cards}</div><div class="dashboard-grid">${panel(state.filters.grade?'班級參與情況':'六個年級，一眼掌握','點選年級或班別，進一步查看。',bars)}${panel('下一次可以陪誰練習','按班別與學號排列；低分是查看線索，需要結合練習內容。',attentionHTML)}${teachingConstructs(students)}<details class="panel wide observation-more"><summary>可以再練的字與學習節奏<span>需要時再展開</span></summary><div class="observation-grid"><section><h2>${state.legacy?'語音練習觀察':'可以再練的字'}</h2><p class="panel-subtitle">逐字評測中的低分紀錄，不推測聲母、韻母或聲調問題。</p>${skills}</section><section><h2>這段時間的學習節奏</h2><p class="panel-subtitle">每日有紀錄的人數；同一學生可在不同日出現。</p>${trendChart(state.data.trend||[],'participation')}</section></div></details></div>`;
}
function teachingConstructs(students){
 const summary=state.data.summary||{},cards=[];
 for(const [key,label]of Object.entries(CONSTRUCTS)){
  const group=summary.byConstruct?.[key];if(!group)continue;
  const sources=['serverVerified','clientReported'].filter(source=>group[source]?.measuredN>0||group[source]?.unmeasuredN>0);
  if(!sources.length)continue;const needing=students.filter(row=>supportSignals(row).some(signal=>signal.key===key)).length;
  cards.push(`<article class="construct-card teaching-construct"><h3>${label}</h3>${sources.map(source=>{const metric=group[source],value=score(metric.meanScore);return `<div class="construct-source"><span>${source==='serverVerified'?'伺服器評測':'學生端回報'}</span><strong>${value===null?'未測':shown(value,1)+' 分'}</strong><div class="construct-bar" aria-hidden="true"><span style="width:${value??0}%"></span></div><p>${shown(metric.measuredN)} 筆有效測量${metric.unmeasuredN>0?' · '+shown(metric.unmeasuredN)+' 筆未測':''}</p></div>`;}).join('')}<button class="construct-support" data-student-filter="support" data-construct="${key}" ${needing?'':'disabled'}>${needing?'查看 '+needing+' 位可再練的學生':'目前無低分分項學生'}${needing?' →':''}</button></article>`);
 }
 return cards.length?panel('哪類練習可以再加強','各分項與來源獨立計算；點選分項查看學生，不合併成總分。',`<div class="construct-grid">${cards.join('')}</div>`,true):panel('分項表現正在累積','有有效測量後，會分開顯示發音、聽寫與字音等表現。',empty('先讓學生完成一次練習','沒有分數時不給學生貼上弱項標籤。'),true);
}

function renderLegacySkills(phonics){const entries=Object.entries(phonics).filter(([,v])=>score(v)!==null);return entries.length?`<div class="skill-list">${entries.map(([label,v])=>`<div><div class="skill-header"><span>${esc(label)}</span><span>${shown(v,1)} 分</span></div><div class="skill-track" role="img" aria-label="${esc(label)}，${v} 分"><span style="width:${v}%"></span></div></div>`).join('')}</div>`:empty('尚未有語音細項成績');}
function readingWordPractice(data){
 const words=(Array.isArray(data.readingWords)?data.readingWords:[]).filter(word=>typeof word.char==='string'&&word.count>0&&word.below60Count>0&&score(word.meanScore)!==null),visible=words.slice(0,8);
 if(!visible.length)return empty(data.readingWordSummary?.totalGroups>0?'目前沒有需要重練的字音紀錄':'尚未有逐字評測紀錄',data.readingWordSummary?.totalGroups>0?'所選範圍內，已驗證的逐字評測沒有低於 60 分的紀錄。':'逐字評測同步後會列出可重練的字；不由總分推斷聲母、韻母或聲調問題。');
 return `<ul class="word-practice-list">${visible.map(word=>{const poem=state.poems.find(p=>Number(p.id)===Number(word.poemId)),line=/\.l(\d+)$/.exec(String(word.itemId)),position=line?'第 '+(Number(line[1])+1)+' 句':'';return `<li><strong class="word-practice-glyph">${esc(word.char)}</strong><div><h3>${esc(poem?.title||'第 '+word.poemId+' 首古詩')}${position?' · '+position:''}</h3><p>${shown(word.below60Count)} / ${shown(word.count)} 次低於 60 分 · 均分 ${shown(word.meanScore,1)}</p></div></li>`;}).join('')}</ul>${data.readingWordSummary?.truncated||words.length>visible.length?'<p class="helper">還有其他字音紀錄，可選年級或班別進一步查看。</p>':''}`;
}
function studentList(){
 const all=joinedStudents(),filtered=selectedStudents(),size=20,pages=Math.max(1,Math.ceil(filtered.length/size));state.page=Math.min(state.page,pages-1);const page=filtered.slice(state.page*size,(state.page+1)*size);
 const options=[['all','全部學生',all.length],['active','有練習紀錄',recordsReady()?all.filter(isActive).length:null],['unstarted','期內未有紀錄',absenceReliable()?all.filter(row=>row.person.id&&!isActive(row)).length:null],['support','可再給予支持',recordsReady()?all.filter(row=>supportSignals(row).length).length:null],['unmeasured','未有朗讀評測',recordsReady()?all.filter(row=>isActive(row)&&readingScore(row)===null).length:null],['completed','有完成紀錄',recordsReady()&&!state.legacy?all.filter(row=>row.completedN>0).length:null]];
 const rows=page.map(row=>{const [status,tone]=activeStatus(row),signals=supportSignals(row);return `<tr><td><button class="name-button" data-student="${esc(row.researchId)}">${esc(row.person.displayName)}</button><p class="student-meta">${esc(row.grade+row.cls)} 班${row.person.classNo?' · '+esc(row.person.classNo)+' 號':''}</p>${signals.length?`<p class="student-support-note">${esc([...new Set(signals.map(signal=>signal.label))].join('、'))}可再練</p>`:''}</td><td><span class="mobile-label">參與</span><span class="tag ${tone}">${status}</span></td><td><span class="mobile-label">朗讀</span>${scoreMarkup(readingScore(row))}</td><td><span class="mobile-label">有效練習</span><span>${isActive(row)?shown(practiceCount(row))+' 筆':'—'}</span></td><td><span class="mobile-label">嘗試</span><span class="mono">${isActive(row)?shown(row.nAttempts):'—'}</span></td><td class="muted">${esc(row.lastSeenAt?timestamp(row.lastSeenAt):'未有紀錄')}</td><td><button class="button small" data-student="${esc(row.researchId)}" aria-label="查看${esc(row.person.displayName)}的歷程">查看歷程 <span aria-hidden="true">→</span></button></td></tr>`;}).join('');
 const selected=options.find(([key])=>key===state.studentFilter)?.[1]||'全部學生';
 return `<section class="panel" id="student-list"><div class="list-toolbar"><div><h2 tabindex="-1">每位學生的學習情況</h2><p class="helper">${esc(scopeLabel())} · ${all.length} 人 · 按班別與學號排列</p></div><label class="search-field"><span class="sr-only">搜尋姓名、班別、學號或研究代碼</span><input type="search" id="student-search" value="${esc(state.search)}" placeholder="搜尋姓名、班別或學號" autocomplete="off"></label></div><div class="student-filter-tabs" role="group" aria-label="按學習情況篩選">${options.map(([key,label,count])=>`<button type="button" data-student-filter="${key}" aria-pressed="${state.studentFilter===key}" ${count===null?'disabled':''}>${label}<span>${count===null?'—':count}</span></button>`).join('')}</div>${state.studentFilter==='support'?`<div class="support-filter-row"><label class="field" for="student-construct">查看哪一項<select id="student-construct"><option value="">全部低分分項</option>${Object.entries(CONSTRUCTS).map(([key,label])=>`<option value="${key}" ${state.constructFilter===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="helper">所選嘗試中，至少一項有效分項均分低於 60；未測不列入。</p></div>`:''}<p class="list-result" role="status">${esc(selected)}${state.constructFilter?' · '+esc(CONSTRUCTS[state.constructFilter]):''}：${filtered.length} 人${state.search?' · 符合搜尋':''}</p>${rows?`<div class="table-area"><table class="student-table"><thead><tr><th scope="col">學生</th><th scope="col">參與情況</th><th scope="col">朗讀</th><th scope="col">有效練習</th><th scope="col">嘗試次數</th><th scope="col">最近紀錄</th><th scope="col">歷程</th></tr></thead><tbody>${rows}</tbody></table></div><div class="list-summary"><span>未測不是 0 分；沒有本期紀錄不代表從未練習。</span></div><div class="pagination"><button class="button small" data-page="${state.page-1}" ${state.page===0?'disabled':''}>上一頁</button><span>${state.page+1} / ${pages} · 共 ${filtered.length} 人</span><button class="button small" data-page="${state.page+1}" ${state.page+1>=pages?'disabled':''}>下一頁</button></div>`:empty('這個範圍沒有符合的學生','可以清除搜尋，或查看全部學生。')+`<button class="button" data-student-filter="all">查看全部學生</button>`}</section>`;
}
function updateStudentList(){const previous=document.querySelector('#student-list');if(previous)previous.outerHTML=studentList();}

function quality(){
 if(state.legacy)return panel('舊版資料範圍','這個入口只保留單班的最新摘要。','<dl class="definition-list"><div><dt>成績來源</dt><dd>歷史摘要的朗讀與寫字分數，沒有完整的評測來源與嘗試事件，不能重新核實。</dd></div><div><dt>尚未提供</dt><dd>全校名冊、首次嘗試、完整過程、事件匯出及研究資料字典。</dd></div><div><dt>缺失與 0 分</dt><dd>沒有成績顯示未測；明確保存的 0 分仍顯示 0。</dd></div></dl>',true);
 const coverage=state.data.coverage||{},summary=state.data.summary||{},server=summary.serverVerified||{},client=summary.clientReported||{},sync=state.data.sync||{},integrity=sync.integrity;
 const items=[['事件紀錄',coverage.nEvents,'所選日期與範圍內'],['已驗證測量',server.measuredN,'有有效分數的伺服器評測'],['練習回報',client.measuredN,'由學生端回報的測量'],['排除紀錄',coverage.nInvalidEvents,'未通過資料品質檢查']];
 const exportBody=DEMO?'<p class="status-strip">這裏是模擬資料。請使用上方的 Excel 或 Word 按鈕測試下載。</p>':`<div class="export-box"><div><h3>匯出目前範圍</h3><p>${esc(scopeLabel())} · ${esc(state.filters.from+' 至 '+state.filters.to)} · ${esc(ACTIVITY_LABELS[state.filters.activity])}</p><p>包含完整歷程與資料字典，不限首次／最近。檔案只使用研究代碼，不附姓名、密碼或錄音。</p></div><div class="export-actions"><button class="button primary" data-export="csv">${icon('download')}匯出 CSV</button><button class="button" data-export="jsonl">JSONL</button></div></div><div id="export-progress"></div>`;
 const integrityBody=integrity?`<div class="sync-integrity"><h3>待補齊的紀錄</h3><p>待處理 ${shown(integrity.pendingObjects)} 項 · 完整性問題 ${shown(integrity.integrityIssues)} 項 · 等候重試 ${shown(integrity.retryPending)} 項</p><p>最近嘗試：${esc(timestamp(integrity.lastAttemptAt))}${integrity.oldestPendingAt?' · 最早待處理：'+esc(timestamp(integrity.oldestPendingAt)):''}</p></div>`:'';
 return `<div class="dashboard-grid">${panel('匯出學習紀錄','逐頁核對完整性，全部完成後才會下載。',exportBody,true)}${panel('資料是否已經齊備','未完成同步的空白，不代表學生沒有練習。',`<div class="quality-grid">${items.map(([label,value,note])=>`<article class="quality-item"><h3>${label}</h3><strong>${shown(value)}</strong><p>${note}</p></article>`).join('')}</div><dl class="definition-list sync-facts"><div><dt>目前狀態</dt><dd>${esc(sync.status==='attention'?'部分紀錄待修復':sync.status==='catching_up'?'正在補齊同步':sync.status==='unavailable'?'等待首次同步':sync.status==='direct'?'直接讀取資料庫':'顯示已同步紀錄')}</dd></div><div><dt>資料整理</dt><dd>${esc(timestamp(state.data.generatedAt))}</dd></div><div><dt>最近匯入</dt><dd>${esc(sync.status==='direct'?'直接讀取，無需匯入':timestamp(sync.lastImportedAt))}</dd></div><div><dt>名冊狀態</dt><dd>${state.rosterError?'未能載入，暫不計算未有紀錄的人數':'已載入 '+filteredRoster().length+' 人'}</dd></div></dl>${integrityBody}`,true)}<details class="panel wide observation-more"><summary>怎樣解讀這些數字<span>資料定義與限制</span></summary><dl class="definition-list"><div><dt>名冊與參與</dt><dd>沒有本期紀錄的學生仍保留在名冊，不能據此判定整學期從未練習。同步未齊時，不判斷誰未開始。</dd></div><div><dt>首次／最近</dt><dd>在所選日期內，按每位學生、古詩、活動、題目、內容版本與模式選取首次或最近嘗試。同次嘗試只取最後結果；輔助與自由練習不計入獨立表現均分。</dd></div><div><dt>未測與 0 分</dt><dd>未測不是 0 分。明確回傳的有效 0 分仍計入測量；不把缺失資料當作學生表現欠佳。</dd></div><div><dt>分項與來源</dt><dd>發音、聽寫、字音辨認等各自計算。伺服器評測與學生端回報分開解讀，不相加成總分。</dd></div><div><dt>可以再練的字</dt><dd>使用逐字評測中低於 60 分的紀錄，並非聲母、韻母或聲調的診斷。</dd></div><div><dt>資料字典</dt><dd>${esc(state.data.dictionaryVersion||'未提供')} · 輔助／自由練習 ${shown(summary.practiceOutcomeN)} 筆結果</dd></div><div><dt>未測紀錄</dt><dd>伺服器測量 ${shown(server.unmeasuredN)} 筆 · 學生端回報 ${shown(client.unmeasuredN)} 筆</dd></div></dl></details>${modeBreakdown(summary)}</div>`;
}

function modeBreakdown(summary){
 if(!summary?.byMode)return '';
 const modes=[['standard','標準練習'],['advanced','進階練習'],['review','輔助重練'],['free','自由練習'],['unspecified','未標示模式']];
 const list=modes.filter(([key])=>summary.byMode[key]?.nOutcomeEvents>0);
 if(!list.length)return '';
 return `<details class="mode-details panel wide"><summary>各模式的練習紀錄</summary><p class="helper">不同模式分開查看；輔助與自由練習不計入獨立表現均分。</p><dl class="definition-list">${list.map(([key,label])=>{const mode=summary.byMode[key],practice=['review','free'].includes(key);return `<div><dt>${label}</dt><dd>${shown(mode.nOutcomeEvents)} 筆結果${practice?' · 用作練習過程紀錄':` · 已驗證測量 ${shown(mode.serverVerified?.measuredN)} 筆 · 有效練習回報 ${shown(mode.clientReported?.measuredN)} 筆`}</dd></div>`;}).join('')}</dl></details>`;
}
function constructBreakdown(summary,compare=null){
 if(!summary?.byConstruct)return '';
 const labels={'reading.pronunciation':'朗讀發音','writing.dictation':'聽寫辨字','sound.recognition':'字音辨認','match.accuracy':'配對練習','sequence.accuracy':'排序練習','scene_builder.accuracy':'情境選擇'},sources=[['serverVerified','伺服器評測'],['clientReported','學生端回報']];
 const groups=Object.entries(labels).map(([key,label])=>{const measured=summary.byConstruct[key]||{},rows=sources.filter(([source])=>measured[source]?.measuredN>0||measured[source]?.unmeasuredN>0||compare?.first?.byConstruct?.[key]?.[source]?.measuredN>0||compare?.latest?.byConstruct?.[key]?.[source]?.measuredN>0).map(([source,sourceLabel])=>{const metric=measured[source]||{},first=compare?.first?.byConstruct?.[key]?.[source],latest=compare?.latest?.byConstruct?.[key]?.[source];return `<div class="construct-source"><span>${sourceLabel}</span><strong>${score(metric.meanScore)===null?'未測':shown(metric.meanScore,1)+' 分'}</strong><p>${shown(metric.measuredN)} 筆有效測量${metric.unmeasuredN>0?' · '+shown(metric.unmeasuredN)+' 筆未測':''}</p>${compare?`<p>首次 ${score(first?.meanScore)===null?'未測':shown(first.meanScore,1)+' 分'} · 最近 ${score(latest?.meanScore)===null?'未測':shown(latest.meanScore,1)+' 分'}</p>`:''}</div>`;}).join('');return rows?`<article class="construct-card"><h3>${label}</h3>${rows}</article>`:'';}).filter(Boolean);
 return groups.length?panel('分項學習表現','發音、字音辨認與聽寫分開計算；不同題目及模式的分數仍需配合教學內容解讀。',`<div class="construct-grid">${groups.join('')}</div>`,true):'';
}
function trendChart(rows,kind){
 const points=rows.map(r=>({date:r.date,time:Date.parse(r.date+'T00:00:00Z'),value:kind==='participation'?number(r.nStudents):score(readingMetric(r).meanScore)})).filter(p=>p.value!==null&&Number.isFinite(p.time)).sort((a,b)=>a.time-b.time);
 if(!points.length)return empty(kind==='participation'?'期內還沒有學習節奏紀錄':'尚未有足夠的朗讀紀錄','資料累積後會顯示；不將缺失日期補成 0 分。');
 const max=kind==='participation'?Math.max(...points.map(p=>p.value),1):100,w=540,h=180,left=36,right=18,top=16,bottom=30,span=points.at(-1).time-points[0].time;const xs=points.map(p=>left+(w-left-right)*(span?(p.time-points[0].time)/span:.5)),ys=points.map(p=>h-bottom-(h-top-bottom)*p.value/max);
 const label=points.map(p=>`${p.date}：${shown(p.value,1)}${kind==='participation'?'人':'分'}`).join('；');
 return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(kind==='participation'?'每日有紀錄學生人數':'每日已驗證朗讀均分')}</title>${[0,.5,1].map(f=>`<line x1="${left}" x2="${w-right}" y1="${h-bottom-(h-top-bottom)*f}" y2="${h-bottom-(h-top-bottom)*f}" stroke="#e4e9e0"/><text x="${left-8}" y="${h-bottom-(h-top-bottom)*f+4}" text-anchor="end" class="chart-label">${shown(max*f)}</text>`).join('')}${points.length>1?`<polyline points="${points.map((_,i)=>`${xs[i]},${ys[i]}`).join(' ')}" fill="none" stroke="#47765b" stroke-width="2.5"/>`:''}${points.map((p,i)=>`<circle cx="${xs[i]}" cy="${ys[i]}" r="3.5" fill="#47765b"><title>${esc(p.date)}：${p.value}</title></circle>`).join('')}<text x="${left}" y="${h-6}" class="chart-label">${esc(points[0].date.slice(5))}</text><text x="${w-right}" y="${h-6}" text-anchor="end" class="chart-label">${esc(points.at(-1).date.slice(5))}</text></svg><p class="chart-accessible">${points.length} 個有資料的日期${kind==='participation'?'':' · 各日題目可能不同，變化不直接等於能力增減'}</p>`;
}
async function openStudent(researchId,{keepTab=false}={}){
 const student=joinedStudents().find(row=>row.researchId===researchId);if(!student)return;state.detailStudent=student;state.detailData=null;if(!keepTab)state.detailTab='learning';state.detailRequest?.abort();const controller=new AbortController();state.detailRequest=controller;
 document.querySelector('#student-dialog-content').innerHTML=detailShell(student,'<div class="empty"><span class="loader"></span><p>正在取得個人歷程</p></div>',false);if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
 try{const data=state.legacy?state.data:await requestJSON(analyticsQuery(selectionQuery({student:researchId,grade:student.grade,cls:student.cls})),{signal:controller.signal});if(controller.signal.aborted)return;state.detailData=data;
  const record=data.students?.find(row=>row.researchId===researchId)||student;document.querySelector('#student-dialog-content').innerHTML=detailShell(student,detailBody(record,data));
 }catch(error){if(controller.signal.aborted)return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}document.querySelector('#student-dialog-content').innerHTML=detailShell(student,empty('個人歷程暫時未能載入','目前範圍與學生選擇已保留。')+'<button class="button primary" data-action="retry-detail">重新載入</button>',false);}
}
function detailShell(student,body,ready=true){
 const cohort=selectedStudents(),index=cohort.findIndex(row=>row.researchId===student.researchId);
 const navigation=index>=0?`<div class="detail-navigation"><button class="button small" data-detail-next="-1" ${index===0?'disabled':''}>上一位</button><span>${index+1} / ${cohort.length} 位學生</span><button class="button small" data-detail-next="1" ${index===cohort.length-1?'disabled':''}>下一位</button></div>`:'';
 return `<header class="dialog-header"><div><p class="eyebrow">學生學習歷程</p><h2 id="student-dialog-title">${esc(student.person.displayName)}</h2><p class="helper">${esc(student.grade+student.cls)} 班${student.person.classNo?' · '+esc(student.person.classNo)+' 號':''} · ${esc(state.filters.from)} 至 ${esc(state.filters.to)}</p></div><button class="button icon-only" data-action="close-dialog" aria-label="關閉學生歷程">×</button></header><div class="dialog-body">${navigation}${ready?`<div class="detail-tabs" role="tablist" aria-label="學生歷程內容"><button role="tab" id="detail-tab-learning" aria-controls="detail-learning" aria-selected="${state.detailTab==='learning'}" tabindex="${state.detailTab==='learning'?0:-1}" data-detail-tab="learning">表現與字音</button><button role="tab" id="detail-tab-history" aria-controls="detail-history" aria-selected="${state.detailTab==='history'}" tabindex="${state.detailTab==='history'?0:-1}" data-detail-tab="history">練習歷程</button></div>`:''}${body}${ready&&!DEMO&&!state.legacy&&student.person.id?`<details class="password-reset-section"><summary>帳戶協助</summary><button class="button quiet small" data-action="confirm-reset">重設學生密碼</button><div id="student-password-reset"></div></details>`:''}</div>`;
}

function detailBody(record,data){
 const first=record.first||{},latest=record.latest||{},firstScore=score(readingMetric(first).meanScore),latestScore=score(readingMetric(latest).meanScore);
 const cards=kpi('首次朗讀',shown(firstScore,1),'所選範圍的首次嘗試','分')+kpi('最近朗讀',shown(latestScore,1),'所選範圍的最近嘗試','分')+kpi('嘗試次數',isActive(record)?shown(record.nAttempts):'—','不同活動的嘗試紀錄','次');
 const signals=supportSignals(record),suggestion=signals.length?`<div class="detail-guidance"><h3>下一次可以一起練</h3><ul>${signals.map(signal=>`<li><strong>${esc(signal.label)}</strong><span>${shown(signal.score,1)} 分 · ${esc(signal.source)}</span></li>`).join('')}</ul><p>這是所選嘗試的分項紀錄，請配合題目內容安排練習。</p></div>`:!isActive(record)?'<p class="status-strip">所選範圍暫未見練習紀錄，可以調整日期或確認同步狀態。</p>':'<p class="status-strip">目前沒有低於 60 分的已測分項；未測項目仍需等待有效紀錄。</p>';
 const daily=(data.trend||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 return `<section id="detail-learning" role="tabpanel" aria-labelledby="detail-tab-learning" ${state.detailTab==='learning'?'':'hidden'}><div class="kpi-grid">${cards}</div>${suggestion}${constructBreakdown(selectedSummary(record),{first,latest})}${data.readingWordSummary?panel('可以再練的字','逐字評測低於 60 分的紀錄；按詩句位置分開。',readingWordPractice(data)):''}</section><section id="detail-history" role="tabpanel" aria-labelledby="detail-tab-history" ${state.detailTab==='history'?'':'hidden'}>${panel('朗讀變化',state.legacy?'舊版沒有每日評測紀錄。':'不同日期的題目可能不同；沒有分數時留空。',trendChart(data.trend||[],'reading'))}${panel('每日練習歷程','分開觀察嘗試、完成與有效評測。',daily.length?`<ol class="timeline">${daily.map(day=>`<li><time datetime="${esc(day.date)}">${esc(day.date)}</time><div><h3>${shown(day.nAttempts)} 次嘗試 · ${shown(day.completedN)} 項完成紀錄</h3><p>朗讀 ${score(readingMetric(day).meanScore)===null?'未測':shown(readingMetric(day).meanScore,1)+' 分'} · 有效練習 ${shown(day.clientReported?.measuredN)} 筆</p></div></li>`).join('')}</ol>`:empty('尚未有每日歷程',state.legacy?'舊版只保存最新摘要。':''))}${modeBreakdown(data.summary)}</section>`;
}
function switchDetailTab(tab,{focus=false}={}){if(!['learning','history'].includes(tab))return;state.detailTab=tab;for(const button of dialog.querySelectorAll('[data-detail-tab]')){const selected=button.dataset.detailTab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus();}for(const id of ['learning','history']){const panel=dialog.querySelector('#detail-'+id);if(panel)panel.hidden=id!==tab;}}

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
function confirmPasswordReset(){
 const student=state.detailStudent,host=document.querySelector('#student-password-reset');if(DEMO||!student?.person.id||!host)return;
 host.innerHTML=`<div class="reset-confirmation"><h3>確認重設 ${esc(student.person.displayName)} 的密碼？</h3><p>學生所有已登入裝置將登出。新密碼只會在這次畫面顯示，請當面交給學生。</p><div class="form-actions"><button class="button" data-action="cancel-reset">取消</button><button class="button primary" data-action="reset-password">確認重設</button></div><p class="form-error" role="alert" hidden></p></div>`;
 host.querySelector('[data-action=cancel-reset]').focus();
}
async function resetStudentPassword(button){
 const student=state.detailStudent,host=document.querySelector('#student-password-reset');if(DEMO||!student?.person.id||!host)return;
 button.disabled=true;button.textContent='正在重設…';
 try{const result=await requestJSON(AUTH,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.auth?.csrfToken||''},body:JSON.stringify({action:'reset_student_password',studentId:student.person.id})});if(!result.reset||result.studentId!==student.person.id||typeof result.initialPassword!=='string')throw new Error('重設結果未獲確認');if(!host.isConnected||state.detailStudent!==student)return;
  host.innerHTML=`<div class="reset-confirmation"><h3>密碼已重設</h3><p>只在這次畫面顯示，關閉後不會保存。</p><label class="field">${esc(student.person.displayName)} 的新密碼<input id="reset-password-value" type="text" readonly autocomplete="off" spellcheck="false"></label><div class="form-actions"><button class="button primary" data-action="copy-password">複製新密碼</button><button class="button" data-action="cancel-reset">已記下，隱藏密碼</button></div></div>`;host.querySelector('input').value=result.initialPassword;
 }catch(error){if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}if(!host.isConnected)return;const el=host.querySelector('.form-error');if(el){el.textContent=error.status===429?'重設次數較多，請 15 分鐘後再試。':error.status===404?'這位學生的帳戶已停用或不存在。':error.status===409?'學生帳戶已變更，請關閉後重新查看。':'重設結果未獲確認，請檢查連線後再試。';el.hidden=false;}button.disabled=false;button.textContent='確認重設';}
}
async function copyStudentPassword(){const input=document.querySelector('#reset-password-value');if(!input)return;try{await navigator.clipboard.writeText(input.value);toast('已複製新密碼，請妥善交給學生。');}catch{input.focus();input.select();toast('請複製已選取的新密碼。');}}
function updateExportProgress(){
 const job=state.exportJob,host=document.querySelector('#export-progress');
 for(const button of document.querySelectorAll('[data-export]'))button.disabled=job?.status==='running';
 if(!host)return;if(!job){host.replaceChildren();return;}
 const running=job.status==='running',context=`${job.scope} · ${job.from} 至 ${job.to} · ${job.format.toUpperCase()}`;
 host.innerHTML=`<div class="export-progress ${job.status}" role="status"><div><strong>${esc(running?'正在核對匯出紀錄':job.status==='complete'?'檔案已準備完成':job.status==='cancelled'?'已取消匯出':'匯出未完成')}</strong><p>${esc(context)}</p></div>${running?`<progress ${job.total!==null&&job.total>0?`max="${job.total}" value="${job.rows}"`:''} aria-label="匯出紀錄進度"></progress><p>已核對 ${shown(job.pages)} 頁 · ${shown(job.rows)}${job.total!==null?' / '+shown(job.total):''} 筆</p><button class="button small" data-action="cancel-export">取消匯出</button>`:`<p>${esc(job.message||'')}</p>${job.status==='complete'?'':`<button class="button small" data-export="${job.format}">重新匯出 ${job.format.toUpperCase()}</button>`}`}</div>`;
}
function cancelExport(){const job=state.exportJob;if(!job||job.status!=='running')return;job.cancelled=true;job.controller.abort();job.status='cancelled';job.message='沒有下載任何部分檔案；準備好時可以重新匯出。';updateExportProgress();}

function filterKey(filters){return JSON.stringify(Object.fromEntries(['grade','cls','from','to','attempt','activity'].map(key=>[key,String(filters?.[key]??(key==='attempt'?'latest':''))])));}
function filterDescription(filters){return `${filters.grade?filters.grade+' 年級':'全校'}${filters.cls?' · '+filters.cls+' 班':''} · ${filters.from} 至 ${filters.to} · ${ACTIVITY_LABELS[filters.activity||'']||'全部活動'} · ${filters.attempt==='first'?'首次':'最近'}嘗試`;}
function toolPayloadFilters(filters){return Object.fromEntries(Object.entries(filters).filter(([,value])=>value!==''&&value!==null&&value!==undefined));}
function clearTeacherTools(){state.assistantJob?.controller.abort();state.documentJob?.controller.abort();state.assistantJob=null;state.assistantReport=null;state.documentJob=null;state.toolsPreparing=false;}
function toolsScopeChanged(){clearTeacherTools();renderTeacherTools();}
function validReportForScope(){const report=state.assistantReport;return !!report&&filterKey(report.filters)===filterKey(state.filters)&&filterKey(draftFilters())===filterKey(state.filters);}
function renderTeacherTools(){
 const host=document.querySelector('#teacher-tools');if(!host)return;if(state.legacy||state.auth?.user?.role!=='teacher'){host.replaceChildren();return;}
 const draft=draftFilters(),busy=state.toolsPreparing||state.assistantJob?.status==='running'||state.documentJob?.status==='running';
 host.innerHTML=`<section class="teacher-tools-bar" aria-label="教師常用工具"><div class="tools-heading"><span class="tools-mark" aria-hidden="true">教</span><div><h2>教學資料，一鍵下載</h2><p id="teacher-tools-scope">${esc(filterDescription(draft))}</p></div></div><div class="teacher-tools-actions"><button class="button" data-teacher-tool="xlsx" ${busy?'disabled':''}>${icon('download')}匯出 Excel</button><button class="button primary" data-teacher-tool="docx" ${busy?'disabled':''}>${icon('download')}${state.assistantJob?.status==='running'?'正在撰寫報告…':'產生 Word 報告'}</button></div><p class="tools-hint">Excel 查看學生紀錄；Word 由 DeepSeek V4 Pro 寫好學習分析與教學建議，完成後自動下載。</p></section><div id="document-tool-status"></div><div id="teacher-analysis"></div>`;
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

async function exportData(format,button){
 if(DEMO||state.legacy||!state.data||!state.auth||state.exportJob?.status==='running'||!['csv','jsonl'].includes(format))return;
 const epoch=sessionEpoch,authAtStart=state.auth,snapshots={query:selectionQuery(),from:state.filters.from,to:state.filters.to},job={format,scope:scopeLabel(),from:state.filters.from,to:state.filters.to,rows:0,pages:0,total:null,status:'running',message:'',cancelled:false,controller:new AbortController()};state.exportJob=job;updateExportProgress();
 const valid=()=>epoch===sessionEpoch&&state.auth===authAtStart&&state.exportJob===job&&!job.cancelled;
 try{let cursor=0,chunks=[],manifests=[],snapshot=null,dictionary=null;
  for(let page=0;page<50;page++){
   const params=new URLSearchParams(snapshots.query);params.set('format',format);params.set('cursor',String(cursor));params.set('limit','5000');if(snapshot)params.set('snapshot',snapshot);
   const result=await requestJSON(analyticsQuery(params),{signal:job.controller.signal});if(!valid())return;
   if(typeof result.content!=='string'||!result.manifest||!result.dictionary)throw new Error('匯出資料不完整');
   const manifest=result.manifest;if(!manifest.snapshotId||snapshot&&manifest.snapshotId!==snapshot)throw new Error('匯出資料已更新');snapshot=manifest.snapshotId;
   if(!Number.isSafeInteger(manifest.returned)||manifest.returned<0||!Number.isSafeInteger(manifest.totalMatched)||manifest.totalMatched<0)throw new Error('匯出資料不完整');
   if(job.total!==null&&manifest.totalMatched!==job.total)throw new Error('匯出資料已更新');job.total=manifest.totalMatched;
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(result.content)),checksum=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(!valid())return;if(checksum!==manifest.sha256)throw new Error('匯出完整性檢查未通過');
   if(dictionary&&JSON.stringify(dictionary)!==JSON.stringify(result.dictionary))throw new Error('匯出資料已更新');dictionary=result.dictionary;manifests.push(manifest);let content=result.content;if(format==='csv'&&page>0){const newline=content.indexOf('\n');if(newline<0)throw new Error('匯出資料不完整');content=content.slice(newline+1);}chunks.push(content);job.rows+=manifest.returned;job.pages++;updateExportProgress();
   if(manifest.nextCursor===null||manifest.nextCursor===undefined)break;const next=Number(manifest.nextCursor);if(!Number.isFinite(next)||next<=cursor)throw new Error('分頁順序不完整');cursor=next;if(page===49)throw new Error('紀錄較多，請縮短日期範圍再匯出。');
  }
  if(!valid())return;if(job.rows!==job.total)throw new Error('匯出筆數未齊');
  const content=chunks.join(''),blob=new Blob([format==='csv'?'\uFEFF':'',content],{type:format==='csv'?'text/csv;charset=utf-8':'application/x-ndjson'});
  download(blob,`普通話研究紀錄_${snapshots.from}_${snapshots.to}.${format}`);download(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),filters:Object.fromEntries(snapshots.query),rows:job.rows,dictionary,pages:manifests},null,2)],{type:'application/json'}),`普通話研究紀錄_${snapshots.from}_${snapshots.to}_說明.json`);
  job.status='complete';job.message=`已核對 ${job.pages} 頁、${job.rows.toLocaleString()} 筆紀錄；已下載資料檔與字典說明。`;toast(`已匯出 ${job.rows.toLocaleString()} 筆研究事件及資料字典。`);
 }catch(error){if(!valid())return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}job.status='error';job.message=error.code==='NARROW_DATE_OR_CLASS_FILTER'?'紀錄較多，請先縮短日期範圍或選擇一個班別，再重新匯出。':error.status===409||error.message==='匯出資料已更新'?'匯出期間有新紀錄加入，沒有下載部分檔案。請重新匯出。':error.message==='紀錄較多，請縮短日期範圍再匯出。'?error.message:'完整性核對或連線未完成，沒有下載部分檔案。請重新匯出。';toast(job.message);
 }finally{if(epoch===sessionEpoch&&state.exportJob===job)updateExportProgress();}
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
  const form=document.querySelector('#teacher-filters'),grade=event.target.value,previous=form.elements.cls.value,classes=[...new Set((state.roster||[]).filter(row=>!grade||String(row.grade)===grade).map(row=>String(row.cls||'')))].filter(Boolean).sort();if(state.legacy&&!classes.length)classes.push('A','B','C','D','E','F');
  form.elements.cls.innerHTML=(state.legacy?'':'<option value="">全部班別</option>')+classes.map(cls=>`<option value="${esc(cls)}" ${cls===previous?'selected':''}>${esc(cls)} 班</option>`).join('');
 }
 if(event.target.closest('#teacher-filters'))markFilterDraft();
});
root.addEventListener('input',event=>{
 if(event.target.closest('#teacher-filters')){markFilterDraft();return;}
 if(event.isComposing||event.target.id!=='student-search')return;state.search=event.target.value;state.page=0;const cursor=event.target.selectionStart;updateStudentList();const input=document.querySelector('#student-search');input?.focus();try{input?.setSelectionRange(cursor,cursor);}catch{}
});
root.addEventListener('compositionend',event=>{if(event.target.id==='student-search')event.target.dispatchEvent(new Event('input',{bubbles:true}));});
function click(event){const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.teacherTool){const tool=button.dataset.teacherTool;if(tool==='docx')void generateAnalysis();else if(tool==='cancel-analysis')cancelAnalysis();else if(tool==='cancel-document')cancelDocument();else void exportDocument(tool);return;}
 if(button.dataset.view){state.view=button.dataset.view;state.page=0;renderDashboard();}
 if(button.dataset.action==='refresh'||button.dataset.action==='retry-roster'){if(state.rosterError||button.dataset.action==='retry-roster')void enterDashboard();else void loadData();}
 if(button.dataset.action==='boot')void boot();if(button.dataset.action==='logout')void logout();
 if(button.dataset.action==='reset-filters')applyFilters({grade:'',cls:'',from:dayOffset(-29),to:dayOffset(0),attempt:'latest',activity:''});
 if(button.dataset.dateOffset!==undefined){const form=document.querySelector('#teacher-filters');form.elements.from.value=dayOffset(Number(button.dataset.dateOffset));form.elements.to.value=dayOffset(0);markFilterDraft();}
 if(button.dataset.studentFilter){showStudentGroup(button.dataset.studentFilter,button.dataset.construct||'');}
 if(button.dataset.detailTab)switchDetailTab(button.dataset.detailTab);
 if(button.dataset.detailNext){const cohort=selectedStudents(),index=cohort.findIndex(row=>row.researchId===state.detailStudent?.researchId),next=cohort[index+Number(button.dataset.detailNext)];if(next)void openStudent(next.researchId,{keepTab:true});}
 if(button.dataset.action==='retry-detail'&&state.detailStudent)void openStudent(state.detailStudent.researchId,{keepTab:true});
 if(button.dataset.action==='close-dialog'){state.detailRequest?.abort();state.detailStudent=null;state.detailData=null;dialog.close();document.querySelector('#student-dialog-content').replaceChildren();}
 if(button.dataset.action==='confirm-reset')confirmPasswordReset();if(button.dataset.action==='reset-password')void resetStudentPassword(button);if(button.dataset.action==='cancel-reset')document.querySelector('#student-password-reset')?.replaceChildren();if(button.dataset.action==='copy-password')void copyStudentPassword();
 if(button.dataset.student)void openStudent(button.dataset.student);if(button.dataset.export)void exportData(button.dataset.export,button);if(button.dataset.action==='cancel-export')cancelExport();
 if(button.dataset.page!==undefined){state.page=Math.max(0,Number(button.dataset.page)||0);updateStudentList();document.querySelector('#student-list')?.scrollIntoView({block:'start',behavior:'instant'});}
 if(button.dataset.groupGrade)applyFilters({...state.filters,grade:button.dataset.groupGrade,cls:button.dataset.groupClass||''});
}
root.addEventListener('click',click);dialog.addEventListener('click',click);
dialog.addEventListener('keydown',event=>{if(!event.target.matches('[data-detail-tab]')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();switchDetailTab(event.key==='Home'?'learning':event.key==='End'?'history':state.detailTab==='learning'?'history':'learning',{focus:true});});
dialog.addEventListener('close',()=>{if(dialog.open)return;state.detailRequest?.abort();state.detailStudent=null;state.detailData=null;document.querySelector('#student-dialog-content').replaceChildren();});
dialog.addEventListener('submit',event=>{if(event.target.id==='teacher-password-form'){event.preventDefault();void changePassword(event.target);}});document.querySelector('#teacher-logout').addEventListener('click',logout);
// Remove the old teacher-token persistence once; school credentials are never stored in browser storage.
try{sessionStorage.removeItem('maanshan-teacher-access');}catch{}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void checkSession();});
window.addEventListener('pagehide',()=>{clearPrivate();root.replaceChildren();});window.addEventListener('pageshow',event=>{if(event.persisted)void boot();else void checkSession();});
boot();
