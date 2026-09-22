import {imageAsset} from './media-images.mjs?v=20260923-school23';
import {fetchImage} from './image-loader.mjs?v=20260923-school23';
const stillURL=new URL(imageAsset('media/shishi/guide-still-20260919a.webp'),import.meta.url).href;
const gestures={wave:{url:new URL('./media/shishi/guide-wave-20260919a.webp',import.meta.url).href,duration:2000},book:{url:new URL('./media/shishi/guide-book-20260919a.webp',import.meta.url).href,duration:4000}};
const bytes=new Map();

/** Reuse the supplied 2D art. Static between short gestures; no render loop. */
export function mountShishiSprite(host,{canPlay=()=>true,interval=6000}={}){
 const events=new AbortController(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const still=new Image(256,376);still.alt='';still.src=stillURL;still.decoding='async';still.className='shishi-still';
 host.replaceChildren(still);host.dataset.gesture='idle';
 let dead=false,token=0,playing=null,objectURL=null,finishTimer=0,waveTimer=0;
 const allowed=()=>!dead&&host.isConnected&&!document.hidden&&!reduced.matches&&canPlay();
 function stop(){token++;clearTimeout(finishTimer);playing?.remove();playing=null;if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;still.style.visibility='';host.dataset.gesture='idle';}
 function schedule(){clearTimeout(waveTimer);if(dead)return;waveTimer=setTimeout(async()=>{if(allowed()&&host.dataset.gesture==='idle')await play('wave');schedule();},interval);}
 async function play(kind){
  if(!gestures[kind]||!allowed())return;
  stop();const generation=token,gesture=gestures[kind];
  try{
   if(!bytes.has(kind))bytes.set(kind,fetchImage(gesture.url).catch(error=>{bytes.delete(kind);throw error;}));
   const blob=await bytes.get(kind);if(generation!==token||!allowed())return;
   objectURL=URL.createObjectURL(blob);const image=new Image(256,376);image.alt='';image.className='shishi-gesture';image.src=objectURL;playing=image;
   await image.decode();if(generation!==token||!allowed()){if(generation===token)stop();return;}
   host.append(image);still.style.visibility='hidden';host.dataset.gesture=kind;
   finishTimer=setTimeout(()=>{if(generation===token)stop();},gesture.duration);
  }catch{if(generation===token)stop();}
 }
 function refresh(){if(!allowed())stop();schedule();}
 document.addEventListener('visibilitychange',refresh,{signal:events.signal});reduced.addEventListener('change',refresh,{signal:events.signal});schedule();
 return{play,stop,refresh,destroy(){if(dead)return;dead=true;stop();clearTimeout(waveTimer);events.abort();host.replaceChildren();}};
}
