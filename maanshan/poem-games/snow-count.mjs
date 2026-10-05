import {createGameImageLoader} from './image-ready.mjs?v=20260922-school11';
import {imageAsset} from '../media-images.mjs?v=20261006-school42';
import {createProcessResearch} from './research.mjs?v=20260920a';
const file = path => new URL(imageAsset(`media/${path}`), import.meta.url).href;
// 「數雪花」: catch ten flakes, tap the sky three times, hide five flakes in the white plum,
// then look for 「雪」 among the poem's 28 characters — there is none (the poem's 「奇」).
// Coordinates are % of the 1600×900 scenes; blossom spots sit on painted white flowers of scene 4.
const lines = ['一片兩片三四片','五六七八九十片','千片萬片無數片','飛入梅花都不見'],chars = lines.join('');
const lit = [[0,2,4,5,7],[0,1,2,3,4,5,7],[0,2,4,7],[0,1,2,4,5,7]];
const nums = [...'一兩三四五六七八九十'], many = ['千片','萬片','無數片'], left = ['','一','兩','三','四','五'];
const flakes = [[9,20],[27,14],[45,24],[64,14],[83,21],[16,46],[34,42],[50,63],[72,42],[90,55]];
const bigs = [[9,20],[26,14],[16,49],[34,40],[24,75]];
const plums = [[48.5,28],[70.5,26.5],[84.2,13.5],[93.2,41],[78.2,56.8]];
const alts = ['湖邊的天空，飄着幾片雪花。','雪花多起來了。','大雪紛飛，數也數不完。','雪中開滿白色的梅花。'];
const knowledge = '題目叫《詠雪》，詩裏卻一個「雪」字也沒有，句句都在寫雪：雪花從一片數到無數片，最後飛入白梅花都不見。這就是詩的「奇」。';
const wonder = ['題目叫《詠雪》，','詩裏沒有「雪」字。'];
// Snow settles on the tiles in a loose, unhurried order.
const settle = [...chars].map((_,i)=>i*37%28*48+(i%3)*90);
const arms = ['M0 0V-43M0-17l-11-9M0-17l11-9M0-30l-8-7M0-30l8-7','M0 0V-41M0-12l-12-7M0-12l12-7M0-25l-10-9M0-25l10-9M0-35l-5-5M0-35l5-5','M0 0V-42M0-26l-12-5M0-26l12-5M0-26l-5-11M0-26l5-11'];
const crystal = v => {const d=[0,60,120,180,240,300].map(r=>`<path d="${arms[v%3]}" transform="rotate(${r})"/>`).join('');return `<svg viewBox="-50 -50 100 100" aria-hidden="true" focusable="false"><g class="sc-edge">${d}</g><g class="sc-core">${d}</g>${v%3===2?'<circle class="sc-hub" r="7"/>':''}</svg>`;};
const blossom = `<svg class="sc-bloom" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">${[0,72,144,216,288].map(r=>`<circle cy="-21" r="19" transform="rotate(${r})"/>`).join('')}<circle class="sc-heart" r="9"/></svg>`;
const ear = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-5 4H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
let seed = 11; const rnd = () => (seed = seed*16807%2147483647)/2147483647;
const fall = Array.from({length:96},(_,i)=>`<i style="--x:${(rnd()*100).toFixed(1)}%;--y:${(rnd()*94).toFixed(1)}%;--s:${(i<18?5+rnd()*6:i<60?3.5+rnd()*5:2.5+rnd()*4).toFixed(1)}px;--d:${(i<18?7+rnd()*5:i<60?4.5+rnd()*3:3+rnd()*2).toFixed(1)}s;--t:-${(rnd()*12).toFixed(1)}s;--w:${Math.round(rnd()*50-25)}px;--o:${(.6+rnd()*.4).toFixed(2)}"></i>`).join('');

export function mountSnowCount(holder,{initialState,readOnly=false,playAudio,onState,onComplete,onResearch,reducedMotion=false,onProgress}={}){
  const doc=holder.ownerDocument,view=doc.defaultView,abort=new view.AbortController(),signal=abort.signal,timers=new Set();
  const loadImages=createGameImageLoader({signal});
  const raw=initialState&&typeof initialState==='object'&&!Array.isArray(initialState)?initialState:{};
  // Version 1 saved the first three rounds and continues into the 「雪」 round; unknown versions start afresh.
  // A solved state counts only once the app confirms it (gameCompleted); otherwise the last question is asked again.
  const init=raw.version===1||raw.version===2||raw.gameCompleted===true?raw:{};
  const pick=(v,n)=>Array.isArray(v)?[...new Set(v.filter(i=>Number.isInteger(i)&&i>=0&&i<n))]:Number.isInteger(v)?[...Array(Math.max(0,Math.min(n,v))).keys()]:[];
  let caught=pick(init.caught,10),flurry=caught.length===10&&[0,1,2,3].includes(init.flurry)?init.flurry:0,hidden=flurry===3?pick(init.hidden,5):[];
  let seen=hidden.length===5&&Array.isArray(init.seen)?pick(init.seen,28):[],solved=false;
  const fill=()=>{caught=[...Array(10).keys()];flurry=3;hidden=[0,1,2,3,4];solved=true;};
  if(readOnly||init.gameCompleted===true)fill();
  const stage=()=>caught.length<10?'catch':flurry<3?'flurry':hidden.length<5?'hide':solved?'done':'seek';
  let shown=stage(),reported=shown==='done',dead=false,ready=false,loadId=0,selected=null,drag=null,dragFrame=0,suppress={i:-1,until:0},lastSky=0,kb=false,speaking=false,audioGen=0,audioContext=null,noise=null,marksFor='',wrong=0,reading=-1,rove=0;
  const queue=[],spoken=new Set(),flying=new Set(),dest=new Map(),anims=new Set();
  const research=createProcessResearch(onResearch,{prefix:'game.snow',alive:()=>!dead&&!readOnly});
  const root=doc.createElement('section');root.className=`poem-snow-game${reducedMotion?' is-reduced':''}`;root.setAttribute('aria-label','數雪花');
  root.innerHTML=`<div class="sc-layout">
    <div class="sc-head"><p class="sc-task"></p><span class="sc-chip"></span></div>
    <div class="sc-stage" aria-busy="true">
      ${[1,2,3,4].map(n=>`<img class="sc-scene" data-scene="${n}" alt="" width="1600" height="900" draggable="false" decoding="async">`).join('')}
      <div class="sc-veil" aria-hidden="true"></div><div class="sc-fall" aria-hidden="true">${fall}</div>
      <div class="sc-flakes" role="group" aria-label="飄着的雪花">${flakes.map(([x,y],i)=>`<button type="button" class="sc-flake" data-flake="${i}" style="--x:${x}%;--y:${y}%;--d:${(7+i%4*1.3).toFixed(1)}s;--t:-${(i*1.7%9).toFixed(1)}s" aria-label="雪花" disabled>${crystal(i)}</button>`).join('')}</div>
      <button type="button" class="sc-sky" data-sky aria-label="輕輕點天空，讓雪下得更大" hidden disabled><span class="sc-sky-hint" aria-hidden="true">點天空</span></button>
      <div class="sc-plums" role="group" aria-label="白梅花" hidden>${plums.map(([x,y],i)=>`<button type="button" class="sc-plum" data-plum="${i}" style="--x:${x}%;--y:${y}%" aria-label="白梅花，第${'一二三四五'[i]}朵" disabled><span></span></button>`).join('')}</div>
      <div class="sc-bigs" role="group" aria-label="五片大雪花" hidden>${bigs.map(([x,y],i)=>`<button type="button" class="sc-big" data-big="${i}" style="--x:${x}%;--y:${y}%" aria-label="大雪花，第${'一二三四五'[i]}片" aria-pressed="false" disabled><span class="sc-big-art">${crystal(i+1)}</span></button>`).join('')}</div>
      <div class="sc-poem" role="group" aria-label="《詠雪》全詩" hidden>${lines.map((line,r)=>`<div class="sc-row" role="group" aria-label="第${'一二三四'[r]}句">${[...line].map((c,k)=>`<button type="button" class="sc-tile" data-tile="${r*7+k}" style="--n:${r*7+k};--k:${settle[r*7+k]}" tabindex="-1" disabled><span class="sc-face"><span class="sc-char">${c}</span><i class="sc-cap" aria-hidden="true">${crystal(r*7+k)}</i></span></button>`).join('')}</div>`).join('')}</div>
      <div class="sc-end" hidden><span>飛入梅花都不見</span><small>白雪飛進白梅，分不出來了。</small></div>
      <div class="sc-loading" role="status"><span>雪景正在展開…</span><button type="button" data-sc-retry hidden>再試一次</button></div>
    </div>
    <div class="sc-card" role="img"><span class="sc-count"><small></small><b></b></span><span class="sc-marks" aria-hidden="true"></span></div>
    <div class="sc-ask" role="group" aria-label="詩裏有沒有「雪」字？" hidden><span class="sc-want"><small>要找的字</small><b>雪</b></span><button type="button" class="sc-answer" data-sc-answer="yes" disabled>有</button><button type="button" class="sc-answer" data-sc-answer="none" disabled>一個也沒有！</button></div>
    <div class="sc-actionline"><p class="sc-verse"></p><button type="button" class="sc-listen" data-sc-listen>${ear}<span>聽這句詩</span></button></div>
    <p class="sc-feedback" role="status" aria-live="polite"></p>
  </div>`;
  holder.append(root);
  const q=s=>root.querySelector(s),all=s=>[...root.querySelectorAll(s)],stageEl=q('.sc-stage'),scenes=all('.sc-scene');
  const tell=text=>{if(!dead)q('.sc-feedback').textContent=text;};
  const later=(fn,ms)=>{const id=view.setTimeout(()=>{timers.delete(id);if(!dead)fn();},ms);timers.add(id);return id;};
  const state=()=>({version:2,stage:stage(),caught:[...caught],flurry,hidden:[...hidden],seen:[...seen],solved});
  const save=()=>{if(!readOnly&&!dead)onState?.(state());};
  const progress=()=>{if(!readOnly&&!dead)onProgress?.({completed:caught.length+flurry+hidden.length+(solved?1:0),total:19});};
  const live=s=>ready&&!dead&&!readOnly&&shown===s&&stage()===s;
  const sceneNo=()=>shown==='catch'?(caught.length>=4?2:1):shown==='flurry'?(flurry?3:2):4;
  const lineNo=()=>shown==='catch'?(caught.length<=4?0:1):shown==='flurry'?2:3;
  const poem=()=>shown==='seek'||shown==='done';
  const intro={catch:'雪花慢慢飄下來了。點一點，數一數。',flurry:'雪越下越大了。輕輕點天空看看。',hide:'看，白色的梅花開了。把雪花送進去。',seek:'找一找！點一點詩裏的字。',done:'一個「雪」字也沒有，卻寫滿了雪！這就是詩的「奇」。'};
  const task={catch:'點一點雪花，一片一片數。',flurry:'輕輕點天空，讓雪下得更大。',hide:'把雪花送進白色的梅花裏。',end:'雪花飛入梅花，不見了！',seek:'題目叫《詠雪》，詩裏有沒有「雪」字？',done:'你找到了詩的「奇」！'};
  const poet=`<span class="sc-poet"><img src="${file('yong-xue/avatar.webp')}" alt="鄭板橋說" width="480" height="600" decoding="async" draggable="false"></span>`;

  function render(){
    const s=shown,n=caught.length,h=hidden.length,sc=sceneNo(),li=lineNo(),end=s==='hide'&&h===5,key=end?'end':s;
    root.dataset.stage=s;root.classList.toggle('is-carrying',selected!==null||!!drag?.moved);
    scenes.forEach((img,i)=>{img.classList.toggle('is-on',i<sc);img.alt=i+1===sc?alts[i]:'';});
    q('.sc-fall').dataset.level=s==='catch'?'off':s==='flurry'?String(flurry):s==='done'?'1':'0';
    q('.sc-veil').classList.toggle('is-on',s==='flurry'&&flurry===3||poem());
    const t=q('.sc-task');if(t.dataset.stage!==key){t.dataset.stage=key;t.classList.toggle('has-poet',poem());t.innerHTML=(poem()?poet:'')+`<span class="sc-say">${task[key].split(/(?<=，)/).map(c=>`<span>${c}</span>`).join('')}</span>`;}
    const chip=q('.sc-chip'),no=s==='catch'?1:s==='flurry'?2:s==='hide'?3:4;chip.textContent=`${no} / 4`;chip.setAttribute('aria-label',`第${no}步，共4步`);
    q('.sc-flakes').hidden=s!=='catch';
    all('.sc-flake').forEach((b,i)=>{const got=caught.includes(i);b.classList.toggle('is-caught',got);b.disabled=got||!live('catch');b.setAttribute('aria-hidden',String(got));});
    const sky=q('.sc-sky');sky.hidden=s!=='flurry';sky.disabled=!live('flurry');
    q('.sc-bigs').hidden=s!=='hide';q('.sc-plums').hidden=s!=='hide'||end;
    all('.sc-plum').forEach(b=>{b.disabled=!live('hide');});
    all('.sc-big').forEach((b,i)=>{
      const gone=hidden.includes(i),[x,y]=gone&&dest.has(i)?plums[dest.get(i)]:bigs[i];
      b.style.setProperty('--x',`${x}%`);b.style.setProperty('--y',`${y}%`);
      if(!drag||drag.b!==b){b.style.removeProperty('--dx');b.style.removeProperty('--dy');}
      b.classList.toggle('is-gone',gone);b.classList.toggle('is-selected',selected===i);b.setAttribute('aria-pressed',String(selected===i));
      b.disabled=gone||!live('hide');b.setAttribute('aria-hidden',String(gone));
    });
    q('.sc-end').hidden=!end;
    // The poem board: 28 character tiles; one of them carries the keyboard tab stop.
    q('.sc-poem').hidden=!poem();
    all('.sc-tile').forEach((b,i)=>{b.disabled=!live('seek');b.tabIndex=i===rove?0:-1;b.classList.toggle('is-seen',seen.includes(i));});
    all('.sc-row').forEach((row,k)=>row.classList.toggle('is-reading',k===reading));
    q('.sc-card').hidden=s==='seek';q('.sc-ask').hidden=s!=='seek';
    all('[data-sc-answer]').forEach(b=>{b.disabled=!live('seek');});
    // Counting card: the big word, and a tidy row of marks.
    const group=s==='catch'||s==='flurry'||s==='done'?s:'hide',marks=q('.sc-marks');
    if(marksFor!==group){marksFor=group;marks.dataset.kind=group;marks.innerHTML=group==='catch'?flakes.map((_,i)=>`<i class="sc-mark">${crystal(i)}</i>`).join(''):group==='flurry'?many.map(w=>`<i class="sc-pill">${w}</i>`).join(''):group==='done'?`<span class="sc-wonder">${wonder.map(w=>`<span>${w}</span>`).join('')}</span>`:bigs.map((_,i)=>`<i class="sc-mark">${crystal(i+1)}${blossom}</i>`).join('');}
    all('.sc-marks>i').forEach((m,i)=>m.classList.toggle('is-on',group==='catch'?i<n&&!flying.has(i):group==='flurry'?i<flurry:i<h));
    const [label,word,said]=s==='catch'?[n?'數到':'點一點',n?`${nums[n-1]}片`:'數一數',n?`數到${nums[n-1]}片`:'還沒有數']:s==='flurry'?['雪越下越多',flurry?many[flurry-1]:'十片',flurry?many[flurry-1]:'十片']:s==='done'?['詩的','奇',`詩的「奇」：${wonder.join('')}`]:h<5?['還有',`${left[5-h]}片`,`還有${left[5-h]}片雪花`]:['雪花','不見了','雪花都不見了'];
    const big=q('.sc-count b');q('.sc-count small').textContent=label;big.textContent=word;big.classList.toggle('is-muted',s==='catch'&&!n||s==='flurry'&&!flurry);big.classList.toggle('is-seal',s==='done');
    q('.sc-card').setAttribute('aria-label',said);
    const verse=q('.sc-verse'),shine=li===0?lit[0][Math.min(4,n)]:li===1?lit[1][n-4]:li===2?lit[2][flurry]:lit[3][h];verse.hidden=poem();
    if(verse.dataset.line!==String(li)){verse.dataset.line=String(li);verse.innerHTML=[...lines[li]].map(c=>`<span>${c}</span>`).join('');}
    all('.sc-verse span').forEach((c,i)=>c.classList.toggle('is-lit',i<shine));
    const listen=q('[data-sc-listen]');listen.disabled=!ready||speaking;listen.setAttribute('aria-busy',String(speaking));listen.querySelector('span').textContent=speaking?'仔細聽…':poem()?'聽這首詩':'聽這句詩';
  }
  function instant(){root.classList.add('is-instant');render();void root.offsetWidth;later(()=>root.classList.remove('is-instant'),60);}
  function present(){
    if(!ready||readOnly||dead)return;
    if(shown==='catch')research.present('catch',{total:10});
    else if(shown==='flurry')research.present('flurry',{total:3});
    else if(shown==='hide')bigs.forEach((_,i)=>{if(!hidden.includes(i))research.present(`hide.${i}`,{position:i,total:5});});
    else if(shown==='seek')research.present('seek',{total:28});
  }
  function focusFirst(selector){if(kb&&!dead)all(selector).find(b=>!b.disabled&&!b.closest('[hidden]'))?.focus({preventScroll:true});}
  function pulse(el,name,ms=900){el.classList.remove(name);void el.offsetWidth;el.classList.add(name);later(()=>el.classList.remove(name),ms);}
  function advance(){
    if(dead||shown===stage())return;shown=stage();selected=null;render();present();tell(intro[shown]);
    if(shown==='flurry')focusFirst('.sc-sky');else if(shown==='hide')focusFirst('.sc-big');else if(shown==='seek')focusFirst('.sc-tile');else if(shown==='done')focusFirst('[data-sc-listen]');
  }

  // Sound: short WebAudio cues for taps, and the recorded poem lines one at a time.
  function ac(){audioContext??=new(view.AudioContext||view.webkitAudioContext)();if(audioContext.state==='suspended')void audioContext.resume().catch(()=>{});return audioContext;}
  function chime(freqs,{gap=.09,peak=.1,len=.75}={}){try{const c=ac(),t0=c.currentTime;freqs.forEach((f,k)=>{const o=c.createOscillator(),g=c.createGain(),t=t0+k*gap;o.type='sine';o.frequency.setValueAtTime(f,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+len);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+len+.05);});}catch{}}
  const notes=[523.25,587.33,659.25,783.99,880,1046.5,1174.66,1318.51,1567.98,1760];
  function whoosh(level){try{const c=ac(),t=c.currentTime,len=1+level*.3;if(!noise){noise=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const d=noise.getChannelData(0);for(let k=0;k<d.length;k++)d[k]=Math.random()*2-1;}
    const s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();s.buffer=noise;f.type='bandpass';f.Q.value=.7;f.frequency.setValueAtTime(450+level*300,t);f.frequency.exponentialRampToValueAtTime(1300+level*450,t+len*.5);
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.06+level*.03,t+.28);g.gain.exponentialRampToValueAtTime(.0001,t+len);s.connect(f);f.connect(g);g.connect(c.destination);s.start(t);s.stop(t+len+.05);}catch{}}
  async function speak(text){let ok=false,timer=0;try{ok=await Promise.race([Promise.resolve().then(()=>playAudio?.({text})),new Promise(r=>{timer=later(()=>r(false),15000);})]);}catch{ok=false;}finally{view.clearTimeout(timer);timers.delete(timer);}return ok;}
  const audioStep=()=>shown==='done'?'game':shown;
  function say(li){if(readOnly||dead||typeof playAudio!=='function'||spoken.has(li))return;spoken.add(li);queue.push(li);void pump();}
  async function pump(){
    if(speaking||dead||!queue.length)return;const li=queue.shift(),gen=audioGen;speaking=true;render();
    const ok=await speak(lines[li]);if(dead||gen!==audioGen)return;speaking=false;if(ok!==true)research.error(audioStep(),'audio_unavailable');render();void pump();
  }
  // On the poem board the button reads the whole poem, lighting each line as it is heard.
  async function listen(){
    if(!ready||speaking||dead)return;const gen=audioGen,step=audioStep(),whole=poem();research.hint(step,'audio');speaking=true;
    let ok=false;
    for(const li of whole?[0,1,2,3]:[lineNo()]){reading=whole?li:-1;render();ok=await speak(lines[li]);if(dead||gen!==audioGen)return;if(ok!==true)break;}
    reading=-1;speaking=false;render();
    if(ok!==true){research.error(step,'audio_unavailable');tell('聲音暫時未能播放，可以看着詩句讀一讀。');}
    void pump();
  }

  // Scene 1–2: catch and count ten flakes.
  function ghost(button,k){
    const mark=all('.sc-marks>i')[k];if(reducedMotion||!mark||typeof button.animate!=='function')return;
    const R=root.getBoundingClientRect(),a=button.getBoundingClientRect(),b=mark.getBoundingClientRect(),w=a.width*.8,g=doc.createElement('span');
    const at=(r,dy=0,more='')=>`translate(${r.left-R.left+r.width/2-w/2}px,${r.top-R.top+r.height/2-w/2+dy}px)${more}`;
    g.className='sc-ghost';g.innerHTML=crystal(k);g.style.width=g.style.height=`${w}px`;root.append(g);flying.add(k);
    const anim=g.animate([{transform:at(a,0,' scale(1) rotate(0deg)')},{transform:at(a,-10,' scale(1.18) rotate(40deg)'),offset:.22},{transform:at(b,0,` scale(${Math.max(.3,b.width/w)}) rotate(120deg)`)}],{duration:760,easing:'cubic-bezier(.45,0,.25,1)'});
    anims.add(anim);const end=()=>{anims.delete(anim);g.remove();flying.delete(k);if(!dead)render();};anim.onfinish=end;anim.oncancel=end;
  }
  function catchFlake(i){
    if(!live('catch')||caught.includes(i))return;
    const button=q(`[data-flake="${i}"]`);caught.push(i);const n=caught.length;
    research.action('catch',`flake.${i}`);chime([notes[n-1]],{peak:.09,len:.9});
    if(n===10)research.answer('catch','count.10',true);
    ghost(button,n-1);render();save();progress();
    tell(['一片！再找一片。','兩片！再找一片。','三片！還有雪花在飄。','四片！詩人這樣數：一片兩片三四片。','五片！接着數。','六片！數得真好。','七片！還有三片。','八片！還有兩片。','九片！只差一片。','十片！五六七八九十片，數完了。'][n-1]);
    if(n===4)say(0);
    if(n===10){say(1);later(advance,reducedMotion?700:1500);}
    else if(kb){const rest=flakes.map((_,k)=>(i+1+k)%10).find(k=>!caught.includes(k));q(`[data-flake="${rest}"]`)?.focus({preventScroll:true});}
  }

  // Scene 2–3: three taps on the sky make 千片、萬片、無數片.
  function tapSky(event){
    if(!live('flurry'))return;const now=Date.now();if(now-lastSky<450)return;lastSky=now;
    flurry++;research.action('flurry',`tap.${flurry}`);whoosh(flurry);
    if(!reducedMotion){const r=stageEl.getBoundingClientRect(),dot=doc.createElement('span'),pointer=event?.detail!==0&&event?.clientX;dot.className='sc-ripple';dot.style.left=`${pointer?event.clientX-r.left:r.width/2}px`;dot.style.top=`${pointer?event.clientY-r.top:r.height*.3}px`;stageEl.append(dot);later(()=>dot.remove(),1100);}
    if(flurry===3)research.answer('flurry','count.3',true);
    render();save();progress();
    tell(['千片！雪越下越多。再點一下。','萬片！比千片還要多。再點一下。','無數片！多得數也數不完。'][flurry-1]);
    if(flurry===3){say(2);later(advance,reducedMotion?900:2600);}
  }

  // Scene 4: move five flakes into the white plum blossoms — drag, tap then tap, or keyboard.
  function hideFlake(i,p){
    if(!live('hide')||hidden.includes(i))return;
    research.answer(`hide.${i}`,'plum',true);hidden.push(i);dest.set(i,p);selected=null;render();save();progress();
    pulse(q(`[data-plum="${p}"]`),'is-glow',1600);
    later(()=>chime([1046.5,1318.51,1567.98],{gap:.1,peak:.07,len:1.1}),reducedMotion?60:520);
    const rest=5-hidden.length;
    tell(rest?`咦，雪花不見了！還有${left[rest]}片。`:'咦，五片雪花都不見了！');
    if(!rest){say(3);later(advance,reducedMotion?1600:3000);}
    else focusFirst('.sc-big');
  }
  function miss(i){research.answer(`hide.${i}`,'outside',false);research.hint(`hide.${i}`);tell('放到白色的梅花上試試。');}
  function select(i){
    if(!live('hide')||hidden.includes(i))return;
    if(selected===i){selected=null;render();tell('再點一片雪花，也可以拖過去。');return;}
    selected=i;research.action(`hide.${i}`,'select','option_selected');render();tell('選好了，再點一朵白梅花。');focusFirst('.sc-plum');
  }
  function plumTap(p){
    if(!live('hide'))return;
    if(selected===null){tell('先點一片雪花，再點白梅花。');pulse(q('.sc-bigs'),'is-nudge');return;}
    hideFlake(selected,p);
  }
  function nearest(x,y){
    const limit=Math.max(48,stageEl.getBoundingClientRect().width*.16);let best=-1,bd=limit;
    all('.sc-plum').forEach((el,k)=>{const r=el.getBoundingClientRect(),d=Math.hypot(x-r.left-r.width/2,y-r.top-r.height/2);if(d<bd){bd=d;best=k;}});return best;
  }
  const mark=k=>all('.sc-plum').forEach((el,j)=>el.classList.toggle('is-near',j===k));
  function paint(){dragFrame=0;if(!drag||dead)return;drag.b.style.setProperty('--dx',`${drag.dx}px`);drag.b.style.setProperty('--dy',`${drag.dy}px`);const k=nearest(drag.px,drag.py);if(k!==drag.near){drag.near=k;mark(k);}}
  function cancelDrag(){
    const d=drag;drag=null;view.cancelAnimationFrame(dragFrame);dragFrame=0;if(!d)return null;
    d.b.classList.remove('is-dragging');mark(-1);try{d.b.releasePointerCapture(d.id);}catch{}
    suppress={i:d.i,until:Date.now()+600};return d;
  }
  function down(event){
    const b=event.target.closest?.('.sc-big');kb=false;
    if(dead||drag||!b||b.disabled||event.button>0||event.isPrimary===false)return;
    if(event.cancelable)event.preventDefault();
    drag={id:event.pointerId,i:+b.dataset.big,b,x:event.clientX,y:event.clientY,dx:0,dy:0,px:event.clientX,py:event.clientY,moved:false,near:-1};
    if(event.pointerType!=='touch')b.focus({preventScroll:true});
    try{b.setPointerCapture(event.pointerId);}catch{}
  }
  function move(event){
    if(!drag||event.pointerId!==drag.id)return;if(event.cancelable)event.preventDefault();
    drag.dx=event.clientX-drag.x;drag.dy=event.clientY-drag.y;drag.px=event.clientX;drag.py=event.clientY;
    if(!drag.moved&&Math.hypot(drag.dx,drag.dy)>8){drag.moved=true;drag.b.classList.add('is-dragging');if(selected!==drag.i)selected=null;render();}
    if(drag.moved&&!dragFrame)dragFrame=view.requestAnimationFrame(paint);
  }
  function release(event){
    if(!drag||event.pointerId!==drag.id)return;
    const d=cancelDrag();if(!d.moved){if(event.type==='pointerup')select(d.i);else render();return;}
    const p=event.type==='pointerup'?nearest(event.clientX,event.clientY):-1;
    if(p>=0)hideFlake(d.i,p);else{render();if(event.type==='pointerup')miss(d.i);}
  }

  // Round 4: the title is 《詠雪》, yet none of the 28 characters is 「雪」. Each tap melts a tiny flake.
  function tapTile(i){
    if(!live('seek'))return;
    const c=chars[i],fresh=!seen.includes(i),twin=seen.some(k=>k!==i&&chars[k]===c);
    research.action('seek',`tile.${i}`);rove=i;if(fresh)seen.push(i);
    const tile=q(`[data-tile="${i}"]`);pulse(tile,'is-shimmer',800);
    if(!reducedMotion){const m=doc.createElement('i');m.className='sc-melt';m.setAttribute('aria-hidden','true');m.innerHTML=crystal(i);tile.querySelector('.sc-face').append(m);later(()=>m.remove(),1150);}
    chime([1567.98,1174.66],{gap:.08,peak:.05,len:.55});render();save();
    if(fresh&&seen.length===28){tell('每個字都看過了！詩裏有「雪」字嗎？');pulse(q('.sc-ask'),'is-pulse',1300);}
    else tell(!fresh?`「${c}」看過了，不是「雪」。`:twin?`又是「${c}」！不是「雪」。`:seen.length>1?`「${c}」也不是「雪」。`:`「${c}」不是「雪」。`);
  }
  function answer(none){
    if(!live('seek'))return;
    if(!none){
      wrong++;research.answer('seek','yes',false);research.hint('seek');chime([392,329.63],{gap:.14,peak:.05,len:.5});
      tell(wrong===1?'題目裏有「雪」，詩裏呢？點一點每個字，看一看。':'再找找，哪一個是「雪」字？');
      pulse(q('.sc-want'),'is-pulse',1300);pulse(q('.sc-poem'),'is-nudge');return;
    }
    research.answer('seek','none',true);solved=true;root.classList.add('is-celebrate');
    chime([1046.5,1318.51,1567.98,2093],{gap:.13,peak:.08,len:1.3});later(()=>whoosh(1),reducedMotion?0:250);save();progress();
    if(!reported){reported=true;research.complete();onComplete?.({correct:true,response:state(),knowledge});}
    advance();
  }

  async function load(){
    if(loadId)research.retry('assets');
    const request=++loadId,box=q('.sc-loading'),retry=q('[data-sc-retry]');ready=false;box.hidden=false;box.querySelector('span').textContent='雪景正在展開…';retry.hidden=true;stageEl.setAttribute('aria-busy','true');render();
    const unavailable=()=>{if(dead||request!==loadId)return;research.error('assets');box.querySelector('span').textContent='圖片還在載入，可以再試一次。';retry.hidden=false;stageEl.setAttribute('aria-busy','false');};
    const source=(img,again)=>{const url=new URL(file(`yong-xue/scene-${img.dataset.scene}.webp`));if(again)url.searchParams.set('retry',String(request));if(again||!img.getAttribute('src'))img.src=url.href;};
    try{
      const first=scenes[sceneNo()-1];first.fetchPriority='high';source(first,request>1);
      await loadImages([first],{onTimeout:unavailable});
      if(dead||request!==loadId)return;ready=true;box.hidden=true;stageEl.setAttribute('aria-busy','false');scenes.forEach(img=>source(img,false));
      render();present();progress();
    }catch{unavailable();}
  }

  root.addEventListener('pointerdown',down,{signal});
  root.addEventListener('pointermove',move,{signal,passive:false});
  root.addEventListener('pointerup',release,{signal});
  root.addEventListener('pointercancel',release,{signal});
  root.addEventListener('lostpointercapture',release,{signal});
  for(const type of ['contextmenu','selectstart','dragstart'])root.addEventListener(type,event=>{if(event.target.closest?.('.sc-stage')&&event.cancelable)event.preventDefault();},{signal});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden&&drag){cancelDrag();render();}},{signal});
  view.addEventListener('blur',()=>{if(drag){cancelDrag();render();}},{signal});
  root.addEventListener('click',event=>{
    const t=event.target;if(event.detail===0)kb=true;
    const flake=t.closest?.('[data-flake]'),big=t.closest?.('[data-big]'),plum=t.closest?.('[data-plum]'),tile=t.closest?.('[data-tile]'),ans=t.closest?.('[data-sc-answer]');
    if(flake)catchFlake(+flake.dataset.flake);
    else if(tile)tapTile(+tile.dataset.tile);
    else if(ans)answer(ans.dataset.scAnswer==='none');
    else if(t.closest?.('[data-sky]'))tapSky(event);
    else if(big){const i=+big.dataset.big;if(event.detail===0||suppress.i!==i||Date.now()>suppress.until)select(i);}
    else if(plum)plumTap(+plum.dataset.plum);
    else if(t.closest?.('[data-sc-listen]'))void listen();
    else if(t.closest?.('[data-sc-retry]'))void load();
  },{signal});
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&selected!==null){selected=null;render();tell('再點一片雪花，也可以拖過去。');return;}
    // Poem tiles move like a 4×7 grid: left/right along a line, up/down between lines.
    const tile=event.target.closest?.('.sc-tile'),jump={ArrowRight:1,ArrowLeft:-1,ArrowDown:7,ArrowUp:-7,Home:-rove%7,End:6-rove%7}[event.key];
    if(tile&&jump!==undefined){event.preventDefault();kb=true;rove=(rove+jump+28)%28;render();q(`[data-tile="${rove}"]`)?.focus({preventScroll:true});return;}
    const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key],el=event.target.closest?.('.sc-flake,.sc-big,.sc-plum');if(!step||!el)return;
    const group=all(`.${el.classList[0]}`).filter(b=>!b.disabled),k=group.indexOf(el);if(k<0)return;
    event.preventDefault();kb=true;group[(k+step+group.length)%group.length].focus({preventScroll:true});
  },{signal});

  // Stop sounds, timers and passing effects before showSolution/reset jump to another state.
  function quiet(){
    cancelDrag();timers.forEach(id=>view.clearTimeout(id));timers.clear();anims.forEach(a=>a.cancel());all('.sc-ghost,.sc-ripple,.sc-melt').forEach(n=>n.remove());
    all('.is-shimmer,.is-nudge,.is-glow,.is-pulse').forEach(n=>n.classList.remove('is-shimmer','is-nudge','is-glow','is-pulse'));root.classList.remove('is-celebrate');
    audioGen++;queue.length=0;speaking=false;reading=-1;
  }

  tell(intro[shown]);render();void load();
  return {
    showSolution(){
      if(dead||readOnly)return;quiet();
      if(stage()!=='done'){research.hint('game','reveal');reported=true;fill();}
      selected=null;shown='done';instant();tell(intro.done);
    },
    reset(){
      if(dead||readOnly)return;quiet();spoken.clear();flying.clear();dest.clear();
      caught=[];flurry=0;hidden=[];seen=[];solved=false;reported=false;wrong=0;rove=0;selected=null;lastSky=0;shown='catch';
      research.reset();instant();present();tell(intro.catch);save();progress();if(!ready&&!loadId)void load();
    },
    destroy(){
      if(dead)return;dead=true;loadId++;audioGen++;cancelDrag();abort.abort();timers.forEach(id=>view.clearTimeout(id));timers.clear();
      anims.forEach(a=>{try{a.cancel();}catch{}});try{void audioContext?.close().catch(()=>{});}catch{}root.remove();
    }
  };
}
