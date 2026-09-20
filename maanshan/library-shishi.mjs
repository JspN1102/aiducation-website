import {mountShishiSprite} from './shishi-sprite.mjs?v=20260921-school2';

export const LIBRARY_GREETING='選擇一首古詩，開始學習吧。';

// This welcome has its own sprite lifecycle; it never opens the poet chat.
export function mountLibraryShishi(host,{onSpeak,canPlay=()=>true}={}){
  const button=document.createElement('button');button.type='button';button.className='library-shishi';
  button.setAttribute('aria-label','聽詩詩介紹：選擇一首古詩，開始學習吧');
  const art=document.createElement('span');art.className='library-shishi-art';art.setAttribute('aria-hidden','true');
  button.append(art);host.append(button);
  let dead=false;
  const sprite=mountShishiSprite(art,{canPlay:()=>!dead&&canPlay(),interval:6500});
  const click=()=>{if(dead||!canPlay())return;void sprite.play('book');void onSpeak?.(LIBRARY_GREETING,button);};
  button.addEventListener('click',click);
  return{destroy(){if(dead)return;dead=true;sprite.destroy();button.removeEventListener('click',click);button.remove();}};
}
