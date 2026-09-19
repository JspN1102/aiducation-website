const AUTH='/api/school-auth',ANALYTICS='/api/teacher-analytics';
const root=document.querySelector('#teacher-root'),dialog=document.querySelector('#student-dialog');
const state={auth:null,legacy:false,legacyCode:'',roster:null,rosterError:false,data:null,poems:[],view:'overview',search:'',page:0,generation:0,request:null,detailRequest:null,detailStudent:null,filters:{grade:'',cls:'',from:dayOffset(-29),to:dayOffset(0),attempt:'latest',activity:''}};
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
async function requestJSON(url,{signal,headers={},...options}={}){
 const controller=new AbortController(),epoch=sessionEpoch,abort=()=>controller.abort();pendingRequests.add(controller);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timeout=setTimeout(abort,25000);
 try{const response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...headers},signal:controller.signal});
  let data=null;try{data=await response.json();}catch{}
  if(epoch!==sessionEpoch||controller.signal.aborted)throw new DOMException('Session request cancelled','AbortError');
  if(!response.ok){const error=new Error(data?.error||'讀取未完成');error.status=response.status;error.code=data?.code;throw error;}
  if(!data||typeof data!=='object')throw new Error('回應格式不完整');return data;
 }finally{pendingRequests.delete(controller);clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
function clearPrivate(){sessionEpoch++;for(const controller of pendingRequests)controller.abort();pendingRequests.clear();sessionCheck=null;state.request?.abort();state.detailRequest?.abort();state.generation++;state.data=null;state.roster=null;state.rosterError=false;state.auth=null;state.legacyCode='';state.search='';state.page=0;state.detailStudent=null;if(dialog.open)dialog.close();document.querySelector('#student-dialog-content').replaceChildren();const identity=document.querySelector('#teacher-identity');identity.textContent='';identity.hidden=true;document.querySelector('#teacher-logout').hidden=true;document.querySelector('#teacher-change-password')?.remove();}
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
 try{const [roster,catalog]=await Promise.all([requestJSON(AUTH+'?action=roster'),state.poems.length?Promise.resolve(null):requestJSON('./poems.json').catch(()=>null)]);if(generation!==state.generation)return;state.roster=Array.isArray(roster.students)?roster.students:[];state.rosterError=false;if(Array.isArray(catalog?.poems))state.poems=catalog.poems;}
 catch(error){if(generation!==state.generation)return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}state.rosterError=true;}
 if(generation!==state.generation)return;renderFilters();await loadData();
}
function renderShell(){
 root.innerHTML=`<div class="workspace"><aside class="teacher-sidebar" aria-label="教師功能"><p class="sidebar-label">教學視角</p><nav class="view-nav">${[['overview','學習總覽'],['students','學生紀錄'],['quality','資料品質']].map(([id,label])=>`<button data-view="${id}" ${state.view===id?'aria-current="page"':''}>${icon(id)}${label}</button>`).join('')}</nav><div class="sidebar-foot">觀察每位學生的進步。<br>不以分數為學生排名。</div></aside><main class="teacher-main" id="teacher-main"><div class="page-heading"><div><p class="eyebrow">TEACHING OBSERVATORY</p><h1 id="view-title">全校學習總覽</h1><p id="view-description">了解參與情況，安排下一次教學。</p><div class="sync-state" id="sync-state"><span class="sync-dot"></span>正在取得紀錄</div></div><div class="heading-actions"><button type="button" class="button" data-action="refresh">${icon('refresh')}更新</button></div></div><div id="filter-holder"></div><div id="dashboard-content" aria-live="polite"></div></main></div>`;renderFilters();
}
function renderFilters(){
 const f=state.filters,classes=[...new Set((state.roster||[]).filter(s=>!f.grade||String(s.grade)===f.grade).map(s=>String(s.cls||'')))].filter(Boolean).sort();
 if(state.legacy&&!classes.length)classes.push('A','B','C','D','E','F');
 const holder=document.querySelector('#filter-holder');if(!holder)return;
 holder.innerHTML=`<form class="filters" id="teacher-filters"><label class="field" for="filter-grade">年級<select id="filter-grade" name="grade">${state.legacy?'':'<option value="">全校六個年級</option>'}${[1,2,3,4,5,6].map(g=>`<option value="${g}" ${f.grade===String(g)?'selected':''}>${g} 年級</option>`).join('')}</select></label><label class="field" for="filter-class">班別<select id="filter-class" name="cls">${state.legacy?'':'<option value="">全部班別</option>'}${classes.map(c=>`<option value="${esc(c)}" ${f.cls===c?'selected':''}>${esc(c)} 班</option>`).join('')}</select></label><label class="field" for="filter-from">開始日期<input type="date" id="filter-from" name="from" value="${esc(f.from)}" ${state.legacy?'disabled':''} required></label><label class="field" for="filter-to">結束日期<input type="date" id="filter-to" name="to" value="${esc(f.to)}" ${state.legacy?'disabled':''} required></label><label class="field" for="filter-attempt">觀察哪次表現<select id="filter-attempt" name="attempt" ${state.legacy?'disabled':''}><option value="latest" ${f.attempt==='latest'?'selected':''}>最近一次</option><option value="first" ${f.attempt==='first'?'selected':''}>首次嘗試</option></select></label><button class="button primary" type="submit">套用範圍</button><div class="filter-note"><span>${state.legacy?'舊版單班摘要 · 日期與首次／最近切換不適用':'日期按 UTC 劃分；同步時間以香港時間顯示。每次最多 31 天。'}</span><strong>${esc(scopeLabel())}</strong></div></form>`;
 const activity=document.createElement('label');activity.className='field';activity.htmlFor='filter-activity';activity.innerHTML=`活動<select id="filter-activity" name="activity" ${state.legacy?'disabled':''}>${[['','全部活動'],['listen','聽一聽'],['read','讀一讀'],['animation','看一看動畫'],['explore','詩境探索'],['challenge','練一練'],['writing','寫字練習'],['chat','與詩人聊天'],['navigation','瀏覽與選詩']].map(([value,label])=>`<option value="${value}" ${f.activity===value?'selected':''}>${label}</option>`).join('')}</select>`;holder.querySelector('[type=submit]').before(activity);
 if(!state.legacy)holder.querySelector('.filter-note span').textContent='日期按 UTC 劃分；同步時間以香港時間顯示。每次最多 31 天。';
}
function scopeLabel(){return `${state.filters.grade?state.filters.grade+' 年級':'全校'}${state.filters.cls?' · '+state.filters.cls+' 班':''}`;}
function rangeValid(f=state.filters){const a=new Date(f.from+'T00:00:00Z'),b=new Date(f.to+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(f.from)&&/^\d{4}-\d{2}-\d{2}$/.test(f.to)&&Number.isFinite(a.getTime())&&Number.isFinite(b.getTime())&&a.toISOString().slice(0,10)===f.from&&b.toISOString().slice(0,10)===f.to&&b>=a&&(b-a)/86400000<31;}
async function loadData(){
 const generation=++state.generation;state.request?.abort();const controller=new AbortController();state.request=controller;state.data=null;state.page=0;
 const host=document.querySelector('#dashboard-content');if(!host)return;
 if(!state.legacy&&!rangeValid()){host.innerHTML='<p class="status-strip error" role="alert">請選擇有效日期，開始至結束日期最多 31 天。</p>';return;}
 host.innerHTML='<div class="initial-state" aria-busy="true"><span class="loader" aria-hidden="true"></span><p>正在整理學習紀錄</p></div>';
 try{
  const data=state.legacy?await loadLegacy(controller.signal):await requestJSON(ANALYTICS+'?'+selectionQuery(),{signal:controller.signal});
  if(generation!==state.generation)return;if(!Array.isArray(data.students))throw new Error('學生紀錄格式不完整');state.data=data;renderDashboard();
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
function activeStatus(row){return state.data?.sync?.status==='unavailable'?['等待同步','']:!isActive(row)?['期內未有紀錄','']:number(row.completedN)>0?['有完成紀錄','green']:['已有練習紀錄','blue'];}
function kpi(label,value,note,unit=''){return `<article class="kpi"><div class="kpi-accent"></div><p class="kpi-label">${esc(label)}</p><p class="kpi-value">${esc(value)}${unit?`<small>${esc(unit)}</small>`:''}</p><p class="kpi-note">${esc(note)}</p></article>`;}
function renderDashboard(){
 if(!state.data)return;
 const descriptions={overview:['全校學習總覽','了解參與情況，安排下一次教學。'],students:['學生練習紀錄','按年級、班別與學號排列，查看個人學習歷程。'],quality:['資料品質與匯出','先了解資料涵蓋範圍，再解讀學習成果。']};
 document.querySelector('#view-title').textContent=descriptions[state.view][0];document.querySelector('#view-description').textContent=descriptions[state.view][1];
 document.querySelectorAll('[data-view]').forEach(el=>{if(el.dataset.view===state.view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 const sync=state.data.sync||{};document.querySelector('#sync-state').innerHTML=`<span class="sync-dot"></span>${state.legacy?'摘要更新':'資料整理'}：${esc(timestamp(state.data.generatedAt))}${sync.lastImportedAt?' · 最近同步 '+esc(timestamp(sync.lastImportedAt)):''}`;
 const content=document.querySelector('#dashboard-content');let note='';
 if(state.legacy)note='<p class="status-strip warning">舊版資料：只顯示這個班別已同步的最新摘要。沒有全校名冊、完整嘗試歷程及研究事件。</p>';
 else if(state.rosterError)note='<p class="status-strip warning">名冊暫時未能載入，只列出有紀錄的研究代碼。參與率與未開始人數暫不計算。</p>';
 if(sync.status==='unavailable')note+='<p class="status-strip warning">研究紀錄尚未完成首次同步。此時的空白不代表學生沒有練習，請稍後更新。</p>';
 else if(sync.status==='catching_up')note+='<p class="status-strip warning">正在補齊同步，資料未齊。現有數字只代表已同步部分，請稍後更新再作教學判斷。</p>';
 else if(sync.status==='published')note+='<p class="status-strip">目前顯示已同步的研究資料，最新練習會在下次同步後出現。</p>';
 else if(sync.status&& !['direct','current','fresh','ready','ok','synced','live'].includes(sync.status))note+='<p class="status-strip warning">部分紀錄可能尚在同步，請以最近同步時間及資料品質說明為準。</p>';
 content.innerHTML=note+(state.view==='overview'?overview():state.view==='students'?studentList():quality());
}
function overview(){
 const students=joinedStudents(),active=students.filter(isActive),completed=students.filter(s=>s.completedN>0),rosterN=!state.legacy&&state.roster?filteredRoster().length:null;
 const server=state.data.summary?.serverVerified||{},client=state.data.summary?.clientReported||{},attempt=state.filters.attempt==='first'?'首次':'最近';
 const ready=state.data.sync?.status!=='unavailable';const cards=kpi('有練習紀錄',ready?String(active.length):'—',!ready?'等待研究紀錄首次同步':rosterN===null?'名冊人數未提供':`名冊 ${rosterN} 人 · 期內未有紀錄 ${Math.max(0,rosterN-active.filter(s=>s.person.id).length)} 人`,'人')+kpi('有完成紀錄',state.legacy||!ready?'—':String(completed.length),state.legacy?'舊版摘要未提供完成事件':'至少一項活動有完成紀錄','人')+kpi(state.legacy?'舊版朗讀摘要':'已驗證測量',ready?shown(server.measuredN):'—',`${attempt}嘗試 · ${state.legacy?'舊版摘要筆數':'有效伺服器測量筆數'}`,'筆')+kpi('練習測量紀錄',ready?shown(client.measuredN):'—',`${attempt}嘗試 · 有效學生端回報`,'筆');
 const groups=state.filters.grade?(state.data.byClass||[]):state.data.byGrade||[];
 const groupRows=groups.map(group=>{const people=(state.roster||[]).filter(p=>Number(p.grade)===Number(group.grade)&&(!group.cls||p.cls===group.cls));return{label:group.grade+(group.cls||' 年級'),grade:group.grade,cls:group.cls||'',active:Number(group.nStudents)||0,total:state.roster?people.length:null};});
 // Include classes or grades without any events using the authenticated roster.
 for(const person of filteredRoster()){const key=state.filters.grade?person.grade+person.cls:String(person.grade)+' 年級';if(!groupRows.some(g=>g.label===key))groupRows.push({label:key,grade:person.grade,cls:state.filters.grade?person.cls:'',active:0,total:filteredRoster().filter(p=>p.grade===person.grade&&(!state.filters.grade||p.cls===person.cls)).length});}
 groupRows.sort((a,b)=>a.grade-b.grade||a.cls.localeCompare(b.cls));
 const bars=groupRows.length?`<div class="progress-list">${groupRows.map(g=>`<div class="progress-line"><button data-group-grade="${g.grade}" data-group-class="${esc(g.cls)}">${esc(g.label)}</button><div class="bar-track" role="img" aria-label="${esc(g.label)}，${g.active} 人有紀錄${g.total===null?'':`，名冊 ${g.total} 人`}"><span class="bar-fill" style="width:${g.total?Math.min(100,g.active/g.total*100):0}%"></span></div><span class="bar-value">${g.active}${g.total===null?' 人':' / '+g.total}</span></div>`).join('')}</div><div class="legend"><span><i></i>有紀錄學生</span><span><i class="pale"></i>名冊內其餘學生</span></div>`:empty('暫時沒有可分組的紀錄','匯入名冊後，沒有開始的班別也會顯示。');
 const attention=students.filter(s=>readingMetric(selectedSummary(s)).measuredN>0&&readingScore(s)!==null&&readingScore(s)<60).slice(0,6);
 const attentionHTML=attention.length?`<ul class="attention-list">${attention.map(s=>`<li class="attention-item"><div class="person"><span class="avatar">${esc(s.grade+s.cls)}</span><div><p class="student-name">${esc(s.person.displayName)}</p><p class="student-meta">${esc(s.grade+s.cls)} 班 · ${esc(state.filters.attempt==='first'?'首次':'最近')}朗讀 ${shown(readingScore(s),1)} 分</p></div></div><button class="button small" data-student="${esc(s.researchId)}">查看歷程</button></li>`).join('')}</ul>`:empty('目前沒有符合這項規則的學生','已測朗讀低於 60 分會列在這裏；未測不視作低分。');
 const skills=state.legacy&&state.data.legacyPhonics?renderLegacySkills(state.data.legacyPhonics):readingWordPractice(state.data);
 return `<div class="kpi-grid">${cards}</div><div class="dashboard-grid">${panel(state.filters.grade?'班級參與情況':'六個年級，一眼掌握','人數分母來自學校名冊；可按年級或班別查看。',bars)}${panel('需留意的朗讀表現','篩選規則：所選嘗試的已測朗讀均分低於 60；按班別與學號排列。',attentionHTML)}${constructBreakdown(state.data.summary)}${panel(state.legacy?'語音練習觀察':'可以再練的字','按句內位置分組，列出有低於 60 分紀錄的字；僅使用伺服器驗證的逐字評測。',skills)}${panel('這段時間的學習節奏','每日有紀錄的人數；同一學生跨日參與會在各日計數。',trendChart(state.data.trend||[],'participation'))}</div>`;
}
function renderLegacySkills(phonics){const entries=Object.entries(phonics).filter(([,v])=>score(v)!==null);return entries.length?`<div class="skill-list">${entries.map(([label,v])=>`<div><div class="skill-header"><span>${esc(label)}</span><span>${shown(v,1)} 分</span></div><div class="skill-track" role="img" aria-label="${esc(label)}，${v} 分"><span style="width:${v}%"></span></div></div>`).join('')}</div>`:empty('尚未有語音細項成績');}
function readingWordPractice(data){
 const words=(Array.isArray(data.readingWords)?data.readingWords:[]).filter(word=>typeof word.char==='string'&&word.count>0&&word.below60Count>0&&score(word.meanScore)!==null),visible=words.slice(0,8);
 if(!visible.length)return empty(data.readingWordSummary?.totalGroups>0?'目前沒有需要重練的字音紀錄':'尚未有逐字評測紀錄',data.readingWordSummary?.totalGroups>0?'所選範圍內，已驗證的逐字評測沒有低於 60 分的紀錄。':'逐字評測同步後會列出可重練的字；不由總分推斷聲母、韻母或聲調問題。');
 return `<ul class="word-practice-list">${visible.map(word=>{const poem=state.poems.find(p=>Number(p.id)===Number(word.poemId)),line=/\.l(\d+)$/.exec(String(word.itemId)),position=line?'第 '+(Number(line[1])+1)+' 句':'';return `<li><strong class="word-practice-glyph">${esc(word.char)}</strong><div><h3>${esc(poem?.title||'第 '+word.poemId+' 首古詩')}${position?' · '+position:''}</h3><p>${shown(word.below60Count)} / ${shown(word.count)} 次低於 60 分 · 均分 ${shown(word.meanScore,1)}</p></div></li>`;}).join('')}</ul>${data.readingWordSummary?.truncated||words.length>visible.length?'<p class="helper">還有其他字音紀錄，可選年級或班別進一步查看。</p>':''}`;
}
function studentList(){
 const all=joinedStudents(),term=state.search.trim().toLowerCase(),filtered=all.filter(s=>!term||[s.person.displayName,s.researchId,s.person.classNo].some(v=>String(v||'').toLowerCase().includes(term))),size=20,pages=Math.max(1,Math.ceil(filtered.length/size));state.page=Math.min(state.page,pages-1);const page=filtered.slice(state.page*size,(state.page+1)*size);
 const rows=page.map(s=>{const [status,tone]=activeStatus(s);return `<tr><td><button class="name-button" data-student="${esc(s.researchId)}">${esc(s.person.displayName)}</button><p class="student-meta">${esc(s.grade+s.cls)} 班${s.person.classNo?' · '+esc(s.person.classNo)+' 號':''}</p></td><td><span class="mobile-label">參與</span><span class="tag ${tone}">${status}</span></td><td><span class="mobile-label">朗讀</span>${scoreMarkup(readingScore(s))}</td><td><span class="mobile-label">有效練習</span><span>${isActive(s)?shown(practiceCount(s))+' 筆':'—'}</span></td><td><span class="mobile-label">嘗試</span><span class="mono">${isActive(s)?shown(s.nAttempts):'—'}</span></td><td class="muted">${esc(s.lastSeenAt?timestamp(s.lastSeenAt):'未有紀錄')}</td><td><button class="button small" data-student="${esc(s.researchId)}" aria-label="查看${esc(s.person.displayName)}的歷程">查看</button></td></tr>`;}).join('');
 return `<section class="panel"><div class="list-toolbar"><div><h2>每位學生的學習情況</h2><p class="helper">${esc(scopeLabel())} · ${all.length} 人 · 不按成績排名</p></div><label class="search-field"><span class="sr-only">搜尋姓名、學號或研究代碼</span><input type="search" id="student-search" value="${esc(state.search)}" placeholder="搜尋姓名或學號" autocomplete="off"></label></div>${rows?`<div class="table-area"><table class="student-table"><thead><tr><th scope="col">學生</th><th scope="col">參與情況</th><th scope="col">朗讀</th><th scope="col">有效練習</th><th scope="col">嘗試次數</th><th scope="col">最近紀錄</th><th scope="col">歷程</th></tr></thead><tbody>${rows}</tbody></table></div><div class="list-summary"><span>「未測」表示沒有有效分數，真實 0 分會顯示 0。</span></div><div class="pagination"><button class="button small" data-page="${state.page-1}" ${state.page===0?'disabled':''}>上一頁</button><span>${state.page+1} / ${pages} · 共 ${filtered.length} 人</span><button class="button small" data-page="${state.page+1}" ${state.page+1>=pages?'disabled':''}>下一頁</button></div>`:empty('沒有符合搜尋的學生',state.roster?'試試其他姓名、班別或日期。':'全校名冊尚未提供。')}</section>`;
}
function quality(){
 if(state.legacy)return panel('舊版資料範圍','這個入口只保留單班的最新摘要。','<dl class="definition-list"><div><dt>成績來源</dt><dd>歷史摘要的朗讀與寫字分數，沒有完整的評測來源與嘗試事件，不能重新核實。</dd></div><div><dt>尚未提供</dt><dd>全校名冊、首次嘗試、完整過程、事件匯出及研究資料字典。</dd></div><div><dt>缺失與 0 分</dt><dd>沒有成績顯示未測；歷史摘要明確保存的 0 分仍顯示 0。</dd></div></dl>',true);
 const c=state.data.coverage||{},summary=state.data.summary||{},server=summary.serverVerified||{},client=summary.clientReported||{};
 const items=[['事件紀錄',c.nEvents,'所選日期與範圍內的事件數'],['已驗證測量',server.measuredN,'伺服器已驗證，具有有效分數'],['學生端練習回報',client.measuredN,'由瀏覽器回報；與伺服器評測分開解讀'],['需排除的紀錄',c.nInvalidEvents,'未通過資料品質檢查的事件']];
 return `<div class="dashboard-grid">${panel('先看資料，再看成績','這些數字說明資料涵蓋程度，不代表學生能力。',`<div class="quality-grid">${items.map(([label,value,note])=>`<article class="quality-item"><h3>${label}</h3><strong>${shown(value)}</strong><p>${note}</p></article>`).join('')}</div>`,true)}${panel('解讀方式','不同來源、不同嘗試，不混在一起當作同一項評測。',`<dl class="definition-list"><div><dt>名冊與參與</dt><dd>沒有期內紀錄的名冊學生仍保留在學生列表；不能據此判定整學期從未練習。</dd></div><div><dt>首次／最近</dt><dd>在所選日期內，按每位學生、古詩、活動、題目、內容版本與模式選取首次或最近嘗試；同次嘗試多次回報只取最後結果。輔助與自由練習不計入獨立表現均分。</dd></div><div><dt>真實 0 分</dt><dd>只有有效回傳的數字 0 才計入 0 分。未測、缺失與同步未完成不計為零。</dd></div><div><dt>兩類來源</dt><dd>均分以有效的題目結果計算；不同題目與模式不視為相同難度。朗讀評測與學生端練習回報分開呈現，回報成績不等於伺服器驗證的評測。</dd></div></dl>`,true)}${constructBreakdown(summary)}${modeBreakdown(summary)}${panel('資料涵蓋與同步','匯出時一併保留資料字典版本與篩選範圍。',`<dl class="definition-list"><div><dt>資料字典</dt><dd>${esc(state.data.dictionaryVersion||'舊版摘要，未提供事件字典')}</dd></div><div><dt>最近匯入</dt><dd>${esc(state.data.sync?.status==='direct'?'直接讀取資料庫，無需匯入':timestamp(state.data.sync?.lastImportedAt))}</dd></div><div><dt>整理時間</dt><dd>${esc(timestamp(state.data.generatedAt))}</dd></div><div><dt>觀察日期</dt><dd>${esc(state.filters.from)} 至 ${esc(state.filters.to)} · UTC 日期</dd></div><div><dt>輔助／自由練習</dt><dd>${shown(summary.practiceOutcomeN)} 筆練習結果；保留過程，但不計入獨立表現均分。</dd></div><div><dt>未測紀錄</dt><dd>伺服器測量 ${shown(server.unmeasuredN)} 筆；練習回報 ${shown(client.unmeasuredN)} 筆。沒有分數不代表表現欠佳。</dd></div><div><dt>語音細項</dt><dd>逐字評測可指出需要重練的字；這不等於聲母、韻母或聲調的診斷，不根據總分推測問題。</dd></div></dl><div class="export-box"><div><h3>匯出研究紀錄</h3><p>只包含研究代碼與事件資料，不附姓名、密碼或錄音。完整歷程不限於目前選中的首次／最近。</p></div><div class="export-actions"><button class="button" data-export="csv" ${state.legacy?'disabled':''}>${icon('download')}CSV</button><button class="button" data-export="jsonl" ${state.legacy?'disabled':''}>JSONL</button></div></div>`,true)}</div>`;
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
async function openStudent(researchId){
 const student=joinedStudents().find(s=>s.researchId===researchId);if(!student)return;state.detailStudent=student;state.detailRequest?.abort();const controller=new AbortController();state.detailRequest=controller;
 document.querySelector('#student-dialog-content').innerHTML=detailShell(student,'<div class="empty"><span class="loader"></span><p>正在取得個人歷程</p></div>',false);if(!dialog.open)dialog.showModal();
 try{const data=state.legacy?state.data:await requestJSON(ANALYTICS+'?'+selectionQuery({student:researchId,grade:student.grade,cls:student.cls}),{signal:controller.signal});if(controller.signal.aborted)return;
  const record=data.students?.find(s=>s.researchId===researchId)||student;document.querySelector('#student-dialog-content').innerHTML=detailShell(student,detailBody(record,data));
 }catch(error){if(controller.signal.aborted)return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}document.querySelector('#student-dialog-content').innerHTML=detailShell(student,empty('個人歷程暫時未能載入','關閉後再試一次。'));}
}
function detailShell(student,body,ready=true){return `<header class="dialog-header"><div><p class="eyebrow">學生學習歷程</p><h2 id="student-dialog-title">${esc(student.person.displayName)}</h2><p class="helper">${esc(student.grade+student.cls)} 班${student.person.classNo?' · '+esc(student.person.classNo)+' 號':''} · ${esc(state.filters.from)} 至 ${esc(state.filters.to)}</p></div><button class="button icon-only" data-action="close-dialog" aria-label="關閉學生歷程">×</button></header><div class="dialog-body">${body}${ready&&!state.legacy&&student.person.id?`<div class="password-reset-section"><button class="button quiet small" data-action="confirm-reset">重設學生密碼</button><div id="student-password-reset"></div></div>`:''}</div>`;}
function detailBody(record,data){
 const first=record.first||{},latest=record.latest||{},f=score(readingMetric(first).meanScore),l=score(readingMetric(latest).meanScore);
 const cards=kpi('首次朗讀',shown(f,1),'所選範圍的首次嘗試','分')+kpi('最近朗讀',shown(l,1),'所選範圍的最近嘗試','分')+kpi('嘗試次數',isActive(record)?shown(record.nAttempts):'—','未有紀錄不計成 0 分','次');
 const daily=(data.trend||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 return `<div class="kpi-grid">${cards}</div>${!isActive(record)?'<p class="status-strip">所選日期內尚未有練習紀錄。可調整日期查看其他時段。</p>':''}${panel('朗讀變化',state.legacy?'舊版摘要沒有每日評測紀錄。':'伺服器驗證的評測；沒有分數的日期不畫成零分。',trendChart(data.trend||[],'reading'))}${data.readingWordSummary?panel('可以再練的字','伺服器逐字評測中低於 60 分的紀錄；按詩句位置分開。',readingWordPractice(data)):''}${constructBreakdown(selectedSummary(record),{first,latest})}${modeBreakdown(data.summary)}${panel('每日練習歷程','按日期查看嘗試及完成情況，保留過程與成果的差別。',daily.length?`<ol class="timeline">${daily.map(day=>`<li><time datetime="${esc(day.date)}">${esc(day.date)}</time><div><h3>${shown(day.nAttempts)} 次嘗試 · ${shown(day.completedN)} 項完成紀錄</h3><p>朗讀 ${score(readingMetric(day).meanScore)===null?'未測':shown(readingMetric(day).meanScore,1)+' 分'} · 有效練習 ${shown(day.clientReported?.measuredN)} 筆</p></div></li>`).join('')}</ol>`:empty('尚未有每日歷程',state.legacy?'舊版只保存最新摘要，不能重建過去的嘗試。':''))}`;
}
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
 catch(error){if(epoch!==sessionEpoch)return;if(error.status===401&&error.code!=='INVALID_CREDENTIALS'||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}if(!form.isConnected)return;errorEl.textContent=error.code==='INVALID_CREDENTIALS'?'目前密碼不正確。':error.status===429?'修改次數較多，請 15 分鐘後再試。':error.status===409?'帳戶資料已變更，請重新登入後再試。':error.status===400?'新密碼不符合要求，請檢查長度。':'修改尚未確認，請檢查連線後重新登入。';errorEl.hidden=false;}
 finally{form.reset();button.disabled=false;button.textContent='儲存新密碼';}
}
function confirmPasswordReset(){
 const student=state.detailStudent,host=document.querySelector('#student-password-reset');if(!student?.person.id||!host)return;
 host.innerHTML=`<div class="reset-confirmation"><h3>確認重設 ${esc(student.person.displayName)} 的密碼？</h3><p>學生所有已登入裝置將登出。新密碼只會在這次畫面顯示，請當面交給學生。</p><div class="form-actions"><button class="button" data-action="cancel-reset">取消</button><button class="button primary" data-action="reset-password">確認重設</button></div><p class="form-error" role="alert" hidden></p></div>`;
 host.querySelector('[data-action=cancel-reset]').focus();
}
async function resetStudentPassword(button){
 const student=state.detailStudent,host=document.querySelector('#student-password-reset');if(!student?.person.id||!host)return;
 button.disabled=true;button.textContent='正在重設…';
 try{const result=await requestJSON(AUTH,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.auth?.csrfToken||''},body:JSON.stringify({action:'reset_student_password',studentId:student.person.id})});if(!result.reset||result.studentId!==student.person.id||typeof result.initialPassword!=='string')throw new Error('重設結果未獲確認');if(!host.isConnected||state.detailStudent!==student)return;
  host.innerHTML=`<div class="reset-confirmation"><h3>密碼已重設</h3><p>只在這次畫面顯示，關閉後不會保存。</p><label class="field">${esc(student.person.displayName)} 的新密碼<input id="reset-password-value" type="text" readonly autocomplete="off" spellcheck="false"></label><div class="form-actions"><button class="button primary" data-action="copy-password">複製新密碼</button><button class="button" data-action="cancel-reset">已記下，隱藏密碼</button></div></div>`;host.querySelector('input').value=result.initialPassword;
 }catch(error){if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');return;}if(!host.isConnected)return;const el=host.querySelector('.form-error');if(el){el.textContent=error.status===429?'重設次數較多，請 15 分鐘後再試。':error.status===404?'這位學生的帳戶已停用或不存在。':error.status===409?'學生帳戶已變更，請關閉後重新查看。':'重設結果未獲確認，請檢查連線後再試。';el.hidden=false;}button.disabled=false;button.textContent='確認重設';}
}
async function copyStudentPassword(){const input=document.querySelector('#reset-password-value');if(!input)return;try{await navigator.clipboard.writeText(input.value);toast('已複製新密碼，請妥善交給學生。');}catch{input.focus();input.select();toast('請複製已選取的新密碼。');}}
async function exportData(format,button){
 if(state.legacy||!state.data)return;const epoch=sessionEpoch;button.disabled=true;const old=button.textContent;button.textContent='準備匯出…';const snapshots={query:selectionQuery(),grade:state.filters.grade,cls:state.filters.cls,from:state.filters.from,to:state.filters.to};
  try{let cursor=0,total=0,chunks=[],manifests=[],snapshot=null,dictionary=null;const authAtStart=state.auth;for(let page=0;page<50;page++){
   const params=new URLSearchParams(snapshots.query);params.set('format',format);params.set('cursor',String(cursor));params.set('limit','5000');if(snapshot)params.set('snapshot',snapshot);const result=await requestJSON(ANALYTICS+'?'+params);
    if(state.auth!==authAtStart||!state.auth)return;
    if(typeof result.content!=='string'||!result.manifest||!result.dictionary)throw new Error('匯出資料不完整');
    const manifest=result.manifest;if(!manifest.snapshotId||snapshot&&manifest.snapshotId!==snapshot)throw new Error('匯出資料已更新');snapshot=manifest.snapshotId;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(result.content)),checksum=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(checksum!==manifest.sha256)throw new Error('匯出完整性檢查未通過');
    if(dictionary&&JSON.stringify(dictionary)!==JSON.stringify(result.dictionary))throw new Error('匯出資料已更新');dictionary=result.dictionary;manifests.push(manifest);let content=result.content;if(format==='csv'&&page>0){const newline=content.indexOf('\n');if(newline<0)throw new Error('匯出資料不完整');content=content.slice(newline+1);}chunks.push(content);total+=Number(manifest.returned)||0;
   if(manifest.nextCursor===null||manifest.nextCursor===undefined)break;const next=Number(manifest.nextCursor);if(!Number.isFinite(next)||next<=cursor)throw new Error('分頁順序不完整');cursor=next;if(page===49)throw new Error('紀錄較多，請縮短日期範圍再匯出。');
  }
   if(state.auth!==authAtStart||!state.auth)return;const content=chunks.join(''),blob=new Blob([format==='csv'?'\uFEFF':'',content],{type:format==='csv'?'text/csv;charset=utf-8':'application/x-ndjson'});download(blob,`普通話研究紀錄_${snapshots.from}_${snapshots.to}.${format}`);download(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),filters:Object.fromEntries(snapshots.query),rows:total,dictionary,pages:manifests},null,2)],{type:'application/json'}),`普通話研究紀錄_${snapshots.from}_${snapshots.to}_說明.json`);toast(`已匯出 ${total.toLocaleString()} 筆研究事件及資料字典。`);
 }catch(error){if(epoch!==sessionEpoch)return;if(error.status===401||error.status===403){clearPrivate();renderLogin('登入已失效，請重新登入。');}else toast(error.code==='NARROW_DATE_OR_CLASS_FILTER'?'紀錄較多，請縮短日期範圍或選擇一個班別再匯出。':error.status===409||error.message==='匯出資料已更新'?'匯出期間有新紀錄加入，請重新匯出。':error.message==='紀錄較多，請縮短日期範圍再匯出。'?error.message:'匯出未完成，請稍後重試。');}
 finally{button.disabled=false;button.textContent=old;}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function loadLegacy(signal){
 const grade=Number(state.filters.grade),cls=state.filters.cls,poem=state.poems.find(p=>Number(p.grade)===grade)||state.poems.find(p=>p.id===grade),poemId=poem?.id||grade;
 const data=await requestJSON('/api/maanshan-data?'+new URLSearchParams({grade,cls,poemId}),{signal,headers:{Authorization:'Bearer '+state.legacyCode}});if(data.error)throw new Error('舊版資料暫未可用');
 const students=(data.students||[]).map(s=>{const r=score(s.score),w=score(s.writeScore),summary={nEvents:1,nStudents:1,nAttempts:null,completedN:null,serverVerified:{meanScore:r,measuredN:r===null?0:1,unmeasuredN:r===null?1:0},clientReported:{meanScore:w,measuredN:w===null?0:1,unmeasuredN:w===null?1:0}};return{researchId:String(s.id),legacyName:String(s.name||'未命名學生'),grade,cls,...summary,first:{},latest:summary,lastSeenAt:s.lastUpdated};});
 return{schemaVersion:1,generatedAt:new Date().toISOString(),legacyPhonics:data.phonAvg,students,summary:{serverVerified:{meanScore:mean(students.map(s=>s.serverVerified.meanScore)),measuredN:students.filter(s=>s.serverVerified.meanScore!==null).length},clientReported:{meanScore:mean(students.map(s=>s.clientReported.meanScore)),measuredN:students.filter(s=>s.clientReported.meanScore!==null).length}},byGrade:[],byClass:[],trend:[],coverage:{nStudents:students.length,nEvents:null,nInvalidEvents:null}};
}
root.addEventListener('submit',event=>{
 if(event.target.id==='teacher-login-form'){event.preventDefault();login(event.target);}
 if(event.target.id==='teacher-filters'){event.preventDefault();const form=new FormData(event.target),next={...state.filters};for(const key of ['grade','cls','from','to','attempt','activity'])if(form.has(key))next[key]=String(form.get(key));if(!state.legacy&&!rangeValid(next)){toast('請選擇有效日期，開始至結束日期最多 31 天。');return;}state.filters=next;state.search='';renderFilters();loadData();}
});
root.addEventListener('change',event=>{if(event.target.id==='filter-grade'){const form=document.querySelector('#teacher-filters'),grade=event.target.value,classes=[...new Set((state.roster||[]).filter(s=>!grade||String(s.grade)===grade).map(s=>String(s.cls||'')))].filter(Boolean).sort();if(state.legacy&&!classes.length)classes.push('A','B','C','D','E','F');form.elements.cls.innerHTML=(state.legacy?'':'<option value="">全部班別</option>')+classes.map(c=>`<option value="${esc(c)}">${esc(c)} 班</option>`).join('');}});
root.addEventListener('input',event=>{if(event.isComposing||event.target.id!=='student-search')return;state.search=event.target.value;state.page=0;const cursor=event.target.selectionStart;document.querySelector('#dashboard-content').innerHTML=studentList();const input=document.querySelector('#student-search');input.focus();try{input.setSelectionRange(cursor,cursor);}catch{}});
function click(event){const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.view){state.view=button.dataset.view;state.page=0;renderDashboard();}
  if(button.dataset.action==='refresh'){if(state.rosterError)enterDashboard();else loadData();}if(button.dataset.action==='boot')boot();if(button.dataset.action==='logout')logout();if(button.dataset.action==='close-dialog'){state.detailRequest?.abort();state.detailStudent=null;dialog.close();document.querySelector('#student-dialog-content').replaceChildren();}
  if(button.dataset.action==='confirm-reset')confirmPasswordReset();if(button.dataset.action==='reset-password')resetStudentPassword(button);if(button.dataset.action==='cancel-reset')document.querySelector('#student-password-reset')?.replaceChildren();if(button.dataset.action==='copy-password')copyStudentPassword();
 if(button.dataset.student)openStudent(button.dataset.student);if(button.dataset.export)exportData(button.dataset.export,button);
 if(button.dataset.page!==undefined){state.page=Math.max(0,Number(button.dataset.page)||0);renderDashboard();}
 if(button.dataset.groupGrade){state.filters.grade=button.dataset.groupGrade;state.filters.cls=button.dataset.groupClass||'';renderFilters();loadData();}
}
root.addEventListener('click',click);dialog.addEventListener('click',click);dialog.addEventListener('close',()=>{if(dialog.open)return;state.detailRequest?.abort();state.detailStudent=null;document.querySelector('#student-dialog-content').replaceChildren();});dialog.addEventListener('submit',event=>{if(event.target.id==='teacher-password-form'){event.preventDefault();changePassword(event.target);}});document.querySelector('#teacher-logout').addEventListener('click',logout);
// Remove the old teacher-token persistence once; school credentials are never stored in browser storage.
try{sessionStorage.removeItem('maanshan-teacher-access');}catch{}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void checkSession();});
window.addEventListener('pagehide',()=>{clearPrivate();root.replaceChildren();});window.addEventListener('pageshow',event=>{if(event.persisted)void boot();else void checkSession();});
boot();
