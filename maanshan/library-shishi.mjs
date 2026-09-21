import {mountShishiSprite} from './shishi-sprite.mjs?v=20260921-school9';

// This welcome has its own sprite and guide; it never opens the poet chat.
export function mountLibraryShishi(host,{canPlay=()=>true}={}){
  const button=document.createElement('button');button.type='button';button.className='library-shishi';
  button.setAttribute('aria-label','詩詩的學習小提示');
  button.setAttribute('aria-expanded','false');
  button.setAttribute('aria-controls','library-shishi-guide');
  const art=document.createElement('span');art.className='library-shishi-art';art.setAttribute('aria-hidden','true');
  button.append(art);(host.querySelector('.library-title-end')||host).append(button);
  const guide=document.createElement('aside');guide.id='library-shishi-guide';guide.className='library-guide-bubble';guide.hidden=true;
  guide.setAttribute('aria-label','詩詩的小提示');
  guide.innerHTML='<button type="button" class="library-guide-close" aria-label="關閉小提示">×</button><p>選一首古詩，開始學習吧！</p>';
  host.append(guide);
  let dead=false,layoutFrame=0;
  const sprite=mountShishiSprite(art,{canPlay:()=>!dead&&canPlay(),interval:6500});
  function position(){
    if(dead||guide.hidden)return;
    const heading=host.getBoundingClientRect(),mascot=button.getBoundingClientRect(),width=Math.min(326,heading.width);
    guide.style.width=width+'px';
    const height=guide.offsetHeight,beside=heading.right-mascot.right>=width+12;
    const left=beside?mascot.right-heading.left+12:Math.max(0,Math.min(heading.width-width,mascot.right-heading.left-width+16));
    const top=beside?Math.max(0,mascot.top-heading.top+(mascot.height-height)/2):mascot.bottom-heading.top+10;
    guide.dataset.placement=beside?'beside':'below';
    guide.style.left=left+'px';guide.style.top=top+'px';
    guide.style.setProperty('--guide-tail',Math.max(22,Math.min((beside?height:width)-22,beside?mascot.top-heading.top+mascot.height/2-top:mascot.left-heading.left+mascot.width/2-left))+'px');
    // A transient popover must never resize the heading or shift the books.
  }
  const schedulePosition=()=>{cancelAnimationFrame(layoutFrame);layoutFrame=requestAnimationFrame(position);};
  const close=(restoreFocus=false)=>{guide.hidden=true;button.setAttribute('aria-expanded','false');host.style.removeProperty('--library-guide-space');if(restoreFocus&&!dead&&button.isConnected)button.focus({preventScroll:true});};
  const click=()=>{if(dead||!canPlay())return;if(!guide.hidden){close();return;}void sprite.play('book');guide.hidden=false;button.setAttribute('aria-expanded','true');position();};
  const outside=event=>{if(!guide.hidden&&!guide.contains(event.target)&&!button.contains(event.target))close();};
  const controller=new AbortController(),options={signal:controller.signal};
  guide.querySelector('.library-guide-close').addEventListener('click',()=>close(true),options);
  document.addEventListener('click',outside,options);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!guide.hidden){event.preventDefault();close(true);}},options);
  window.addEventListener('resize',schedulePosition,options);
  const resize=new ResizeObserver(schedulePosition);resize.observe(host.querySelector('h1')||button);
  button.addEventListener('click',click,options);
  return{destroy(){if(dead)return;dead=true;controller.abort();cancelAnimationFrame(layoutFrame);resize.disconnect();close();sprite.destroy();button.remove();guide.remove();}};
}
