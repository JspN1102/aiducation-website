import {mountShishiSprite} from './shishi-sprite.mjs?v=20260921-school6';

// This welcome has its own sprite and guide; it never opens the poet chat.
export function mountLibraryShishi(host,{canPlay=()=>true}={}){
  const button=document.createElement('button');button.type='button';button.className='library-shishi';
  button.setAttribute('aria-label','詩詩的學習小提示');
  button.setAttribute('aria-haspopup','dialog');
  button.setAttribute('aria-controls','library-shishi-guide');
  const art=document.createElement('span');art.className='library-shishi-art';art.setAttribute('aria-hidden','true');
  button.append(art);(host.querySelector('.library-title-end')||host).append(button);
  const guide=document.createElement('dialog');guide.id='library-shishi-guide';guide.className='library-guide-dialog';
  guide.setAttribute('aria-labelledby','library-guide-title');
  guide.setAttribute('aria-describedby','library-guide-text');
  guide.innerHTML='<button type="button" class="library-guide-close" aria-label="關閉小提示">×</button><h2 id="library-guide-title">跟詩詩一起學古詩</h2><p id="library-guide-text">先選一首古詩，跟着示範讀一讀。<br>讀完再玩小遊戲，一起聽清楚、說準確！</p><button type="button" class="button primary library-guide-done">我知道了</button>';
  host.append(guide);
  let dead=false;
  const sprite=mountShishiSprite(art,{canPlay:()=>!dead&&canPlay(),interval:6500});
  const close=()=>{guide.close();if(!dead&&button.isConnected)button.focus({preventScroll:true});};
  const click=()=>{if(dead||!canPlay())return;void sprite.play('book');if(!guide.open)guide.showModal();};
  const backdrop=event=>{if(event.target!==guide)return;const rect=guide.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();};
  const controller=new AbortController(),options={signal:controller.signal};
  guide.querySelector('.library-guide-close').addEventListener('click',close,options);
  guide.querySelector('.library-guide-done').addEventListener('click',close,options);
  guide.addEventListener('click',backdrop,options);
  button.addEventListener('click',click);
  return{destroy(){if(dead)return;dead=true;controller.abort();guide.close();sprite.destroy();button.removeEventListener('click',click);button.remove();guide.remove();}};
}
